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
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { purgeExpired } from "@/lib/db/repos/review_queue_repo";
import { purgeExpiredRawCaptures } from "@/lib/db/repos/raw_notifications_repo";
import { runIncomePass } from "@/lib/income/income_ledger_subscriber";
import { seedParserRules } from "@/lib/ingest/seed_rules";
import { captureInstallEvidence } from "@/lib/onboarding/install_evidence";
import { purgeOldSupportReports } from "@/lib/support/outbox_runner";
import { runRecurringPass } from "@/lib/recurring/recurring_ledger_subscriber";
import { checkForRulesetUpdate } from "@/services/parser_rules";
import { sendParseStats } from "@/services/telemetry";

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
  // Install evidence, FIRST and awaited (google-account-linking plan Task 7).
  // First because it is the only step here whose input can be destroyed: the
  // device's `firstInstallTime` is the sole record that someone installed
  // inside the beta window, and it dies with the next uninstall. Everything
  // below can be redone on the next launch; this cannot, so it must not sit
  // behind a migration that might throw.
  //
  // `.catch` for the same reason `runRetention` swallows: recording a
  // marketing cohort is not worth a device that will not open, and the module
  // is already write-once and null-tolerant internally, so a rejection
  // reaching here means something outside its own contract broke.
  await captureInstallEvidence(Date.now()).catch(() => undefined);
  const db = await getDatabase();
  await runMigrations(db);
  await seedDefaultCategories();
  await seedParserRules();
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
