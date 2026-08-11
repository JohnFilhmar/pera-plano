// lib/__tests__/bootstrap.test.ts — task-17-brief.md Step 1's three named
// tests, plus the idempotency-by-row-count proof the task explicitly calls
// for: run bootstrapApp() twice and assert the category count did NOT
// double, rather than merely asserting the second call "does not throw."
import { closeDatabase, getDatabase, unlockDatabase } from "@/lib/db/database";
import {
  __resetBootstrapForTests,
  bootstrapApp,
  getLastBootstrapResult,
} from "@/lib/bootstrap";
import { setSetting } from "@/lib/db/repos/app_settings_repo";
import { getActiveRuleset, getActiveVersion } from "@/lib/db/repos/parser_rulesets_repo";
import { TEST_DEK } from "@/test_support/db";
import { enqueue, listOpen } from "@/lib/db/repos/review_queue_repo";
import { getRawCapture, RAW_CAPTURE_TTL_MS, storeRawCapture } from "@/lib/db/repos/raw_notifications_repo";
import { runMigrations } from "@/lib/db/migrations";
import type { RawCapture } from "@/types/domain";
import type { SQLiteDatabase } from "@/lib/db/database";

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
beforeEach(async () => {
  await closeDatabase();
  await unlockDatabase(TEST_DEK);
  __resetBootstrapForTests();
});

afterEach(async () => {
  await closeDatabase();
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
