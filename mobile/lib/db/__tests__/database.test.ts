import { closeDatabase, getDatabase } from "../database";

// Same module both "expo-sqlite" (via jest moduleNameMapper) and this relative path
// resolve to — Babel's CJS interop returns the identical exports object for a module
// flagged `__esModule`, so monkeypatching this reference is visible to database.ts too.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sqliteMock = require("../../../test_support/expo_sqlite_mock");

afterEach(async () => {
  await closeDatabase().catch(() => undefined);
});

test("getDatabase can recover after a rejected open, once closeDatabase clears the wedge", async () => {
  const originalOpen = sqliteMock.openDatabaseAsync;
  let callCount = 0;
  sqliteMock.openDatabaseAsync = async (name: string) => {
    callCount += 1;
    if (callCount === 1) {
      throw new Error("simulated open failure");
    }
    return originalOpen(name);
  };

  try {
    await expect(getDatabase()).rejects.toThrow("simulated open failure");

    // closeDatabase still surfaces the same rejection (there was never a real database to
    // close) — but it must clear the singleton regardless, so the wedge doesn't persist.
    await expect(closeDatabase()).rejects.toThrow("simulated open failure");

    // The open now succeeds (callCount === 2). If closeDatabase failed to clear dbPromise,
    // this would replay the exact same dead rejected promise forever.
    const db = await getDatabase();
    expect(db).toBeDefined();
  } finally {
    sqliteMock.openDatabaseAsync = originalOpen;
  }
});
