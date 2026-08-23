// lib/wallets/__tests__/summary.test.ts — m1c plan Task 4, rule 1.
//
// THE TOTAL IS THE MOST DAMAGING NUMBER IN THE APP. It is the first figure on
// the first real screen, and docs/04-features/02-wallets.md rule 23 excludes
// credit wallets from it because a credit balance is money OWED, not money
// held. Adding it inflates the headline figure of a budgeting app — so every
// credit fixture below carries a NON-ZERO balance, and each total assertion is
// a number that changes the moment that balance is counted.
//
// The grouping tests seed wallets in a DIFFERENT order than they must render,
// so an implementation that returns insertion order (or alphabetises) fails
// rather than passing by luck on a conveniently-ordered fixture.
import type { Wallet, WalletType } from "@/types/domain";

import {
  archivedWallets,
  groupWalletsByType,
  totalActiveBalance,
  totalActiveWalletCount,
  WALLET_TYPE_LABELS,
  WALLET_TYPE_ORDER,
} from "../summary";

function wallet(
  name: string,
  type: WalletType,
  balance: number,
  isArchived = false,
): Wallet {
  return {
    id: `id-${name}`,
    name,
    type,
    balance,
    currency: "PHP",
    isArchived,
    driftDismissedTransactionId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

// Deliberately NOT in render order: cash first, bank last, credit in the
// middle. Insertion order here is cash, credit, bank, savings, e-wallet.
const MIXED: Wallet[] = [
  wallet("Pocket", "cash", 50_00),
  wallet("Visa", "credit", 12_345_00),
  wallet("BPI", "bank", 100_00),
  wallet("GSave", "savings", 200_00),
  wallet("GCash", "e-wallet", 300_00),
];

describe("WALLET_TYPE_ORDER", () => {
  test("is the plan's display order, not the type enum's declaration order", () => {
    expect(WALLET_TYPE_ORDER).toEqual(["bank", "e-wallet", "savings", "credit", "cash"]);
  });
});

describe("WALLET_TYPE_LABELS", () => {
  test("labels every type in WALLET_TYPE_ORDER", () => {
    for (const type of WALLET_TYPE_ORDER) {
      expect(WALLET_TYPE_LABELS[type]).toEqual(expect.any(String));
      expect(WALLET_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
  });

  test("the credit heading says the balances under it are owed, not held", () => {
    // Rule 1: credit wallets are "shown as amounts owed". The section heading
    // is where that is said once for the whole group.
    expect(WALLET_TYPE_LABELS.credit.toLowerCase()).toContain("owed");
  });

  test("no two types share a label", () => {
    expect(new Set(Object.values(WALLET_TYPE_LABELS)).size).toBe(WALLET_TYPE_ORDER.length);
  });
});

describe("groupWalletsByType", () => {
  test("orders the groups bank, e-wallet, savings, credit, cash", () => {
    expect(groupWalletsByType(MIXED).map((g) => g.type)).toEqual([
      "bank",
      "e-wallet",
      "savings",
      "credit",
      "cash",
    ]);
  });

  test("omits a type nobody has a wallet of", () => {
    const groups = groupWalletsByType([wallet("BPI", "bank", 1), wallet("Pocket", "cash", 2)]);
    expect(groups.map((g) => g.type)).toEqual(["bank", "cash"]);
  });

  test("keeps the repository's order within a group", () => {
    const groups = groupWalletsByType([
      wallet("BDO", "bank", 1),
      wallet("BPI", "bank", 2),
      wallet("Landbank", "bank", 3),
    ]);
    // Repository order (oldest first), NOT alphabetical — "BDO, BPI, Landbank"
    // happens to be both, so the fixture is reversed to tell them apart.
    expect(groups[0].wallets.map((w) => w.name)).toEqual(["BDO", "BPI", "Landbank"]);
    const reversed = groupWalletsByType([
      wallet("Landbank", "bank", 3),
      wallet("BPI", "bank", 2),
      wallet("BDO", "bank", 1),
    ]);
    expect(reversed[0].wallets.map((w) => w.name)).toEqual(["Landbank", "BPI", "BDO"]);
  });

  test("leaves archived wallets out of every group — they have their own section", () => {
    const groups = groupWalletsByType([
      wallet("BPI", "bank", 1),
      wallet("Old BDO", "bank", 2, true),
    ]);
    expect(groups.map((g) => g.wallets.map((w) => w.name))).toEqual([["BPI"]]);
  });

  test("no wallets produces no groups", () => {
    expect(groupWalletsByType([])).toEqual([]);
  });
});

describe("archivedWallets", () => {
  test("returns only the archived ones, in the order given", () => {
    const list = [
      wallet("BPI", "bank", 1),
      wallet("Old BDO", "bank", 2, true),
      wallet("Old GCash", "e-wallet", 3, true),
    ];
    expect(archivedWallets(list).map((w) => w.name)).toEqual(["Old BDO", "Old GCash"]);
  });

  test("returns nothing when nothing is archived", () => {
    expect(archivedWallets([wallet("BPI", "bank", 1)])).toEqual([]);
  });
});

describe("totalActiveBalance", () => {
  test("sums the active non-credit wallets", () => {
    // 100_00 bank + 300_00 e-wallet + 200_00 savings + 50_00 cash.
    expect(totalActiveBalance(MIXED)).toBe(650_00);
  });

  test("EXCLUDES credit, whose ₱12,345.00 would otherwise inflate the headline", () => {
    const withoutCredit = MIXED.filter((w) => w.type !== "credit");
    expect(totalActiveBalance(MIXED)).toBe(totalActiveBalance(withoutCredit));
    // The figure a naive `reduce` over every wallet would produce.
    expect(totalActiveBalance(MIXED)).not.toBe(650_00 + 12_345_00);
  });

  test("a credit wallet alone totals zero, not its balance", () => {
    expect(totalActiveBalance([wallet("Visa", "credit", 12_345_00)])).toBe(0);
  });

  test("EXCLUDES archived wallets (spec rule 17), even while the toggle shows them", () => {
    const withArchived = [...MIXED, wallet("Closed BDO", "bank", 999_00, true)];
    expect(totalActiveBalance(withArchived)).toBe(650_00);
  });

  test("excludes an archived CREDIT wallet on both counts at once", () => {
    const withArchivedCredit = [...MIXED, wallet("Old Visa", "credit", 777_00, true)];
    expect(totalActiveBalance(withArchivedCredit)).toBe(650_00);
  });

  test("no wallets totals zero", () => {
    expect(totalActiveBalance([])).toBe(0);
  });

  test("sums in centavos, never rounding to pesos", () => {
    expect(totalActiveBalance([wallet("A", "cash", 5), wallet("B", "cash", 7)])).toBe(12);
  });
});

describe("totalActiveWalletCount", () => {
  // The label and the figure it sits above must count the same wallets — see
  // this function's own header. Every case here mirrors a `totalActiveBalance`
  // case above, on the same MIXED fixture, so the two can be read side by side.
  test("counts the same wallets totalActiveBalance sums — 4, not all 5", () => {
    expect(totalActiveWalletCount(MIXED)).toBe(4);
  });

  test("EXCLUDES credit, the exact wallet a naive `!isArchived`-only filter used to count", () => {
    const withoutCredit = MIXED.filter((w) => w.type !== "credit");
    expect(totalActiveWalletCount(MIXED)).toBe(totalActiveWalletCount(withoutCredit));
    // The count a filter on archived-only (the bug this function replaces)
    // would have produced.
    expect(totalActiveWalletCount(MIXED)).not.toBe(5);
  });

  test("a credit wallet alone counts zero, not one", () => {
    expect(totalActiveWalletCount([wallet("Visa", "credit", 12_345_00)])).toBe(0);
  });

  test("EXCLUDES archived wallets, even while the toggle shows them", () => {
    const withArchived = [...MIXED, wallet("Closed BDO", "bank", 999_00, true)];
    expect(totalActiveWalletCount(withArchived)).toBe(4);
  });

  test("no wallets counts zero", () => {
    expect(totalActiveWalletCount([])).toBe(0);
  });
});
