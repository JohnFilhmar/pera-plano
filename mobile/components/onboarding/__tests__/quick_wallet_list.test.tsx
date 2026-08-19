// components/onboarding/__tests__/quick_wallet_list.test.tsx — task-4-brief
// rule 1: every wallet used to start at ₱0.00 with no way to say "this one
// already has ₱3,000 in it." This is the presentational half — the field
// itself.
//
// THE FIELD IS A KEYPAD FIELD NOW (numeric-input-system Task 13), and this is
// the screen behind the owner's original report: they typed 100000 into
// onboarding's wallet balance and got ₱1,000.00, because the helper it went
// through read every keystroke as a CENTAVO. `centavosFrom` reads the same
// keystrokes as PESOS, so 100000 is a hundred thousand pesos — asserted by
// name below.
//
// A STATEFUL HARNESS, NOT A MOCKED onChangeOpeningBalance, FOR ANYTHING THAT
// TYPES. The keypad panel derives each keystroke from `request.text`, which
// only moves when the CONTROLLED value prop moves (contexts/keypad_context.tsx
// — `emit` deliberately does not update the request). A list whose parent
// throws every edit away would therefore see "1", "0", "0"… rather than
// "100000": the test would be driving a field that cannot accumulate, which
// is not the field the app ships.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { typeAmount } from "@/test_support/keypad";

import { QuickWalletList } from "../quick_wallet_list";
import type { WalletProposal } from "../quick_wallet_list";

function makeProposal(overrides: Partial<WalletProposal> = {}): WalletProposal {
  return {
    key: "gcash",
    name: "GCash",
    type: "e-wallet",
    packageName: "com.globe.gcash.android",
    included: true,
    openingBalanceText: "",
    ...overrides,
  };
}

const noop = jest.fn();

/** KeypadHost FIRST: a field cannot raise a panel with no host mounted. */
function renderList(proposals: WalletProposal[]): void {
  render(
    <KeypadProvider>
      <KeypadHost />
      <QuickWalletList
        proposals={proposals}
        onRename={noop}
        onChangeType={noop}
        onToggleIncluded={noop}
        onChangeOpeningBalance={noop}
      />
    </KeypadProvider>,
  );
}

/** The same list, but holding its own proposals — so typing accumulates. */
function renderTypeable(initial: WalletProposal[]): void {
  function Harness() {
    const [proposals, setProposals] = useState(initial);
    return (
      <QuickWalletList
        proposals={proposals}
        onRename={noop}
        onChangeType={noop}
        onToggleIncluded={noop}
        onChangeOpeningBalance={(key, text) => {
          noop(key, text);
          setProposals((current) =>
            current.map((p) => (p.key === key ? { ...p, openingBalanceText: text } : p)),
          );
        }}
      />
    );
  }

  render(
    <KeypadProvider>
      <KeypadHost />
      <Harness />
    </KeypadProvider>,
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
    expect(screen.getByTestId("wallet-proposal-balance-gcash")).toBeTruthy();
    expect(screen.getByTestId("wallet-proposal-balance-preview-gcash")).toHaveTextContent("₱0.00");
  });

  test("typing reports the text the user built, keystroke by keystroke", () => {
    renderTypeable([makeProposal()]);

    typeAmount("wallet-proposal-balance-gcash", "3000");

    expect(noop).toHaveBeenLastCalledWith("gcash", "3000");
  });

  test("the preview reads exactly what the caller's text implies", () => {
    // "3000" now, not "300000": the amount this test is about is ₱3,000.00
    // either way — only the keystrokes that reach it changed
    // (numeric-input-system Task 13).
    renderList([makeProposal({ openingBalanceText: "3000" })]);

    expect(screen.getByTestId("wallet-proposal-balance-preview-gcash")).toHaveTextContent(
      "₱3,000.00",
    );
  });

  test("REGRESSION: 100000 in an opening balance is one hundred thousand pesos", () => {
    // The owner's original report, in the exact place they hit it. Under the
    // old centavos-by-digit reading these six keystrokes were 100000 CENTAVOS
    // and the field said ₱1,000.00.
    renderTypeable([makeProposal()]);

    typeAmount("wallet-proposal-balance-gcash", "100000");

    expect(screen.getByText("₱100,000")).toBeTruthy();
    expect(screen.getByTestId("wallet-proposal-balance-preview-gcash")).toHaveTextContent(
      "₱100,000.00",
    );
  });

  test("a decimal point is the only way to a fraction", () => {
    renderTypeable([makeProposal()]);

    typeAmount("wallet-proposal-balance-gcash", "1000.5");

    expect(screen.getByTestId("wallet-proposal-balance-preview-gcash")).toHaveTextContent(
      "₱1,000.50",
    );
  });

  test("an excluded proposal's balance cannot be typed into", () => {
    renderTypeable([makeProposal({ included: false })]);

    fireEvent.press(screen.getByTestId("wallet-proposal-balance-gcash"));

    // The old field was `editable={included}`; a NumericField has no such
    // prop, so the row is disabled by making the Pressable subtree
    // unreachable. No panel opened, so there is nothing to type into.
    expect(screen.queryByTestId("keypad-host")).toBeNull();
    expect(noop).not.toHaveBeenCalled();
  });

  test("a cash proposal gets the same field — cash can start with money on hand too", () => {
    renderList([makeProposal({ key: "cash", name: "Cash", type: "cash", packageName: null })]);

    expect(screen.getByTestId("wallet-proposal-balance-cash")).toBeTruthy();
  });
});
