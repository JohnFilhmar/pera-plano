import { closeDatabase } from "@/lib/db/database";
import {
  archiveWallet,
  createWallet,
  dismissBalanceDrift,
  DuplicateNameError,
  getBalanceDrift,
  getWallet,
  listWallets,
  updateWallet,
  WalletNotFoundError,
} from "../wallets_repo";
import { deleteTransaction, insertTransaction } from "../transactions_repo";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";

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
  // Asserted on the error class rather than a message regex (review finding 2):
  // every later repo copies this pattern for its own invariant, and a typed
  // error survives a message wording tweak that a regex match would not.
  await expect(createWallet({ name: "GCash", type: "e-wallet" })).rejects.toThrow(
    DuplicateNameError,
  );
});

test("createWallet allows reusing the name of an archived wallet, case-insensitively too", async () => {
  const first = await createWallet({ name: "GCash", type: "e-wallet" });
  await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [first.id]);
  const second = await createWallet({ name: "GCash", type: "e-wallet" });
  expect(second.id).not.toBe(first.id);

  // The exemption must survive the case-insensitivity fix too: archiving "GCash"
  // frees the name for a differently-cased "gcash", not just an exact-case one.
  await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [second.id]);
  const third = await createWallet({ name: "gcash", type: "e-wallet" });
  expect(third.id).not.toBe(second.id);
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

describe("createWallet's duplicate-name check is case-insensitive (review finding 1)", () => {
  // Wallet names are free-typed, not picked from an enum, so a user who creates
  // "GCash" and later types "gcash" is the expected way a real person trips the
  // uniqueness invariant — not an edge case. SQLite's default TEXT collation is
  // BINARY, so this fails unless the comparison explicitly opts into NOCASE.
  test("'GCash' then 'gcash' collide", async () => {
    await createWallet({ name: "GCash", type: "e-wallet" });
    await expect(createWallet({ name: "gcash", type: "e-wallet" })).rejects.toThrow(
      DuplicateNameError,
    );
  });

  test("DuplicateNameError carries the offending (as-typed) name", async () => {
    await createWallet({ name: "GCash", type: "e-wallet" });
    await expect(createWallet({ name: "gcash", type: "e-wallet" })).rejects.toMatchObject({
      walletName: "gcash",
    });
  });
});

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

// ---------------------------------------------------------------------------
// m1c Task 3 — the write paths the wallet edit form and the archive action need.
// The m1c plan named hooks (`use_update_wallet`, `use_archive_wallet`) over
// repository functions that were never written; these are those functions.
// ---------------------------------------------------------------------------

describe("updateWallet edits the wallet's own fields and nothing else", () => {
  test("renames a wallet, bumps updated_at, and leaves created_at and the balance alone", async () => {
    const dateSpy = jest.spyOn(Date, "now");
    dateSpy.mockReturnValue(1_000);
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 250_00 });
    dateSpy.mockReturnValue(9_000);
    const updated = await updateWallet(wallet.id, { name: "GCash Main" });
    dateSpy.mockRestore();

    expect(updated.name).toBe("GCash Main");
    expect(updated.createdAt).toBe(1_000);
    expect(updated.updatedAt).toBe(9_000);
    // The balance is the ledger's running total, not a form field. An update
    // path that recomputed or reset it would silently rewrite money.
    expect(updated.balance).toBe(250_00);
    expect((await getWallet(wallet.id))?.name).toBe("GCash Main");
    expect((await getWallet(wallet.id))?.balance).toBe(250_00);
  });

  test("changes the type", async () => {
    const wallet = await createWallet({ name: "Coins.ph", type: "e-wallet" });
    const updated = await updateWallet(wallet.id, { type: "savings" });
    expect(updated.type).toBe("savings");
    expect((await getWallet(wallet.id))?.type).toBe("savings");
  });

  test("an omitted key leaves that field alone rather than nulling it", async () => {
    // A naive `UPDATE ... SET name = ?, type = ?` with `patch.name` bound
    // directly writes NULL/undefined over the untouched column. Patching ONLY
    // the type must leave the name intact, and vice versa.
    const wallet = await createWallet({ name: "BPI Payroll", type: "bank" });
    const typeOnly = await updateWallet(wallet.id, { type: "savings" });
    expect(typeOnly.name).toBe("BPI Payroll");

    const nameOnly = await updateWallet(wallet.id, { name: "BPI Savings" });
    expect(nameOnly.type).toBe("savings");
  });

  test("throws WalletNotFoundError for an unknown id", async () => {
    await expect(updateWallet("does-not-exist", { name: "Ghost" })).rejects.toThrow(
      WalletNotFoundError,
    );
  });

  test("rejects a rename onto another non-archived wallet's name, case-insensitively", async () => {
    await createWallet({ name: "GCash", type: "e-wallet" });
    const other = await createWallet({ name: "Maya", type: "e-wallet" });
    // Invariant 1 has to hold on the UPDATE path too — enforcing it only in
    // createWallet leaves renaming as an unguarded back door into two live
    // wallets sharing a name, which is exactly what the matcher rules key on.
    await expect(updateWallet(other.id, { name: "gcash" })).rejects.toThrow(DuplicateNameError);
  });

  test("re-casing a wallet's OWN name is allowed — the self-row must be excluded from the check", async () => {
    const wallet = await createWallet({ name: "gcash", type: "e-wallet" });
    // A collision check written as "any non-archived row with this name" finds
    // the row being renamed and refuses every no-op save the form makes.
    const updated = await updateWallet(wallet.id, { name: "GCash" });
    expect(updated.name).toBe("GCash");
  });

  test("a name freed by archiving may be taken by a rename", async () => {
    const retired = await createWallet({ name: "Old GCash", type: "e-wallet" });
    const current = await createWallet({ name: "Maya", type: "e-wallet" });
    await archiveWallet(retired.id);

    const updated = await updateWallet(current.id, { name: "Old GCash" });
    expect(updated.name).toBe("Old GCash");
  });
});

describe("archiveWallet sets the flag and never deletes (invariant I4)", () => {
  test("flips is_archived and bumps updated_at, leaving the row in place", async () => {
    const dateSpy = jest.spyOn(Date, "now");
    dateSpy.mockReturnValue(1_000);
    const wallet = await createWallet({ name: "Old bank", type: "bank" });
    dateSpy.mockReturnValue(9_000);
    await archiveWallet(wallet.id);
    dateSpy.mockRestore();

    const archived = await getWallet(wallet.id);
    expect(archived?.isArchived).toBe(true);
    expect(archived?.updatedAt).toBe(9_000);
    expect(archived?.createdAt).toBe(1_000);
  });

  test("the wallet's transactions survive, still pointing at the archived wallet", async () => {
    // The whole reason there is no deleteWallet: the schema's NO ACTION foreign
    // key would reject the DELETE, and an archive implemented as delete-and-
    // recreate would orphan (or destroy) the ledger behind it.
    const wallet = await createWallet({ name: "Everyday", type: "cash" });
    const now = Date.now();
    await db.runAsync(
      "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES (?, ?, NULL, ?, 0, 0, ?, ?)",
      ["cat_archive", "Groceries", "shopping-cart", now, now],
    );
    await db.runAsync(
      `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, source, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'out', ?, 'manual', 1.0, ?, ?)`,
      ["tx_archive", wallet.id, "cat_archive", 5000, now, now, now],
    );

    await archiveWallet(wallet.id);

    const stillThere = await db.getFirstAsync<{ id: string; wallet_id: string }>(
      "SELECT id, wallet_id FROM transactions WHERE id = ?",
      ["tx_archive"],
    );
    expect(stillThere).toEqual({ id: "tx_archive", wallet_id: wallet.id });
  });

  test("an archived wallet leaves listWallets() but stays readable by id and via includeArchived", async () => {
    const keep = await createWallet({ name: "Everyday", type: "cash" });
    const retire = await createWallet({ name: "Old bank", type: "bank" });
    await archiveWallet(retire.id);

    expect((await listWallets()).map((w) => w.id)).toEqual([keep.id]);
    expect((await listWallets({ includeArchived: true })).map((w) => w.id)).toEqual([
      keep.id,
      retire.id,
    ]);
    // Still readable by id — the detail route for an archived wallet must work.
    expect(await getWallet(retire.id)).not.toBeNull();
  });

  test("archiving twice is a no-op, not an error", async () => {
    const wallet = await createWallet({ name: "Old bank", type: "bank" });
    await archiveWallet(wallet.id);
    await expect(archiveWallet(wallet.id)).resolves.toBeUndefined();
    expect((await getWallet(wallet.id))?.isArchived).toBe(true);
  });

  test("archiving an unknown id is a silent no-op", async () => {
    await expect(archiveWallet("does-not-exist")).resolves.toBeUndefined();
  });

  test("archiving frees the name for a new wallet", async () => {
    const first = await createWallet({ name: "GCash", type: "e-wallet" });
    await archiveWallet(first.id);
    const second = await createWallet({ name: "GCash", type: "e-wallet" });
    expect(second.id).not.toBe(first.id);
  });
});

// ---------------------------------------------------------------------------
// m1c Task 3b — getBalanceDrift, the data behind the "balance drift" attention
// state (docs/04-features/02-wallets.md §Wallets tab states, and §balance
// handling rule 3: "the drift explainer shows the gap").
//
// A boolean would satisfy the badge and starve the explainer: "your balances
// disagree" with no figures is a warning the user cannot act on, and rule 3's
// two offers (record the gap as an adjustment, or dismiss) both need the gap as
// a number. So this returns both figures AND their difference, or nothing at
// all when there is nothing to explain.
// ---------------------------------------------------------------------------

describe("getBalanceDrift reports the gap between the provider's figure and ours", () => {
  const CATEGORY_ID = "cat_drift";

  async function seedCategory(): Promise<void> {
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
       VALUES (?, 'Food & Dining', NULL, 'utensils', 1, 0, ?, ?)`,
      [CATEGORY_ID, now, now],
    );
  }

  beforeEach(seedCategory);

  test("returns null for a wallet that has never received a reported balance", async () => {
    // Not `{ drift: 0 }`. A zero drift renders a badge saying the bank and the
    // ledger agree — a claim the app has no basis whatsoever for making on a
    // cash wallet, or on any wallet before its first reporting notification.
    const wallet = await createWallet({ name: "Pocket cash", type: "cash", openingBalance: 50000 });
    await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 12000, direction: "out",
      occurredAt: 1000, source: "manual", confidence: 1,
    });

    expect(await getBalanceDrift(wallet.id)).toBeNull();
  });

  test("returns null for an unknown wallet id", async () => {
    expect(await getBalanceDrift("does-not-exist")).toBeNull();
  });

  test("returns the reported figure, the computed figure and the gap between them", async () => {
    // Opening ₱1,000.00, a ₱150.00 spend, and the provider says ₱9,000.00.
    // computed = 100000 - 15000 = 85000. reported = 900000. drift = 815000.
    // All three are different numbers, so a transposed field is visible.
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    const report = await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 15000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 900000,
    });

    expect(await getBalanceDrift(wallet.id)).toEqual({
      reported: 900000,
      computed: 85000,
      drift: 815000,
      // 003: WHICH row these figures came from, and which one the user has
      // already accepted. Both travel with the figures so the badge can compare
      // them without a second read.
      reportingTransactionId: report.id,
      dismissedTransactionId: null,
    });
  });

  test("drift is reported MINUS computed, so a bank holding less than we counted reads negative", async () => {
    // The sign carries meaning the explainer needs: negative means the app
    // over-counted (a spend it missed), positive means it under-counted.
    const wallet = await createWallet({ name: "BPI", type: "bank", openingBalance: 100000 });
    const report = await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 60000,
    });

    const drift = await getBalanceDrift(wallet.id);
    expect(drift).toEqual({
      reported: 60000, computed: 90000, drift: -30000,
      reportingTransactionId: report.id, dismissedTransactionId: null,
    });
    expect(drift!.drift).toBe(drift!.reported - drift!.computed);
  });

  test("returns a zero drift, NOT null, when the provider and the ledger agree exactly", async () => {
    // The agreeing case must still produce figures: this is what tells the UI
    // "checked, and it matches", which is a different statement from "never
    // checked" — and it is the only way the drift tolerance can be applied.
    const wallet = await createWallet({ name: "Maya", type: "e-wallet", openingBalance: 100000 });
    const report = await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 15000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 85000,
    });

    expect(await getBalanceDrift(wallet.id)).toEqual({
      reported: 85000,
      computed: 85000,
      drift: 0,
      reportingTransactionId: report.id,
      dismissedTransactionId: null,
    });
  });

  test("reads the LATEST reported balance, not the first one", async () => {
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 700000,
    });
    // The second report lands on the SNAPPED balance: computed = 700000 - 20000.
    const latest = await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 20000, direction: "out",
      occurredAt: 2000, source: "notification", confidence: 0.95, balanceAfter: 650000,
    });

    expect(await getBalanceDrift(wallet.id)).toEqual({
      reported: 650000,
      computed: 680000,
      drift: -30000,
      // The id tracks the same row the figures do. It is what makes a dismissal
      // of the FIRST report stop applying once this one lands.
      reportingTransactionId: latest.id,
      dismissedTransactionId: null,
    });
  });

  test("non-reporting transactions between two reports are folded into the computed figure", async () => {
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 700000,
    });
    await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 5000, direction: "out",
      occurredAt: 2000, source: "manual", confidence: 1,
    });
    // Running balance is now 695000; a ₱50.00 spend takes it to 690000.
    const latest = await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 5000, direction: "out",
      occurredAt: 3000, source: "notification", confidence: 0.95, balanceAfter: 690000,
    });

    expect(await getBalanceDrift(wallet.id)).toEqual({
      reported: 690000,
      computed: 690000,
      drift: 0,
      reportingTransactionId: latest.id,
      dismissedTransactionId: null,
    });
  });

  test("the figures come from the report that actually set the balance — commit order, not occurred_at order", async () => {
    // A LATE-ARRIVING OLDER NOTIFICATION. Spec rule 9's second half ("out-of-order
    // arrivals snap only if the notification timestamp is newer") is NOT
    // implemented — rule 12 is: the snap always proceeds. So the wallet's balance
    // is whatever the last COMMITTED report said, and the explainer has to
    // describe that same figure or it would explain a balance the wallet does
    // not have. Deliberately committed with the older occurred_at LAST.
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 10000, direction: "out",
      occurredAt: 9000, source: "notification", confidence: 0.95, balanceAfter: 700000,
    });
    await insertTransaction({
      walletId: wallet.id, categoryId: CATEGORY_ID, amount: 20000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 300000,
    });

    const drift = await getBalanceDrift(wallet.id);
    expect(drift?.reported).toBe(300000);
    expect((await getWallet(wallet.id))?.balance).toBe(drift?.reported);
  });

  test("one wallet's report never leaks into another wallet's drift", async () => {
    const reporting = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    const quiet = await createWallet({ name: "Pocket cash", type: "cash", openingBalance: 20000 });
    await insertTransaction({
      walletId: reporting.id, categoryId: CATEGORY_ID, amount: 15000, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter: 900000,
    });

    expect(await getBalanceDrift(quiet.id)).toBeNull();
    expect(await getBalanceDrift(reporting.id)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Migration 003 — dismissBalanceDrift, rule 3's second offer.
//
// Rule 3 lets the user "record the gap as an adjustment Transaction ..., or
// dismiss (accept the snap silently)". Dismissal waited for a schema decision
// because the obvious shape — a boolean "the user dismissed the drift" — is
// wrong in a way that only shows up later: it silences the acknowledged drift
// AND every genuine one after it, so the next real disagreement between the bank
// and the ledger is invisible with nothing for the user to notice.
//
// The column is a nullable TRANSACTION ID instead, because `getBalanceDrift`
// already keys on exactly one row — the newest reporting transaction — so the
// drift on screen has an identity. Same id still newest means seen; a newer
// reporting transaction has a different id, so the badge returns by itself.
//
// THE TEST BELOW THAT A BOOLEAN WOULD FAIL is "a NEWER reporting transaction is
// not covered by the earlier dismissal". Every other test in this block passes
// against the wrong design.
// ---------------------------------------------------------------------------

describe("dismissBalanceDrift records WHICH drift the user has seen", () => {
  const CATEGORY_ID = "cat_dismiss";

  async function seedCategory(): Promise<void> {
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
       VALUES (?, 'Food & Dining', NULL, 'utensils', 1, 0, ?, ?)`,
      [CATEGORY_ID, now, now],
    );
  }

  beforeEach(seedCategory);

  async function report(walletId: string, amount: number, balanceAfter: number) {
    return insertTransaction({
      walletId, categoryId: CATEGORY_ID, amount, direction: "out",
      occurredAt: 1000, source: "notification", confidence: 0.95, balanceAfter,
    });
  }

  test("a brand-new wallet has dismissed nothing", async () => {
    // NULL, not a falsy id and not an empty string: "nothing acknowledged" has
    // to be distinguishable from every id this app can generate.
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    expect(wallet.driftDismissedTransactionId).toBeNull();
    expect((await getWallet(wallet.id))?.driftDismissedTransactionId).toBeNull();
  });

  test("dismissing reports the same id back as the reporting transaction's", async () => {
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    const first = await report(wallet.id, 15000, 900000);

    await dismissBalanceDrift(wallet.id, first.id);

    const drift = await getBalanceDrift(wallet.id);
    // The figures are untouched — dismissing accepts the snap, it does not
    // change or hide what the two sides said. The badge's own rule is that the
    // two ids match.
    expect(drift).toEqual({
      reported: 900000,
      computed: 85000,
      drift: 815000,
      reportingTransactionId: first.id,
      dismissedTransactionId: first.id,
    });
  });

  test("a NEWER reporting transaction is not covered by the earlier dismissal", async () => {
    // THE test. A boolean flag, or a dismissal that stores a timestamp nothing
    // ever compares, passes every other assertion in this file and fails here —
    // and the failure it represents in the app is the one that matters: a real
    // reconciliation problem the user is never told about, with no way to
    // notice, because they once dismissed an unrelated one.
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    const first = await report(wallet.id, 15000, 900000);
    await dismissBalanceDrift(wallet.id, first.id);

    const second = await report(wallet.id, 20000, 700000);

    const drift = await getBalanceDrift(wallet.id);
    expect(drift?.reportingTransactionId).toBe(second.id);
    // Still the OLD id — the dismissal is not cleared by anything, it simply
    // stops matching. That is what makes the badge come back with no
    // housekeeping step for anyone to forget.
    expect(drift?.dismissedTransactionId).toBe(first.id);
    expect(drift?.dismissedTransactionId).not.toBe(drift?.reportingTransactionId);
  });

  test("dismissing one wallet's drift leaves another wallet's untouched", async () => {
    // A flag stored per app rather than per wallet passes every single-wallet
    // test above and silences a bank the user has never looked at.
    const gcash = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    const bpi = await createWallet({ name: "BPI", type: "bank", openingBalance: 100000 });
    const gcashReport = await report(gcash.id, 15000, 900000);
    const bpiReport = await report(bpi.id, 15000, 900000);

    await dismissBalanceDrift(gcash.id, gcashReport.id);

    expect((await getBalanceDrift(gcash.id))?.dismissedTransactionId).toBe(gcashReport.id);
    expect((await getBalanceDrift(bpi.id))?.dismissedTransactionId).toBeNull();
    expect((await getBalanceDrift(bpi.id))?.reportingTransactionId).toBe(bpiReport.id);
  });

  test("the dismissal is stored, not remembered — it survives a re-read from the row", async () => {
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    const first = await report(wallet.id, 15000, 900000);

    await dismissBalanceDrift(wallet.id, first.id);

    // Straight off the wallets row, bypassing getBalanceDrift entirely: this is
    // the whole difference between the fix and the bug it replaces, which was a
    // dismissal that lived only for as long as the screen did.
    const row = await db.getFirstAsync<{ id: string | null }>(
      "SELECT drift_dismissed_transaction_id AS id FROM wallets WHERE id = ?",
      [wallet.id],
    );
    expect(row?.id).toBe(first.id);
    expect((await getWallet(wallet.id))?.driftDismissedTransactionId).toBe(first.id);
  });

  test("it bumps updated_at and moves NOTHING else on the wallet", async () => {
    // Dismissing accepts the snap silently — spec rule 3's own words. A balance
    // that moved here would be money appearing with no transaction to explain it.
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    const first = await report(wallet.id, 15000, 900000);
    const before = await getWallet(wallet.id);

    await dismissBalanceDrift(wallet.id, first.id);

    const after = await getWallet(wallet.id);
    expect(after?.balance).toBe(before?.balance);
    expect(after?.name).toBe(before?.name);
    expect(after?.isArchived).toBe(before?.isArchived);
    expect(after?.updatedAt).toBeGreaterThanOrEqual(before!.updatedAt);
  });

  test("dismissing an unknown wallet is a silent no-op, like archiveWallet", async () => {
    // A double tap on a screen whose wallet has just been removed must not
    // throw; nothing about a dismissal is worth failing a user's tap over.
    await expect(dismissBalanceDrift("does-not-exist", "also-not-real")).resolves.toBeUndefined();
  });

  test("deleting the dismissed transaction clears the dismissal instead of failing", async () => {
    // The review queue's "Same transaction" merge deletes a duplicate row. If
    // that row is the one a dismissal names, the foreign key would block the
    // delete and the merge would fail with an error naming neither. Clearing it
    // is also the right answer on its own terms: a dismissal of a transaction
    // that no longer exists acknowledges nothing.
    const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100000 });
    const first = await report(wallet.id, 15000, 900000);
    await dismissBalanceDrift(wallet.id, first.id);

    await expect(deleteTransaction(first.id)).resolves.toBeUndefined();

    expect((await getWallet(wallet.id))?.driftDismissedTransactionId).toBeNull();
    expect(await getBalanceDrift(wallet.id)).toBeNull();
  });
});
