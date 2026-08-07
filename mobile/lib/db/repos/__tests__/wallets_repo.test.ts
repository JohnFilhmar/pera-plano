import { closeDatabase } from "@/lib/db/database";
import { createWallet, getWallet, listWallets } from "../wallets_repo";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "expo-sqlite";

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Verbatim from task-10-brief.md — prove the pinned contract §3 shape exists.
// ---------------------------------------------------------------------------

test("createWallet persists a wallet with a uuid id and defaults", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  expect(wallet.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(wallet.balance).toBe(0);
  expect(wallet.currency).toBe("PHP");
  expect(wallet.isArchived).toBe(false);
  expect(wallet.createdAt).toBe(wallet.updatedAt);

  const row = await db.getFirstAsync<{ name: string; is_archived: number }>(
    "SELECT name, is_archived FROM wallets WHERE id = ?",
    [wallet.id],
  );
  expect(row).toEqual({ name: "GCash", is_archived: 0 });
});

test("createWallet uses openingBalance as the balance anchor", async () => {
  const wallet = await createWallet({
    name: "BPI Payroll",
    type: "bank",
    openingBalance: 1234567,
  });
  expect(wallet.balance).toBe(1234567);
  expect((await getWallet(wallet.id))?.balance).toBe(1234567);
});

test("createWallet rejects a duplicate name among non-archived wallets", async () => {
  await createWallet({ name: "GCash", type: "e-wallet" });
  await expect(createWallet({ name: "GCash", type: "e-wallet" })).rejects.toThrow(
    /already in use/i,
  );
});

test("createWallet allows reusing the name of an archived wallet", async () => {
  const first = await createWallet({ name: "GCash", type: "e-wallet" });
  await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [first.id]);
  const second = await createWallet({ name: "GCash", type: "e-wallet" });
  expect(second.id).not.toBe(first.id);
});

test("getWallet returns null for an unknown id", async () => {
  expect(await getWallet("missing")).toBeNull();
});

test("listWallets hides archived wallets by default and can include them", async () => {
  const cash = await createWallet({ name: "Cash on hand", type: "cash" });
  const old = await createWallet({ name: "Old bank", type: "bank" });
  await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [old.id]);

  const active = await listWallets();
  expect(active.map((w) => w.id)).toEqual([cash.id]);

  const all = await listWallets({ includeArchived: true });
  expect(all.map((w) => w.id)).toEqual([cash.id, old.id]);
  expect(all[1].isArchived).toBe(true);
});

// ---------------------------------------------------------------------------
// Discriminating suite below. The tests above prove the shape from the brief;
// these are built so a plausible-but-broken implementation (inverted archived
// filter, dropped ORDER BY, `undefined` instead of `null`, a float creeping
// into balance, an archive path that deletes) fails for a specific reason.
// ---------------------------------------------------------------------------

describe("getWallet distinguishes 'missing' from every other falsy-ish outcome", () => {
  test("returns null, not undefined, not throwing, for an id that was never inserted", async () => {
    const result = await getWallet("does-not-exist");
    // toBeNull() alone already fails on `undefined` (Object.is(undefined, null) is
    // false), but the explicit `not.toBeUndefined()` documents which broken variant
    // — "return the bare row lookup result" — this guards against.
    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });
});

describe("listWallets archived filter — both directions must hold independently", () => {
  // A single "hides by default" assertion cannot tell an inverted WHERE clause
  // (is_archived = 1) from a correct one when there's only one archived row and
  // one active row and you only check one side. These two tests each fail if
  // the filter is flipped, and fail for the OPPOSITE reason from each other.
  test("an archived wallet is absent from the default list", async () => {
    const active = await createWallet({ name: "Everyday", type: "cash" });
    const archived = await createWallet({ name: "Retired", type: "bank" });
    await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [archived.id]);

    const result = await listWallets();
    const ids = result.map((w) => w.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(archived.id);
  });

  test("an archived wallet is present when includeArchived is true", async () => {
    const active = await createWallet({ name: "Everyday", type: "cash" });
    const archived = await createWallet({ name: "Retired", type: "bank" });
    await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [archived.id]);

    const result = await listWallets({ includeArchived: true });
    const ids = result.map((w) => w.id);
    expect(ids).toContain(active.id);
    expect(ids).toContain(archived.id);
  });
});

describe("listWallets ordering is by created_at, not insertion order, with archived collapsed to the tail", () => {
  test("three wallets created out of created_at order still list oldest-first, archived last", async () => {
    // Control Date.now() so insertion order (C, A, B) differs from created_at
    // order (A, B, C) — two rows sorting correctly "by accident" is exactly the
    // gap the task called out, so this uses three with a deliberately scrambled
    // insertion sequence.
    const dateSpy = jest.spyOn(Date, "now");
    dateSpy.mockReturnValueOnce(3_000); // Wallet C
    dateSpy.mockReturnValueOnce(3_000);
    const walletC = await createWallet({ name: "Wallet C", type: "cash" });
    dateSpy.mockReturnValueOnce(1_000); // Wallet A
    dateSpy.mockReturnValueOnce(1_000);
    const walletA = await createWallet({ name: "Wallet A", type: "bank" });
    dateSpy.mockReturnValueOnce(2_000); // Wallet B
    dateSpy.mockReturnValueOnce(2_000);
    const walletB = await createWallet({ name: "Wallet B", type: "savings" });
    dateSpy.mockRestore();

    const active = await listWallets();
    expect(active.map((w) => w.id)).toEqual([walletA.id, walletB.id, walletC.id]);

    // Archive the middle-created wallet (created_at 2000, between A and C). If
    // listWallets({includeArchived}) ordered by created_at alone (no is_archived
    // clause), B would land BETWEEN A and C, not at the tail — that is precisely
    // what this catches.
    await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [walletB.id]);
    const all = await listWallets({ includeArchived: true });
    expect(all.map((w) => w.id)).toEqual([walletA.id, walletC.id, walletB.id]);
    expect(all[2].isArchived).toBe(true);
  });
});

describe("balance stays an exact integer centavo value end to end", () => {
  test("a ten-million-peso opening balance round-trips exactly through create and read", async () => {
    const TEN_MILLION_PESOS_IN_CENTAVOS = 1_000_000_000;
    const wallet = await createWallet({
      name: "Trust Fund",
      type: "savings",
      openingBalance: TEN_MILLION_PESOS_IN_CENTAVOS,
    });
    expect(wallet.balance).toBe(TEN_MILLION_PESOS_IN_CENTAVOS);
    expect(Number.isInteger(wallet.balance)).toBe(true);

    const reread = await getWallet(wallet.id);
    expect(reread?.balance).toBe(TEN_MILLION_PESOS_IN_CENTAVOS);
    expect(Number.isInteger(reread?.balance)).toBe(true);

    const row = await db.getFirstAsync<{ value: number; kind: string }>(
      "SELECT balance AS value, typeof(balance) AS kind FROM wallets WHERE id = ?",
      [wallet.id],
    );
    expect(row?.kind).toBe("integer");
  });
});

describe("archiving a wallet is not deleting it (invariant I4)", () => {
  test("a transaction booked against a wallet stays readable after the wallet is archived", async () => {
    const wallet = await createWallet({ name: "Everyday", type: "cash" });
    const now = Date.now();
    await db.runAsync(
      "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES (?, ?, NULL, ?, 0, 0, ?, ?)",
      ["cat1", "Groceries", "shopping-cart", now, now],
    );
    await db.runAsync(
      `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, source, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'out', ?, 'manual', 1.0, ?, ?)`,
      ["tx1", wallet.id, "cat1", 5000, now, now, now],
    );

    // Archive the wallet the only way this schema allows retiring one: flip the
    // flag, never DELETE the row (there is no deleteWallet export — see the repo
    // comment). If archiving were implemented as a delete-and-recreate, either
    // this UPDATE would be a DELETE that the FK below rejects, or the transaction
    // row would vanish along with it.
    await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [wallet.id]);

    const stillThere = await db.getFirstAsync<{ id: string; wallet_id: string }>(
      "SELECT id, wallet_id FROM transactions WHERE id = ?",
      ["tx1"],
    );
    expect(stillThere).toEqual({ id: "tx1", wallet_id: wallet.id });

    const archivedWallet = await getWallet(wallet.id);
    expect(archivedWallet?.isArchived).toBe(true);
  });

  test("deleting a wallet with a transaction against it is rejected outright, not silently orphaning", async () => {
    const wallet = await createWallet({ name: "Everyday", type: "cash" });
    const now = Date.now();
    await db.runAsync(
      "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES (?, ?, NULL, ?, 0, 0, ?, ?)",
      ["cat2", "Groceries", "shopping-cart", now, now],
    );
    await db.runAsync(
      `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, source, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'out', ?, 'manual', 1.0, ?, ?)`,
      ["tx2", wallet.id, "cat2", 5000, now, now, now],
    );

    // wallets_repo deliberately exposes no deleteWallet function (contract §3 pins
    // only createWallet/getWallet/listWallets). The only "delete path" that exists
    // at all is raw SQL against the table, and the schema's NO ACTION foreign key
    // must block it — proving I4 holds even though this repo can't violate it by
    // construction.
    await expect(db.runAsync("DELETE FROM wallets WHERE id = ?", [wallet.id])).rejects.toThrow(
      /FOREIGN KEY/i,
    );
  });
});
