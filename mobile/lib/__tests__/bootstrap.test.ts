// lib/__tests__/bootstrap.test.ts — task-17-brief.md Step 1's three named
// tests, plus the idempotency-by-row-count proof the task explicitly calls
// for: run bootstrapApp() twice and assert the category count did NOT
// double, rather than merely asserting the second call "does not throw."
// react-native's AppState is mocked via a Proxy over jest.requireActual, not
// a plain `{...actual}` spread — same technique and same reason as
// contexts/__tests__/lock_context.test.tsx: spreading eagerly evaluates every
// lazy getter on the real module, including native-only exports that crash
// outside a real app. Needed here because `startNetworkSyncSubscriber`
// (M3c Task 7 rule 3, tested below) subscribes to
// `AppState.addEventListener("change", ...)` directly.
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const listeners: Array<(state: string) => void> = [];
  const mockAppState = {
    currentState: "active",
    addEventListener: jest.fn((_event: string, cb: (state: string) => void) => {
      listeners.push(cb);
      return {
        remove: jest.fn(() => {
          const idx = listeners.indexOf(cb);
          if (idx >= 0) listeners.splice(idx, 1);
        }),
      };
    }),
    __emit: (state: string) => {
      for (const cb of [...listeners]) cb(state);
    },
  };
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === "AppState") return mockAppState;
      return Reflect.get(target, prop, receiver);
    },
  });
});

// The native listener module, whose value side calls `requireNativeModule` at
// import time — there is nothing to bind to under Jest, so without this every
// test in this file would die at module load now that `bootstrapApp()` pushes
// the provider filter back across the bridge (GAP-092). Only the one function
// bootstrap actually imports is defined here: an over-complete mock would let
// a future import of a second bridge call pass silently.
jest.mock("@/modules/notification_listener", () => ({
  setProviderFilter: jest.fn(async () => undefined),
}));

// The notification CHANNELS, mocked at the same boundary and for the same
// reason: this file asserts that a launch creates them, not how. Only the one
// export bootstrap uses is defined, so a second one would fail loudly here
// rather than silently no-op (GAP-127).
jest.mock("@/lib/alerts/alerts_service", () => ({
  ensureNotificationChannels: jest.fn(async () => undefined),
}));

import { AppState } from "react-native";
import { ensureNotificationChannels } from "@/lib/alerts/alerts_service";
import { closeDatabase, getDatabase, unlockDatabase } from "@/lib/db/database";
import {
  __resetBootstrapForTests,
  bootstrapApp,
  getLastBootstrapResult,
  startNetworkSyncSubscriber,
} from "@/lib/bootstrap";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { SEED_BUNDLE } from "@/lib/ingest/seed_rules";
import {
  clearOnboardingProviderPause,
  recordOnboardingProviderPause,
} from "@/lib/onboarding/pending_provider_pause";
import { setProviderFilter } from "@/modules/notification_listener";
import {
  getActiveRuleset,
  getActiveVersion,
  upsertRuleset,
} from "@/lib/db/repos/parser_rulesets_repo";
import { TEST_DEK } from "@/test_support/db";
import { enqueue, listOpen } from "@/lib/db/repos/review_queue_repo";
import { getRawCapture, RAW_CAPTURE_TTL_MS, storeRawCapture } from "@/lib/db/repos/raw_notifications_repo";
import { runMigrations } from "@/lib/db/migrations";
import { getIncomeDetectionState } from "@/lib/db/repos/income_repo";
import * as incomeService from "@/lib/income/income_service";
import * as recurringService from "@/lib/recurring/recurring_service";
import { apiClient } from "@/services/api";
import * as parserRulesService from "@/services/parser_rules";
import * as telemetryService from "@/services/telemetry";
import type { RawCapture } from "@/types/domain";
import type { SQLiteDatabase } from "@/lib/db/database";

/** Simulates an OS-level foreground/background transition for the mocked
 * `AppState` above. */
function emitAppState(state: "active" | "background") {
  (AppState as unknown as { __emit: (s: string) => void }).__emit(state);
}

/** Flushes bootstrapApp()'s own unawaited `.then()`/`.catch()` chains — the
 * fire-and-forget network calls under test below — without touching real or
 * fake timers. A plain microtask loop is not always enough once a real
 * sql.js-backed repo call sits in the chain (getActiveVersion, getSetting),
 * which can resolve on a macrotask; the trailing `setTimeout(0)` covers that. */
async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Minimal AxiosResponse stand-in — same shape services/__tests__/telemetry.test.ts's
 * own `okResponse()` helper uses. */
function axiosResponse(status: number, data: unknown) {
  return { data, status, statusText: "", headers: {}, config: {} as never };
}

// bootstrapApp opens its own database via getDatabase() (same singleton every
// repo goes through) — unlike the repo test suites, there is deliberately no
// freshDb()/runMigrations() call here: proving bootstrapApp() itself performs
// that setup is the whole point of this suite.
let db: SQLiteDatabase | undefined;

// Task 7: getDatabase() now throws DatabaseLockedError until unlockDatabase(dek) has run
// (interface contract §3). This suite is about bootstrapApp()'s migrate/seed sequence, not
// about the unlock gate itself (that is lib/db/__tests__/database.test.ts's job), so it
// satisfies the precondition directly rather than asserting anything about it.
//
// CARRY TO TASK 9: nothing in the real app calls unlockDatabase() yet. app/_layout.tsx's
// AppShell calls bootstrapApp() unconditionally on mount with no unlock gate in front of it,
// so on a real device bootstrapApp() will throw DatabaseLockedError and the app will show the
// "PeraPlano couldn't start" recovery screen on every cold start until Task 9 wires its
// unlock screen (device biometric / recovery phrase -> key_manager.unlockWith*() ->
// database.unlockDatabase(dek)) BEFORE AppShell's bootstrapApp() call.
// Every bootstrapApp() call now also fires checkForRulesetUpdate/sendParseStats
// (M3c Task 7 rule 1), unawaited. Without a default mock here, every test
// above and below this comment — not just the ones about networking — would
// open a real socket to `apiClient`'s base URL, exactly what
// services/__tests__/parser_rules.test.ts and telemetry.test.ts's own
// headers say this codebase never does. Mocked at the transport (apiClient.get
// /apiClient.post), not the service functions, so the real interval/validation
// logic inside checkForRulesetUpdate and sendParseStats keeps running — the
// interval tests below depend on that being real, not stubbed away.
let getSpy: jest.SpiedFunction<typeof apiClient.get>;
let postSpy: jest.SpiedFunction<typeof apiClient.post>;

beforeEach(async () => {
  await closeDatabase();
  await unlockDatabase(TEST_DEK);
  __resetBootstrapForTests();
  // A module-level singleton like `lastResult`, so it needs the same explicit
  // reset: a pending onboarding selection left by one test would be written by
  // the next test's very first bootstrapApp().
  clearOnboardingProviderPause();
  getSpy = jest.spyOn(apiClient, "get").mockResolvedValue(axiosResponse(404, null));
  postSpy = jest.spyOn(apiClient, "post").mockResolvedValue(axiosResponse(200, {}));
});

afterEach(async () => {
  await closeDatabase();
  getSpy.mockRestore();
  postSpy.mockRestore();
});

test("bootstrapApp creates the notification channels, without which every alert is dropped", async () => {
  // FOUND ON A DEVICE, NOT IN A TEST (GAP-127). `ensureNotificationChannels`
  // existed and was tested, and nothing in the app ever called it, so the
  // `goals`, `limits` and `reminders` channels were never created on a real
  // phone. Android drops a notification posted to a channel that does not
  // exist: the alarm fires, expo-notifications logs "will not trigger in the
  // future, removing", and nothing reaches the shade. Every limit threshold,
  // bill reminder and goal milestone this app has ever posted died there.
  //
  // AWAITED INSIDE BOOTSTRAP rather than fired from a layout effect, because
  // the subscribers that post are started the moment bootstrap reports ready,
  // and a channel created in a racing effect can lose to the first alert.
  await bootstrapApp();

  expect(ensureNotificationChannels).toHaveBeenCalled();
});

test("bootstrapApp runs migrations then seeds categories (15 rows present afterward)", async () => {
  await bootstrapApp();

  db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string }>("SELECT id FROM categories");
  expect(rows).toHaveLength(15);
});

test("calling bootstrapApp twice does not duplicate categories", async () => {
  await bootstrapApp();
  await bootstrapApp();

  db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string }>("SELECT id FROM categories");
  // Exactly 15, not 30 — a bootstrapApp that re-seeds unconditionally (e.g. an
  // INSERT without the fixed-id + OR IGNORE contract categories_repo relies
  // on) would double this count on the second call.
  expect(rows).toHaveLength(15);
});

test("bootstrapApp returns onboardingComplete: false on a fresh database", async () => {
  const result = await bootstrapApp();
  expect(result).toEqual({ onboardingComplete: false });
});

test("bootstrapApp reflects a previously-persisted onboarding_complete=true, not a hardcoded false", async () => {
  await bootstrapApp();
  await setSetting("onboarding_complete", true);

  const result = await bootstrapApp();
  expect(result).toEqual({ onboardingComplete: true });
});

test("bootstrapApp seeds the bundled parser ruleset — version 1 is active afterward", async () => {
  await bootstrapApp();

  // The pipeline must parse fully offline and on first run (spec §11.5); a
  // bootstrap that skips the seed leaves every notification unparseable with
  // no visible error anywhere.
  expect(await getActiveVersion()).toBe(1);
  const ruleset = await getActiveRuleset();
  expect(ruleset!.providers.length).toBeGreaterThan(0);
});

test("calling bootstrapApp twice does not duplicate the parser ruleset row", async () => {
  await bootstrapApp();
  await bootstrapApp();

  db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string }>("SELECT id FROM parser_rulesets");
  // Exactly 1, not 2 — `parser_rulesets.version` is UNIQUE, so a re-seed that
  // was not a genuine no-op would throw here at app start rather than merely
  // double-writing.
  expect(rows).toHaveLength(1);
});

test("migrations are not re-applied on a second bootstrapApp call — schema_migrations keeps exactly one row for version 1", async () => {
  await bootstrapApp();
  await bootstrapApp();

  db = await getDatabase();
  const rows = await db.getAllAsync<{ version: number }>(
    "SELECT version FROM schema_migrations WHERE version = 1",
  );
  expect(rows).toHaveLength(1);
});

describe("getLastBootstrapResult", () => {
  test("is null before bootstrapApp has ever resolved", () => {
    expect(getLastBootstrapResult()).toBeNull();
  });

  test("synchronously reflects the most recent bootstrapApp() resolution", async () => {
    const resolved = await bootstrapApp();
    expect(getLastBootstrapResult()).toEqual(resolved);
  });
});

// ---------------------------------------------------------------------------
// Retention hygiene (plan Task 11 rule 1).
//
// Startup is where retention runs, because it is the only moment guaranteed to
// happen on a device the user actually opens. Both purges are bounded by the
// clock, so both tests pin it rather than trusting wall time.
// ---------------------------------------------------------------------------

test("bootstrapApp purges raw captures past their 30-day TTL and leaves the rest", async () => {
  await unlockDatabase(TEST_DEK);
  db = await getDatabase();
  await runMigrations(db);

  const now = Date.now();
  // One expired, one not. Asserting only the expired one is gone is what
  // separates "purge works" from "purge deleted the table".
  await storeRawCapture(rawFixture("raw-old"), now - RAW_CAPTURE_TTL_MS - 1);
  await storeRawCapture(rawFixture("raw-fresh"), now);

  await bootstrapApp();

  expect(await getRawCapture("raw-old")).toBeNull();
  expect(await getRawCapture("raw-fresh")).not.toBeNull();
});

test("bootstrapApp purges expired review items and leaves the rest", async () => {
  await unlockDatabase(TEST_DEK);
  db = await getDatabase();
  await runMigrations(db);

  const now = Date.now();
  await enqueue({ kind: "low-confidence", payload: {}, expiresAt: now - 1 });
  await enqueue({ kind: "low-confidence", payload: {}, expiresAt: now + 60_000 });

  await bootstrapApp();

  // Counted straight off the table, NOT through listOpen: that query already
  // filters `expires_at > now`, so an assertion through it passes whether or
  // not the purge ever ran. Retention means the row is GONE from disk — the
  // point is that expired notification-derived content stops existing, not
  // that a list hides it.
  const rows = await db.getAllAsync<{ id: string }>("SELECT id FROM review_queue_items");
  expect(rows).toHaveLength(1);
  // And it is the right survivor.
  expect(await listOpen()).toHaveLength(1);
});

function rawFixture(id: string): RawCapture {
  return {
    id,
    packageName: "com.globe.gcash.android",
    title: "GCash", // ILLUSTRATIVE
    text: "You sent ₱1.00", // ILLUSTRATIVE
    subText: null,
    bigText: null,
    postedAt: 1,
    capturedAt: 1,
  };
}

// ---------------------------------------------------------------------------
// Income detection on startup — m2-part2 Task 14, rules 1 and 3.
// ---------------------------------------------------------------------------
describe("income detection runs once per launch", () => {
  test("bootstrapApp runs a detection pass, and it happens AFTER the migrations", async () => {
    // Rule 1. The ordering is the point: detection reads the ledger and the
    // loan-payment rows, so a pass before `runMigrations` would query tables
    // that do not exist yet — and, because its failures are swallowed, would
    // fail silently on every fresh install.
    await unlockDatabase(TEST_DEK);
    // Deliberately NOT read before the call: `app_settings` does not exist yet,
    // which is the very hazard this test is about. Reading it here throws "no
    // such table" — the same failure a detection pass placed before
    // `runMigrations` would hit, silently, because its errors are swallowed.
    const spy = jest.spyOn(incomeService, "refreshIncomeDetection");

    await expect(bootstrapApp()).resolves.toEqual({ onboardingComplete: false });

    expect(spy).toHaveBeenCalledTimes(1);

    // It ran against a migrated schema and WROTE its notes, rather than being
    // swallowed on a missing table. On an empty ledger the detector's honest
    // answer is `irregular` with no evidence, so the notes record that while
    // `status` stays "unknown" — and `getIncomeSummary` gates on the status, so
    // a percent-of-income Limit still reads as Paused rather than picking up a
    // cadence nobody has any evidence for.
    const state = await getIncomeDetectionState();
    expect(state.status).toBe("unknown");
    expect(state.averageAmount).toBeNull();
    expect(state.matchedTransactionIds).toEqual([]);
    spy.mockRestore();
  });

  test("A THROWING DETECTION DOES NOT PREVENT BOOTSTRAP FROM RESOLVING", async () => {
    // Rule 3: "Income work must never block or break startup". The user can
    // still read their ledger and fix things by hand; an app that will not open
    // cannot be fixed at all. Same asymmetry `runRetention` already has.
    await unlockDatabase(TEST_DEK);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const spy = jest
      .spyOn(incomeService, "refreshIncomeDetection")
      .mockRejectedValue(new Error("detection exploded"));

    await expect(bootstrapApp()).resolves.toEqual({ onboardingComplete: false });

    // The rest of the sequence still happened — this is not "bootstrap gave up
    // quietly", it is "bootstrap finished without income".
    expect(await getActiveVersion()).toBeGreaterThan(0);
    spy.mockRestore();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Recurring-pattern detection on startup — M3 Part 2 Task 7, rules 2 and 3.
// ---------------------------------------------------------------------------
describe("recurring detection runs once per launch", () => {
  test("bootstrapApp runs a refresh pass", async () => {
    await unlockDatabase(TEST_DEK);
    const spy = jest.spyOn(recurringService, "refreshPatterns");

    await expect(bootstrapApp()).resolves.toEqual({ onboardingComplete: false });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  test("A THROWING REFRESH DOES NOT PREVENT BOOTSTRAP FROM RESOLVING", async () => {
    // Rule 3: patterns are derived from the ledger, recomputable at any time,
    // so a launch is not worth failing over them — same asymmetry `runRetention`
    // and income detection already have.
    await unlockDatabase(TEST_DEK);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const spy = jest
      .spyOn(recurringService, "refreshPatterns")
      .mockRejectedValue(new Error("detection exploded"));

    await expect(bootstrapApp()).resolves.toEqual({ onboardingComplete: false });

    // The rest of the sequence still happened.
    expect(await getActiveVersion()).toBeGreaterThan(0);
    spy.mockRestore();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Ruleset check and telemetry send — M3c Task 7.
//
// Rule 1: neither call may be awaited — a request on Philippine mobile data
// can hang for the better part of a minute, and startup must never wait on
// that (STACK_BASIS §8). Rule 2: a throw from either is logged and swallowed
// — belt-and-braces, since both services already resolve rather than reject
// on every failure mode they document (offline, non-2xx, opted out, within
// their own interval), but a caller should not trust that forever. Rule 3: a
// foreground re-checks, respecting the intervals the services already
// enforce against `app_settings` — proven below against the REAL
// `checkForRulesetUpdate`/`sendParseStats` (mocked only at the `apiClient`
// transport, via the file-level `getSpy`/`postSpy` from the outer
// `beforeEach`), not a stand-in for their interval logic. No interval math is
// duplicated in `lib/bootstrap.ts` itself — see `startNetworkSyncSubscriber`'s
// own doc for why.
// ---------------------------------------------------------------------------
describe("ruleset check and telemetry send fire off the startup path", () => {
  test("bootstrap resolves without waiting for the network calls", async () => {
    // Deliberately slow — a promise that never resolves. If bootstrapApp()
    // ever awaited either call, this test would hang until Jest's own
    // testTimeout and fail loudly, instead of passing by accident because a
    // mock happened to resolve instantly.
    const ruleSpy = jest
      .spyOn(parserRulesService, "checkForRulesetUpdate")
      .mockReturnValue(new Promise<{ updated: boolean; version: number }>(() => {}));
    const telemetrySpy = jest
      .spyOn(telemetryService, "sendParseStats")
      .mockReturnValue(new Promise<{ sent: boolean }>(() => {}));

    await expect(bootstrapApp()).resolves.toEqual({ onboardingComplete: false });

    ruleSpy.mockRestore();
    telemetrySpy.mockRestore();
  });

  test("a throwing ruleset check does not break bootstrap", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const ruleSpy = jest
      .spyOn(parserRulesService, "checkForRulesetUpdate")
      .mockRejectedValue(new Error("ruleset check exploded"));

    await expect(bootstrapApp()).resolves.toEqual({ onboardingComplete: false });
    // The rejection is unawaited — give its `.catch` a turn before asserting
    // it was logged rather than left as an unhandled rejection.
    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("checkForRulesetUpdate"),
      expect.any(Error),
    );

    ruleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("a throwing telemetry send does not break bootstrap", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const telemetrySpy = jest
      .spyOn(telemetryService, "sendParseStats")
      .mockRejectedValue(new Error("telemetry send exploded"));

    await expect(bootstrapApp()).resolves.toEqual({ onboardingComplete: false });
    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("sendParseStats"),
      expect.any(Error),
    );

    telemetrySpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("foregrounding triggers a re-check outside the interval", async () => {
    const BASE_NOW = new Date(2026, 7, 15, 12, 0).getTime();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(BASE_NOW);

    await bootstrapApp();
    await flushMicrotasks();
    expect(getSpy).toHaveBeenCalledTimes(1); // the initial, launch-time check

    const stop = startNetworkSyncSubscriber();
    // 25 hours later — past checkForRulesetUpdate's 24h interval.
    nowSpy.mockReturnValue(BASE_NOW + 25 * 60 * 60 * 1000);
    emitAppState("active");
    await flushMicrotasks();

    expect(getSpy).toHaveBeenCalledTimes(2);

    stop();
    nowSpy.mockRestore();
  });

  test("foregrounding inside the interval does not re-check", async () => {
    const BASE_NOW = new Date(2026, 7, 15, 12, 0).getTime();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(BASE_NOW);

    await bootstrapApp();
    await flushMicrotasks();
    expect(getSpy).toHaveBeenCalledTimes(1);

    const stop = startNetworkSyncSubscriber();
    // 1 minute later — well inside the 24h interval.
    nowSpy.mockReturnValue(BASE_NOW + 60 * 1000);
    emitAppState("active");
    await flushMicrotasks();

    // checkForRulesetUpdate's own `app_settings.parser_rules_checked_at` gate
    // (services/parser_rules.ts) short-circuits before ever reaching
    // `apiClient.get` — the call count staying at 1 proves that gate actually
    // fired through this wiring, not merely that the wiring itself stayed
    // quiet.
    expect(getSpy).toHaveBeenCalledTimes(1);

    stop();
    nowSpy.mockRestore();
  });
});

// The provider allowlist is re-pushed on every launch (GAP-092). The native
// filter is stored sealed and has no getter, so a blob that cannot be opened
// — Keystore reset, restore onto another device, a foreign build — reads back
// as the empty set, which the listener treats as ALLOW EVERY PACKAGE while the
// Privacy switches keep showing providers paused. `bootstrapApp()` closes that
// by pushing `paused_provider_packages` back down after unlock; these tests
// pin BOTH halves of the rule, because the dangerous half is the second one:
// the re-sync must never widen the filter it is supposed to be restoring.
describe("provider filter re-sync", () => {
  const mockSetProviderFilter = setProviderFilter as jest.Mock;
  // Two real package names out of assets/parser_rules/seed.json — the seed
  // bootstrapApp() installs is what the allowlist is subtracted from.
  const GCASH = "com.globe.gcash.android";
  const MAYA = "com.paymaya";

  beforeEach(() => {
    mockSetProviderFilter.mockClear();
    mockSetProviderFilter.mockResolvedValue(undefined);
  });

  /** Every package name in the ruleset a completed bootstrapApp() has seeded. */
  async function seededPackages(): Promise<string[]> {
    const bundle = await getActiveRuleset();
    return (bundle?.providers ?? []).flatMap((provider) => provider.packageNames);
  }

  test("a paused provider is pushed back to the listener as an allowlist without it", async () => {
    // First launch: migrate and seed, so there is a package universe to
    // subtract from. Nothing is paused yet, so nothing is pushed.
    await bootstrapApp();
    const everyPackage = await seededPackages();
    // If the seed ever stops carrying these packages the rest of the test
    // would pass while proving nothing, so they are checked, not assumed.
    expect(everyPackage).toContain(MAYA);
    expect(everyPackage).toContain(GCASH);

    await setSetting("paused_provider_packages", [MAYA]);
    mockSetProviderFilter.mockClear();

    await bootstrapApp();

    expect(mockSetProviderFilter).toHaveBeenCalledTimes(1);
    const allowed = mockSetProviderFilter.mock.calls[0][0] as string[];
    expect(allowed).not.toContain(MAYA);
    expect(allowed).toContain(GCASH);
    // The exact complement, not merely "a list that omits Maya": a re-sync
    // that quietly dropped other providers would be the same privacy setting
    // failing in the opposite direction.
    expect([...allowed].sort()).toEqual(
      everyPackage.filter((packageName) => packageName !== MAYA).sort(),
    );
    // Something is still allowed, so this is an allowlist and not a deny-all.
    expect(mockSetProviderFilter.mock.calls[0][1]).toBe(false);
  });

  test("nothing is pushed when the pause list is empty — `[]` would mean allow-all natively", async () => {
    // An empty row is NOT "the user wants everything captured". It is the
    // fresh-install default, and what app/(onboarding)/providers.tsx leaves
    // behind for a user who allowed everything or tapped Skip — so pushing `[]`
    // on an empty row would wipe whatever narrower filter the listener is
    // already holding from that step.
    await bootstrapApp();

    expect(mockSetProviderFilter).not.toHaveBeenCalled();
  });

  test("pausing every known provider pushes the explicit deny-all, never an empty allow-all list", async () => {
    await bootstrapApp();
    await setSetting("paused_provider_packages", await seededPackages());
    mockSetProviderFilter.mockClear();

    await bootstrapApp();

    // This used to push NOTHING, because an allowlist could not express "block
    // everything" and `[]` is allow-all on the Kotlin side. GAP-103 gave the
    // bridge a flag for it, so the state is now re-asserted like every other —
    // which matters most in the case this whole re-sync exists for: a sealed
    // filter that could not be opened and silently fell back to allow-all.
    expect(mockSetProviderFilter).toHaveBeenCalledTimes(1);
    expect(mockSetProviderFilter).toHaveBeenCalledWith([], true);
  });

  test("a ruleset that names no packages is still skipped — that empty list is not a deny-all", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await bootstrapApp();
    await setSetting("paused_provider_packages", [MAYA]);
    // A ruleset with no providers at all: the allowlist arithmetic yields the
    // same `[]` as "everyone is paused", and only one of the two means block
    // everything. Pushing a deny-all here would stop capture on any launch
    // where the ruleset had not loaded.
    await upsertRuleset({ version: 9999, providers: [], tunables: {} });
    mockSetProviderFilter.mockClear();

    await bootstrapApp();

    expect(mockSetProviderFilter).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("provider filter re-sync skipped"));

    warnSpy.mockRestore();
  });

  test("a rejected bridge call is logged and does not fail the launch", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await bootstrapApp();
    await setSetting("paused_provider_packages", [MAYA]);
    mockSetProviderFilter.mockRejectedValueOnce(new Error("bridge unavailable"));

    await expect(bootstrapApp()).resolves.toEqual({ onboardingComplete: false });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("provider filter re-sync failed"),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});

// The onboarding provider step's own selection, carried into the first launch
// that has a database (GAP-116). That screen renders above the unlock gate, so
// it cannot write `paused_provider_packages` itself — it hands the complement of
// its allowlist to lib/onboarding/pending_provider_pause.ts, and `bootstrapApp()`
// stores it just before the re-sync above pushes it back down.
//
// WHAT WAS LOST WITHOUT IT: `setProviderFilter` rejects when the scope did not
// seal (GAP-114), and that screen deliberately logs and carries on rather than
// stranding a first-run user over a filter — so the selection may never have
// reached the listener at all. With no row, nothing could re-apply it, nothing
// could show it, and the step is never offered again to an install that already
// has keys.
//
// EVERY EMPTY CASE HERE IS ALSO A GAP-092 TEST. The re-sync only ever narrows,
// and this pass is what decides whether there is a row for it to narrow from; a
// record that turned "the user allowed everything" into a full pause list would
// make the very next launch push the explicit block-everything.
describe("onboarding provider selection", () => {
  const mockSetProviderFilter = setProviderFilter as jest.Mock;
  const GCASH = "com.globe.gcash.android";
  const MAYA = "com.paymaya";

  beforeEach(() => {
    mockSetProviderFilter.mockClear();
    mockSetProviderFilter.mockResolvedValue(undefined);
  });

  /** The universe the provider step inverts against: no database is open on
   * that screen, so it is the bundled seed rather than the installed ruleset. */
  function stepUniverse(): string[] {
    return SEED_BUNDLE.providers.flatMap((provider) => provider.packageNames);
  }

  /** Every package name in the ruleset a completed bootstrapApp() has seeded. */
  async function seededPackages(): Promise<string[]> {
    const bundle = await getActiveRuleset();
    return (bundle?.providers ?? []).flatMap((provider) => provider.packageNames);
  }

  test("a selection whose seal failed is stored and re-asserted on the launch after it", async () => {
    // The whole of what the provider step can do: push an allowlist at a bridge
    // that dropped it, and record the complement for the launch that has
    // somewhere to put it.
    recordOnboardingProviderPause([GCASH], stepUniverse());

    await bootstrapApp();

    const everyPackage = await seededPackages();
    // Checked, not assumed: a seed that stopped carrying these would leave the
    // rest of this test passing while proving nothing.
    expect(everyPackage).toContain(GCASH);
    expect(everyPackage).toContain(MAYA);
    // The readable row — what the Privacy switches show and what every later
    // launch re-asserts from. It did not exist at all before this pass.
    expect([...(await getSetting("paused_provider_packages"))].sort()).toEqual(
      everyPackage.filter((packageName) => packageName !== GCASH).sort(),
    );
    // And pushed back across the bridge in the SAME launch, not merely written
    // down: the row is stored before the re-sync runs, on purpose.
    expect(mockSetProviderFilter).toHaveBeenCalledTimes(1);
    expect(new Set(mockSetProviderFilter.mock.calls[0][0] as string[])).toEqual(new Set([GCASH]));
    expect(mockSetProviderFilter.mock.calls[0][1]).toBe(false);
  });

  test("the stored selection is re-asserted on later launches too, not only the one that wrote it", async () => {
    recordOnboardingProviderPause([GCASH], stepUniverse());
    await bootstrapApp();
    mockSetProviderFilter.mockClear();

    await bootstrapApp();

    expect(mockSetProviderFilter).toHaveBeenCalledTimes(1);
    expect(new Set(mockSetProviderFilter.mock.calls[0][0] as string[])).toEqual(new Set([GCASH]));
  });

  test("a skipped step records nothing, so the re-sync still pushes nothing (GAP-092)", async () => {
    // `[]` from that screen is ALLOW-ALL. Recorded as `universe - []` it would
    // be every provider paused, and the re-sync above reads a non-empty pause
    // list with an empty remainder as `setProviderFilter([], true)` — every user
    // who tapped Skip would silently stop capturing anything.
    recordOnboardingProviderPause([], stepUniverse());

    await bootstrapApp();

    expect(await getSetting("paused_provider_packages")).toEqual([]);
    expect(mockSetProviderFilter).not.toHaveBeenCalled();
  });

  test("allowing every known provider records nothing — there is nothing to narrow", async () => {
    recordOnboardingProviderPause(stepUniverse(), stepUniverse());

    await bootstrapApp();

    expect(await getSetting("paused_provider_packages")).toEqual([]);
    expect(mockSetProviderFilter).not.toHaveBeenCalled();
  });

  test("a selection of only packages the ruleset never heard of records nothing", async () => {
    // Their one bank is absent from the ruleset, so every KNOWN package is
    // unticked and the naive complement is the entire universe — which the
    // re-sync reads as block-everything, aimed at the very user whose choice it
    // would be blocking. The re-sync cannot express "allow only this unknown
    // package" (pre-existing, see resyncProviderFilter); what it must not do is
    // answer with a deny-all instead.
    recordOnboardingProviderPause(["com.example.realbank.ph"], stepUniverse());

    await bootstrapApp();

    expect(await getSetting("paused_provider_packages")).toEqual([]);
    expect(mockSetProviderFilter).not.toHaveBeenCalled();
  });

  test("the selection is written once, never re-applied over a pause the user changed later", async () => {
    recordOnboardingProviderPause([GCASH], stepUniverse());
    await bootstrapApp();

    // The user resumes every provider in the Privacy centre, then re-locks and
    // unlocks — a second bootstrapApp() in the same process.
    await setSetting("paused_provider_packages", []);
    mockSetProviderFilter.mockClear();

    await bootstrapApp();

    expect(await getSetting("paused_provider_packages")).toEqual([]);
    expect(mockSetProviderFilter).not.toHaveBeenCalled();
  });
});
