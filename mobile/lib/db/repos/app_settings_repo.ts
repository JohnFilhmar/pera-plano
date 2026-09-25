// lib/db/repos/app_settings_repo.ts — the only SQL surface for the App
// Settings key/value store (interface contract §3; downstream plans
// m1b/m3/m3b/m3c depend on `getSetting`/`setSetting` by this exact name).
// Same house shape as wallets_repo.ts (Task 10): thin functions over
// getDatabase(), domain types local to this file since `AppSettings` isn't
// part of the foundation's types/domain.ts list, no entitlement checks here
// (those live at the UI/service layer — see lib/entitlements.ts).
//
// `app_settings` is one row per key (`key TEXT NOT NULL UNIQUE`) with every
// value JSON-encoded into a single `value_json TEXT` column. That column is
// shared by booleans, numbers, objects, arrays, and a nullable number — so the
// one rule that matters here is: encode with JSON.stringify, decode with
// JSON.parse, always. Never store or read the raw JS value directly, or a
// boolean `false`/`null` round-trips as the truthy strings "false"/"null".
//
// NO `theme_preference` KEY HERE, DELIBERATELY. The theme lives entirely in
// AsyncStorage via `contexts/theme_context.tsx` (see that file's own doc) —
// nothing in this app ever reads or writes a `theme_preference` row. A key
// here with no reader/writer would only imply this table covers a value it
// does not, which is exactly the trap `lib/privacy/data_wipe.ts`'s "wipe
// everything" fell into: it resets this table and would have left the theme
// behind while claiming to have erased "every setting".
//
// NO `last_parser_ruleset_version` KEY HERE EITHER, ANYMORE (removed M3c
// Task 6 telemetry fix, 2026-08). It was an inherited Foundation-era key —
// nothing in production ever called `setSetting("last_parser_ruleset_version",
// ...)`; only test files did, by hand, which masked the bug. The real
// source of truth for "which ruleset is installed" is
// `parser_rulesets_repo.getActiveVersion()` (`MAX(version)` over
// `parser_rulesets`) — the same expression `checkForRulesetUpdate`'s
// `since_version` and `upsertRuleset`'s no-downgrade guard already use.
// `services/telemetry.ts` now reads that instead. A settings row nothing
// reads or writes is exactly the `theme_preference` trap above: it makes a
// table look like it covers a value it does not.
import { getDatabase } from "@/lib/db/database";
import { newId } from "@/lib/ids";
import { UNKNOWN_INCOME_DETECTION, type IncomeDetectionState } from "@/types/control";
// TYPE-ONLY, so this repository picks up no runtime dependency on the alerts
// layer at all — the import is erased by the compiler. `HeldPeriod` is defined
// beside the rule that reads it (IA §6.2 rule 7) rather than duplicated here,
// the same way `IncomeDetectionState` above is defined beside income's own.
import type { HeldPeriod } from "@/lib/alerts/notification_policy";
import type { OnboardingStep } from "@/lib/onboarding/onboarding_state";

/**
 * Where the one-time "your income figure moved" notice has got to (GAP-117).
 *
 * `undecided` — no detection pass has judged this device yet · `due` — the
 * figure moved because split paydays are now counted as one payday, and the
 * user has not been told · `done` — told, or judged not to apply. `done` covers
 * both endings on purpose: the notice never returns either way, and a fourth
 * state would only be a record of something no reader can act on.
 */
export type SplitPaydayNotice = "undecided" | "due" | "done";

export type AppSettings = {
  onboarding_complete: boolean;
  /**
   * How far through the numbered flow the user has got, so a run that is
   * interrupted resumes where it stopped rather than at "welcome" (GAP-067).
   *
   * THE TYPE IS THE CONTRACT, NOT A GUARANTEE ABOUT THE ROW. Every setting is
   * stored as JSON and this one is written by whichever app version was
   * installed at the time, so a value outside `ONBOARDING_STEPS` is reachable
   * after a downgrade or a renamed step. `readOnboardingStep` validates what
   * it reads and falls back to the first step; nothing else should read this
   * key directly.
   *
   * Meaningless once `onboarding_complete` is true, and deliberately not
   * cleared: `app/index.tsx` routes on the flag first, so the stale value is
   * never read again.
   */
  onboarding_step: OnboardingStep;
  capture_enabled: boolean;
  telemetry_enabled: boolean;
  /**
   * The earliest instant `lib/wallets/reconcile_scheduler.ts` may show the next
   * cash reconciliation prompt (docs/04-features/02-wallets.md §cash Wallet
   * reconciliation). `null` means never asked — the fresh-install default,
   * which never blocks a prompt.
   *
   * A GATE ON THE NEXT PROMPT, NOT A RECORD OF THE LAST ONE, which is why it is
   * spelled `_prompt_at` rather than `_last_prompted_at` like the tracking
   * notice's key below. The scheduler writes `now + RECONCILE_CADENCE_MS` the
   * moment a prompt actually lands, so being asked once pushes the next ask a
   * full week out whether the user answers, snoozes or ignores it.
   *
   * WRITTEN ONLY WHEN THE OS ACCEPTED THE NOTICE, exactly as
   * `tracking_interrupted_last_notified_at` is: `postAlert` returns `null` when
   * notification permission is missing, and stamping this for a prompt nobody
   * saw would silence the following week's real one.
   *
   * GLOBAL, NOT PER WALLET. Rule 15's per-Wallet snooze and "don't ask for this
   * Wallet again" need a control to set them, and both live in the reconcile
   * sheet / wallet settings; a key with no writer is the `theme_preference` trap
   * this file's header describes, so it is deliberately not added ahead of them.
   */
  cash_reconcile_prompt_at: number | null;
  /**
   * When `services/parser_rules.ts`'s `checkForRulesetUpdate` last actually
   * reached the server (M3c Task 5, rule 5) — `null` means "never checked",
   * matching `cash_reconcile_prompt_at`'s own null-means-unset convention.
   * That module is the only reader/writer; it exists so repeated app
   * launches/foregrounds don't re-request a ruleset that was already checked
   * within the spec's interval.
   */
  parser_rules_checked_at: number | null;
  /**
   * This device's staged-rollout bucket, 0 to 99 (docs/03 §11.2 rule 4, GAP-043).
   * `null` until the first ruleset check assigns one.
   *
   * A STORED RANDOM NUMBER RATHER THAN A HASH OF SOME DEVICE IDENTIFIER, and the
   * distinction matters here more than it would in most apps. This one holds no
   * install id, advertising id or device id, on purpose — the ledger never leaves
   * the phone and there is nothing to correlate it with. Hashing something into a
   * bucket would mean MINTING an identifier where none existed, which is a worse
   * trade than a random integer that is uncorrelated with anything, never sent
   * anywhere, and stable because it is written once.
   *
   * Stable is the requirement: a bucket rolled per check would put the device in
   * and out of the rollout on successive days, which is neither a staged rollout
   * nor a stable experience.
   */
  parser_rules_rollout_bucket: number | null;
  /**
   * Income detection's working notes (m2 Task 9). The first OBJECT-valued
   * setting, and it works unchanged because every value here has always been
   * JSON-encoded into `value_json` — the rule at the top of this file exists
   * for exactly this.
   *
   * Here rather than in a column because m2 Global Constraint 9 says auxiliary
   * state with no dedicated column belongs in `app_settings`, and unlike the
   * limit alert state it genuinely fits: there is exactly ONE income profile
   * (invariant I9), so there is no per-entity map to rewrite and nothing to
   * orphan. Read and written through `income_repo`, which is the only caller.
   */
  income_detection_state: IncomeDetectionState;
  /**
   * OS notification identifiers for scheduled loan reminders, keyed by loan id
   * (m2b Task 7). `scheduleReminder` returns an id and `cancelScheduled` needs
   * it back; nothing else in the app remembers them.
   *
   * Here rather than in a column because m2 Global Constraint 9 names
   * "reminder ids" as an app_settings case outright — and unlike the limit
   * alert state, nothing financial depends on it. A stale entry for a deleted
   * loan costs one `cancelScheduled` call for an id the OS no longer knows,
   * which is a no-op; a stale limit base would have been a wrong number on
   * screen.
   */
  loan_reminder_ids: Record<string, string[]>;
  /**
   * Scheduled bill-reminder ids, keyed by `billId|dueDate` — per CYCLE, not per
   * bill. Spec rule 11 cancels "that cycle's remaining reminders" the moment it
   * is paid, and rule 25 has two cycles of one bill open at once; a per-bill key
   * could not cancel one without cancelling the other's too.
   */
  bill_reminder_ids: Record<string, string[]>;
  /**
   * The subscription forget threshold (Settings screen, M3b Task 5; owner
   * decision 2026-08-16). The listener only ever sees a charge ARRIVE, never a
   * cancellation, so `lib/recurring/recurring_service.ts` has to infer "this
   * subscription is gone" from silence — and the owner's rule for how much
   * silence is enough is "1.5 MISSED PAYMENTS, scaled to that subscription's
   * own cadence."
   *
   * A MULTIPLIER, not a day count, and that is the whole reason this is its
   * own setting rather than a literal baked into the decay math: the user's
   * subscriptions run on different cadences (weekly, monthly, annual), and one
   * fixed day count means a different number of missed cycles for each of
   * them — a flat 45 days is 1.5 missed *months* but would forget an *annual*
   * subscription six weeks after it charged. Storing the multiplier and
   * letting the decay logic scale it by each pattern's own `period` is what
   * keeps "1.5" meaning the same thing (one and a half missed payments) no
   * matter which cadence a given RecurringPattern is on.
   *
   * This file only stores the number the user chose (Settings rule 2's "alert
   * preferences"-adjacent control) — it does NOT implement the decay/removal
   * logic itself. That reads this key and owns the scaling math in
   * `lib/recurring/recurring_service.ts` (a later task).
   *
   * Default 1.5, matching the owner's stated default; the Settings screen
   * clamps user input to the owner's stated range of [1, 3] before it ever
   * reaches `setSetting`, the same way every other numeric setting here
   * trusts its caller rather than re-validating in this file.
   */
  recurring_forget_multiplier: number;

  /**
   * Android package names the user has individually paused from the Privacy
   * centre's per-provider switch list (m3b Task 6 rule 2; docs
   * §04-features/11-settings-privacy.md Flow B). An EMPTY array is the
   * fresh-install default and matches `setProviderFilter([])`'s own "allow
   * every package" default on the native side (`CapturePrefs.kt`) — there is
   * nothing here for a new install to disagree with before the user has
   * touched a single switch.
   *
   * PACKAGE NAMES, NOT PROVIDER KEYS. One provider in the ruleset can own
   * several packages (`sms_relay` carries three), and `setProviderFilter`
   * only ever understands packages — so the settings row that has to be
   * turned back into a `setProviderFilter` argument on every app launch has
   * to already speak that language, not one this repository would have to
   * re-resolve through the ruleset every time it is read.
   *
   * HERE, NOT ON THE NATIVE SIDE, because the native module exposes a
   * SETTER (`setProviderFilter`) but no GETTER — `CapturePrefs.getProviderFilter()`
   * is never wired to an `AsyncFunction` in `NotificationListenerModule.kt`.
   * Without a row to read back, the switch list would have no way to know
   * which providers are currently paused after a cold start; this key is
   * that readable copy, and every write to it is paired with the matching
   * `setProviderFilter` call.
   *
   * PAIRED WRITES ARE NOT ENOUGH, THOUGH, and this doc used to claim they were
   * ("so the two can never disagree"). They can. The native copy is stored
   * SEALED, and a sealed value that cannot be OPENED — Keystore reset, restore
   * onto another device, a preferences file from a foreign build — falls back
   * to the empty set, which the listener reads as ALLOW EVERY PACKAGE
   * (`CapturePrefs.getProviderFilter`). Nothing on this side can detect that,
   * precisely because there is no getter. What closes it is
   * `resyncProviderFilter()` in `lib/bootstrap.ts`: it pushes this row back
   * across the bridge on every launch, so a filter that went allow-all behind
   * the app's back is restored at the next start rather than never.
   *
   * That re-sync only ever NARROWS, so an empty array here is left alone
   * rather than pushed as `setProviderFilter([])`. An empty row does not mean
   * "the user wants allow-all" — it is also the fresh-install default, and what
   * an onboarding user who allowed everything or tapped Skip leaves behind. See
   * that function for the full reasoning.
   *
   * `app/(onboarding)/providers.tsx` DOES write here now, indirectly (GAP-116).
   * It has no open database of its own — it renders above the unlock gate — so
   * it hands the complement of its allowlist to
   * `lib/onboarding/pending_provider_pause.ts`, and
   * `persistOnboardingProviderPause()` in lib/bootstrap.ts stores it on the
   * first launch that can. Before that, a selection the device failed to seal
   * had no row to be restored from at all.
   */
  paused_provider_packages: string[];
  /**
   * Whether the payday-summary push notification is turned on (m3c Task 8
   * audit fix; docs/06-information-architecture.md §6.1: "Default,
   * **opt-in**"). Default `false` — unlike every other channel in the app,
   * this one starts silent, matching the doc's own default column exactly.
   * `income:payday` (lib/events/app_events.ts) already fires regardless of
   * this flag, deduplicated per transaction; this key only gates whether the
   * system notification is posted, not whether the in-app payday sheet
   * (`components/income/payday_detected_sheet.tsx`) appears.
   */
  payday_summary_enabled: boolean;
  /**
   * Epoch ms `notifyTrackingInterrupted` last actually posted (m3c Task 8
   * audit fix; IA §6.2 rule 4: "at most one per distinct interruption, and no
   * more than one per day even across repeated interruptions"). `null` means
   * never — a fresh install's default, matching every other
   * `*_at: number | null` key's own "never yet" convention in this file.
   */
  tracking_interrupted_last_notified_at: number | null;
  /**
   * Epoch ms of the last SUCCESSFUL aggregate-telemetry send (m3c Task 6),
   * or `null` before the first one ever completes. This one value does two
   * jobs at once, deliberately: it is the interval gate ("don't send again
   * for TELEMETRY_INTERVAL_MS") AND the local stats window's `periodStart`
   * for the *next* send — see `services/telemetry.ts`'s header for why
   * those two must always move together. It is written ONLY in the same
   * step that clears `parse_stats` (`lib/diagnostics/parse_stats_repo.ts`),
   * never on a skipped, opted-out, or failed send — advancing it on a
   * failure would move `periodStart` past counts that are still sitting,
   * unsent, in the table, silently dropping them from every future report.
   */
  last_telemetry_sent_at: number | null;
  /**
   * Whether quiet hours are observed at all (IA §6.2 rule 7). Default `true` —
   * the rule states a default WINDOW ("default 21:00-08:00, user-adjustable"),
   * which only means anything if the window is on to begin with; a user who
   * wants alerts at 3am turns this off.
   */
  quiet_hours_enabled: boolean;
  /**
   * Start of the quiet window, in MINUTES FROM LOCAL MIDNIGHT. Default 1260 =
   * 21:00, the first half of rule 7's stated default.
   *
   * MINUTES, NOT `"HH:MM"` AND NOT AN EPOCH INSTANT. The window is a
   * wall-clock concept: it has to keep meaning 9pm on whatever day it is,
   * across a DST transition and across a device timezone change. An instant
   * would freeze one particular evening; a formatted string would have to be
   * parsed at every single comparison. `lib/alerts/notification_policy.ts`
   * owns the arithmetic and takes exactly this unit.
   */
  quiet_hours_start_minute: number;
  /**
   * End of the quiet window, same unit. Default 480 = 08:00.
   *
   * NOTE THAT end < start FOR THE DEFAULT, because the window WRAPS midnight —
   * see `isWithinQuietHours` in `lib/alerts/notification_policy.ts` for why a
   * naive `start <= m && m < end` comparison against these two numbers is
   * empty for every minute of the day, and silently disables the whole rule.
   */
  quiet_hours_end_minute: number;
  /**
   * OS notification identifiers currently scheduled for delivery at the end of
   * the quiet period named by `quiet_hours_held_period` (IA §6.2 rule 7's
   * "held and delivered after quiet hours end").
   *
   * Either the individually-held alerts (at most three) or, once a fourth
   * arrives, exactly one summary id that replaced them — rule 6 applies to the
   * overnight catch-up too, and six alerts held from 2am must not arrive as
   * six notifications at 8am.
   *
   * DURABLE, NOT IN-MEMORY, and that is the point. The app will usually be
   * killed at some point overnight; module state would not survive it, and the
   * held alerts would then arrive individually — or, under a design that kept
   * them in a JS timer instead of the OS scheduler, would be lost entirely,
   * which is precisely what rule 7's "not dropped" forbids.
   */
  quiet_hours_held_ids: string[];
  /**
   * WHICH quiet period `quiet_hours_held_ids` belongs to (`endAt`, the instant
   * they are all scheduled for) and HOW MANY alerts they stand for (`count`).
   * `null` when nothing is held.
   *
   * A COMPANION TO THE IDS RATHER THAN PART OF THEM, because neither number
   * survives in the array once a burst collapses. After the fourth held alert
   * the three individual ids are cancelled and replaced by one summary, so the
   * array's length is 1 while the true count is 4 — the summary's own copy
   * ("6 updates while you were away") would be wrong on every subsequent
   * alert. `endAt` is what makes the record self-expiring: without it, alerts
   * held on Monday night keep counting into Tuesday night on a device that
   * posted nothing in between. The two keys are always written together, in
   * the same step, the way `bill_reminder_ids` and its cycle keys are.
   */
  quiet_hours_held_period: HeldPeriod | null;
  /**
   * GAP-117's one-time notice, tracked here rather than inside
   * `income_detection_state` even though income detection is what settles it.
   * That value is detection's working NOTES and is rewritten wholesale on every
   * pass (see `types/control.ts`); this one has to survive exactly as many
   * rewrites as it takes the user to open the Income screen once.
   *
   * `undecided` IS THE RIGHT FRESH-INSTALL DEFAULT, and it costs a new install
   * nothing: the first detection pass on a device with no previously stored
   * `averageAmount` settles it to `done` before any figure exists to have
   * moved. See `settleSplitPaydayNotice` in lib/income/income_service.ts for
   * why that one rule is also what keeps a NEW user's ordinary median drift
   * from being mistaken for this upgrade's effect.
   */
  income_split_payday_notice: SplitPaydayNotice;
};

/** Values returned by `getSetting`/`getAllSettings` for a key with no row yet. */
export const DEFAULT_SETTINGS: AppSettings = {
  onboarding_complete: false,
  onboarding_step: "welcome",
  capture_enabled: true,
  // OFF UNTIL THE USER TURNS IT ON (owner's ruling, 2026-09-24, GAP-021).
  // docs/07 §2 now processes diagnostics on CONSENT rather than legitimate
  // interest, and a consent that is pre-ticked is not consent. Nothing is sent
  // until the Settings row is switched on; `services/telemetry.ts` reads this
  // same key before every send.
  telemetry_enabled: false,
  cash_reconcile_prompt_at: null,
  parser_rules_checked_at: null,
  parser_rules_rollout_bucket: null,
  income_detection_state: UNKNOWN_INCOME_DETECTION,
  loan_reminder_ids: {},
  bill_reminder_ids: {},
  recurring_forget_multiplier: 1.5,
  paused_provider_packages: [],
  payday_summary_enabled: false,
  tracking_interrupted_last_notified_at: null,
  last_telemetry_sent_at: null,
  // IA §6.2 rule 7's stated default window, in minutes from local midnight:
  // 21:00 (1260) to 08:00 (480). `end < start` is not a typo — it wraps.
  quiet_hours_enabled: true,
  quiet_hours_start_minute: 1260,
  quiet_hours_end_minute: 480,
  quiet_hours_held_ids: [],
  quiet_hours_held_period: null,
  income_split_payday_notice: "undecided",
};

type SettingValueRow = { value_json: string };

/**
 * Decodes one stored `value_json` cell, falling back to `DEFAULT_SETTINGS[key]`
 * on malformed JSON instead of letting `JSON.parse` throw. `setSetting` is the
 * only writer and always writes valid JSON, so this should never fire in
 * normal operation — but a corrupted/partially-restored backup, or a future
 * migration that writes this table directly, can still leave a row with
 * unparseable `value_json`. This table is read at app boot (bootstrapApp), so
 * an uncaught `SyntaxError` here would take the whole app down with no
 * recovery short of reinstalling and losing the ledger. A settings store is
 * exactly the wrong place to be strict about that: losing one preference
 * (theme reverts to auto, say) is a trivial cost next to an app that won't
 * open. The corruption is logged, not swallowed silently — a setting that
 * silently resets itself with no trace is its own debugging nightmare, and
 * this is the one place the app will notice.
 */
function decodeStoredValue<K extends keyof AppSettings>(key: K, valueJson: string): AppSettings[K] {
  try {
    return JSON.parse(valueJson) as AppSettings[K];
  } catch {
    console.warn(
      `app_settings_repo: corrupt value_json for key "${key}" — falling back to its default`,
    );
    return DEFAULT_SETTINGS[key];
  }
}

/**
 * Reads one setting. Returns `DEFAULT_SETTINGS[key]` (never `null`, never a
 * throw) when the key has no row yet — bootstrap reads these on a fresh
 * install where `app_settings` is empty — or when the stored row's JSON is
 * corrupt (see `decodeStoredValue`).
 */
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<SettingValueRow>(
    "SELECT value_json FROM app_settings WHERE key = ?",
    [key],
  );
  if (!row) {
    return DEFAULT_SETTINGS[key];
  }
  return decodeStoredValue(key, row.value_json);
}

/**
 * Writes one setting. Upserts: a key with an existing row is UPDATEd in
 * place (same `id`, fresh `updated_at`); a key with no row yet is INSERTed.
 * Either way there is exactly one row per key afterward — never a duplicate.
 */
export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  const valueJson = JSON.stringify(value);

  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM app_settings WHERE key = ?",
    [key],
  );
  if (existing) {
    await db.runAsync("UPDATE app_settings SET value_json = ?, updated_at = ? WHERE id = ?", [
      valueJson,
      now,
      existing.id,
    ]);
  } else {
    await db.runAsync(
      "INSERT INTO app_settings (id, key, value_json, updated_at) VALUES (?, ?, ?, ?)",
      [newId(), key, valueJson, now],
    );
  }
}

/**
 * All settings in one read, stored values merged over `DEFAULT_SETTINGS` —
 * a key with no row falls back to its default, a key with a row overrides
 * it. Each value is decoded through `decodeStoredValue`, so one corrupt row
 * falls back to its own default without poisoning the rest of the object —
 * the other five keys' stored values are unaffected. The final cast is the
 * single, contained unsafe point: every field comes from `decodeStoredValue`
 * (inherently `unknown` to the compiler) keyed by a `key` column that's
 * already validated against `DEFAULT_SETTINGS` above.
 */
export async function getAllSettings(): Promise<AppSettings> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ key: string; value_json: string }>(
    "SELECT key, value_json FROM app_settings",
  );

  const stored: Partial<Record<keyof AppSettings, unknown>> = {};
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) {
      const key = row.key as keyof AppSettings;
      stored[key] = decodeStoredValue(key, row.value_json);
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings;
}

/**
 * Restores every setting to its default by deleting all rows — `getSetting`
 * and `getAllSettings` already fall back to `DEFAULT_SETTINGS` for a missing
 * row, so an empty table IS "every default" rather than something this
 * function needs to write back explicitly. A no-op (not a throw) when the
 * table is already empty.
 */
export async function resetSettings(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM app_settings");
}
