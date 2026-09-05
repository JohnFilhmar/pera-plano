import { closeDatabase } from "@/lib/db/database";
import { __setTierForTests } from "@/lib/entitlements";
import { createWallet, getWallet } from "../wallets_repo";
import {
  deleteTransaction,
  getTransaction,
  insertTransaction,
  listTransactions,
  reassignWalletTransactions,
  sumSpend,
  supersedeMintedLeg,
  TransactionNotFoundError,
  updateTransaction,
  type TransactionPatch,
} from "../transactions_repo";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";
import type { NewTransaction } from "@/types/domain";

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
  walletId = (await createWallet({ name: "GCash", openingBalance: 100000 })).id;
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
  const otherWalletId = (await createWallet({ name: "Cash" })).id;
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
  const otherWalletId = (await createWallet({ name: "Cash" })).id;
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
    const otherWalletId = (await createWallet({ name: "Cash" })).id;
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

// ---------------------------------------------------------------------------
// m1c Task 3 — the read-one and edit paths the transaction detail screen and
// the Review Queue's "Correct" action need. The m1c plan named hooks
// (`use_transaction`, `use_update_transaction`) over repository functions that
// were never written; these are those functions.
// ---------------------------------------------------------------------------

/** The signed effect a transaction has on its wallet's balance. */
function signedEffect(direction: "in" | "out", amount: number): number {
  return direction === "in" ? amount : -amount;
}

async function balanceOf(id: string): Promise<number> {
  const row = await db.getFirstAsync<{ balance: number }>(
    "SELECT balance FROM wallets WHERE id = ?",
    [id],
  );
  return row?.balance ?? Number.NaN;
}

describe("getTransaction reads one row by id", () => {
  test("returns the committed transaction, mapped to the domain shape", async () => {
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

    const read = await getTransaction(tx.id);
    expect(read).toEqual(tx);
    expect(read?.merchant).toBe("Jollibee");
  });

  test("returns null, not undefined, for an unknown id", async () => {
    const result = await getTransaction("does-not-exist");
    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });
});

describe("updateTransaction keeps the wallet balance in step with the ledger", () => {
  // THE RULE THIS SUITE DEFENDS. insertTransaction moves the wallet balance as
  // part of committing the row, so every later edit to amount, direction or
  // wallet MUST move it again by exactly the difference. An update that writes
  // the row alone leaves the balance describing a transaction that no longer
  // exists — the silent disagreement a money app may never produce.

  test("editing a non-money field leaves every balance untouched", async () => {
    const before = await balanceOf(walletId);
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.9,
    });
    const afterInsert = await balanceOf(walletId);
    expect(afterInsert).toBe(before - 15000);

    const updated = await updateTransaction(tx.id, {
      categoryId: OTHER_CATEGORY_ID,
      note: "reimbursed by Ate",
    });
    expect(updated.categoryId).toBe(OTHER_CATEGORY_ID);
    expect(updated.note).toBe("reimbursed by Ate");
    expect(await balanceOf(walletId)).toBe(afterInsert);
  });

  test("raising an out-transaction amount subtracts exactly the difference", async () => {
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.9,
    });
    const afterInsert = await balanceOf(walletId);

    await updateTransaction(tx.id, { amount: 20000 });
    // Not "balance minus 20000" — the original 15000 was already applied. Only
    // the 5000 difference may move.
    expect(await balanceOf(walletId)).toBe(afterInsert - 5000);
  });

  test("lowering an out-transaction amount gives the difference back", async () => {
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.9,
    });
    const afterInsert = await balanceOf(walletId);

    await updateTransaction(tx.id, { amount: 5000 });
    expect(await balanceOf(walletId)).toBe(afterInsert + 10000);
  });

  test("flipping the direction moves the balance by TWICE the amount", async () => {
    // The single most likely wrong implementation is "apply the new effect"
    // without reversing the old one, which moves the balance by one amount
    // instead of two. Correcting a misparsed direction is a first-week Review
    // Queue action, so this path is hot, not exotic.
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.6,
    });
    const afterInsert = await balanceOf(walletId);

    const updated = await updateTransaction(tx.id, { direction: "in" });
    expect(updated.direction).toBe("in");
    expect(await balanceOf(walletId)).toBe(afterInsert + 30000);
  });

  test("moving a transaction to another wallet reverses it from the old and applies it to the new", async () => {
    const other = await createWallet({ name: "Maya", openingBalance: 50000 });
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.6,
    });
    const originAfterInsert = await balanceOf(walletId);

    const updated = await updateTransaction(tx.id, { walletId: other.id });
    expect(updated.walletId).toBe(other.id);
    // The origin wallet gets its money back...
    expect(await balanceOf(walletId)).toBe(originAfterInsert + 15000);
    // ...and the destination wallet pays it. A repo that only re-applied to the
    // new wallet would leave the money missing from BOTH balances at once.
    expect(await balanceOf(other.id)).toBe(50000 - 15000);
  });

  test("changing the wallet AND the amount together settles both wallets exactly", async () => {
    const other = await createWallet({ name: "Maya", openingBalance: 50000 });
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.6,
    });
    const originAfterInsert = await balanceOf(walletId);

    await updateTransaction(tx.id, { walletId: other.id, amount: 20000 });
    expect(await balanceOf(walletId)).toBe(originAfterInsert + 15000);
    expect(await balanceOf(other.id)).toBe(50000 - 20000);
  });

  test("an omitted key leaves the field alone; an explicit null clears it", async () => {
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      merchant: "Jollibee",
      counterparty: "Juan",
      referenceNo: "REF-1",
      note: "lunch",
      source: "notification",
      confidence: 0.9,
    });

    const kept = await updateTransaction(tx.id, { amount: 16000 });
    expect(kept.merchant).toBe("Jollibee");
    expect(kept.counterparty).toBe("Juan");
    expect(kept.referenceNo).toBe("REF-1");
    expect(kept.note).toBe("lunch");

    const cleared = await updateTransaction(tx.id, { merchant: null, note: null });
    expect(cleared.merchant).toBeNull();
    expect(cleared.note).toBeNull();
    expect(cleared.counterparty).toBe("Juan");
  });

  test("provenance fields are not editable through the patch", async () => {
    // source, confidence, rawNotificationId and transferLinkId are how the app
    // explains where a number came from. A user correction rewrites the FACTS
    // (amount, wallet, category); it must never rewrite the provenance, and
    // transfer_link_id in particular belongs to transfer_links_repo, which owns
    // the link row and the leg stamp as one atomic pair.
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.42,
    });

    const updated = await updateTransaction(tx.id, { amount: 16000 });
    expect(updated.source).toBe("notification");
    expect(updated.confidence).toBe(0.42);
    expect(updated.rawNotificationId).toBeNull();
    expect(updated.transferLinkId).toBeNull();
  });

  test("bumps updated_at and leaves created_at alone", async () => {
    const dateSpy = jest.spyOn(Date, "now");
    dateSpy.mockReturnValue(1_000);
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.9,
    });
    dateSpy.mockReturnValue(9_000);
    const updated = await updateTransaction(tx.id, { amount: 16000 });
    dateSpy.mockRestore();

    expect(updated.createdAt).toBe(1_000);
    expect(updated.updatedAt).toBe(9_000);
  });

  test("the returned object is exactly what getTransaction reads back", async () => {
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.9,
    });
    const updated = await updateTransaction(tx.id, {
      amount: 16000,
      merchant: "Mang Inasal",
      occurredAt: 2000,
    });
    expect(await getTransaction(tx.id)).toEqual(updated);
  });

  test("throws TransactionNotFoundError for an unknown id", async () => {
    await expect(updateTransaction("does-not-exist", { amount: 100 })).rejects.toThrow(
      TransactionNotFoundError,
    );
  });

  test("a rejected write rolls the balance move back with it", async () => {
    // amount has a CHECK (amount > 0). The row UPDATE and the two balance moves
    // must share one SQL transaction, so a rejected row edit cannot leave the
    // wallet already debited for a transaction that was never changed.
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.9,
    });
    const afterInsert = await balanceOf(walletId);

    await expect(updateTransaction(tx.id, { amount: 0 })).rejects.toThrow();

    expect(await balanceOf(walletId)).toBe(afterInsert);
    expect((await getTransaction(tx.id))?.amount).toBe(15000);
  });

  test("the balance a sequence of edits leaves behind equals the ledger's own sum", async () => {
    // The property that actually matters, stated end to end: after any number of
    // edits, the wallet balance must still equal opening balance + the signed sum
    // of every transaction against it. Any single missed or doubled adjustment
    // above shows up here as a mismatch.
    const OPENING = 100000; // the shared `walletId` wallet's opening balance
    const other = await createWallet({ name: "Maya", openingBalance: 0 });

    const a = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.9,
    });
    const b = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 30000,
      direction: "in",
      occurredAt: 2000,
      source: "notification",
      confidence: 0.9,
    });

    await updateTransaction(a.id, { amount: 22500 });
    await updateTransaction(b.id, { direction: "out" });
    await updateTransaction(a.id, { walletId: other.id });

    const rows = await db.getAllAsync<{ wallet_id: string; amount: number; direction: string }>(
      "SELECT wallet_id, amount, direction FROM transactions",
    );
    const expected = new Map<string, number>([
      [walletId, OPENING],
      [other.id, 0],
    ]);
    for (const row of rows) {
      const running = expected.get(row.wallet_id) ?? 0;
      expected.set(row.wallet_id, running + signedEffect(row.direction as "in" | "out", row.amount));
    }

    expect(await balanceOf(walletId)).toBe(expected.get(walletId));
    expect(await balanceOf(other.id)).toBe(expected.get(other.id));
  });
});

// ---------------------------------------------------------------------------
// m1c Task 3b — the reported balance-after, and the SNAP.
//
// docs/04-features/02-wallets.md §balance handling rule 1: "When a committed
// Transaction carries a balance-after for its Wallet, the Wallet `balance`
// SNAPS to that reported value. Reported wins because it is the provider's own
// statement of truth."
//
// THE ONE THING EVERY TEST BELOW IS BUILT AROUND. The wallet in `beforeEach`
// opens at ₱1,000.00 (100000). Every snapping test below reports a figure that
// no increment of any amount in the test could produce, so "set" and "add" can
// never be confused for one another. A test that seeded the wallet at the
// reported figure minus the amount would pass against an implementation that
// ignored the snap entirely — which is precisely the bug this task exists to
// close.
// ---------------------------------------------------------------------------

const OPENING = 100000; // the shared `walletId` wallet, ₱1,000.00

describe("a reported balance-after SETS the wallet balance instead of moving it", () => {
  test("the wallet snaps to the reported figure, not to opening minus the amount", async () => {
    // Deliberately wrong starting balance. ₱150.00 out of a wallet the app
    // thinks holds ₱1,000.00 would leave 85000 if incremented. The provider
    // says the balance afterwards is ₱9,000.00 — 900000. The app has clearly
    // missed ₱8,150.00 of income, and the bank is right.
    const tx = await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 15000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.95,
      balanceAfter: 900000,
    });

    expect(await balanceOf(walletId)).toBe(900000);
    // The three numbers a broken implementation would land on instead:
    expect(await balanceOf(walletId)).not.toBe(OPENING - 15000); // incremented
    expect(await balanceOf(walletId)).not.toBe(OPENING + 900000); // added the report
    expect(await balanceOf(walletId)).not.toBe(OPENING); // dropped the report
    expect(tx.balanceAfter).toBe(900000);
  });

  test("an OUT transaction whose reported balance is HIGHER than before still snaps upward", async () => {
    // The sharpest discriminator in this file. An increment on an `out` row can
    // only ever LOWER the balance; here the reported figure is above the
    // starting one, so any implementation that adds a signed effect — however
    // it computes it — moves the balance the wrong way. Only a SET lands here.
    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 25000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.95,
      balanceAfter: 500000,
    });

    expect(await balanceOf(walletId)).toBe(500000);
    expect(await balanceOf(walletId)).toBeGreaterThan(OPENING);
  });

  test("an IN transaction whose reported balance is LOWER than before still snaps downward", async () => {
    // The mirror image, so the snap cannot be a one-directional special case.
    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 25000,
      direction: "in",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.95,
      balanceAfter: 4000,
    });

    expect(await balanceOf(walletId)).toBe(4000);
    expect(await balanceOf(walletId)).toBeLessThan(OPENING);
  });

  test("a reported balance of exactly ₱0.00 empties the wallet — 0 is a report, not an absence", async () => {
    await insertTransaction({
      walletId,
      categoryId: CATEGORY_ID,
      amount: 5000,
      direction: "out",
      occurredAt: 1000,
      source: "notification",
      confidence: 0.95,
      balanceAfter: 0,
    });
    // A `balanceAfter ? snap : increment` truthiness check leaves 95000 here.
    expect(await balanceOf(walletId)).toBe(0);
  });

  test("two snaps in a row leave the wallet on the SECOND reported figure, not on their sum", async () => {
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 700000,
    });
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 20000, direction: "out",
      occurredAt: 2000, source: "notification", confidence: 0.95, balanceAfter: 300000,
    });

    expect(await balanceOf(walletId)).toBe(300000);
    expect(await balanceOf(walletId)).not.toBe(700000 - 20000);
  });

  test("the snap only touches the reporting wallet, never a sibling", async () => {
    const other = await createWallet({ name: "Maya", openingBalance: 50000 });
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 15000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 900000,
    });

    expect(await balanceOf(walletId)).toBe(900000);
    expect(await balanceOf(other.id)).toBe(50000);
  });
});

// ---------------------------------------------------------------------------
// Spec rule 9's second half — "out-of-order arrivals snap only if the
// notification timestamp is newer than the current snapshot's".
//
// THE ARRIVAL ORDER AND THE TIMESTAMP ORDER ARE DELIBERATELY OPPOSITE in every
// test below: the OLDER notification is inserted LAST, which is the only shape
// the bug has. A fixture that committed them in timestamp order passes against
// an implementation with no guard at all.
// ---------------------------------------------------------------------------

describe("a balance-after older than the current snapshot does not re-anchor the wallet", () => {
  test("the wallet keeps the NEWER reported figure when a stale notification lands after it", async () => {
    // Thursday's notification arrives first and anchors the wallet at ₱7,000.00.
    // Tuesday's — delayed by a dead radio — arrives second saying ₱3,000.00.
    // Snapping to it would rewind the wallet two days and throw away every
    // movement the bank had already counted into the ₱7,000.00.
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 9000, source: "notification", confidence: 0.95, balanceAfter: 700000,
    });
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 20000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 300000,
    });

    expect(await balanceOf(walletId)).toBe(700000);
    // The two numbers a broken implementation lands on: the stale snap itself,
    // and the fallback increment that would book the movement a second time.
    expect(await balanceOf(walletId)).not.toBe(300000);
    expect(await balanceOf(walletId)).not.toBe(700000 - 20000);
  });

  test("the suppressed row is still committed, with its reported figure intact", async () => {
    // Suppression is about the WALLET, not the ledger. The movement happened and
    // the provider did say ₱3,000.00 at that moment; dropping either would lose
    // history the reconciliation work will need.
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 9000, source: "notification", confidence: 0.95, balanceAfter: 700000,
    });
    const stale = await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 20000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 300000,
    });

    const read = await getTransaction(stale.id);
    expect(read?.balanceAfter).toBe(300000);
    expect(read?.amount).toBe(20000);
  });

  test("a report at the SAME instant as the snapshot still snaps — a twin is not out of order", async () => {
    // A push and its SMS relay carry one `occurred_at`. Rule 9 suppresses what
    // is OLDER; treating "not newer" as out of order would freeze the wallet on
    // whichever telling happened to reach the pipeline first.
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 5000, source: "notification", confidence: 0.95, balanceAfter: 700000,
    });
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 5000, source: "notification", confidence: 0.95, balanceAfter: 690000,
    });

    expect(await balanceOf(walletId)).toBe(690000);
  });

  test("suppression is per wallet — a sibling's newer snapshot never blocks a snap", async () => {
    const other = await createWallet({ name: "Maya", openingBalance: 50000 });
    await insertTransaction({
      walletId: other.id, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 9000, source: "notification", confidence: 0.95, balanceAfter: 700000,
    });
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 20000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 300000,
    });

    expect(await balanceOf(walletId)).toBe(300000);
    expect(await balanceOf(other.id)).toBe(700000);
  });

  test("a non-reporting backdated transaction still moves the balance", async () => {
    // The guard is about a stale ANCHOR, not about backdating. Rule 25 keeps a
    // backdated manual entry affecting the balance, and it carries no reported
    // figure to be out of order with.
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 9000, source: "notification", confidence: 0.95, balanceAfter: 700000,
    });
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 25000, direction: "out",
      occurredAt: 1000, source: "manual", confidence: 1,
    });

    expect(await balanceOf(walletId)).toBe(675000);
  });
});

describe("the ordinary computed path is untouched when no balance is reported", () => {
  test("an omitted balanceAfter still increments, exactly as before", async () => {
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 15000, direction: "out",
      occurredAt: 1000, source: "manual", confidence: 1,
    });
    expect(await balanceOf(walletId)).toBe(OPENING - 15000);
  });

  test("an explicit null balanceAfter increments too — absent and null mean the same thing", async () => {
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 15000, direction: "out",
      occurredAt: 1000, source: "manual", confidence: 1, balanceAfter: null,
    });
    expect(await balanceOf(walletId)).toBe(OPENING - 15000);
    const [row] = await listTransactions({});
    expect(row.balanceAfter).toBeNull();
    expect(row.computedBalance).toBeNull();
  });

  test("a non-reporting transaction after a snap moves off the SNAPPED balance", async () => {
    // The snap is an anchor: what follows it is computed FROM it (spec rule 2),
    // not from the pre-snap running total.
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 900000,
    });
    await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 25000, direction: "out",
      occurredAt: 2000, source: "manual", confidence: 1,
    });
    expect(await balanceOf(walletId)).toBe(875000);
  });
});

describe("the snap and the row insert are one SQL transaction", () => {
  test("a rejected insert leaves NO snapped balance and NO row behind", async () => {
    // amount 0 violates the schema's CHECK (amount > 0). An implementation that
    // snapped the wallet outside the transaction — or before the insert, with
    // no transaction at all — would leave the wallet claiming ₱9,000.00 with
    // nothing in the ledger to explain it.
    await expect(
      insertTransaction({
        walletId, categoryId: CATEGORY_ID, amount: 0, direction: "out",
        occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 900000,
      }),
    ).rejects.toThrow();

    expect(await balanceOf(walletId)).toBe(OPENING);
    expect(await listTransactions({})).toHaveLength(0);
  });

  test("a rejected insert against a nonexistent wallet snaps nothing at all", async () => {
    await expect(
      insertTransaction({
        walletId: "no-such-wallet", categoryId: CATEGORY_ID, amount: 15000, direction: "out",
        occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 900000,
      }),
    ).rejects.toThrow();

    expect(await balanceOf(walletId)).toBe(OPENING);
    expect(await listTransactions({})).toHaveLength(0);
  });
});

describe("balanceAfter round-trips through the repository, and is provenance", () => {
  test("the reported figure reads back from getTransaction, not as undefined", async () => {
    const tx = await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 15000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 900000,
    });

    const read = await getTransaction(tx.id);
    expect(read?.balanceAfter).toBe(900000);
    expect(read?.balanceAfter).not.toBeUndefined();
    expect(read).toEqual(tx);
  });

  test("the computed figure the snap overrode is kept alongside it", async () => {
    // What the balance WOULD have been (spec rule 2's computed expectation), so
    // the drift explainer has both numbers to show. 100000 - 15000 = 85000.
    const tx = await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 15000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 900000,
    });
    expect(tx.computedBalance).toBe(85000);
    expect((await getTransaction(tx.id))?.computedBalance).toBe(85000);
    // Distinct from both the reported figure and the amount — a transposed
    // column binding lands on one of those.
    expect(tx.computedBalance).not.toBe(tx.balanceAfter);
    expect(tx.computedBalance).not.toBe(tx.amount);
  });

  test("updateTransaction cannot patch balanceAfter or computedBalance", async () => {
    // Provenance, exactly like source / confidence / rawNotificationId: it is
    // the PROVIDER's statement about a moment that has already passed, and a
    // user correction changes the facts, not the story of where they came from.
    // The cast is the point of the test — TransactionPatch has no such key, so
    // this is what a caller reaching past the type system would achieve.
    const tx = await insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount: 15000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 900000,
    });

    const updated = await updateTransaction(tx.id, {
      amount: 16000,
      balanceAfter: 1,
      computedBalance: 2,
    } as unknown as TransactionPatch);

    expect(updated.balanceAfter).toBe(900000);
    expect(updated.computedBalance).toBe(85000);
    const reread = await getTransaction(tx.id);
    expect(reread?.balanceAfter).toBe(900000);
    expect(reread?.computedBalance).toBe(85000);
    expect(reread?.amount).toBe(16000);
  });
});

// ---------------------------------------------------------------------------
// reassignWalletTransactions — m1c Task 5's archive flow (spec rules 18, 19).
// ---------------------------------------------------------------------------
//
// Archiving offers "keep these transactions here" (the default) or "move them
// to another wallet". This is the move. It exists as a repository function
// rather than as a loop over `updateTransaction` in a hook for one reason that
// matters and one that is merely correct:
//
//   `listTransactions` IS CLAMPED TO THE TIER'S HISTORY FLOOR. A Free-tier loop
//   over it would move the last 90 days and silently leave everything older
//   attached to the archived wallet — an invariant-4 near-miss whose symptom is
//   old transactions vanishing from a wallet that still shows their money.
//
//   ONE SQL TRANSACTION. A half-finished move splits a wallet's history across
//   two wallets with both balances wrong.

describe("reassignWalletTransactions", () => {
  let target: string;

  /** A committed row on the source wallet, with only the field under test varied. */
  function baseTx(patch: Partial<NewTransaction> = {}): NewTransaction {
    return {
      walletId,
      categoryId: CATEGORY_ID,
      amount: 10000,
      direction: "out",
      occurredAt: Date.now(),
      source: "notification",
      confidence: 1,
      ...patch,
    };
  }

  beforeEach(async () => {
    target = (await createWallet({ name: "BPI", openingBalance: 0 })).id;
  });

  test("moves every transaction to the new wallet", async () => {
    await insertTransaction(baseTx({ amount: 10000, direction: "out" }));
    await insertTransaction(baseTx({ amount: 25000, direction: "in" }));

    await reassignWalletTransactions(walletId, target);

    expect(await listTransactions({ walletId })).toEqual([]);
    expect(await listTransactions({ walletId: target })).toHaveLength(2);
  });

  test("carries the balance effect across with the rows", async () => {
    // Opening ₱1,000.00, minus ₱100.00 → ₱900.00 on the source.
    await insertTransaction(baseTx({ amount: 10000, direction: "out" }));

    await reassignWalletTransactions(walletId, target);

    // Reverse-then-apply, batched: the source is left holding only its own
    // anchor, and the target gains exactly what the rows account for. A move
    // that shifted rows but not balances would leave the source claiming money
    // it has no ledger for — the silent disagreement this app may never show.
    const source = await getWallet(walletId);
    const destination = await getWallet(target);
    expect(source?.balance).toBe(100000);
    expect(destination?.balance).toBe(-10000);
  });

  test("preserves the raw notification reference (spec rule 19)", async () => {
    await db.runAsync(
      `INSERT INTO raw_notifications (id, package_name, title, text, sub_text, big_text, posted_at, captured_at, expires_at)
       VALUES ('raw-1', 'com.globe.gcash.android', 't', 'b', NULL, NULL, 0, 0, 0)`,
    );
    const tx = await insertTransaction(baseTx({ rawNotificationId: "raw-1" }));

    await reassignWalletTransactions(walletId, target);

    // Invariant 5 survives moves: "why was this recorded?" must still answer
    // after the wallet it was recorded into has been retired.
    const moved = await getTransaction(tx.id);
    expect(moved?.rawNotificationId).toBe("raw-1");
    expect(moved?.walletId).toBe(target);
  });

  test("moves rows older than the free tier's history window", async () => {
    const old = await insertTransaction(
      baseTx({ occurredAt: Date.now() - 200 * DAY, amount: 5000, direction: "out" }),
    );
    __setTierForTests("free");

    await reassignWalletTransactions(walletId, target);

    // The clamp is a VISIBILITY rule, never a retention or ownership one. A
    // move that respected it would orphan this row on the archived wallet.
    expect((await getTransaction(old.id))?.walletId).toBe(target);
  });

  test("a wallet with no transactions is a no-op, not an error", async () => {
    await reassignWalletTransactions(walletId, target);

    expect((await getWallet(walletId))?.balance).toBe(100000);
    expect((await getWallet(target))?.balance).toBe(0);
  });

  test("moving a wallet to itself changes nothing", async () => {
    await insertTransaction(baseTx({ amount: 10000, direction: "out" }));

    await reassignWalletTransactions(walletId, walletId);

    // Reverse-then-apply on one row nets out, but only if the two statements
    // actually both run. Guarding early is cheaper than trusting they do.
    expect((await getWallet(walletId))?.balance).toBe(90000);
    expect(await listTransactions({ walletId })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// deleteTransaction — m1c Task 10, the merge primitive.
// ---------------------------------------------------------------------------
//
// THE BALANCE IS THE TEST. `insertTransaction` MOVED the wallet balance when the
// row was written, so a delete that only removes the row leaves the wallet
// describing a transaction that no longer exists — the same bug class Task 3
// fixed for edits, in the one flow whose entire purpose is to undo a double
// count.
describe("deleteTransaction reverses the row's balance effect", () => {
  function baseTx(patch: Partial<NewTransaction> = {}): NewTransaction {
    return {
      walletId,
      categoryId: CATEGORY_ID,
      amount: 10000,
      direction: "out",
      occurredAt: Date.now(),
      source: "notification",
      confidence: 1,
      ...patch,
    };
  }

  test("removes the row", async () => {
    const tx = await insertTransaction(baseTx());

    await deleteTransaction(tx.id);

    expect(await getTransaction(tx.id)).toBeNull();
  });

  test("gives an out-leg's money back to the wallet", async () => {
    // Opening ₱1,000.00 − ₱100.00 = ₱900.00 while the row exists.
    const tx = await insertTransaction(baseTx({ amount: 10000, direction: "out" }));
    expect((await getWallet(walletId))?.balance).toBe(90000);

    await deleteTransaction(tx.id);

    expect((await getWallet(walletId))?.balance).toBe(100000);
  });

  test("takes an in-leg's money back out of the wallet", async () => {
    const tx = await insertTransaction(baseTx({ amount: 25000, direction: "in" }));
    expect((await getWallet(walletId))?.balance).toBe(125000);

    await deleteTransaction(tx.id);

    expect((await getWallet(walletId))?.balance).toBe(100000);
  });

  test("leaves every other row's effect on the balance alone", async () => {
    const doomed = await insertTransaction(baseTx({ amount: 10000, direction: "out" }));
    await insertTransaction(baseTx({ amount: 3000, direction: "out" }));

    await deleteTransaction(doomed.id);

    // 100000 − 3000: the survivor still moved the balance and must keep doing so.
    expect((await getWallet(walletId))?.balance).toBe(97000);
    expect(await listTransactions({ walletId })).toHaveLength(1);
  });

  test("throws TransactionNotFoundError for an id with no row", async () => {
    // NOT a silent no-op, unlike `deleteUserRule` or `unlinkTransfer`: this
    // function moves money. A caller deleting a row that is not there has lost
    // track of what it is reversing, and swallowing that hides a balance bug.
    await expect(deleteTransaction("nope")).rejects.toThrow(TransactionNotFoundError);
  });

  test("the delete and the balance reversal are one SQL transaction", async () => {
    const tx = await insertTransaction(baseTx({ amount: 10000, direction: "out" }));
    // A bill_payments row holds a foreign key onto this transaction with no
    // ON DELETE action, so the DELETE itself throws — after any balance write in
    // the same block would already have run.
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO bills (id, name, amount, amount_mode, due_rule_json, category_id, created_at, updated_at)
       VALUES ('bill-1', 'Meralco', 10000, 'fixed', '{}', ?, ?, ?)`,
      [CATEGORY_ID, now, now],
    );
    await db.runAsync(
      `INSERT INTO bill_payments (id, bill_id, transaction_id, cycle_due_date, created_at, updated_at)
       VALUES ('bp-1', 'bill-1', ?, '2026-08-01', ?, ?)`,
      [tx.id, now, now],
    );

    await expect(deleteTransaction(tx.id)).rejects.toThrow(/FOREIGN KEY/i);

    // Rolled back together: the row survives and the balance still accounts for
    // it. A reversal that outlived the failed delete would credit the user for
    // money that never came back.
    expect(await getTransaction(tx.id)).not.toBeNull();
    expect((await getWallet(walletId))?.balance).toBe(90000);
  });
});

// ---------------------------------------------------------------------------
// supersedeMintedLeg — m1c money-transfers Task 13. When the user confirms a
// cash-in came from a bank that posted no notification, PeraPlano MINTS a
// ledger row to stand in for that bank's side. If the bank's notification
// arrives later anyway, this replaces the placeholder with the provider's own
// record rather than letting it become a second, duplicate row.
// ---------------------------------------------------------------------------

describe("supersedeMintedLeg replaces a minted transfer leg with the provider's record", () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = 1_700_000_000_000;
  let bpi: string;

  beforeEach(async () => {
    bpi = (await createWallet({ name: "BPI", openingBalance: 0 })).id;
    // `transactions.raw_notification_id` is a foreign key onto raw_notifications(id)
    // (001_core.sql), so every test below that supersedes onto "raw_1" needs the
    // row to actually exist first, the same way reassignWalletTransactions's own
    // "preserves the raw notification reference" test seeds one.
    await db.runAsync(
      `INSERT INTO raw_notifications (id, package_name, title, text, sub_text, big_text, posted_at, captured_at, expires_at)
       VALUES ('raw_1', 'com.bpi.mobile', 't', 'b', NULL, NULL, 0, 0, 0)`,
    );
  });

  test("superseding rewrites provenance and settles the balance", async () => {
    const minted = await insertTransaction({
      walletId: bpi,
      categoryId: CATEGORY_ID,
      amount: 100_000,
      direction: "out",
      occurredAt: NOW - HOUR,
      source: "manual",
      confidence: 1,
    });
    // `transactions.transfer_link_id` is likewise a foreign key onto
    // transfer_links(id), so 'tl_1' needs a real row first — mirrors this file's
    // own `linkAsTransfer` helper, minus the second leg this fixture has no use for.
    await db.runAsync(
      `INSERT INTO transfer_links (id, out_transaction_id, in_transaction_id, fee_amount, status, detected_by, confidence, created_at, updated_at)
       VALUES ('tl_1', ?, ?, 0, 'active', 'manual', 1.0, ?, ?)`,
      [minted.id, minted.id, Date.now(), Date.now()],
    );
    await db.runAsync("UPDATE transactions SET transfer_link_id = 'tl_1' WHERE id = ?", [
      minted.id,
    ]);
    const before = (await getWallet(bpi))?.balance ?? 0;

    const row = await supersedeMintedLeg(minted.id, {
      amount: 101_500,
      occurredAt: NOW - HOUR + 60_000,
      referenceNo: "REF-9",
      balanceAfter: null,
      rawNotificationId: "raw_1",
      counterparty: "GCASH",
      confidence: 0.95,
    });

    expect(row.source).toBe("notification");
    expect(row.referenceNo).toBe("REF-9");
    expect(row.rawNotificationId).toBe("raw_1");
    expect(row.amount).toBe(101_500);
    // The link survives — the pair the user confirmed is the same pair.
    expect(row.transferLinkId).toBe("tl_1");

    // Reverse-then-apply: the minted 100_000 out is undone, the real 101_500 applied.
    expect((await getWallet(bpi))?.balance).toBe(before - 1_500);
  });

  test("superseding keeps exactly one row", async () => {
    const minted = await insertTransaction({
      walletId: bpi,
      categoryId: CATEGORY_ID,
      amount: 100_000,
      direction: "out",
      occurredAt: NOW - HOUR,
      source: "manual",
      confidence: 1,
    });

    await supersedeMintedLeg(minted.id, {
      amount: 100_000,
      occurredAt: NOW - HOUR,
      referenceNo: "REF-9",
      balanceAfter: null,
      rawNotificationId: "raw_1",
      counterparty: null,
      confidence: 0.95,
    });

    expect(await listTransactions({})).toHaveLength(1);
  });

  test("throws TransactionNotFoundError for an unknown id", async () => {
    await expect(
      supersedeMintedLeg("does-not-exist", {
        amount: 100_000,
        occurredAt: NOW,
        referenceNo: null,
        balanceAfter: null,
        rawNotificationId: "raw_1",
        counterparty: null,
        confidence: 0.9,
      }),
    ).rejects.toThrow(TransactionNotFoundError);
  });
});
