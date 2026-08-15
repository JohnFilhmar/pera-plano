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
  const theme: "auto" | "light" | "dark" = await getSetting("theme_preference");
  void theme;
  // @ts-expect-error - AppSettings["theme_preference"] is a string union, never a number.
  const notANumber: number = await getSetting("theme_preference");
  void notANumber;
}
void _typeLevelPin_getSettingNarrowsToItsKey;

// ---------------------------------------------------------------------------
// Verbatim from task-14-brief.md — prove the pinned shape exists.
// ---------------------------------------------------------------------------

test("getSetting returns the documented default for every key when nothing is stored", async () => {
  expect(await getSetting("onboarding_complete")).toBe(false);
  expect(await getSetting("capture_enabled")).toBe(true);
  expect(await getSetting("telemetry_enabled")).toBe(true);
  expect(await getSetting("theme_preference")).toBe("auto");
  expect(await getSetting("last_parser_ruleset_version")).toBe(0);
  expect(await getSetting("cash_reconcile_prompt_at")).toBeNull();
});

test("setSetting then getSetting round-trips each of the six value types", async () => {
  await setSetting("onboarding_complete", true);
  await setSetting("capture_enabled", false);
  await setSetting("telemetry_enabled", false);
  await setSetting("theme_preference", "dark");
  await setSetting("last_parser_ruleset_version", 7);
  await setSetting("cash_reconcile_prompt_at", 1_700_000_000_000);

  expect(await getSetting("onboarding_complete")).toBe(true);
  expect(await getSetting("capture_enabled")).toBe(false);
  expect(await getSetting("telemetry_enabled")).toBe(false);
  expect(await getSetting("theme_preference")).toBe("dark");
  expect(await getSetting("last_parser_ruleset_version")).toBe(7);
  expect(await getSetting("cash_reconcile_prompt_at")).toBe(1_700_000_000_000);
});

test("setSetting called twice on the same key upserts, not duplicates", async () => {
  await setSetting("last_parser_ruleset_version", 1);
  await setSetting("last_parser_ruleset_version", 2);

  const rows = await db.getAllAsync<{ value_json: string }>(
    "SELECT value_json FROM app_settings WHERE key = ?",
    ["last_parser_ruleset_version"],
  );
  expect(rows).toHaveLength(1);
  expect(await getSetting("last_parser_ruleset_version")).toBe(2);
});

test("getAllSettings merges stored values over defaults for the rest", async () => {
  await setSetting("theme_preference", "light");

  const all = await getAllSettings();
  expect(all).toEqual({
    ...DEFAULT_SETTINGS,
    theme_preference: "light",
  });
});

test("resetSettings restores every default", async () => {
  await setSetting("onboarding_complete", true);
  await setSetting("capture_enabled", false);
  await setSetting("theme_preference", "dark");
  await setSetting("last_parser_ruleset_version", 9);
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
    ["theme_preference", "light", "string"],
    ["last_parser_ruleset_version", 42, "number"],
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
});

describe("reading an unset key returns exactly its documented default, per key", () => {
  test.each([
    ["onboarding_complete", false],
    ["capture_enabled", true],
    ["telemetry_enabled", true],
    ["theme_preference", "auto"],
    ["last_parser_ruleset_version", 0],
  ] as const)("%s defaults to %p", async (key, expected) => {
    const value = await getSetting(key);
    expect(value).toBe(expected);
    expect(value).not.toBeNull();
  });

  test("cash_reconcile_prompt_at defaults to null specifically, not merely falsy", async () => {
    const value = await getSetting("cash_reconcile_prompt_at");
    expect(value).toBeNull();
  });

  test("an unset key never throws", async () => {
    await expect(getSetting("last_parser_ruleset_version")).resolves.not.toThrow();
  });
});

describe("setSetting upsert leaves exactly one row per key, with the latest value persisted", () => {
  test("two writes to the same key: one row, value_json reflects the second write", async () => {
    await setSetting("theme_preference", "light");
    await setSetting("theme_preference", "dark");

    const rows = await db.getAllAsync<{ value_json: string }>(
      "SELECT value_json FROM app_settings WHERE key = ?",
      ["theme_preference"],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].value_json)).toBe("dark");
  });

  test("writing two different keys produces two rows, not one shared row", async () => {
    await setSetting("theme_preference", "dark");
    await setSetting("onboarding_complete", true);

    const rows = await db.getAllAsync<{ key: string }>("SELECT key FROM app_settings");
    expect(rows.map((r) => r.key).sort()).toEqual(["onboarding_complete", "theme_preference"]);
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
    await setSetting("last_parser_ruleset_version", 5);

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

describe("a corrupt value_json cell is decoded defensively, never thrown", () => {
  test("getSetting returns the key's documented default when its stored value_json is malformed", async () => {
    await db.runAsync(
      "INSERT INTO app_settings (id, key, value_json, updated_at) VALUES (?, ?, ?, ?)",
      ["corrupt-1", "theme_preference", "{not json", Date.now()],
    );

    const value = await getSetting("theme_preference");
    expect(value).toBe(DEFAULT_SETTINGS.theme_preference);
    expect(typeof value).toBe("string");
  });

  test("getAllSettings falls back to the default for a corrupt key without poisoning the other stored values", async () => {
    // Two healthy stored values, then one row corrupted via raw SQL — proves
    // the fallback is scoped to the one bad key, not a whole-read failure
    // that would also wipe out onboarding_complete/last_parser_ruleset_version.
    await setSetting("onboarding_complete", true);
    await setSetting("last_parser_ruleset_version", 3);
    await db.runAsync(
      "INSERT INTO app_settings (id, key, value_json, updated_at) VALUES (?, ?, ?, ?)",
      ["corrupt-2", "theme_preference", "{not json", Date.now()],
    );

    const all = await getAllSettings();
    expect(all.theme_preference).toBe(DEFAULT_SETTINGS.theme_preference);
    expect(all.onboarding_complete).toBe(true);
    expect(typeof all.onboarding_complete).toBe("boolean");
    expect(all.last_parser_ruleset_version).toBe(3);
    expect(typeof all.last_parser_ruleset_version).toBe("number");
    expect(all.capture_enabled).toBe(DEFAULT_SETTINGS.capture_enabled);
    expect(all.telemetry_enabled).toBe(DEFAULT_SETTINGS.telemetry_enabled);
    expect(all.cash_reconcile_prompt_at).toBe(DEFAULT_SETTINGS.cash_reconcile_prompt_at);
  });

  test("the corruption is logged, not swallowed silently — the warning names the offending key", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await db.runAsync(
        "INSERT INTO app_settings (id, key, value_json, updated_at) VALUES (?, ?, ?, ?)",
        ["corrupt-3", "last_parser_ruleset_version", "not json at all", Date.now()],
      );

      await getSetting("last_parser_ruleset_version");

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("last_parser_ruleset_version");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
