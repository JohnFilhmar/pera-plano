import { closeDatabase } from "@/lib/db/database";
import { __setTierForTests } from "@/lib/entitlements";
import { createWallet } from "../wallets_repo";
import { insertTransaction, listTransactions, sumSpend } from "../transactions_repo";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "expo-sqlite";

const DAY = 24 * 60 * 60 * 1000;
const CATEGORY_ID = "cat_food";
const OTHER_CATEGORY_ID = "cat_transport";

let db: SQLiteDatabase;
let walletId: string;

async function seedCategory(id: string, name: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, ?, NULL, 'circle-help', 1, 0, 0, 0)`,
    [id, name],
  );
}

async function linkAsTransfer(outId: string, inId: string): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO transfer_links (id, out_transaction_id, in_transaction_id, fee_amount, status, detected_by, confidence, created_at, updated_at)
     VALUES ('tl1', ?, ?, 0, 'active', 'manual', 1.0, ?, ?)`,
    [outId, inId, now, now],
  );
  await db.runAsync("UPDATE transactions SET transfer_link_id = 'tl1' WHERE id IN (?, ?)", [
    outId,
    inId,
  ]);
}

beforeEach(async () => {
  db = await freshDb();
  await seedCategory(CATEGORY_ID, "Food & Dining");
  await seedCategory(OTHER_CATEGORY_ID, "Transport");
  walletId = (await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 })).id;
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Verbatim from task-11-brief.md — prove the pinned contract §3 shape exists.
// ---------------------------------------------------------------------------

test("insertTransaction persists the row and returns the domain object", async () => {
  const tx = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 15000,
    direction: "out",
    occurredAt: 1754060400000,
    merchant: "Jollibee",
    source: "notification",
    confidence: 0.94,
  });

  expect(tx.id).toHaveLength(36);
  expect(tx.merchant).toBe("Jollibee");
  expect(tx.counterparty).toBeNull();
  expect(tx.transferLinkId).toBeNull();
  expect(tx.createdAt).toBe(tx.updatedAt);

  const row = await db.getFirstAsync<{ amount: number; direction: string }>(
    "SELECT amount, direction FROM transactions WHERE id = ?",
    [tx.id],
  );
  expect(row).toEqual({ amount: 15000, direction: "out" });
});

test("insertTransaction moves the wallet balance in both directions", async () => {
  await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 15000,
    direction: "out",
    occurredAt: 1,
    source: "manual",
    confidence: 1,
  });
  let balance = await db.getFirstAsync<{ balance: number }>(
    "SELECT balance FROM wallets WHERE id = ?",
    [walletId],
  );
  expect(balance?.balance).toBe(85000);

  await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 5000,
    direction: "in",
    occurredAt: 2,
    source: "manual",
    confidence: 1,
  });
  balance = await db.getFirstAsync<{ balance: number }>(
    "SELECT balance FROM wallets WHERE id = ?",
    [walletId],
  );
  expect(balance?.balance).toBe(90000);
});

test("listTransactions returns newest first", async () => {
  const older = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 100,
    direction: "out",
    occurredAt: 1000,
    source: "manual",
    confidence: 1,
  });
  const newer = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 200,
    direction: "out",
    occurredAt: 2000,
    source: "manual",
    confidence: 1,
  });
  const list = await listTransactions({});
  expect(list.map((t) => t.id)).toEqual([newer.id, older.id]);
});

test("listTransactions filters by wallet, category, direction and [from, to)", async () => {
  const otherWalletId = (await createWallet({ name: "Cash", type: "cash" })).id;
  const a = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 100,
    direction: "out",
    occurredAt: 1000,
    source: "manual",
    confidence: 1,
  });
  const b = await insertTransaction({
    walletId,
    categoryId: OTHER_CATEGORY_ID,
    amount: 200,
    direction: "in",
    occurredAt: 2000,
    source: "manual",
    confidence: 1,
  });
  await insertTransaction({
    walletId: otherWalletId,
    categoryId: CATEGORY_ID,
    amount: 300,
    direction: "out",
    occurredAt: 3000,
    source: "manual",
    confidence: 1,
  });

  expect((await listTransactions({ walletId })).map((t) => t.id)).toEqual([b.id, a.id]);
  expect((await listTransactions({ categoryId: CATEGORY_ID })).length).toBe(2);
  expect((await listTransactions({ direction: "in" })).map((t) => t.id)).toEqual([b.id]);
  // `to` is EXCLUSIVE: 2000 is outside [1000, 2000).
  expect((await listTransactions({ from: 1000, to: 2000 })).map((t) => t.id)).toEqual([a.id]);
});

test("listTransactions can exclude transfer-linked rows (invariant I2)", async () => {
  const out = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 500,
    direction: "out",
    occurredAt: 1000,
    source: "manual",
    confidence: 1,
  });
  const inLeg = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 500,
    direction: "in",
    occurredAt: 1001,
    source: "manual",
    confidence: 1,
  });
  const standalone = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 700,
    direction: "out",
    occurredAt: 1002,
    source: "manual",
    confidence: 1,
  });
  await linkAsTransfer(out.id, inLeg.id);

  expect((await listTransactions({})).length).toBe(3);
  expect((await listTransactions({ excludeTransferLinked: true })).map((t) => t.id)).toEqual([
    standalone.id,
  ]);
});

test("sumSpend adds outgoing money only, excluding transfer legs", async () => {
  const out = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 500,
    direction: "out",
    occurredAt: 1000,
    source: "manual",
    confidence: 1,
  });
  const inLeg = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 500,
    direction: "in",
    occurredAt: 1001,
    source: "manual",
    confidence: 1,
  });
  await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 700,
    direction: "out",
    occurredAt: 1002,
    source: "manual",
    confidence: 1,
  });
  await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 900,
    direction: "in",
    occurredAt: 1003,
    source: "manual",
    confidence: 1,
  });
  await linkAsTransfer(out.id, inLeg.id);

  expect(await sumSpend({ from: 0, to: 2000 })).toBe(700);
});

test("sumSpend honours the exclusive upper bound and category/wallet filters", async () => {
  const otherWalletId = (await createWallet({ name: "Cash", type: "cash" })).id;
  await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 100,
    direction: "out",
    occurredAt: 1000,
    source: "manual",
    confidence: 1,
  });
  await insertTransaction({
    walletId,
    categoryId: OTHER_CATEGORY_ID,
    amount: 200,
    direction: "out",
    occurredAt: 1500,
    source: "manual",
    confidence: 1,
  });
  await insertTransaction({
    walletId: otherWalletId,
    categoryId: CATEGORY_ID,
    amount: 400,
    direction: "out",
    occurredAt: 1600,
    source: "manual",
    confidence: 1,
  });
  await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 800,
    direction: "out",
    occurredAt: 2000,
    source: "manual",
    confidence: 1,
  });

  expect(await sumSpend({ from: 1000, to: 2000 })).toBe(700);
  expect(await sumSpend({ from: 0, to: 3000, categoryIds: [CATEGORY_ID] })).toBe(1300);
  expect(await sumSpend({ from: 0, to: 3000, walletIds: [otherWalletId] })).toBe(400);
  expect(await sumSpend({ from: 0, to: 3000, categoryIds: [] })).toBe(0);
  expect(await sumSpend({ from: 0, to: 1 })).toBe(0);
});

test("free tier clamps sumSpend and listTransactions to the 90-day window", async () => {
  const now = Date.now();
  await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 100,
    direction: "out",
    occurredAt: now - 10 * DAY,
    source: "manual",
    confidence: 1,
  });
  await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount: 900,
    direction: "out",
    occurredAt: now - 100 * DAY,
    source: "manual",
    confidence: 1,
  });

  __setTierForTests("plus");
  expect(await sumSpend({ from: 0, to: now + 1000 })).toBe(1000);
  expect((await listTransactions({})).length).toBe(2);

  __setTierForTests("free");
  expect(await sumSpend({ from: 0, to: now + 1000 })).toBe(100);
  expect((await listTransactions({})).length).toBe(1);
});

// ---------------------------------------------------------------------------
// Discriminating suite below. The tests above prove the shape from the brief;
// these are built so a plausible-but-broken implementation (dropped transfer
// filter, flipped range bound, silently-ignored filter, insertion-order leak,
// float-coerced sum) fails for a specific, identifiable reason.
// ---------------------------------------------------------------------------

describe("transfer exclusion holds positively AND negatively in one fixture (invariant I2)", () => {
  test("a ledger with a normal out, a normal in, and a linked transfer pair: sumSpend counts only the normal out-leg, listTransactions still shows all four rows", async () => {
    const transferOut = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 500,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });
    const transferIn = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 500,
      direction: "in",
      occurredAt: 1001,
      source: "manual",
      confidence: 1,
    });
    const normalOut = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 34500,
      direction: "out",
      occurredAt: 1002,
      source: "manual",
      confidence: 1,
    });
    const normalIn = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 999900,
      direction: "in",
      occurredAt: 1003,
      source: "manual",
      confidence: 1,
    });
    await linkAsTransfer(transferOut.id, transferIn.id);

    // Positive: the ledger still has all four rows and the user can see the
    // transfer movement — I2 excludes transfers from TOTALS, not from history.
    const all = await listTransactions({});
    expect(all.map((t) => t.id).sort()).toEqual(
      [transferOut.id, transferIn.id, normalOut.id, normalIn.id].sort(),
    );

    // Negative: the exact centavo value proves the transfer out-leg (500) was
    // excluded — a broken implementation that sums ALL 'out' rows regardless
    // of transfer_link_id would report 35000 (500 + 34500), not 34500.
    expect(await sumSpend({ from: 0, to: 2000 })).toBe(normalOut.amount);
    expect(await sumSpend({ from: 0, to: 2000 })).toBe(34500);
  });
});

describe("the transfer in-leg is excluded from a direction-filtered listing too (I2, symmetric)", () => {
  test("two normal 'in' transactions plus one transfer in-leg: filtering direction='in' with excludeTransferLinked=true keeps only the two normal ones", async () => {
    const transferOut = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 200000,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });
    const transferIn = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 200000,
      direction: "in",
      occurredAt: 1001,
      source: "manual",
      confidence: 1,
    });
    const normalIn1 = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 5000,
      direction: "in",
      occurredAt: 1002,
      source: "manual",
      confidence: 1,
    });
    const normalIn2 = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 7500,
      direction: "in",
      occurredAt: 1003,
      source: "manual",
      confidence: 1,
    });
    await linkAsTransfer(transferOut.id, transferIn.id);

    const incomeRows = await listTransactions({ direction: "in", excludeTransferLinked: true });
    // Exact id set: proves the BIG transfer-in leg (200000) was dropped, not
    // just "some" row — a bug that excludes the wrong leg or nothing at all
    // would either include transferIn.id or drop a normal row instead.
    expect(incomeRows.map((t) => t.id).sort()).toEqual([normalIn1.id, normalIn2.id].sort());
    const incomeTotal = incomeRows.reduce((sum, t) => sum + t.amount, 0);
    // If the transfer in-leg leaked in, this would be 212500, not 12500.
    expect(incomeTotal).toBe(12500);
  });
});

describe("listTransactions window is [from, to): from inclusive, to exclusive, independent of other filters", () => {
  // Convention pinned by contract §3 / task-11-brief: `from` inclusive, `to`
  // exclusive, so a period's exclusive end plugs straight into the next
  // period's start with no double-count and no gap.
  test("a row exactly on `from` is included; a row exactly on `to` is excluded", async () => {
    const beforeWindow = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 10,
      direction: "out",
      occurredAt: 999,
      source: "manual",
      confidence: 1,
    });
    const onFrom = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 20,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });
    const insideWindow = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 30,
      direction: "out",
      occurredAt: 1999,
      source: "manual",
      confidence: 1,
    });
    const onTo = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 40,
      direction: "out",
      occurredAt: 2000,
      source: "manual",
      confidence: 1,
    });
    const afterWindow = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 50,
      direction: "out",
      occurredAt: 2001,
      source: "manual",
      confidence: 1,
    });

    const result = await listTransactions({ from: 1000, to: 2000 });
    expect(result.map((t) => t.id)).toEqual([insideWindow.id, onFrom.id]);
    expect(result.map((t) => t.id)).not.toContain(beforeWindow.id);
    expect(result.map((t) => t.id)).not.toContain(onTo.id);
    expect(result.map((t) => t.id)).not.toContain(afterWindow.id);
  });
});

describe("TxFilter fields combine with AND semantics, not OR", () => {
  test("combining walletId and categoryId returns strictly fewer rows than either filter alone", async () => {
    const otherWalletId = (await createWallet({ name: "Cash", type: "cash" })).id;
    // wallet=A,category=FOOD ; wallet=A,category=TRANSPORT ; wallet=B,category=FOOD
    const walletAFood = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 100,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });
    await insertTransaction({
      walletId,
      categoryId: OTHER_CATEGORY_ID,
      amount: 200,
      direction: "out",
      occurredAt: 1001,
      source: "manual",
      confidence: 1,
    });
    await insertTransaction({
      walletId: otherWalletId,
      categoryId: CATEGORY_ID,
      amount: 300,
      direction: "out",
      occurredAt: 1002,
      source: "manual",
      confidence: 1,
    });

    const byWalletOnly = await listTransactions({ walletId });
    const byCategoryOnly = await listTransactions({ categoryId: CATEGORY_ID });
    const byBoth = await listTransactions({ walletId, categoryId: CATEGORY_ID });

    expect(byWalletOnly.length).toBe(2);
    expect(byCategoryOnly.length).toBe(2);
    // A filter silently ignored would make `byBoth` equal one of the two lists
    // above (length 2); true AND combination narrows it further.
    expect(byBoth.length).toBe(1);
    expect(byBoth.map((t) => t.id)).toEqual([walletAFood.id]);
  });
});

describe("listTransactions ordering survives insertion order that differs from occurred_at order", () => {
  test("three rows inserted out of chronological order still list newest-occurred first", async () => {
    // Insertion order is [middle, newest, oldest] by occurredAt — deliberately
    // scrambled so a query relying on rowid/insertion order (no ORDER BY, or
    // an ORDER BY on the wrong column) cannot coincidentally match.
    const middle = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 100,
      direction: "out",
      occurredAt: 2000,
      source: "manual",
      confidence: 1,
    });
    const newest = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 200,
      direction: "out",
      occurredAt: 3000,
      source: "manual",
      confidence: 1,
    });
    const oldest = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 300,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });

    const result = await listTransactions({});
    expect(result.map((t) => t.id)).toEqual([newest.id, middle.id, oldest.id]);
  });

  test("two rows sharing the same occurred_at break the tie by created_at, newest-created first — even when that DISAGREES with insertion/rowid order", async () => {
    // Deliberately inverted vs. insertion order: the row inserted FIRST (lower
    // rowid) gets the LARGER mocked created_at, and the row inserted SECOND
    // (higher rowid) gets the SMALLER one. SQLite ties on an indexed column
    // can resolve in rowid order by default, so a test where created_at rises
    // alongside insertion order cannot tell "sorted by created_at DESC" apart
    // from "coincidentally returned in rowid DESC order" — this construction
    // makes the two orderings disagree, so only the real tie-break clause
    // produces the expected result.
    const dateSpy = jest.spyOn(Date, "now");
    dateSpy.mockReturnValueOnce(9_000); // createdAt for the first insert (rowid 1)
    const insertedFirstRowidButNewer = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 100,
      direction: "out",
      occurredAt: 1000, // identical occurred_at for both rows
      source: "manual",
      confidence: 1,
    });
    dateSpy.mockReturnValueOnce(1_000); // createdAt for the second insert (rowid 2)
    const insertedSecondRowidButOlder = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 200,
      direction: "out",
      occurredAt: 1000,
      source: "manual",
      confidence: 1,
    });
    dateSpy.mockRestore();

    const result = await listTransactions({});
    // created_at DESC must win: 9000 (inserted first) sorts before 1000
    // (inserted second) — the OPPOSITE of both insertion order and rowid-desc.
    expect(result.map((t) => t.id)).toEqual([
      insertedFirstRowidButNewer.id,
      insertedSecondRowidButOlder.id,
    ]);
  });
});

describe("sumSpend keeps exact integer precision on totals over ₱10,000,000.00", () => {
  test("four large out transactions sum to an exact centavo integer with no float drift", async () => {
    // 4 x PHP 3,000,000.00 = PHP 12,000,000.00 = 1,200,000,000 centavos.
    // A float-accumulating implementation risks losing precision above
    // Number.MAX_SAFE_INTEGER-adjacent magnitudes or via repeated division;
    // this stays well inside safe-integer range but is large enough that any
    // stray `/ 100` or string-concatenation bug would visibly corrupt the total.
    const LARGE_AMOUNT = 300_000_000; // PHP 3,000,000.00 in centavos
    for (let i = 0; i < 4; i++) {
      await insertTransaction({
        walletId,
        categoryId: CATEGORY_ID,
        amount: LARGE_AMOUNT,
        direction: "out",
        occurredAt: 1000 + i,
        source: "manual",
        confidence: 1,
      });
    }
    // One transfer-linked out-leg of the same large magnitude, to prove the
    // exclusion clause still holds even at this scale.
    const transferOut = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: LARGE_AMOUNT,
      direction: "out",
      occurredAt: 2000,
      source: "manual",
      confidence: 1,
    });
    const transferIn = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: LARGE_AMOUNT,
      direction: "in",
      occurredAt: 2001,
      source: "manual",
      confidence: 1,
    });
    await linkAsTransfer(transferOut.id, transferIn.id);

    const total = await sumSpend({ from: 0, to: 3000 });
    expect(total).toBe(1_200_000_000);
    expect(Number.isInteger(total)).toBe(true);
  });
});
