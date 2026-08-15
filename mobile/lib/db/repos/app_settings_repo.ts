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
// shared by booleans, numbers, a string union, and a nullable number — so the
// one rule that matters here is: encode with JSON.stringify, decode with
// JSON.parse, always. Never store or read the raw JS value directly, or a
// boolean `false`/`null` round-trips as the truthy strings "false"/"null".
import { getDatabase } from "@/lib/db/database";
import { newId } from "@/lib/ids";
import { UNKNOWN_INCOME_DETECTION, type IncomeDetectionState } from "@/types/control";

export type ThemePreference = "auto" | "light" | "dark";

export type AppSettings = {
  onboarding_complete: boolean;
  capture_enabled: boolean;
  telemetry_enabled: boolean;
  theme_preference: ThemePreference;
  last_parser_ruleset_version: number;
  cash_reconcile_prompt_at: number | null;
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
};

/** Values returned by `getSetting`/`getAllSettings` for a key with no row yet. */
export const DEFAULT_SETTINGS: AppSettings = {
  onboarding_complete: false,
  capture_enabled: true,
  telemetry_enabled: true,
  theme_preference: "auto",
  last_parser_ruleset_version: 0,
  cash_reconcile_prompt_at: null,
  income_detection_state: UNKNOWN_INCOME_DETECTION,
  loan_reminder_ids: {},
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
