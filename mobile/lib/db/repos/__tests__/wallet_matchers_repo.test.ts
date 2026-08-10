// lib/db/repos/__tests__/wallet_matchers_repo.test.ts — the read side of
// `wallet_matchers`, owed to the Normalizer since plan Task 5.
//
// `normalizeEvent(event, provider, wallets, matchers, tunables)` is pure and
// does no I/O, so somebody has to hand it the rows. This is that somebody. The
// write side (`setMatchers`, `findWalletForPackage`) belongs to the wallets UI
// plan (m1c Task 5) and is deliberately not invented here — these tests insert
// through SQL for the same reason the repo exposes no writer yet.
import { closeDatabase } from "@/lib/db/database";
import { createWallet } from "../wallets_repo";
import { freshDb } from "@/test_support/db";
import { listMatchers } from "../wallet_matchers_repo";
import type { SQLiteDatabase } from "@/lib/db/database";

const NOW = 1_786_000_000_000;

let db: SQLiteDatabase;
let main: string;
let savings: string;

async function insertMatcher(
  id: string,
  walletId: string,
  packageName: string,
  hint: string | null,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO wallet_matchers (id, wallet_id, package_name, hint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, walletId, packageName, hint, NOW, NOW],
  );
}

beforeEach(async () => {
  db = await freshDb();
  main = (await createWallet({ name: "GCash", type: "e-wallet" })).id;
  savings = (await createWallet({ name: "GSave", type: "savings" })).id;
});

afterEach(async () => {
  await closeDatabase();
});

test("listMatchers returns every row as a domain WalletMatcher", async () => {
  await insertMatcher("m-1", main, "com.globe.gcash.android", null);
  await insertMatcher("m-2", savings, "com.globe.gcash.android", "GSave");

  const matchers = await listMatchers();

  expect(matchers).toEqual([
    {
      id: "m-1",
      walletId: main,
      packageName: "com.globe.gcash.android",
      // An absent hint is null, not "" and not undefined — `foldHint` in the
      // Normalizer treats null as "this row claims the whole provider".
      hint: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "m-2",
      walletId: savings,
      packageName: "com.globe.gcash.android",
      hint: "GSave",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);
});

test("listMatchers narrows to one wallet when given an id", async () => {
  await insertMatcher("m-1", main, "com.globe.gcash.android", null);
  await insertMatcher("m-2", savings, "com.globe.gcash.android", "GSave");

  const matchers = await listMatchers(savings);

  expect(matchers.map((matcher) => matcher.id)).toEqual(["m-2"]);
});

test("an empty table lists nothing rather than throwing", async () => {
  expect(await listMatchers()).toEqual([]);
  expect(await listMatchers(main)).toEqual([]);
});
