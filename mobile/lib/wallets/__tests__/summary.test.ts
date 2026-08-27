// lib/wallets/__tests__/summary.test.ts — m1c plan Task 4 rule 1, rewritten
// when the wallet TYPE was replaced by inferred traits.
//
// THE TOTAL IS THE MOST DAMAGING NUMBER IN THE APP. It is the first figure on
// the first real screen, and docs/04-features/02-wallets.md rule 23 keeps owed
// balances out of it because an owed balance is money the user does NOT have.
// Adding it inflates the headline figure of a budgeting app by the size of a
// debt — so every owed fixture below carries a NON-ZERO balance, and each total
// assertion is a number that changes the moment that balance is counted.
//
// WHAT CHANGED, AND WHAT DID NOT. The exclusion used to key on
// `type === "credit"`, a value the user picked during onboarding before they
// had entered a single transaction; it now keys on `owedBalance`, which the app
// infers and the user can correct. The RULE is identical, and these tests are
// written so they would still fail if the exclusion were dropped.
import type { Wallet } from "@/types/domain";

import {
  archivedWallets,
  isManualOnly,
  splitByOwed,
  totalActiveBalance,
  totalActiveWalletCount,
} from "../summary";

type WalletShape = {
  name: string;
  balance: number;
  isArchived?: boolean;
  owedBalance?: boolean;
  matcherCount?: number;
};

function wallet({
  name,
  balance,
  isArchived = false,
  owedBalance = false,
  matcherCount = 1,
}: WalletShape): Wallet {
  return {
    id: `id-${name}`,
    name,
    balance,
    currency: "PHP",
    isArchived,
    driftDismissedTransactionId: null,
    owedBalance,
    owedPinned: false,
    matcherCount,
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

const HELD_ONE = wallet({ name: "BPI", balance: 100_00 });
const HELD_TWO = wallet({ name: "GCash", balance: 300_00 });
const HELD_MANUAL = wallet({ name: "Pocket", balance: 50_00, matcherCount: 0 });
const OWED = wallet({ name: "Visa", balance: 12_345_00, owedBalance: true });
const ARCHIVED = wallet({ name: "Old BDO", balance: 900_00, isArchived: true });

// Deliberately NOT in render order, so an implementation that returns insertion
// order passes for the right reason rather than by luck on a tidy fixture.
const MIXED: Wallet[] = [HELD_MANUAL, OWED, HELD_ONE, HELD_TWO];

describe("splitByOwed", () => {
  test("separates what the user has from what they owe", () => {
    const { held, owed } = splitByOwed(MIXED);

    expect(held.map((entry) => entry.name)).toEqual(["Pocket", "BPI", "GCash"]);
    expect(owed.map((entry) => entry.name)).toEqual(["Visa"]);
  });

  test("keeps the repository's order within each half", () => {
    // The repo returns oldest-first, and the Wallets tab renders that order.
    const ordered = [
      wallet({ name: "First", balance: 1 }),
      wallet({ name: "Second", balance: 2 }),
      wallet({ name: "Third", balance: 3 }),
    ];
    expect(splitByOwed(ordered).held.map((entry) => entry.name)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  test("leaves archived wallets out of BOTH halves — they have their own section", () => {
    const archivedOwed = wallet({
      name: "Closed card",
      balance: 500_00,
      owedBalance: true,
      isArchived: true,
    });
    const { held, owed } = splitByOwed([...MIXED, ARCHIVED, archivedOwed]);

    expect(held.map((entry) => entry.name)).not.toContain("Old BDO");
    expect(owed.map((entry) => entry.name)).not.toContain("Closed card");
  });

  test("no wallets produces two empty halves, never undefined", () => {
    expect(splitByOwed([])).toEqual({ held: [], owed: [] });
  });
});

describe("isManualOnly", () => {
  test("a wallet nothing routes to is manual — what `type: cash` used to mean", () => {
    expect(isManualOnly(HELD_MANUAL)).toBe(true);
  });

  test("a wallet with a matcher is not manual", () => {
    expect(isManualOnly(HELD_ONE)).toBe(false);
  });

  test("a wallet whose last matcher was removed becomes manual", () => {
    // DERIVED, NOT STORED, and this is the case that makes it worth deriving:
    // nothing can route to this wallet any more, so nothing can track it, and a
    // stored flag would still be claiming otherwise.
    expect(isManualOnly({ ...HELD_ONE, matcherCount: 0 })).toBe(true);
  });
});

describe("archivedWallets", () => {
  test("returns only the archived ones, in the order given", () => {
    const list = [HELD_ONE, ARCHIVED, HELD_TWO];
    expect(archivedWallets(list).map((entry) => entry.name)).toEqual(["Old BDO"]);
  });

  test("returns nothing when nothing is archived", () => {
    expect(archivedWallets(MIXED)).toEqual([]);
  });
});

describe("totalActiveBalance", () => {
  test("sums the active wallets the user actually holds", () => {
    expect(totalActiveBalance([HELD_ONE, HELD_TWO, HELD_MANUAL])).toBe(450_00);
  });

  test("EXCLUDES owed balances, whose ₱12,345.00 would otherwise inflate the headline", () => {
    // The whole rule in one assertion: the owed wallet is the largest balance
    // in the fixture, so counting it is impossible to miss.
    expect(totalActiveBalance(MIXED)).toBe(450_00);
  });

  test("an owed wallet alone totals zero, not its balance", () => {
    expect(totalActiveBalance([OWED])).toBe(0);
  });

  test("EXCLUDES archived wallets, even while the toggle is showing them", () => {
    expect(totalActiveBalance([HELD_ONE, ARCHIVED])).toBe(100_00);
  });

  test("excludes an archived OWED wallet on both counts at once", () => {
    const archivedOwed = wallet({
      name: "Closed card",
      balance: 500_00,
      owedBalance: true,
      isArchived: true,
    });
    expect(totalActiveBalance([HELD_ONE, archivedOwed])).toBe(100_00);
  });

  test("no wallets totals zero", () => {
    expect(totalActiveBalance([])).toBe(0);
  });

  test("sums in centavos, never rounding to pesos", () => {
    const odd = [wallet({ name: "A", balance: 12_34 }), wallet({ name: "B", balance: 56_78 })];
    expect(totalActiveBalance(odd)).toBe(69_12);
  });
});

describe("totalActiveWalletCount", () => {
  // The label and the figure it sits above must count the same wallets — a
  // count built from a different filter silently disagrees with its own total.
  test("counts exactly the wallets totalActiveBalance sums", () => {
    expect(totalActiveWalletCount(MIXED)).toBe(3);
  });

  test("EXCLUDES owed wallets — the exact wallet a naive `!isArchived` filter counts", () => {
    expect(totalActiveWalletCount([HELD_ONE, OWED])).toBe(1);
  });

  test("an owed wallet alone counts zero, not one", () => {
    expect(totalActiveWalletCount([OWED])).toBe(0);
  });

  test("EXCLUDES archived wallets, even while the toggle is showing them", () => {
    expect(totalActiveWalletCount([HELD_ONE, ARCHIVED])).toBe(1);
  });

  test("no wallets counts zero", () => {
    expect(totalActiveWalletCount([])).toBe(0);
  });
});
