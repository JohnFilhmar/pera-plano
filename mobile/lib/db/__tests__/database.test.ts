import {
  closeDatabase,
  DatabaseLockedError,
  getDatabase,
  isDatabaseUnlocked,
  unlockDatabase,
  wipeDatabase,
} from "../database";
import { runMigrations } from "../migrations";

// Same module both "@op-engineering/op-sqlite" (via jest moduleNameMapper) and this relative
// path resolve to — Babel's CJS interop returns the identical exports object for a module
// flagged `__esModule`, so monkeypatching this reference is visible to database.ts too.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sqliteMock = require("../../../test_support/sqlite_mock");

// A fixed, non-secret 32-byte key. The mock ignores op-sqlite's encryptionKey option entirely
// (test_support/sqlite_mock.ts's header comment), so its exact value is irrelevant here —
// only whether unlockDatabase() was ever called with SOME key matters to this file.
const DEK = new Uint8Array(32).fill(0x11);
const OTHER_DEK = new Uint8Array(32).fill(0x22);

afterEach(async () => {
  await closeDatabase().catch(() => undefined);
});

// ---------------------------------------------------------------------------
// The gate. This is the single most important behavior in this file — see
// DatabaseLockedError's doc in database.ts for why a fresh, empty handle
// instead of a throw would be a silent-data-loss bug, not a convenience.
// ---------------------------------------------------------------------------

test("getDatabase() throws DatabaseLockedError before any unlock, rather than returning a handle", async () => {
  expect(isDatabaseUnlocked()).toBe(false);
  await expect(getDatabase()).rejects.toBeInstanceOf(DatabaseLockedError);
});

test("DatabaseLockedError's message never embeds the DEK or any key material", async () => {
  try {
    await getDatabase();
    throw new Error("expected getDatabase() to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseLockedError);
    const message = (error as Error).message;
    // The message is a fixed, static string — asserting its exact shape here means any
    // future change that starts interpolating the dek (e.g. "for debugging") breaks this
    // test rather than silently shipping key material into a thrown error.
    expect(message).toBe("database is locked — call unlockDatabase(dek) before getDatabase()");
  }
});

// ---------------------------------------------------------------------------
// The full state machine: locked -> unlockDatabase(dek) -> unlocked ->
// closeDatabase() -> locked again. Each transition asserted explicitly, not
// just the end state — a test that only checked the end state could pass
// even if an intermediate transition were broken.
// ---------------------------------------------------------------------------

test("the state machine: locked -> unlocked -> locked again", async () => {
  expect(isDatabaseUnlocked()).toBe(false);
  await expect(getDatabase()).rejects.toBeInstanceOf(DatabaseLockedError);

  await unlockDatabase(DEK);
  expect(isDatabaseUnlocked()).toBe(true);
  const db = await getDatabase();
  expect(db).toBeDefined();

  await closeDatabase();
  expect(isDatabaseUnlocked()).toBe(false);
  await expect(getDatabase()).rejects.toBeInstanceOf(DatabaseLockedError);
});

test("unlockDatabase() is idempotent while already unlocked — a second call (even with a different key) returns the SAME handle rather than re-opening", async () => {
  await unlockDatabase(DEK);
  const first = await getDatabase();

  await unlockDatabase(OTHER_DEK);
  const second = await getDatabase();

  expect(second).toBe(first);
});

test("closeDatabase() before any unlock is a harmless no-op", async () => {
  await expect(closeDatabase()).resolves.toBeUndefined();
  expect(isDatabaseUnlocked()).toBe(false);
});

test("after closeDatabase(), unlockDatabase() can open a fresh handle again (not the old, closed one)", async () => {
  await unlockDatabase(DEK);
  const first = await getDatabase();

  await closeDatabase();
  await unlockDatabase(DEK);
  const second = await getDatabase();

  expect(second).not.toBe(first);
});

// ---------------------------------------------------------------------------
// Migrations run AFTER unlock, on the decrypted handle (contract §3's
// amendment; docs/12 §8) — never before, and never against an unencrypted
// fallback handle.
// ---------------------------------------------------------------------------

test("migrations run after unlockDatabase() and produce all 19 contract tables", async () => {
  await unlockDatabase(DEK);
  const db = await getDatabase();
  await runMigrations(db);

  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' AND name NOT LIKE 'sqlite_%'",
  );
  expect(tables).toHaveLength(19);
});

test("attempting to get a handle before unlock fails closed, not against a silent fallback handle", async () => {
  // getDatabase() is what a would-be caller uses to get a handle for runMigrations — proving
  // it throws before unlock (already covered above) is what makes this true, but this test
  // pins the concrete failure mode a caller doing `runMigrations(await getDatabase())`
  // actually observes: a rejection, not a migration silently running against an empty,
  // unencrypted database.
  await expect(getDatabase()).rejects.toBeInstanceOf(DatabaseLockedError);
});

// ---------------------------------------------------------------------------
// Mutation-check note (recorded in task-7-report.md with the full transcript): temporarily
// changing getDatabase() to fall back to opening a fresh handle instead of throwing when
// dbPromise is null was confirmed to turn the FIRST test in this file (and others above) red.
// That is the discriminating evidence that the gate is enforced by this suite, not merely
// asserted once and never re-checked.
// ---------------------------------------------------------------------------

test("unlockDatabase can recover after a rejected open, once closeDatabase clears the wedge", async () => {
  const originalOpen = sqliteMock.open;
  let callCount = 0;
  sqliteMock.open = (options: { name: string; encryptionKey?: string }) => {
    callCount += 1;
    if (callCount === 1) {
      throw new Error("simulated open failure");
    }
    return originalOpen(options);
  };

  try {
    await expect(unlockDatabase(DEK)).rejects.toThrow("simulated open failure");
    // dbPromise is set (to the now-rejected promise) until closeDatabase clears it — matching
    // the pre-encryption getDatabase()'s wedge contract exactly.
    expect(isDatabaseUnlocked()).toBe(true);

    // closeDatabase still surfaces the same rejection (there was never a real database to
    // close) — but it must clear the singleton regardless, so the wedge doesn't persist.
    await expect(closeDatabase()).rejects.toThrow("simulated open failure");
    expect(isDatabaseUnlocked()).toBe(false);

    // The open now succeeds (callCount === 2). If closeDatabase failed to clear dbPromise,
    // this would replay the exact same dead rejected promise forever.
    await unlockDatabase(DEK);
    const db = await getDatabase();
    expect(db).toBeDefined();
  } finally {
    sqliteMock.open = originalOpen;
  }
});

// ---------------------------------------------------------------------------
// The DEK is handed to a third-party native library as an option value. We do
// not control what that library puts in its error messages, and node_modules
// is not auditable from here — so the guarantee has to be enforced on OUR side
// of the boundary rather than assumed on theirs. This test simulates the worst
// realistic case: a library that echoes its options back in the failure.
// ---------------------------------------------------------------------------

test("an op-sqlite open failure that echoes its options never surfaces the DEK", async () => {
  const originalOpen = sqliteMock.open;
  const dekHex = "11".repeat(32);
  sqliteMock.open = (options: { name: string; encryptionKey?: string }) => {
    // Exactly what a library that interpolates its config into the error would produce.
    const error = new Error(`unable to open database ${options.name} (encryptionKey: ${options.encryptionKey})`);
    // Reading `.stack` before throwing memoizes the formatted string WITH the original
    // message. This is what a library that logs its own failure does, and it is what makes
    // the difference between the two candidate fixes: patching `.message` in place cannot
    // reach an already-materialized stack, whereas building a fresh Error is unaffected.
    // Without this line the weaker fix passes and the test proves nothing.
    void error.stack;
    throw error;
  };

  try {
    let caught: unknown;
    await unlockDatabase(DEK).catch((error: unknown) => {
      caught = error;
    });

    const message = (caught as Error).message;
    // The two forms the key could take: SQLCipher's literal, and the bare hex inside it.
    expect(message).not.toContain(dekHex);
    expect(message).not.toContain(`x'${dekHex}'`);
    // The diagnostic value has to survive the redaction, or the guard just trades a
    // key leak for an unfixable bug report.
    expect(message).toContain("unable to open database");
    // A stack can carry a copy of the message it was built from.
    expect((caught as Error).stack ?? "").not.toContain(dekHex);
  } finally {
    sqliteMock.open = originalOpen;
    await closeDatabase().catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// wipeDatabase() — the §11a "wipe and start over" primitive's database half
// (docs/12-encryption-and-app-lock.md §11a). Unlike closeDatabase(), this
// must destroy the underlying file on disk, not just release the handle —
// the whole point is that the data cannot come back. It must also work with
// NO key at all (the unrecoverable state has none), which is exactly why it
// deletes rather than opening for real use.
// ---------------------------------------------------------------------------

test("wipeDatabase() closes an already-open handle, deletes the file, and returns to the locked state", async () => {
  await unlockDatabase(DEK);
  expect(isDatabaseUnlocked()).toBe(true);

  await wipeDatabase();

  expect(isDatabaseUnlocked()).toBe(false);
  await expect(getDatabase()).rejects.toBeInstanceOf(DatabaseLockedError);
});

test("wipeDatabase() works with NO key and no prior unlock at all -- the unrecoverable-state case has no DEK to open with", async () => {
  expect(isDatabaseUnlocked()).toBe(false);

  await expect(wipeDatabase()).resolves.toBeUndefined();

  expect(isDatabaseUnlocked()).toBe(false);
  await expect(getDatabase()).rejects.toBeInstanceOf(DatabaseLockedError);
});

test("wipeDatabase() always closes before it deletes -- never deletes a still-open file", async () => {
  // The mock's delete() throws if called before close() (test_support/
  // sqlite_mock.ts), modeling op-sqlite's documented `db.close(); db.delete();`
  // ordering. If database.ts's wipeDatabase() ever called delete() first (or
  // skipped close()), this would surface as a rejection here instead of
  // silently passing.
  await unlockDatabase(DEK);
  await expect(wipeDatabase()).resolves.toBeUndefined();
});

test("after wipeDatabase(), unlockDatabase() can open a brand-new handle again", async () => {
  await unlockDatabase(DEK);
  await wipeDatabase();

  await unlockDatabase(OTHER_DEK);
  expect(isDatabaseUnlocked()).toBe(true);
  const db = await getDatabase();
  expect(db).toBeDefined();
});
