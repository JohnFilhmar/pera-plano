import { closeDatabase } from "@/lib/db/database";
import {
  DEFAULT_SETTINGS,
  getAllSettings,
  getSetting,
  resetSettings,
  setSetting,
  type AppSettings,
} from "../app_settings_repo";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Type-level pin (checked by `tsc --noEmit`, never executed by jest):
// getSetting<K> must actually narrow to AppSettings[K], not widen to `unknown`
// or `any`. A signature that compiles but returns `any` would let BOTH lines
// below through silently — the @ts-expect-error line is what pins that it
// doesn't.
// ---------------------------------------------------------------------------
async function _typeLevelPin_getSettingNarrowsToItsKey(): Promise<void> {
  const promptAt: number | null = await getSetting("cash_reconcile_prompt_at");
  void promptAt;
  // @ts-expect-error - AppSettings["cash_reconcile_prompt_at"] is number | null, never a string.
  const notAString: string = await getSetting("cash_reconcile_prompt_at");
  void notAString;
}
void _typeLevelPin_getSettingNarrowsToItsKey;

// ---------------------------------------------------------------------------
// Verbatim from task-14-brief.md — prove the pinned shape exists.
// ---------------------------------------------------------------------------

test("getSetting returns the documented default for every key when nothing is stored", async () => {
  expect(await getSetting("onboarding_complete")).toBe(false);
  expect(await getSetting("capture_enabled")).toBe(true);
  // OFF UNTIL ASKED (owner's ruling, 2026-09-24, GAP-021). Diagnostics are
  // processed on consent, not legitimate interest, so nothing is sent until the
  // user turns the Settings row on. Capture above stays true because that is
  // the app's entire purpose and the user granted notification access for it.
  expect(await getSetting("telemetry_enabled")).toBe(false);
  expect(await getSetting("cash_reconcile_prompt_at")).toBeNull();
});

test("setSetting then getSetting round-trips each of the four value types", async () => {
  await setSetting("onboarding_complete", true);
  await setSetting("capture_enabled", false);
  await setSetting("telemetry_enabled", false);
  await setSetting("cash_reconcile_prompt_at", 1_700_000_000_000);

  expect(await getSetting("onboarding_complete")).toBe(true);
  expect(await getSetting("capture_enabled")).toBe(false);
  expect(await getSetting("telemetry_enabled")).toBe(false);
  expect(await getSetting("cash_reconcile_prompt_at")).toBe(1_700_000_000_000);
});

test("setSetting called twice on the same key upserts, not duplicates", async () => {
  await setSetting("recurring_forget_multiplier", 1);
  await setSetting("recurring_forget_multiplier", 2);

  const rows = await db.getAllAsync<{ value_json: string }>(
    "SELECT value_json FROM app_settings WHERE key = ?",
    ["recurring_forget_multiplier"],
  );
  expect(rows).toHaveLength(1);
  expect(await getSetting("recurring_forget_multiplier")).toBe(2);
});

test("getAllSettings merges stored values over defaults for the rest", async () => {
  await setSetting("recurring_forget_multiplier", 7);

  const all = await getAllSettings();
  expect(all).toEqual({
    ...DEFAULT_SETTINGS,
    recurring_forget_multiplier: 7,
  });
});

test("resetSettings restores every default", async () => {
  await setSetting("onboarding_complete", true);
  await setSetting("capture_enabled", false);
  await setSetting("recurring_forget_multiplier", 9);
  await setSetting("cash_reconcile_prompt_at", 123);

  await resetSettings();

  expect(await getAllSettings()).toEqual(DEFAULT_SETTINGS);
});

// ---------------------------------------------------------------------------
// Discriminating suite below. app_settings has ONE text column shared by
// booleans, numbers, a string union, and a nullable number — the tests above
// prove the shape from the brief, but they use `toBe`, which already fails a
// stringified "false"/"null" against the literal false/null (Object.is does
// not coerce). These tests go further: they pin the exact *runtime type*
// coming back (`typeof`), and pin behavior a same-shaped-but-wrong
// implementation (raw string storage, dropped JSON.parse, `null` for unset
// keys, insert-only upsert, whole-object reset semantics) would get wrong for
// a specific, stated reason.
// ---------------------------------------------------------------------------

describe("boolean false and null survive as their exact runtime type, not a truthy string", () => {
  test("telemetry_enabled false round-trips as boolean false, typeof \"boolean\"", async () => {
    await setSetting("telemetry_enabled", false);
    const value = await getSetting("telemetry_enabled");
    expect(value).toBe(false);
    expect(typeof value).toBe("boolean");
  });

  test("capture_enabled false round-trips as boolean false, typeof \"boolean\"", async () => {
    // capture_enabled defaults to true, so this also proves the stored value
    // (not the default) is what comes back once a row exists.
    await setSetting("capture_enabled", false);
    const value = await getSetting("capture_enabled");
    expect(value).toBe(false);
    expect(typeof value).toBe("boolean");
  });

  test("cash_reconcile_prompt_at null round-trips as null, not the string \"null\"", async () => {
    await setSetting("cash_reconcile_prompt_at", 555);
    await setSetting("cash_reconcile_prompt_at", null);
    const value = await getSetting("cash_reconcile_prompt_at");
    expect(value).toBeNull();
    // A stringified "null" is truthy and typeof "string" — this is the second
    // silent failure mode the brief calls out (prompt-at reads as "already set").
    expect(typeof value).not.toBe("string");
  });
});

describe("getSetting preserves the exact runtime type for every key, not just the value", () => {
  test.each([
    ["onboarding_complete", true, "boolean"],
    ["capture_enabled", true, "boolean"],
    ["telemetry_enabled", false, "boolean"],
    ["recurring_forget_multiplier", 42, "number"],
  ] as const)("%s = %p round-trips typeof %s", async (key, value, expectedType) => {
    await setSetting(key, value);
    const result = await getSetting(key);
    expect(result).toBe(value);
    expect(typeof result).toBe(expectedType);
  });

  test("cash_reconcile_prompt_at round-trips typeof \"number\" when set to a timestamp", async () => {
    await setSetting("cash_reconcile_prompt_at", 1_690_000_000_000);
    const result = await getSetting("cash_reconcile_prompt_at");
    expect(result).toBe(1_690_000_000_000);
    expect(typeof result).toBe("number");
  });

  test("paused_provider_packages round-trips an array of package names", async () => {
    await setSetting("paused_provider_packages", ["com.globe.gcash.android"]);
    const result = await getSetting("paused_provider_packages");
    expect(result).toEqual(["com.globe.gcash.android"]);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("reading an unset key returns exactly its documented default, per key", () => {
  test.each([
    ["onboarding_complete", false],
    ["capture_enabled", true],
    ["telemetry_enabled", false],
    ["recurring_forget_multiplier", 1.5],
  ] as const)("%s defaults to %p", async (key, expected) => {
    const value = await getSetting(key);
    expect(value).toBe(expected);
    expect(value).not.toBeNull();
  });

  test("paused_provider_packages defaults to an empty array", async () => {
    const value = await getSetting("paused_provider_packages");
    expect(value).toEqual([]);
  });

  test("cash_reconcile_prompt_at defaults to null specifically, not merely falsy", async () => {
    const value = await getSetting("cash_reconcile_prompt_at");
    expect(value).toBeNull();
  });

  test("an unset key never throws", async () => {
    await expect(getSetting("recurring_forget_multiplier")).resolves.not.toThrow();
  });
});

describe("setSetting upsert leaves exactly one row per key, with the latest value persisted", () => {
  test("two writes to the same key: one row, value_json reflects the second write", async () => {
    await setSetting("recurring_forget_multiplier", 1);
    await setSetting("recurring_forget_multiplier", 2);

    const rows = await db.getAllAsync<{ value_json: string }>(
      "SELECT value_json FROM app_settings WHERE key = ?",
      ["recurring_forget_multiplier"],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].value_json)).toBe(2);
  });

  test("writing two different keys produces two rows, not one shared row", async () => {
    await setSetting("recurring_forget_multiplier", 2);
    await setSetting("onboarding_complete", true);

    const rows = await db.getAllAsync<{ key: string }>("SELECT key FROM app_settings");
    expect(rows.map((r) => r.key).sort()).toEqual([
      "onboarding_complete",
      "recurring_forget_multiplier",
    ]);
  });
});

describe("getAllSettings merge is per-key, not all-or-nothing", () => {
  test("setting one key leaves EVERY other key at its default in the same read", async () => {
    await setSetting("onboarding_complete", true);

    const all = await getAllSettings();
    expect(all.onboarding_complete).toBe(true);

    // Destructured rather than hand-listed. The original spelled out the other
    // five keys, which meant m2 Task 9's `income_detection_state` broke this
    // test rather than being covered by it — and the next key would too. The
    // `Omit` annotations keep it exhaustive: a key missing from either side is
    // still a compile error, but neither side has to name any of them.
    const { onboarding_complete: _set, ...rest }: AppSettings = all;
    const { onboarding_complete: _default, ...restDefaults }: AppSettings = DEFAULT_SETTINGS;

    const observed: Omit<AppSettings, "onboarding_complete"> = rest;
    const expected: Omit<AppSettings, "onboarding_complete"> = restDefaults;
    expect(observed).toEqual(expected);
  });

  test("getAllSettings on a fresh db (no rows at all) equals DEFAULT_SETTINGS exactly", async () => {
    expect(await getAllSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("resetSettings clears the underlying rows, verified directly against the table", () => {
  test("after resetSettings, app_settings has zero rows", async () => {
    await setSetting("onboarding_complete", true);
    await setSetting("recurring_forget_multiplier", 5);

    await resetSettings();

    const rows = await db.getAllAsync<{ key: string }>("SELECT key FROM app_settings");
    expect(rows).toHaveLength(0);
  });

  test("resetSettings on an already-empty table is a no-op, not a throw", async () => {
    await expect(resetSettings()).resolves.not.toThrow();
    expect(await getAllSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

// ---------------------------------------------------------------------------
// Coordinator review finding: `app_settings` is read at app boot, and
// `setSetting` isn't the only thing that can put a row in this table — a
// corrupted/partially-restored backup, or a future migration writing this
// table directly, can leave `value_json` unparseable. An unguarded
// JSON.parse would throw out of `bootstrapApp()` and the app would never
// open. These tests write a malformed row directly with raw SQL (bypassing
// `setSetting`, which never writes bad JSON) to prove the read paths recover
// instead of propagating the SyntaxError.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// M3b Task 5 — the subscription forget threshold (owner decision 2026-08-16).
// `recurring_forget_multiplier` is read only, never decayed, by this file;
// `lib/recurring/recurring_service.ts` owns the scaling math. This just pins
// the round-trip the Settings screen depends on.
// ---------------------------------------------------------------------------

describe("recurring_forget_multiplier — the subscription forget threshold", () => {
  test("defaults to 1.5 when unset", async () => {
    expect(await getSetting("recurring_forget_multiplier")).toBe(1.5);
  });

  test("setSetting then getSetting round-trips a chosen multiplier", async () => {
    await setSetting("recurring_forget_multiplier", 2.25);
    const value = await getSetting("recurring_forget_multiplier");
    expect(value).toBe(2.25);
    expect(typeof value).toBe("number");
  });

  test("getAllSettings surfaces the stored multiplier alongside every other default", async () => {
    await setSetting("recurring_forget_multiplier", 3);
    const all = await getAllSettings();
    expect(all).toEqual({ ...DEFAULT_SETTINGS, recurring_forget_multiplier: 3 });
  });
});

// ---------------------------------------------------------------------------
// docs/06-information-architecture.md §6.2 rule 7 — the quiet-hours window.
// `lib/alerts/notification_policy.ts` owns the arithmetic; this pins the
// stored shape it reads, and in particular that the DEFAULT window is the one
// the spec states.
// ---------------------------------------------------------------------------

describe("quiet hours — the window §6.2 rule 7 states", () => {
  test("defaults to enabled, 21:00-08:00, expressed in minutes from local midnight", () => {
    expect(DEFAULT_SETTINGS.quiet_hours_enabled).toBe(true);
    // 1260 = 21 * 60 and 480 = 8 * 60. Spelled as the arithmetic rather than
    // as bare literals, so a transposed default fails here rather than
    // silently shifting everyone's quiet hours by an hour.
    expect(DEFAULT_SETTINGS.quiet_hours_start_minute).toBe(21 * 60);
    expect(DEFAULT_SETTINGS.quiet_hours_end_minute).toBe(8 * 60);
  });

  test("the default END is BEFORE the default START — the window wraps midnight", () => {
    // Not a typo, and the single most important property of these two numbers:
    // an implementation that assumes start < end is empty for this window and
    // silently disables rule 7 entirely.
    expect(DEFAULT_SETTINGS.quiet_hours_end_minute).toBeLessThan(
      DEFAULT_SETTINGS.quiet_hours_start_minute,
    );
  });

  test("an unset install reads the defaults rather than null", async () => {
    expect(await getSetting("quiet_hours_enabled")).toBe(true);
    expect(await getSetting("quiet_hours_start_minute")).toBe(1260);
    expect(await getSetting("quiet_hours_end_minute")).toBe(480);
  });

  test("a user-chosen window round-trips as numbers, not strings", async () => {
    await setSetting("quiet_hours_start_minute", 1350);
    await setSetting("quiet_hours_end_minute", 390);

    expect(await getSetting("quiet_hours_start_minute")).toBe(1350);
    expect(typeof (await getSetting("quiet_hours_end_minute"))).toBe("number");
  });

  test("quiet_hours_enabled false round-trips as boolean false, not the string \"false\"", async () => {
    await setSetting("quiet_hours_enabled", false);
    const value = await getSetting("quiet_hours_enabled");
    expect(value).toBe(false);
    expect(typeof value).toBe("boolean");
  });
});

describe("quiet hours — the durable held record §6.2 rule 7 depends on", () => {
  test("starts empty on a fresh install", async () => {
    expect(await getSetting("quiet_hours_held_ids")).toEqual([]);
    expect(await getSetting("quiet_hours_held_period")).toBeNull();
  });

  test("the ids and the period they belong to both survive a round trip", async () => {
    // DURABILITY IS THE POINT. A 100% limit breach raised at 2am is scheduled
    // with the OS for the morning and its id recorded here, because the app
    // will usually be killed overnight — module state would not survive it and
    // rule 7 says the alert is "not dropped".
    const morning = new Date(2026, 7, 20, 8, 0).getTime();
    await setSetting("quiet_hours_held_ids", ["os-1", "os-2"]);
    await setSetting("quiet_hours_held_period", { endAt: morning, count: 2 });

    expect(await getSetting("quiet_hours_held_ids")).toEqual(["os-1", "os-2"]);
    expect(await getSetting("quiet_hours_held_period")).toEqual({ endAt: morning, count: 2 });
  });

  test("the count is stored separately because the ids stop carrying it once collapsed", async () => {
    // After a burst collapses, three individual ids are cancelled and replaced
    // by ONE summary — so the array's length is 1 while the true count is 4.
    // Deriving the count from the array would put "1 update while you were
    // away" on a screen standing in for four.
    const morning = new Date(2026, 7, 20, 8, 0).getTime();
    await setSetting("quiet_hours_held_ids", ["os-summary"]);
    await setSetting("quiet_hours_held_period", { endAt: morning, count: 4 });

    const period = await getSetting("quiet_hours_held_period");
    expect(period?.count).toBe(4);
    expect(await getSetting("quiet_hours_held_ids")).toHaveLength(1);
  });

  test("clearing the record puts back exactly the fresh-install shape", async () => {
    await setSetting("quiet_hours_held_ids", ["os-1"]);
    await setSetting("quiet_hours_held_period", { endAt: 1, count: 1 });

    await setSetting("quiet_hours_held_ids", []);
    await setSetting("quiet_hours_held_period", null);

    expect(await getSetting("quiet_hours_held_ids")).toEqual([]);
    expect(await getSetting("quiet_hours_held_period")).toBeNull();
  });
});

describe("a corrupt value_json cell is decoded defensively, never thrown", () => {
  test("getSetting returns the key's documented default when its stored value_json is malformed", async () => {
    await db.runAsync(
      "INSERT INTO app_settings (id, key, value_json, updated_at) VALUES (?, ?, ?, ?)",
      ["corrupt-1", "telemetry_enabled", "{not json", Date.now()],
    );

    const value = await getSetting("telemetry_enabled");
    expect(value).toBe(DEFAULT_SETTINGS.telemetry_enabled);
    expect(typeof value).toBe("boolean");
  });

  test("getAllSettings falls back to the default for a corrupt key without poisoning the other stored values", async () => {
    // Two healthy stored values, then one row corrupted via raw SQL — proves
    // the fallback is scoped to the one bad key, not a whole-read failure
    // that would also wipe out onboarding_complete/recurring_forget_multiplier.
    await setSetting("onboarding_complete", true);
    await setSetting("recurring_forget_multiplier", 3);
    await db.runAsync(
      "INSERT INTO app_settings (id, key, value_json, updated_at) VALUES (?, ?, ?, ?)",
      ["corrupt-2", "telemetry_enabled", "{not json", Date.now()],
    );

    const all = await getAllSettings();
    expect(all.telemetry_enabled).toBe(DEFAULT_SETTINGS.telemetry_enabled);
    expect(typeof all.telemetry_enabled).toBe("boolean");
    expect(all.onboarding_complete).toBe(true);
    expect(typeof all.onboarding_complete).toBe("boolean");
    expect(all.recurring_forget_multiplier).toBe(3);
    expect(typeof all.recurring_forget_multiplier).toBe("number");
    expect(all.capture_enabled).toBe(DEFAULT_SETTINGS.capture_enabled);
    expect(all.cash_reconcile_prompt_at).toBe(DEFAULT_SETTINGS.cash_reconcile_prompt_at);
  });

  test("the corruption is logged, not swallowed silently — the warning names the offending key", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await db.runAsync(
        "INSERT INTO app_settings (id, key, value_json, updated_at) VALUES (?, ?, ?, ?)",
        ["corrupt-3", "recurring_forget_multiplier", "not json at all", Date.now()],
      );

      await getSetting("recurring_forget_multiplier");

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("recurring_forget_multiplier");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
