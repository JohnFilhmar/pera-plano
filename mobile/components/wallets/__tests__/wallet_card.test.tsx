// components/wallets/__tests__/wallet_card.test.tsx — m1c plan Task 4.
//
// Four presentational components, and two of them can lie about money:
//
//   BalanceMismatchBadge decides whether the app admits a disagreement between
//   the provider's reported balance and the ledger's computed one. Three
//   states have to stay distinct and only one of them shows a badge:
//     drift === null      → the wallet has NEVER had a reported balance. There
//                           is nothing to agree or disagree about, so a badge
//                           here is a claim with no basis behind it.
//     |drift| <= tolerance → rounding. A warning on every wallet trains the
//                           user to ignore the warning.
//     |drift| >  tolerance → say so, WITH BOTH FIGURES. "These disagree" with
//                           no numbers gives the user nothing to act on.
//
//   WalletCard renders a credit wallet's balance, which is money owed. The
//   card has to say so; the total row (lib/wallets/summary.ts) has to leave it
//   out. Both halves are tested, in two places, because getting either one
//   wrong overstates what the user has.
//
// The tolerance is a PROP, sourced from the ruleset's
// `balanceDriftToleranceCentavos` by the screens. The parametrised test below
// holds one drift fixed and varies only the tolerance, so an implementation
// with the ₱1.00 default inlined fails.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Banknote, CreditCard, Landmark, PiggyBank, Smartphone } from "lucide-react-native";

import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { Wallet, WalletMatcher, WalletType } from "@/types/domain";

import { BalanceMismatchBadge } from "../balance_mismatch_badge";
import { MatcherChipList } from "../matcher_chip_list";
import { WalletCard } from "../wallet_card";
import { WALLET_TYPE_ICONS, WalletTypeIcon } from "../wallet_type_icon";

function wallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: "w1",
    name: "GCash",
    type: "e-wallet",
    balance: 123_456,
    currency: "PHP",
    isArchived: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WalletTypeIcon — one glyph per type, and five DIFFERENT glyphs
// ---------------------------------------------------------------------------

describe("WalletTypeIcon", () => {
  const EXPECTED: [WalletType, unknown][] = [
    ["bank", Landmark],
    ["e-wallet", Smartphone],
    ["savings", PiggyBank],
    ["credit", CreditCard],
    ["cash", Banknote],
  ];

  test.each(EXPECTED)("%s maps to its own lucide icon", (type, icon) => {
    expect(WALLET_TYPE_ICONS[type]).toBe(icon);
  });

  test("all five types map to DIFFERENT icons", () => {
    // A type-icon map is easy to write with a copy-paste duplicate in it, and
    // two types sharing a glyph is invisible until a user misreads a row.
    expect(new Set(Object.values(WALLET_TYPE_ICONS)).size).toBe(5);
  });

  test("covers every wallet type with no extras", () => {
    expect(Object.keys(WALLET_TYPE_ICONS).sort()).toEqual(
      ["bank", "cash", "credit", "e-wallet", "savings"].sort(),
    );
  });

  test.each(EXPECTED.map(([type]) => type))("renders for %s", (type) => {
    render(<WalletTypeIcon type={type} testID="icon" />);
    expect(screen.getByTestId("icon")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// BalanceMismatchBadge
// ---------------------------------------------------------------------------

describe("BalanceMismatchBadge", () => {
  test("a drift beyond tolerance renders BOTH figures", () => {
    render(
      <BalanceMismatchBadge
        drift={{ reported: 900_000, computed: 850_00, drift: 900_000 - 850_00 }}
        toleranceCentavos={100}
      />,
    );

    expect(screen.getByTestId("balance-mismatch")).toBeTruthy();
    // Both, not one. A badge that shows only the reported figure tells the
    // user the app disagrees with the bank without saying by how much — and
    // each figure is asserted against ITS OWN label, so swapping the two
    // (telling the user the bank counted what the app did) fails here.
    expect(screen.getByTestId("balance-mismatch-reported")).toHaveTextContent("₱9,000.00");
    expect(screen.getByTestId("balance-mismatch-computed")).toHaveTextContent("₱850.00");
  });

  test("a drift WITHIN tolerance renders nothing at all", () => {
    render(
      <BalanceMismatchBadge
        drift={{ reported: 85_050, computed: 85_000, drift: 50 }}
        toleranceCentavos={100}
      />,
    );
    expect(screen.queryByTestId("balance-mismatch")).toBeNull();
  });

  test("a drift exactly AT tolerance renders nothing (the boundary is inclusive)", () => {
    render(
      <BalanceMismatchBadge
        drift={{ reported: 85_100, computed: 85_000, drift: 100 }}
        toleranceCentavos={100}
      />,
    );
    expect(screen.queryByTestId("balance-mismatch")).toBeNull();
  });

  test("a zero drift renders nothing — the figures agree", () => {
    render(
      <BalanceMismatchBadge
        drift={{ reported: 85_000, computed: 85_000, drift: 0 }}
        toleranceCentavos={100}
      />,
    );
    expect(screen.queryByTestId("balance-mismatch")).toBeNull();
  });

  test("NO REPORTED BALANCE (null) renders nothing — null is not a zero drift", () => {
    // getBalanceDrift returns null for a wallet that has never received a
    // reported balance: cash wallets, brand-new wallets, providers that omit
    // it. Treating null as `drift: 0` would be harmless here, but treating it
    // as "the figures agree" anywhere is a claim the app cannot support.
    render(<BalanceMismatchBadge drift={null} toleranceCentavos={100} />);
    expect(screen.queryByTestId("balance-mismatch")).toBeNull();
  });

  test("a NEGATIVE drift beyond tolerance still renders — magnitude, not sign", () => {
    // Negative means the bank holds LESS than the ledger accounts for: spend
    // the app never saw. That is the direction that matters most.
    render(
      <BalanceMismatchBadge
        drift={{ reported: 80_000, computed: 85_000, drift: -5_000 }}
        toleranceCentavos={100}
      />,
    );
    expect(screen.getByTestId("balance-mismatch")).toBeTruthy();
    expect(screen.getByTestId("balance-mismatch-reported")).toHaveTextContent("₱800.00");
    expect(screen.getByTestId("balance-mismatch-computed")).toHaveTextContent("₱850.00");
  });

  test("an unknown tolerance renders nothing — no threshold, no verdict", () => {
    // The ruleset has not loaded yet. Rendering the badge on a guessed
    // threshold would flash a warning that may vanish a frame later.
    render(
      <BalanceMismatchBadge
        drift={{ reported: 900_000, computed: 85_000, drift: 815_000 }}
        toleranceCentavos={undefined}
      />,
    );
    expect(screen.queryByTestId("balance-mismatch")).toBeNull();
  });

  describe("the threshold comes from the prop, never from an inlined ₱1.00", () => {
    // One drift, two tolerances, opposite outcomes. An implementation that
    // hard-codes DEFAULT_TUNABLES' 100 passes the first and fails the second —
    // which is the whole point of shipping the tolerance as retunable ruleset
    // data (docs/04-features/02-wallets.md §14 open question 1).
    const drift = { reported: 85_500, computed: 85_000, drift: 500 };

    test("tolerance ₱1.00 — the ₱5.00 drift is reported", () => {
      render(<BalanceMismatchBadge drift={drift} toleranceCentavos={100} />);
      expect(screen.getByTestId("balance-mismatch")).toBeTruthy();
    });

    test("tolerance ₱50.00 — the same drift is silence", () => {
      render(<BalanceMismatchBadge drift={drift} toleranceCentavos={5_000} />);
      expect(screen.queryByTestId("balance-mismatch")).toBeNull();
    });
  });

  test("offers no dismiss action — there is nowhere to record one (Task 5)", () => {
    // Spec rule 3 offers "record the gap as an adjustment, or dismiss", but no
    // acknowledged/dismissed flag exists in the schema, so a dismissed drift
    // would re-render forever. The badge is display-only until Task 5 designs
    // what reconciliation writes.
    render(
      <BalanceMismatchBadge
        drift={{ reported: 900_000, computed: 85_000, drift: 815_000 }}
        toleranceCentavos={100}
      />,
    );
    expect(screen.queryByText(/dismiss/i)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WalletCard
// ---------------------------------------------------------------------------

describe("WalletCard", () => {
  test("renders the name and the balance, formatted once by AmountText", () => {
    render(<WalletCard wallet={wallet()} drift={null} toleranceCentavos={100} />);
    expect(screen.getByText("GCash")).toBeTruthy();
    expect(screen.getByText("₱1,234.56")).toBeTruthy();
  });

  test("a CREDIT wallet says the balance is owed", () => {
    render(
      <WalletCard
        wallet={wallet({ type: "credit", name: "Visa", balance: 12_345_00 })}
        drift={null}
        toleranceCentavos={100}
      />,
    );
    expect(screen.getByText("₱12,345.00")).toBeTruthy();
    expect(screen.getByText("Owed")).toBeTruthy();
  });

  test("a non-credit wallet does NOT say owed", () => {
    render(<WalletCard wallet={wallet()} drift={null} toleranceCentavos={100} />);
    expect(screen.queryByText("Owed")).toBeNull();
  });

  test("an archived wallet is labelled as such", () => {
    render(
      <WalletCard wallet={wallet({ isArchived: true })} drift={null} toleranceCentavos={100} />,
    );
    expect(screen.getByText("Archived")).toBeTruthy();
  });

  test("passes its drift through to the badge", () => {
    render(
      <WalletCard
        wallet={wallet()}
        drift={{ reported: 900_000, computed: 85_000, drift: 815_000 }}
        toleranceCentavos={100}
      />,
    );
    expect(screen.getByTestId("wallet-card-w1-drift")).toBeTruthy();
    expect(screen.getByTestId("wallet-card-w1-drift-reported")).toHaveTextContent("₱9,000.00");
    expect(screen.getByTestId("wallet-card-w1-drift-computed")).toHaveTextContent("₱850.00");
  });

  test("renders no badge when the wallet has never reported a balance", () => {
    render(<WalletCard wallet={wallet()} drift={null} toleranceCentavos={100} />);
    expect(screen.queryByTestId("wallet-card-w1-drift")).toBeNull();
  });

  test("fires onPress when the row is tapped", () => {
    const onPress = jest.fn();
    render(<WalletCard wallet={wallet()} drift={null} toleranceCentavos={100} onPress={onPress} />);
    fireEvent.press(screen.getByTestId("wallet-card-w1"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("renders its type icon", () => {
    render(<WalletCard wallet={wallet({ type: "bank" })} drift={null} toleranceCentavos={100} />);
    expect(screen.getByTestId("wallet-card-w1-icon")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MatcherChipList
// ---------------------------------------------------------------------------

describe("MatcherChipList", () => {
  const PROVIDERS: ProviderRuleset[] = [
    {
      providerKey: "gcash",
      packageNames: ["com.globe.gcash.android"],
      version: 1,
      channel: "push",
      templates: [],
    },
  ];

  function matcher(overrides: Partial<WalletMatcher> = {}): WalletMatcher {
    return {
      id: "m1",
      walletId: "w1",
      packageName: "com.globe.gcash.android",
      hint: null,
      createdAt: 1_000,
      updatedAt: 1_000,
      ...overrides,
    };
  }

  test('reads "Catches: GCash", not the android package name', () => {
    render(<MatcherChipList matchers={[matcher()]} providers={PROVIDERS} />);
    expect(screen.getByText("Catches: GCash")).toBeTruthy();
  });

  test("a hint is shown alongside the provider — GCash main vs GSave", () => {
    render(<MatcherChipList matchers={[matcher({ hint: "GSave" })]} providers={PROVIDERS} />);
    expect(screen.getByText("Catches: GCash · GSave")).toBeTruthy();
  });

  test("a package no ruleset claims falls back to the package name, never to blank", () => {
    render(
      <MatcherChipList matchers={[matcher({ packageName: "com.unknown.app" })]} providers={PROVIDERS} />,
    );
    expect(screen.getByText("Catches: com.unknown.app")).toBeTruthy();
  });

  test("renders one chip per matcher", () => {
    render(
      <MatcherChipList
        matchers={[matcher(), matcher({ id: "m2", hint: "GSave" })]}
        providers={PROVIDERS}
        testID="chips"
      />,
    );
    expect(screen.getByText("Catches: GCash")).toBeTruthy();
    expect(screen.getByText("Catches: GCash · GSave")).toBeTruthy();
  });

  test("no matchers renders nothing at all", () => {
    render(<MatcherChipList matchers={[]} providers={PROVIDERS} testID="chips" />);
    expect(screen.queryByTestId("chips")).toBeNull();
  });

  test("the chips are labels, not controls", () => {
    // Matcher editing is Task 5's picker. A tappable chip here would promise
    // an action that does not exist yet.
    render(<MatcherChipList matchers={[matcher()]} providers={PROVIDERS} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
