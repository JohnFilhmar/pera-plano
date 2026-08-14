// lib/transactions/__tests__/manual_entry.test.ts — the defaults behind m1c
// plan Task 8's rule 3, as pure functions.
//
// They are here rather than inline in the form because each one is a decision
// about WHERE THE USER'S MONEY LANDS, and two of them fail silently:
//
//   THE WALLET. Cash written into a bank wallet corrupts both — the bank's
//   balance stops matching the bank, and the cash the user actually spent is
//   never counted against their pocket. Nothing errors, and both totals look
//   perfectly plausible afterwards.
//
//   THE DATE. A future-dated entry is money that has not moved yet counted in
//   this period's spend, and spec rule 24 forbids it outright.
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import type { Transaction, Wallet } from "@/types/domain";

import { categoryForMerchant, lastUsedCashWallet, occurredAtFor } from "../manual_entry";

const AUG_11_NOON = new Date(2026, 7, 11, 12, 0).getTime();
const AUG_12_NOON = new Date(2026, 7, 12, 12, 0).getTime();
const AUG_13_9AM = new Date(2026, 7, 13, 9, 0).getTime();
const AUG_13_6PM = new Date(2026, 7, 13, 18, 0).getTime();
/** The injected clock. Nothing here reads `Date.now()`. */
const NOW = new Date(2026, 7, 13, 21, 30).getTime();

function wallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: "w1",
    name: "Pocket",
    type: "cash",
    balance: 100_000,
    currency: "PHP",
    isArchived: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    walletId: "w1",
    categoryId: "cat_food_dining",
    amount: 10_000,
    direction: "out",
    occurredAt: AUG_13_9AM,
    merchant: "Jollibee",
    counterparty: null,
    referenceNo: null,
    source: "manual",
    confidence: 1,
    rawNotificationId: null,
    transferLinkId: null,
    note: null,
    balanceAfter: null,
    computedBalance: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// lastUsedCashWallet — rule 3's "wallet = the most recently used cash wallet"
// ---------------------------------------------------------------------------

describe("lastUsedCashWallet", () => {
  test("returns the cash wallet the ledger touched most recently", () => {
    const pocket = wallet({ id: "cash-pocket", name: "Pocket" });
    const jar = wallet({ id: "cash-jar", name: "Jar" });

    const chosen = lastUsedCashWallet(
      [pocket, jar],
      [
        tx({ id: "older", walletId: "cash-jar", occurredAt: AUG_11_NOON }),
        tx({ id: "newer", walletId: "cash-pocket", occurredAt: AUG_12_NOON }),
      ],
    );

    expect(chosen?.id).toBe("cash-pocket");
  });

  test("ignores the ledger's own order and reads the timestamps", () => {
    const pocket = wallet({ id: "cash-pocket" });
    const jar = wallet({ id: "cash-jar" });

    // Handed oldest-first. A `find` over whatever order the caller passed would
    // pick the jar and be wrong on exactly the days it matters.
    const chosen = lastUsedCashWallet(
      [pocket, jar],
      [
        tx({ id: "oldest", walletId: "cash-pocket", occurredAt: AUG_11_NOON }),
        tx({ id: "newest", walletId: "cash-jar", occurredAt: AUG_13_6PM }),
      ],
    );

    expect(chosen?.id).toBe("cash-jar");
  });

  test("NEVER returns a bank, e-wallet, savings or credit wallet", () => {
    const bpi = wallet({ id: "bank", type: "bank" });
    const gcash = wallet({ id: "ewallet", type: "e-wallet" });
    const pocket = wallet({ id: "cash-pocket" });

    // The most recent transaction in the ledger is the BANK's, and it must not
    // win: cash entered into a bank wallet corrupts both balances silently.
    const chosen = lastUsedCashWallet(
      [bpi, gcash, pocket],
      [
        tx({ id: "cash-spend", walletId: "cash-pocket", occurredAt: AUG_11_NOON }),
        tx({ id: "bank-spend", walletId: "bank", occurredAt: AUG_13_6PM }),
      ],
    );

    expect(chosen?.id).toBe("cash-pocket");
  });

  test("falls back to the only cash wallet when the ledger has no cash rows", () => {
    const pocket = wallet({ id: "cash-pocket" });
    const bpi = wallet({ id: "bank", type: "bank" });

    expect(lastUsedCashWallet([bpi, pocket], [tx({ walletId: "bank" })])?.id).toBe("cash-pocket");
    expect(lastUsedCashWallet([bpi, pocket], [])?.id).toBe("cash-pocket");
  });

  test("returns null when there is no cash wallet at all", () => {
    const bpi = wallet({ id: "bank", type: "bank" });
    const gcash = wallet({ id: "ewallet", type: "e-wallet" });

    // The form's create-a-cash-wallet prompt hangs off this null. Returning a
    // bank wallet "so the form has something" is the exact corruption this
    // whole function exists to prevent.
    expect(lastUsedCashWallet([bpi, gcash], [])).toBeNull();
  });

  test("returns null rather than guessing between two unused cash wallets", () => {
    const pocket = wallet({ id: "cash-pocket" });
    const jar = wallet({ id: "cash-jar" });

    // Two pockets and no evidence is a coin flip, and the loser is a real
    // wallet whose balance is now wrong. The form asks instead.
    expect(lastUsedCashWallet([pocket, jar], [])).toBeNull();
  });

  test("skips archived cash wallets, in the list and in the ledger", () => {
    const retired = wallet({ id: "cash-old", isArchived: true });
    const pocket = wallet({ id: "cash-pocket" });

    // Spec rule 2 of the archive flow: an archived wallet is "hidden from all
    // pickers (manual entry, …)". Its history stays visible in the ledger, so
    // the ledger scan has to exclude it too or the picker's default names a
    // wallet the picker itself will not offer.
    const chosen = lastUsedCashWallet(
      [retired, pocket],
      [
        tx({ id: "old", walletId: "cash-old", occurredAt: AUG_13_6PM }),
        tx({ id: "new", walletId: "cash-pocket", occurredAt: AUG_11_NOON }),
      ],
    );

    expect(chosen?.id).toBe("cash-pocket");
  });

  test("breaks a same-instant tie on the later write", () => {
    const pocket = wallet({ id: "cash-pocket" });
    const jar = wallet({ id: "cash-jar" });

    const chosen = lastUsedCashWallet(
      [pocket, jar],
      [
        tx({ id: "first", walletId: "cash-pocket", occurredAt: AUG_12_NOON, createdAt: 1 }),
        tx({ id: "second", walletId: "cash-jar", occurredAt: AUG_12_NOON, createdAt: 2 }),
      ],
    );

    expect(chosen?.id).toBe("cash-jar");
  });
});

// ---------------------------------------------------------------------------
// categoryForMerchant — rule 3's "category = last used for that merchant"
// ---------------------------------------------------------------------------

describe("categoryForMerchant", () => {
  test("returns the category that merchant last landed in", () => {
    const ledger = [
      tx({ id: "old", merchant: "Jollibee", categoryId: "cat_transport", occurredAt: AUG_11_NOON }),
      tx({
        id: "new",
        merchant: "Jollibee",
        categoryId: "cat_food_dining",
        occurredAt: AUG_13_6PM,
      }),
    ];

    expect(categoryForMerchant(ledger, "Jollibee")).toBe("cat_food_dining");
  });

  test("matches the merchant case- and whitespace-insensitively", () => {
    const ledger = [tx({ merchant: "Jollibee", categoryId: "cat_food_dining" })];

    // A user typing "jollibee" means the same shop, and a default that only
    // works when they capitalise it is a default that mostly does not work.
    expect(categoryForMerchant(ledger, "  jollibee ")).toBe("cat_food_dining");
  });

  test("falls back to Uncategorized for an unknown merchant", () => {
    const ledger = [tx({ merchant: "Jollibee", categoryId: "cat_food_dining" })];

    expect(categoryForMerchant(ledger, "Palengke")).toBe(UNCATEGORIZED_ID);
  });

  test("falls back to Uncategorized when no merchant is typed", () => {
    const ledger = [tx({ merchant: "Jollibee", categoryId: "cat_food_dining" })];

    // Not "the last category used at all". A blank merchant is no evidence,
    // and inheriting the previous entry's category would file a jeepney fare
    // under groceries because groceries happened to be typed first.
    expect(categoryForMerchant(ledger, "")).toBe(UNCATEGORIZED_ID);
    expect(categoryForMerchant(ledger, "   ")).toBe(UNCATEGORIZED_ID);
    expect(categoryForMerchant(ledger, null)).toBe(UNCATEGORIZED_ID);
  });

  test("ignores rows with no merchant", () => {
    const ledger = [tx({ merchant: null, categoryId: "cat_transport" })];

    expect(categoryForMerchant(ledger, "Jollibee")).toBe(UNCATEGORIZED_ID);
  });
});

// ---------------------------------------------------------------------------
// occurredAtFor — rule 3's "date = today", and spec rule 24's "never future"
// ---------------------------------------------------------------------------

describe("occurredAtFor", () => {
  test("today keeps the actual moment, not midnight", () => {
    // So an entry typed at 9pm sorts after the morning's, instead of jumping to
    // the top of today's group as though it happened first.
    expect(occurredAtFor("2026-08-13", NOW)).toBe(NOW);
  });

  test("a past day lands at the start of that local day", () => {
    expect(occurredAtFor("2026-08-11", NOW)).toBe(new Date(2026, 7, 11, 0, 0, 0, 0).getTime());
  });

  test("rejects a future day", () => {
    // Spec rule 24: a manual transaction "is never future-dated". Money that
    // has not moved yet must not be counted against this period's spend.
    expect(occurredAtFor("2026-08-14", NOW)).toBeNull();
    expect(occurredAtFor("2027-01-01", NOW)).toBeNull();
  });

  test("rejects anything that is not a real calendar day", () => {
    expect(occurredAtFor("", NOW)).toBeNull();
    expect(occurredAtFor("13-08-2026", NOW)).toBeNull();
    expect(occurredAtFor("2026-8-1", NOW)).toBeNull();
    expect(occurredAtFor("2026-13-01", NOW)).toBeNull();
    // `new Date(2026, 1, 30)` rolls silently into March — the one bad date that
    // parses without complaint.
    expect(occurredAtFor("2026-02-30", NOW)).toBeNull();
  });
});
