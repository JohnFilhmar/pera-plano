// lib/bootstrap.ts — the single startup sequence the root layout awaits
// before mounting the navigator (task-17-brief.md rule 1). Applies pending
// migrations, seeds the default categories, seeds the bundled parser ruleset,
// and reads onboarding_complete — each of those four steps is independently
// safe to repeat (runMigrations tracks applied versions in schema_migrations;
// seedDefaultCategories uses fixed ids + INSERT OR IGNORE; seedParserRules
// upserts through a guard that ignores an equal-or-lower version; getSetting is
// a pure read) so bootstrapApp() itself is safe to call on every launch
// (brief's ordering-hazard rule 3).
import { AppState, type AppStateStatus } from "react-native";
import { getDatabase } from "@/lib/db/database";
import { runMigrations } from "@/lib/db/migrations";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { purgeExpired } from "@/lib/db/repos/review_queue_repo";
import { purgeExpiredRawCaptures } from "@/lib/db/repos/raw_notifications_repo";
import { getActiveRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { runIncomePass } from "@/lib/income/income_ledger_subscriber";
import { seedParserRules } from "@/lib/ingest/seed_rules";
import { persistPendingProviderPause } from "@/lib/onboarding/pending_provider_pause";
import { sweepOrphanedAttachments } from "@/lib/support/attachments";
import { purgeOldSupportReports } from "@/lib/support/outbox_runner";
import { listAllAttachmentFileUris } from "@/lib/support/support_reports_repo";
import { runRecurringPass } from "@/lib/recurring/recurring_ledger_subscriber";
import { checkForRulesetUpdate } from "@/services/parser_rules";
import { sendParseStats } from "@/services/telemetry";
import { setProviderFilter } from "@/modules/notification_listener";

export type BootstrapResult = { onboardingComplete: boolean };

// Holds the most recent bootstrapApp() result so app/index.tsx can read it
// synchronously without a second DB round-trip or a second render-blank gate
// of its own — by the time index.tsx mounts, the root layout has already
// awaited bootstrapApp() once (rule 1's gate). Module-level singleton, same
// house pattern as lib/db/database.ts's `dbPromise` and lib/fonts.ts's
// `applied` flag: a run-once-at-startup fact, not React state.
let lastResult: BootstrapResult | null = null;

/** Test-only reset so bootstrap.test.ts and app/__tests__ don't leak state across files. */
export function __resetBootstrapForTests(): void {
  lastResult = null;
}

/**
 * Runs the full startup sequence: apply pending migrations, seed the PH
 * default categories, seed the bundled parser ruleset, then read
 * `onboarding_complete`. Safe to call on every launch — and, per the brief,
 * safe to call twice in the same launch without doubling any seeded data.
 *
 * The ruleset seed sits after the category seed and before the settings read,
 * where it needs the migrated schema but nothing else. A failure here is left
 * to propagate like every other step's: a device that reaches the tabs with no
 * parser rules would look healthy while silently ingesting nothing, which is
 * worse than the recovery screen.
 */
export async function bootstrapApp(): Promise<BootstrapResult> {
  const db = await getDatabase();
  await runMigrations(db);
  await seedDefaultCategories();
  await seedParserRules();
  // The onboarding provider step's own selection (GAP-116). BEFORE the re-sync
  // below, so the launch that first stores the row is also the one that pushes
  // it back across the bridge.
  //
  // NO LONGER THE ONLY PLACE THIS HAPPENS (GAP-091). The step moved into the
  // numbered flow, where the database is open, so it normally persists its own
  // selection and there is nothing pending by the time this runs. It stays
  // because it is what recovers a write that failed on the screen, and because
  // an install that reached the step before the move still has to be drained.
  await persistPendingProviderPause();
  // The per-provider pause list, pushed back across the bridge (GAP-092).
  // AFTER the ruleset seed, because the allowlist it builds is "every package
  // the installed ruleset knows about, minus the paused ones" and there is no
  // package universe to subtract from until the seed has run. Awaited, unlike
  // the network calls below, because it is one settings read and one
  // SharedPreferences write, not a request that can hang on mobile data.
  await resyncProviderFilter();
  // The two server calls (M3c Task 7 rule 1). Fired here — after migrations
  // and seeding, so `getActiveVersion()` and `getParseStats()` have a
  // migrated, seeded schema to read — but DELIBERATELY NOT AWAITED, unlike
  // every other line in this function. Those are local database work;
  // `checkForRulesetUpdate` and `sendParseStats` are network calls, and on
  // Philippine mobile data a request can hang the better part of a minute.
  // Awaiting either would mean a bad signal on a jeepney holds the very
  // first frame hostage — exactly what STACK_BASIS §8 rules out. Both
  // already resolve `{ updated: false }` / `{ sent: false }` on every
  // failure mode they know about (offline, non-2xx, opted out, within their
  // own 24h interval) rather than throwing, so `fireNetworkSync`'s `.catch`
  // below is belt-and-braces for the one they don't: a bug in either
  // service that throws instead of resolving should not be able to reach
  // here and turn into an unhandled rejection.
  fireNetworkSync(Date.now());
  await runRetention(Date.now());
  // Income detection, once per launch (m2-part2 Task 14 rule 1). AFTER the
  // migrations and the seeds, because it reads the ledger and the loan
  // payments; BEFORE the settings read only because nothing depends on the
  // order there. `runIncomePass` swallows its own failures for the same reason
  // `runRetention` does — income is derived convenience, and a launch is not
  // worth failing over it (rule 3).
  await runIncomePass(Date.now());
  // Recurring-pattern detection, once per launch (M3 Part 2 Task 7 rule 2).
  // Same placement as income above, for the same reason: it reads the ledger
  // those migrations and seeds just made queryable, and nothing else here
  // depends on running before or after it. `runRecurringPass`
  // (lib/recurring/recurring_ledger_subscriber.ts) already wraps
  // `refreshPatterns` in the one try/catch this app should have for it — a
  // second, independently-written copy here would eventually disagree with
  // that one about what "failed safely" means, the same reasoning that keeps
  // this file calling `runIncomePass` instead of `refreshIncomeDetection`
  // directly. Patterns are derived from the ledger, same as income, so a
  // launch is not worth failing over them either (rule 3).
  await runRecurringPass(Date.now());
  const onboardingComplete = await getSetting("onboarding_complete");
  lastResult = { onboardingComplete };
  return lastResult;
}

/**
 * Retention hygiene (plan Task 11 rule 1). Startup is where it runs, because it
 * is the only moment guaranteed to happen on a device someone actually opens —
 * there is no background job, and a phone that never launches the app should
 * not be accumulating notification text indefinitely.
 *
 * Raw captures carry the 30-day TTL that makes the "we keep the text for a
 * month" promise real rather than aspirational (contract §3), and expired
 * review items are notification-derived content too. `listOpen` already hides
 * an expired item, which is exactly why the deletion has to happen here:
 * hiding is not retention.
 *
 * FAILURES ARE SWALLOWED, unlike every other step in this sequence. A purge is
 * housekeeping; the app is completely usable without it, and letting a failed
 * DELETE put the user on the recovery screen would trade a slightly larger
 * table for a device that cannot open. That asymmetry is the whole reason this
 * is not inlined above.
 */
async function runRetention(now: number): Promise<void> {
  try {
    await purgeExpiredRawCaptures(now);
    await purgeExpired(now);
  } catch {
    // Housekeeping only — never worth failing a launch over.
  }
  // Delivered problem reports and their attachment files, past their 30-day
  // keep (lib/support/outbox_runner.ts). OUTSIDE the try above, not inside it,
  // because it swallows its own failures already — folding it in would mean a
  // raw-capture purge that threw could skip it silently, and this is the pass
  // that unlinks the largest files this app writes.
  await purgeOldSupportReports(now);

  // Attachment files no row points at, and decrypted temp files a killed
  // process left behind (GAP-072). AFTER the purge above, so files it has just
  // unlinked are not counted twice, and after the rows it deleted are already
  // gone from the reference list.
  //
  // THE READ AND THE SWEEP ARE IN ONE TRY, AND THAT IS THE WHOLE POINT. The
  // sweep deletes everything the list does not name, so a failed read must
  // never reach it as an empty list — that would unlink the attachments of
  // every report still waiting to send. Throwing out of the read skips the
  // sweep entirely, which is the correct failure: a leaked file costs
  // kilobytes, and a swept queue costs the user their evidence.
  try {
    const referenced = await listAllAttachmentFileUris();
    const { removed } = await sweepOrphanedAttachments(referenced);
    if (removed > 0) {
      console.warn(`[support] swept ${removed} orphaned attachment file(s)`);
    }
  } catch {
    // Housekeeping only — never worth failing a launch over.
  }
}

// `persistPendingProviderPause` (GAP-116) USED TO LIVE HERE, with a long note
// on why the provider step could not write its own selection: it ran above the
// unlock gate, where `getDatabase()` rejects and the `app_settings` table does
// not exist yet. GAP-091 moved that step into the numbered flow, where the
// database IS open, so the reasoning no longer holds and the body moved to
// lib/onboarding/pending_provider_pause.ts, beside the inversion rule it
// depends on and within reach of both callers. What is still true of the call
// above, and is the reason it stays, is written there.

/**
 * Re-asserts the native provider allowlist from `paused_provider_packages`,
 * once per launch (GAP-092).
 *
 * WHY A LAUNCH RE-SYNC EXISTS AT ALL. `setProviderFilter` is a write-only
 * bridge call — `CapturePrefs.getProviderFilter()` is never wired to an
 * `AsyncFunction`, so nothing in JS can ask the listener what filter it is
 * actually applying. The filter is stored SEALED, and a sealed value that
 * cannot be OPENED (the Keystore was reset, the app was restored onto another
 * device, the preferences file came from a foreign build) falls back to the
 * empty set, which the listener reads as ALLOW EVERY PACKAGE. Without this
 * pass, that failure is silent and permanent: the Privacy switches keep
 * showing providers paused, read from the row below, while the listener
 * captures all of them until the user happens to toggle a switch. Pushing the
 * settings row back down on every launch bounds that window to a single
 * start-up.
 *
 * IT ONLY EVER NARROWS. An EMPTY `paused_provider_packages` is NOT pushed as
 * `setProviderFilter([])`, even though that is what the Privacy centre writes
 * when the last switch goes back on. The empty row is ambiguous — it is the
 * fresh-install default, AND what `persistOnboardingProviderPause()` above
 * leaves for the onboarding user who allowed everything or tapped Skip, both of
 * which mean allow-all and neither of which records a paused package. Pushing
 * allow-all on an empty row would therefore be guessing at a filter the
 * listener may already hold from a narrower onboarding selection: the exact
 * fail-open this function exists to close, dressed up as a re-sync. Nothing
 * known means nothing pushed.
 *
 * A NARROWER ONBOARDING SELECTION IS NO LONGER INVISIBLE HERE (GAP-116), which
 * is what makes that skip safe rather than merely cautious. The pass above
 * records the complement of the user's allowlist, so the case that used to have
 * no row — a filter the provider step chose and the device failed to seal — now
 * arrives as an ordinary non-empty pause list and is re-asserted below like any
 * other.
 *
 * EVERY PACKAGE PAUSED IS PUSHED AS THE EXPLICIT DENY-ALL, never as `[]`.
 * This used to be a second skip, because an allowlist could not express "block
 * everything" and `[]` meant its exact opposite on the Kotlin side; GAP-103
 * added the flag, so the state can now be re-asserted like any other instead
 * of being the one setting a re-sync deliberately gave up on. It stays
 * independent of `setCaptureEnabled`, which no launch path may touch.
 *
 * A RULESET THAT NAMES NO PACKAGES IS STILL SKIPPED, and it is not the same
 * case. "Everyone else is paused" and "there is no everyone else to ask about"
 * both compute an empty allowlist, and only the first is a deny-all — pushing
 * one for the second would block capture on any launch where the ruleset had
 * not loaded yet.
 *
 * FAILURES ARE SWALLOWED, like `runRetention`'s and for the same reason: a
 * launch that cannot reach the bridge is still a usable app, and the recovery
 * screen protects nobody's privacy. Logged, because unlike a skipped purge
 * this one leaves a setting the user can see disagreeing with what the
 * listener does.
 *
 * ONE OF THOSE FAILURES NOW HAS A NAME (GAP-114): `setProviderFilter` rejects
 * with `ProviderFilterNotStoredError` when the device could not seal the
 * allowlist, which is precisely the state this function exists to re-assert
 * out of. Still swallowed, and deliberately — the remedy for that error is a
 * relaunch, and this IS the launch path, so there is nothing left to retry and
 * nobody on screen to tell. The Privacy centre reports it when the user is
 * standing in front of a switch; here the log line above is the whole record,
 * and it already says the right thing.
 */
async function resyncProviderFilter(): Promise<void> {
  try {
    const paused = await getSetting("paused_provider_packages");
    if (paused.length === 0) return;

    const pausedSet = new Set(paused);
    const bundle = await getActiveRuleset();
    // The same allowlist arithmetic as `hooks/mutations/use_set_provider_pause.ts`,
    // over the same universe the Privacy switch list builds its rows from
    // (`app/(tabs)/more/privacy.tsx`): every package in the active ruleset,
    // minus the paused ones. The two have to agree, so neither may invent its
    // own idea of what "every package" means.
    const universe = (bundle?.providers ?? []).flatMap((provider) => provider.packageNames);
    if (universe.length === 0) {
      console.warn(
        "provider filter re-sync skipped: the active ruleset names no packages, so there is no allowlist to rebuild",
      );
      return;
    }

    const allowed = universe.filter((packageName) => !pausedSet.has(packageName));
    // Nothing left allowed, out of a universe that was not empty to begin
    // with, is the every-provider-paused state — deny-all, not allow-all.
    await setProviderFilter(allowed, allowed.length === 0);
  } catch (error) {
    console.error(
      "provider filter re-sync failed; the listener keeps whatever filter it already had",
      error,
    );
  }
}

/**
 * Fires the ruleset check and the telemetry send, neither awaited (M3c Task 7
 * rule 1 — see the call site in bootstrapApp() for the full reasoning).
 * `.catch` on each is rule 2: both services already resolve rather than
 * reject on every failure mode documented in their own files, so a rejection
 * reaching here means one of them broke that contract — logged with
 * `console.error` (not the `console.warn` the services themselves use for
 * expected, offline-is-normal failures) precisely because it should never
 * happen, and swallowed regardless, because neither a stale ruleset nor a
 * missed telemetry window is worth doing anything more disruptive than
 * logging about.
 */
function fireNetworkSync(now: number): void {
  checkForRulesetUpdate(now).catch((error: unknown) => {
    console.error("checkForRulesetUpdate rejected — this should never happen; ruleset unchanged", error);
  });
  sendParseStats(now).catch((error: unknown) => {
    console.error("sendParseStats rejected — this should never happen; telemetry skipped this period", error);
  });
}

/**
 * Re-checks for a ruleset update and re-sends telemetry on every foreground
 * (M3c Task 7 rule 3), subscribing to `AppState` the same way
 * `contexts/lock_context.tsx` already does. Returns the teardown, the same
 * shape `app/_layout.tsx`'s other `bootstrapState === "ready"` effects
 * (ingest, income, recurring) already return.
 *
 * NO INTERVAL LOGIC LIVES HERE. `checkForRulesetUpdate` and `sendParseStats`
 * already gate themselves against `app_settings` (`parser_rules_checked_at`,
 * `last_telemetry_sent_at`) — a second, independently-written 24h check in
 * this file would eventually disagree with theirs about what "too soon"
 * means, the same reasoning `bootstrapApp()`'s doc already gives for not
 * re-implementing `runIncomePass`/`runRecurringPass`'s own try/catch. Every
 * foreground calls `fireNetworkSync` unconditionally; the services decide,
 * every time, whether that turns into an actual request.
 */
export function startNetworkSyncSubscriber(): () => void {
  const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state !== "active") return;
    fireNetworkSync(Date.now());
  });
  return () => subscription.remove();
}

/**
 * Synchronous read of the last bootstrapApp() result. Returns `null` only if
 * bootstrapApp() has never resolved in this process — shouldn't happen in the
 * real app given the root layout's gate, but app/index.tsx still treats it
 * defensively (falls through to the tabs) rather than crashing on a null.
 */
export function getLastBootstrapResult(): BootstrapResult | null {
  return lastResult;
}
