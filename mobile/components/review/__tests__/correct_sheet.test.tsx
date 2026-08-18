// components/review/__tests__/correct_sheet.test.tsx — m1c plan Task 10.
//
// THE TWO-TAP CORRECTION, and the checkbox that decides whether it teaches.
//
// This component is presentational: it never writes anything. What it must get
// right is the PATCH it reports, because `lib/review/resolve_actions.ts` decides
// what to commit and what rule to create purely from that object. Two mistakes
// here are invisible until weeks later:
//
//   REPORTING A FIELD THE USER DID NOT TOUCH would make every confirmation look
//   like a correction, and the queue would manufacture a UserRule from every
//   card the user simply agreed with.
//
//   LOSING `createRule: false` would create the rule anyway — silently
//   recategorizing rows the user never looked at, having just told the app not
//   to.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { ALWAYS_BOTH_LABEL, CorrectSheet, alwaysRuleLabel } from "../correct_sheet";

import type { Category, ReviewQueueItem, Wallet } from "@/types/domain";

const FOOD = "cat_food_dining";
const TRANSPORT = "cat_transport";

const CATEGORIES: Category[] = [
  {
    id: FOOD,
    name: "Food & Dining",
    parentId: null,
    icon: "utensils",
    isSystem: true,
    isHidden: false,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: TRANSPORT,
    name: "Transport",
    parentId: null,
    icon: "bus",
    isSystem: true,
    isHidden: false,
    createdAt: 0,
    updatedAt: 0,
  },
];

const WALLETS: Wallet[] = [
  {
    id: "wallet_gcash",
    name: "GCash",
    type: "e-wallet",
    balance: 100000,
    currency: "PHP",
    isArchived: false,
    driftDismissedTransactionId: null,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "wallet_bpi",
    name: "BPI",
    type: "bank",
    balance: 500000,
    currency: "PHP",
    isArchived: false,
    driftDismissedTransactionId: null,
    createdAt: 0,
    updatedAt: 0,
  },
];

function item(payload: Record<string, unknown> = {}): ReviewQueueItem {
  return {
    id: "item-1",
    kind: "low-confidence",
    payload: {
      amount: 125000,
      direction: "out",
      merchant: "7-ELEVEN",
      walletId: "wallet_gcash",
      categoryId: FOOD,
      confidence: 0.72,
      ...payload,
    },
    rawNotificationId: "raw-1",
    createdAt: 0,
    expiresAt: null,
    resolvedAt: null,
  };
}

const onSubmit = jest.fn();
const onDismiss = jest.fn();

function renderSheet(entry: ReviewQueueItem = item()): void {
  render(
    <CorrectSheet
      visible
      item={entry}
      wallets={WALLETS}
      categories={CATEGORIES}
      onDismiss={onDismiss}
      onSubmit={onSubmit}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the sheet opens on what the parser proposed", () => {
  test("prefills the parsed amount, wallet, category and merchant", () => {
    renderSheet();

    expect(screen.getByTestId("numpad-amount")).toHaveTextContent("₱1,250.00");
    expect(screen.getByTestId("correct-wallet-wallet_gcash").props.accessibilityState).toMatchObject(
      { selected: true },
    );
    expect(screen.getByTestId("correct-category")).toHaveTextContent("Food & Dining");
    expect(screen.getByTestId("correct-merchant").props.value).toBe("7-ELEVEN");
  });

  test("starts empty for a capture nothing could be read from", () => {
    renderSheet(item({ amount: null, direction: null, walletId: null, merchant: null }));

    // The unknown-provider flow lands here too (spec §"this is a money
    // notification"), and it must not present a guessed ₱0.00 as a parsed value.
    expect(screen.getByTestId("numpad-amount")).toHaveTextContent("₱0.00");
    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  test("hides nothing behind an invisible sheet", () => {
    render(
      <CorrectSheet
        visible={false}
        item={item()}
        wallets={WALLETS}
        categories={CATEGORIES}
        onDismiss={onDismiss}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByTestId("correct-sheet")).toBeNull();
  });
});

describe("the patch reports only what the user changed", () => {
  test("an untouched sheet submits no field at all", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-save"));

    // Saving without touching anything is a CONFIRMATION. Reporting the
    // unchanged values as a patch would make `resolve_actions` treat it as a
    // correction and manufacture a rule from it.
    expect(onSubmit).toHaveBeenCalledWith({ createRule: true });
  });

  test("a changed category is reported", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-category"));
    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    fireEvent.press(screen.getByTestId("category-picker-save"));
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith({ categoryId: TRANSPORT, createRule: true });
  });

  test("a changed wallet is reported", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith({ walletId: "wallet_bpi", createRule: true });
  });

  test("a changed amount is reported in centavos built from keystrokes", () => {
    renderSheet(item({ amount: null }));

    for (const key of ["1", "2", "3", "4"]) {
      fireEvent.press(screen.getByTestId(`numpad-key-${key}`));
    }
    fireEvent.press(screen.getByTestId("correct-save"));

    // 1,2,3,4 → ₱12.34 → 1234 centavos. Never a display string parsed back into
    // a number (Task 8 rule 2).
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 1234 }));
  });

  test("a flipped direction is reported", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-direction-in"));
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ direction: "in" }));
  });

  test("a corrected merchant is reported", () => {
    renderSheet();

    fireEvent.changeText(screen.getByTestId("correct-merchant"), "7-Eleven Katipunan");
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: "7-Eleven Katipunan" }),
    );
  });
});

describe("the rule checkbox", () => {
  test("is offered, and checked, once a correction would teach something", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));

    // Checked by default: the common case is "yes, always" (spec rule 12), and a
    // user who must opt IN to being remembered will correct the same merchant
    // forever and conclude triage is pointless.
    const checkbox = screen.getByTestId("correct-rule-checkbox");
    expect(checkbox.props.accessibilityState).toMatchObject({ checked: true });
  });

  test("is not offered when nothing has been corrected", () => {
    renderSheet();

    // "Always do what you already did" is not an offer worth making.
    expect(screen.queryByTestId("correct-rule-checkbox")).toBeNull();
  });

  test("is not offered for a category change with no merchant to key on", () => {
    renderSheet(item({ merchant: null }));

    fireEvent.press(screen.getByTestId("correct-category"));
    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    fireEvent.press(screen.getByTestId("category-picker-save"));

    // `categorizer.ts` makes a blank `merchantPattern` FAIL CLOSED, so this rule
    // could never fire. Offering it would promise something the pipeline cannot
    // keep.
    expect(screen.queryByTestId("correct-rule-checkbox")).toBeNull();
  });

  test("unchecking it is carried through to the patch", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));
    fireEvent.press(screen.getByTestId("correct-rule-checkbox"));
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith({ walletId: "wallet_bpi", createRule: false });
  });

  test("names both halves of what it will do", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-category"));
    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    fireEvent.press(screen.getByTestId("category-picker-save"));

    expect(screen.getByText(alwaysRuleLabel("7-ELEVEN", "Transport"))).toBeTruthy();
  });

  test("admits it when one box governs two rules", () => {
    renderSheet();

    fireEvent.press(screen.getByTestId("correct-category"));
    fireEvent.press(screen.getByTestId(`category-option-${TRANSPORT}`));
    fireEvent.press(screen.getByTestId("category-picker-save"));
    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));

    // Naming only the category rule while quietly suppressing the wallet rule
    // too would make the box mean more than it says.
    expect(screen.getByText(ALWAYS_BOTH_LABEL)).toBeTruthy();

    fireEvent.press(screen.getByTestId("correct-rule-checkbox"));
    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith({
      categoryId: TRANSPORT,
      walletId: "wallet_bpi",
      createRule: false,
    });
  });
});

describe("save is refused while the ledger would reject the row", () => {
  test("a zero amount cannot be saved", () => {
    renderSheet(item({ amount: null }));

    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  test("no wallet cannot be saved", () => {
    renderSheet(item({ walletId: null }));

    // The one field the gate routed this item here FOR. Committing without it
    // would throw from the repository, after the sheet had already closed.
    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });

    fireEvent.press(screen.getByTestId("correct-wallet-wallet_bpi"));

    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });
});

// Device-testing fix, Task 1 (2026-08-18): a real ₱200 notification landed in
// the queue and could not be saved. `canSave` was correct — the app was
// silently right and useless at the same time, because nothing told the user
// why, and the field they needed sat below a scroll fold they never found.
describe("a disabled Save always says why", () => {
  test("explains why save is disabled when no wallet is chosen", () => {
    renderSheet(item({ walletId: null }));

    expect(screen.getByTestId("correct-save-reason")).toHaveTextContent(
      "Pick a wallet to save",
    );
  });

  test("explains why save is disabled when the amount is zero", () => {
    renderSheet(item({ amount: null }));

    expect(screen.getByTestId("correct-save-reason")).toHaveTextContent(
      "Enter an amount to save",
    );
  });

  test("says nothing once the sheet is actually savable", () => {
    renderSheet();

    expect(screen.queryByTestId("correct-save-reason")).toBeNull();
  });
});

describe("the wallet picker defaults when the choice is unambiguous", () => {
  test("preselects the only wallet when there is exactly one", () => {
    render(
      <CorrectSheet
        visible
        item={item({ walletId: null })}
        wallets={[WALLETS[0]]}
        categories={CATEGORIES}
        onDismiss={onDismiss}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByTestId("correct-wallet-wallet_gcash").props.accessibilityState).toMatchObject(
      { selected: true },
    );
    // Nothing left to ask about, so the sheet is savable without a tap.
    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  test("does not preselect a wallet when there are several", () => {
    renderSheet(item({ walletId: null }));

    expect(screen.getByTestId("correct-wallet-wallet_gcash").props.accessibilityState).toMatchObject(
      { selected: false },
    );
    expect(screen.getByTestId("correct-wallet-wallet_bpi").props.accessibilityState).toMatchObject(
      { selected: false },
    );
    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  test("tells the user when there are no wallets at all", () => {
    render(
      <CorrectSheet
        visible
        item={item({ walletId: null })}
        wallets={[]}
        categories={CATEGORIES}
        onDismiss={onDismiss}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByTestId("correct-wallet-empty")).toHaveTextContent(
      /No wallets yet/,
    );
    expect(screen.queryByTestId(/^correct-wallet-wallet_/)).toBeNull();
    expect(screen.getByTestId("correct-save").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  test("still reports only the changed fields", () => {
    // Regression on rule 5: the auto-preselected sole wallet must fold into
    // the diff's OWN baseline, not read as a user correction.
    render(
      <CorrectSheet
        visible
        item={item({ walletId: null })}
        wallets={[WALLETS[0]]}
        categories={CATEGORIES}
        onDismiss={onDismiss}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.press(screen.getByTestId("correct-save"));

    expect(onSubmit).toHaveBeenCalledWith({ createRule: true });
  });
});
