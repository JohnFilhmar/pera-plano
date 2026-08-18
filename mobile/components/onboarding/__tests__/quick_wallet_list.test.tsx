// components/onboarding/__tests__/quick_wallet_list.test.tsx — task-4-brief
// rule 1: every wallet used to start at ₱0.00 with no way to say "this one
// already has ₱3,000 in it." This is the presentational half — the field
// itself, entered the same way Task 5 settled on for the rest of the app:
// centavos-by-digit, with a live, honest preview.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { QuickWalletList } from "../quick_wallet_list";
import type { WalletProposal } from "../quick_wallet_list";

function makeProposal(overrides: Partial<WalletProposal> = {}): WalletProposal {
  return {
    key: "gcash",
    name: "GCash",
    type: "e-wallet",
    packageName: "com.globe.gcash.android",
    included: true,
    openingBalanceDigits: "",
    ...overrides,
  };
}

const noop = jest.fn();

function renderList(proposals: WalletProposal[]): void {
  render(
    <QuickWalletList
      proposals={proposals}
      onRename={noop}
      onChangeType={noop}
      onToggleIncluded={noop}
      onChangeOpeningBalance={noop}
    />,
  );
}

beforeEach(() => {
  noop.mockClear();
});

describe("the opening balance field", () => {
  test("onboarding offers an optional opening balance per wallet", () => {
    renderList([makeProposal()]);

    // Present, and BLANK by default — "optional, defaulting to empty" (rule
    // 1) — reading ₱0.00 rather than an error, because a blank field is a
    // real answer, not a missing one.
    expect(screen.getByTestId("wallet-proposal-balance-gcash").props.value).toBe("");
    expect(screen.getByTestId("wallet-proposal-balance-preview-gcash")).toHaveTextContent("₱0.00");

    fireEvent.changeText(screen.getByTestId("wallet-proposal-balance-gcash"), "300000");

    expect(noop).toHaveBeenCalledWith("gcash", "300000");
  });

  test("the preview reads exactly what the caller's digits imply", () => {
    renderList([makeProposal({ openingBalanceDigits: "300000" })]);

    // ₱3,000.00, not ₱300,000.00 or ₱30.00 — the same centavos-by-digit rule
    // Task 5 fixed the income field to honestly reflect, applied here too.
    expect(screen.getByTestId("wallet-proposal-balance-preview-gcash")).toHaveTextContent(
      "₱3,000.00",
    );
  });

  test("a cash proposal gets the same field — cash can start with money on hand too", () => {
    renderList([
      makeProposal({ key: "cash", name: "Cash", type: "cash", packageName: null }),
    ]);

    expect(screen.getByTestId("wallet-proposal-balance-cash")).toBeTruthy();
  });
});
