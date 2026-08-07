import type { Category, ReviewQueueItem, Transaction, Wallet } from "@/types/domain";
import { freshDb } from "@/test_support/db";
import { closeDatabase } from "../database";
import {
  categoryToRow,
  reviewQueueItemToRow,
  rowToCategory,
  rowToReviewQueueItem,
  rowToTransaction,
  rowToWallet,
  transactionToRow,
  walletToRow,
} from "../mappers";
import type { SQLiteDatabase } from "expo-sqlite";

afterEach(async () => {
  await closeDatabase();
});

/** Actual column names for `table`, straight from the real schema — not a hand-typed list. */
async function columnsOf(db: SQLiteDatabase, table: string): Promise<string[]> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.map((c) => c.name).sort();
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

describe("wallet mapper", () => {
  const wallet: Wallet = {
    id: "6f3c0f5e-8a3b-4d6e-9c1a-2b4d6e8f0a1c",
    name: "GCash",
    type: "e-wallet",
    balance: 250075,
    currency: "PHP",
    isArchived: true,
    createdAt: 1754060400000,
    updatedAt: 1754060400001,
  };

  test("walletToRow's keys are exactly the wallets table's real columns — a dropped or misspelled column fails this", async () => {
    const db = await freshDb();
    const row = walletToRow(wallet);
    expect(Object.keys(row).sort()).toEqual(await columnsOf(db, "wallets"));
  });

  test("walletToRow maps each field into its own column, not a neighbor's", () => {
    const row = walletToRow(wallet);
    expect(row).toEqual({
      id: "6f3c0f5e-8a3b-4d6e-9c1a-2b4d6e8f0a1c",
      name: "GCash",
      type: "e-wallet",
      balance: 250075,
      currency: "PHP",
      is_archived: 1,
      created_at: 1754060400000,
      updated_at: 1754060400001,
    });
  });

  test("walletToRow encodes isArchived=false as 0 (both boolean directions checked, not just true)", () => {
    expect(walletToRow({ ...wallet, isArchived: false }).is_archived).toBe(0);
  });

  test("walletToRow keeps balance an exact integer centavos value — never a float, never a formatted string", () => {
    const row = walletToRow({ ...wallet, balance: 987_654_321 });
    expect(row.balance).toBe(987654321);
    expect(typeof row.balance).toBe("number");
    expect(Number.isInteger(row.balance)).toBe(true);
  });

  test("rowToWallet decodes a real inserted row (is_archived=0, distinct created/updated timestamps)", async () => {
    const db = await freshDb();
    await db.runAsync(
      "INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["w_real", "BPI Savings", "bank", 500000, "PHP", 0, 1700000000000, 1700000000123],
    );
    const row = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM wallets WHERE id = 'w_real'",
    );
    expect(rowToWallet(row as never)).toEqual({
      id: "w_real",
      name: "BPI Savings",
      type: "bank",
      balance: 500000,
      currency: "PHP",
      isArchived: false,
      createdAt: 1700000000000,
      updatedAt: 1700000000123,
    });
  });

  test("rowToWallet decodes is_archived=1 as true, not the literal number 1", async () => {
    const db = await freshDb();
    await db.runAsync(
      "INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["w_archived", "Old Cash", "cash", 0, "PHP", 1, 1700000000000, 1700000000000],
    );
    const row = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM wallets WHERE id = 'w_archived'",
    );
    const domain = rowToWallet(row as never);
    expect(domain.isArchived).toBe(true);
    expect(domain.isArchived).not.toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

describe("transaction mapper", () => {
  const tx: Transaction = {
    id: "0d9b1c2e-3f4a-45b6-8c7d-9e0f1a2b3c4d",
    walletId: "wallet-111",
    categoryId: "category-222",
    amount: 15000,
    direction: "out",
    occurredAt: 1754060400000,
    merchant: "Jollibee",
    counterparty: null,
    referenceNo: "REF123",
    source: "notification",
    confidence: 0.94,
    rawNotificationId: null,
    transferLinkId: null,
    note: null,
    createdAt: 1754060400002,
    updatedAt: 1754060400003,
  };

  test("transactionToRow's keys are exactly the transactions table's real columns", async () => {
    const db = await freshDb();
    const row = transactionToRow(tx);
    expect(Object.keys(row).sort()).toEqual(await columnsOf(db, "transactions"));
  });

  test("transactionToRow does not transpose wallet_id/category_id", () => {
    const row = transactionToRow(tx);
    expect(row.wallet_id).toBe("wallet-111");
    expect(row.category_id).toBe("category-222");
  });

  test("transactionToRow does not transpose occurred_at/created_at/updated_at — three distinct timestamps land in three distinct columns", () => {
    const row = transactionToRow(tx);
    expect(row.occurred_at).toBe(1754060400000);
    expect(row.created_at).toBe(1754060400002);
    expect(row.updated_at).toBe(1754060400003);
    expect(new Set([row.occurred_at, row.created_at, row.updated_at]).size).toBe(3);
  });

  test("transactionToRow keeps amount an exact integer centavos value, never a float", () => {
    const row = transactionToRow({ ...tx, amount: 999_999_999 });
    expect(row.amount).toBe(999999999);
    expect(typeof row.amount).toBe("number");
    expect(Number.isInteger(row.amount)).toBe(true);
  });

  test("transactionToRow keeps confidence a fraction, distinct from amount and not coerced to an int", () => {
    const row = transactionToRow(tx);
    expect(row.confidence).toBe(0.94);
    expect(row.confidence).not.toBe(row.amount);
  });

  test("transactionToRow maps nullable fields to real null, never the string 'null'", () => {
    const row = transactionToRow(tx);
    for (const value of [row.counterparty, row.raw_notification_id, row.transfer_link_id, row.note]) {
      expect(value).toBeNull();
      expect(value).not.toBe("null");
    }
    // merchant and referenceNo are non-null here — sanity that null-mapping isn't blanket.
    expect(row.merchant).toBe("Jollibee");
    expect(row.reference_no).toBe("REF123");
  });

  test("rowToTransaction decodes a real inserted row end to end, including nullables and a fractional confidence", async () => {
    const db = await freshDb();
    const now = Date.now();
    await db.runAsync(
      "INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at) VALUES ('w1','W','cash',0,'PHP',0,?,?)",
      [now, now],
    );
    await db.runAsync(
      "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES ('c1','C',NULL,'circle',0,0,?,?)",
      [now, now],
    );
    await db.runAsync(
      `INSERT INTO transactions
        (id, wallet_id, category_id, amount, direction, occurred_at, merchant, counterparty,
         reference_no, source, confidence, raw_notification_id, transfer_link_id, note, created_at, updated_at)
       VALUES ('t1','w1','c1',15000,'out',?,NULL,NULL,NULL,'manual',0.5,NULL,NULL,NULL,?,?)`,
      [now, now, now + 1],
    );
    const row = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM transactions WHERE id = 't1'",
    );
    expect(rowToTransaction(row as never)).toEqual({
      id: "t1",
      walletId: "w1",
      categoryId: "c1",
      amount: 15000,
      direction: "out",
      occurredAt: now,
      merchant: null,
      counterparty: null,
      referenceNo: null,
      source: "manual",
      confidence: 0.5,
      rawNotificationId: null,
      transferLinkId: null,
      note: null,
      createdAt: now,
      updatedAt: now + 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

describe("category mapper", () => {
  const category: Category = {
    id: "b2a4c6d8-1e2f-4a3b-9c8d-7e6f5a4b3c2d",
    name: "Food & Dining",
    parentId: null,
    icon: "utensils",
    isSystem: true,
    isHidden: false,
    createdAt: 1754060400000,
    updatedAt: 1754060400000,
  };

  test("categoryToRow's keys are exactly the categories table's real columns", async () => {
    const db = await freshDb();
    expect(Object.keys(categoryToRow(category)).sort()).toEqual(await columnsOf(db, "categories"));
  });

  test("categoryToRow does not transpose is_system/is_hidden", () => {
    const row = categoryToRow(category);
    expect(row.is_system).toBe(1);
    expect(row.is_hidden).toBe(0);
  });

  test("categoryToRow encodes the opposite is_system/is_hidden combination too", () => {
    const row = categoryToRow({ ...category, isSystem: false, isHidden: true });
    expect(row.is_system).toBe(0);
    expect(row.is_hidden).toBe(1);
  });

  test("categoryToRow keeps a non-null parentId distinct from id", () => {
    const row = categoryToRow({ ...category, parentId: "parent-999" });
    expect(row.parent_id).toBe("parent-999");
    expect(row.id).toBe("b2a4c6d8-1e2f-4a3b-9c8d-7e6f5a4b3c2d");
  });

  test("rowToCategory decodes a real inserted row with parent_id NULL", async () => {
    const db = await freshDb();
    const now = Date.now();
    await db.runAsync(
      "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES ('cat1','Utilities',NULL,'zap',1,0,?,?)",
      [now, now],
    );
    const row = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM categories WHERE id = 'cat1'",
    );
    expect(rowToCategory(row as never)).toEqual({
      id: "cat1",
      name: "Utilities",
      parentId: null,
      icon: "zap",
      isSystem: true,
      isHidden: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  test("rowToCategory decodes a real inserted row with a non-null parent_id", async () => {
    const db = await freshDb();
    const now = Date.now();
    await db.runAsync(
      "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES ('parent1','Root',NULL,'circle',1,0,?,?)",
      [now, now],
    );
    await db.runAsync(
      "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES ('child1','Child','parent1','circle',0,1,?,?)",
      [now, now],
    );
    const row = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM categories WHERE id = 'child1'",
    );
    const domain = rowToCategory(row as never);
    expect(domain.parentId).toBe("parent1");
    expect(domain.isHidden).toBe(true);
    expect(domain.isSystem).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Review Queue Item
// ---------------------------------------------------------------------------

describe("review queue item mapper", () => {
  const item: ReviewQueueItem = {
    id: "e1f2a3b4-c5d6-47e8-9f0a-1b2c3d4e5f6a",
    kind: "low-confidence",
    payload: { amount: 15000, direction: "out", merchant: "JUAN D" },
    rawNotificationId: "rn1",
    createdAt: 1754060400000,
    expiresAt: null,
    resolvedAt: null,
  };

  test("reviewQueueItemToRow's keys are exactly the review_queue_items table's real columns", async () => {
    const db = await freshDb();
    expect(Object.keys(reviewQueueItemToRow(item)).sort()).toEqual(
      await columnsOf(db, "review_queue_items"),
    );
  });

  test("reviewQueueItemToRow serializes payload to a JSON string that decodes back to the same object", () => {
    const row = reviewQueueItemToRow(item);
    expect(typeof row.payload_json).toBe("string");
    expect(JSON.parse(row.payload_json)).toEqual(item.payload);
  });

  test("reviewQueueItemToRow keeps expires_at/resolved_at null and distinct from created_at", () => {
    const row = reviewQueueItemToRow(item);
    expect(row.expires_at).toBeNull();
    expect(row.resolved_at).toBeNull();
    expect(row.created_at).toBe(1754060400000);
  });

  test("rowToReviewQueueItem decodes a real inserted row's payload_json into an object, not a string", async () => {
    const db = await freshDb();
    const now = Date.now();
    await db.runAsync(
      "INSERT INTO review_queue_items (id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at) VALUES ('rq1','ambiguous-transfer',?,NULL,?,NULL,NULL)",
      [JSON.stringify({ foo: "bar", n: 5 }), now],
    );
    const row = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM review_queue_items WHERE id = 'rq1'",
    );
    const domain = rowToReviewQueueItem(row as never);
    expect(domain.payload).toEqual({ foo: "bar", n: 5 });
    expect(typeof domain.payload).toBe("object");
    expect(domain).toEqual({
      id: "rq1",
      kind: "ambiguous-transfer",
      payload: { foo: "bar", n: 5 },
      rawNotificationId: null,
      createdAt: now,
      expiresAt: null,
      resolvedAt: null,
    });
  });

  test("rowToReviewQueueItem keeps created_at/expires_at/resolved_at distinct when all three are non-null", async () => {
    const db = await freshDb();
    const created = 1700000000000;
    const expires = 1700000100000;
    const resolved = 1700000200000;
    await db.runAsync(
      "INSERT INTO raw_notifications (id, package_name, title, text, sub_text, big_text, posted_at, captured_at, expires_at) VALUES ('rn2','com.example',NULL,NULL,NULL,NULL,?,?,?)",
      [created, created, resolved],
    );
    await db.runAsync(
      "INSERT INTO review_queue_items (id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at) VALUES ('rq2','possible-duplicate','{}','rn2',?,?,?)",
      [created, expires, resolved],
    );
    const row = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM review_queue_items WHERE id = 'rq2'",
    );
    const domain = rowToReviewQueueItem(row as never);
    expect(domain.createdAt).toBe(created);
    expect(domain.expiresAt).toBe(expires);
    expect(domain.resolvedAt).toBe(resolved);
    expect(domain.rawNotificationId).toBe("rn2");
  });
});
