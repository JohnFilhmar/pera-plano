// lib/__tests__/bootstrap.test.ts — task-17-brief.md Step 1's three named
// tests, plus the idempotency-by-row-count proof the task explicitly calls
// for: run bootstrapApp() twice and assert the category count did NOT
// double, rather than merely asserting the second call "does not throw."
import { closeDatabase, getDatabase } from "@/lib/db/database";
import {
  __resetBootstrapForTests,
  bootstrapApp,
  getLastBootstrapResult,
} from "@/lib/bootstrap";
import { setSetting } from "@/lib/db/repos/app_settings_repo";
import type { SQLiteDatabase } from "expo-sqlite";

// bootstrapApp opens its own database via getDatabase() (same singleton every
// repo goes through) — unlike the repo test suites, there is deliberately no
// freshDb()/runMigrations() call here: proving bootstrapApp() itself performs
// that setup is the whole point of this suite.
let db: SQLiteDatabase | undefined;

beforeEach(async () => {
  await closeDatabase();
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
