// components/transactions/__tests__/manual_entry_form.test.tsx — m1c plan
// Task 8, rules 1, 3 and 5. Amount and date now go through the shared keypad
// and calendar picker (numeric-input-system W1 Task 9).
//
// AMOUNT FIRST IS A PRODUCT DECISION WITH A TEST. Cash entry competes with
// not-bothering: every tap before the amount is a reason to skip it, and a cash
// wallet that only receives half its spending is worse than no cash wallet at
// all, because the user believes the total. So the load-bearing assertion here
// is the boring-looking one — type four digits, press save, and a COMPLETE
// transaction comes out, with every other field defaulted.
//
// AND THE ONE DEFAULT THAT MAY NOT BE GUESSED IS THE WALLET. With no cash
// wallet the form says so and offers to make one; it never quietly picks the
// bank. Cash written into a bank wallet corrupts both — the bank stops matching
// the bank, and the pocket money is never counted against the pocket.
//
// Presentational: it validates and reports. The route owns every read and write
// (Global Constraints: no repository import inside a component), so what is
// SUBMITTED is what is asserted here, and what is WRITTEN is asserted in
// app/__tests__/transaction_new.test.tsx.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import type { ReactElement } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { clearAmount, typeAmount } from "@/test_support/keypad";
import type { Category, Transaction, Wallet } from "@/types/domain";

import { ManualEntryForm } from "../manual_entry_form";

// A stand-in for the OS date dialog DateField opens, matching
// components/ui/__tests__/date_field.test.tsx's own mock — except the picked
// date is mutable per test, since these tests need to land on specific days
// (today, a backdate, a refused future date) rather than one fixed value.
// `mock`-prefixed so babel-plugin-jest-hoist allows the factory to close over it.
let mockPickedDate = new Date(2026, 7, 13);

jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ onChange }: { onChange: (event: { type: string }, date?: Date) => void }) => (
      <Pressable testID="date-picker-pick" onPress={() => onChange({ type: "set" }, mockPickedDate)}>
        <Text>pick</Text>
      </Pressable>
    ),
  };
});

const onSubmit = jest.fn();
const onCreateCashWallet = jest.fn();

const AUG_11_NOON = new Date(2026, 7, 11, 12, 0).getTime();
const AUG_12_NOON = new Date(2026, 7, 12, 12, 0).getTime();
/** The injected clock: 13 Aug 2026, 9:30pm. Nothing here reads `Date.now()`. */
const NOW = new Date(2026, 7, 13, 21, 30).getTime();

const POCKET: Wallet = {
  id: "cash-pocket",
  name: "Pocket",
  type: "cash",
  balance: 100_000,
  currency: "PHP",
  isArchived: false,
  driftDismissedTransactionId: null,
  createdAt: 1_000,
  updatedAt: 1_000,
};
const JAR: Wallet = { ...POCKET, id: "cash-jar", name: "Jar" };
const BPI: Wallet = { ...POCKET, id: "bank-bpi", name: "BPI", type: "bank" };
const GCASH: Wallet = { ...POCKET, id: "ewallet-gcash", name: "GCash", type: "e-wallet" };

const CATEGORIES: Category[] = [
  {
    id: UNCATEGORIZED_ID,
    name: "Uncategorized",
    parentId: null,
    icon: "circle-help",
    isSystem: true,
    isHidden: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  {
    id: "cat_food_dining",
    name: "Food & Dining",
    parentId: null,
    icon: "utensils",
    isSystem: true,
    isHidden: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  {
    id: "cat_transport",
    name: "Transport",
    parentId: null,
    icon: "bus",
    isSystem: true,
    isHidden: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
];

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    walletId: "cash-pocket",
    categoryId: "cat_food_dining",
    amount: 10_000,
    direction: "out",
    occurredAt: AUG_11_NOON,
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

/**
 * Owns the amount's controlled state the way app/transaction/new.tsx does, so
 * typing through the shared keypad has somewhere real to land — see
 * manual_entry_form.tsx's header on why the amount is a prop, not internal
 * state.
 */
function Harness({
  wallets = [POCKET, BPI],
  transactions = [],
}: {
  wallets?: Wallet[];
  transactions?: Transaction[];
}) {
  const [amount, setAmount] = useState("");
  return (
    <ManualEntryForm
      wallets={wallets}
      categories={CATEGORIES}
      transactions={transactions}
      now={NOW}
      amount={amount}
      onAmountChange={setAmount}
      onSubmit={onSubmit}
      onCreateCashWallet={onCreateCashWallet}
    />
  );
}

// NumericField throws without a KeypadProvider above it, and the panel it
// opens has to be hosted somewhere — see test_support/keypad.ts's header.
function renderForm(ui: ReactElement): void {
  render(
    <KeypadProvider>
      {ui}
      <KeypadHost />
    </KeypadProvider>,
  );
}

function save(): void {
  fireEvent.press(screen.getByTestId("manual-entry-save"));
}

/** Opens the date field, mock-picks the given local day, and closes the dialog. */
function pickDate(testID: string, year: number, month: number, day: number): void {
  mockPickedDate = new Date(year, month - 1, day);
  fireEvent.press(screen.getByTestId(testID));
  fireEvent.press(screen.getByTestId("date-picker-pick"));
}

beforeEach(() => {
  onSubmit.mockClear();
  onCreateCashWallet.mockClear();
});

// ---------------------------------------------------------------------------
// Rule 1 — the numpad is the landing state and everything else is defaulted
// ---------------------------------------------------------------------------

describe("amount first", () => {
  test("the amount field is on screen with nothing else touched", () => {
    renderForm(<Harness />);

    // The auto-open-on-mount behaviour that makes this the LANDING state lives
    // in app/transaction/new.tsx (asserted in transaction_new.test.tsx) — this
    // component-level test only owns that the field itself exists.
    expect(screen.getByTestId("manual-amount")).toBeTruthy();
  });

  test("typing 1000 records one thousand pesos, not ten", () => {
    // The whole reason this migration exists: before it, every digit typed
    // here was read as CENTAVOS, so "1000" produced ₱10.00.
    renderForm(<Harness />);

    typeAmount("manual-amount", "1000");
    save();

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 100_000 }));
  });

  test("four keystrokes and save is a complete transaction", () => {
    renderForm(<Harness transactions={[tx()]} />);

    typeAmount("manual-amount", "1234");
    save();

    // EVERY field, from four taps. This is the whole design: the user typed an
    // amount and nothing else, and the row that lands in their ledger is
    // correct in the wallet, the direction, the date and the category.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      amount: 123_400,
      direction: "out",
      walletId: "cash-pocket",
      categoryId: UNCATEGORIZED_ID,
      occurredAt: NOW,
      merchant: null,
      note: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — save is disabled at zero
// ---------------------------------------------------------------------------

describe("a zero amount cannot be saved", () => {
  test("pressing save with nothing typed submits nothing", () => {
    renderForm(<Harness />);

    save();

    // The schema's `CHECK (amount > 0)` would reject it anyway — as a SQL error
    // surfacing three layers below the button, long after the user has left the
    // screen believing the entry was recorded.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("the save button reports itself disabled", () => {
    renderForm(<Harness />);

    expect(screen.getByTestId("manual-entry-save").props.accessibilityState.disabled).toBe(true);
  });

  test("it enables the moment a digit is typed and disables again on clear", () => {
    renderForm(<Harness />);

    typeAmount("manual-amount", "1");
    expect(screen.getByTestId("manual-entry-save").props.accessibilityState.disabled).toBe(false);

    clearAmount("manual-amount");
    expect(screen.getByTestId("manual-entry-save").props.accessibilityState.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — the defaults
// ---------------------------------------------------------------------------

describe("the defaults", () => {
  test("direction is `out`", () => {
    renderForm(<Harness />);

    // Spending is what cash is for; the occasional cash gift can be switched.
    expect(screen.getByTestId("manual-entry-direction-out").props.accessibilityState.selected).toBe(
      true,
    );
    expect(screen.getByTestId("manual-entry-direction-in").props.accessibilityState.selected).toBe(
      false,
    );
  });

  test("the wallet is the most recently used cash wallet", () => {
    renderForm(
      <Harness
        wallets={[POCKET, JAR, BPI]}
        transactions={[
          tx({ id: "older", walletId: "cash-jar", occurredAt: AUG_11_NOON }),
          tx({ id: "newer", walletId: "cash-pocket", occurredAt: AUG_12_NOON }),
        ]}
      />,
    );

    expect(screen.getByTestId("manual-entry-wallet-cash-pocket").props.accessibilityState.selected).toBe(
      true,
    );
    expect(screen.getByTestId("manual-entry-wallet-cash-jar").props.accessibilityState.selected).toBe(
      false,
    );
  });

  test("the date is today", () => {
    renderForm(<Harness />);

    expect(screen.getByText("2026-08-13")).toBeTruthy();
  });

  test("the category is the one that merchant last landed in", () => {
    renderForm(
      <Harness transactions={[tx({ merchant: "Jollibee", categoryId: "cat_food_dining" })]} />,
    );

    typeAmount("manual-amount", "5000");
    fireEvent.changeText(screen.getByTestId("manual-entry-merchant"), "Jollibee");
    save();

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: "cat_food_dining", merchant: "Jollibee" }),
    );
  });

  test("an unknown merchant falls back to Uncategorized", () => {
    renderForm(
      <Harness transactions={[tx({ merchant: "Jollibee", categoryId: "cat_food_dining" })]} />,
    );

    typeAmount("manual-amount", "5000");
    fireEvent.changeText(screen.getByTestId("manual-entry-merchant"), "Palengke");
    save();

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: UNCATEGORIZED_ID, merchant: "Palengke" }),
    );
  });

  test("a category the user picked outranks the merchant's history", () => {
    renderForm(
      <Harness transactions={[tx({ merchant: "Jollibee", categoryId: "cat_food_dining" })]} />,
    );

    typeAmount("manual-amount", "5000");
    fireEvent.changeText(screen.getByTestId("manual-entry-merchant"), "Jollibee");
    fireEvent.press(screen.getByTestId("manual-entry-category"));
    fireEvent.press(screen.getByTestId("category-option-cat_transport"));
    fireEvent.press(screen.getByTestId("category-picker-save"));
    save();

    // A default that overwrites a deliberate choice is worse than no default.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: "cat_transport" }),
    );
  });
});

// ---------------------------------------------------------------------------
// The wallet, and the one case that may not be defaulted at all
// ---------------------------------------------------------------------------

describe("no cash wallet", () => {
  test("renders a create prompt instead of a silent bank default", () => {
    renderForm(<Harness wallets={[BPI, GCASH]} />);

    // The prompt is the whole point. A bank wallet chosen for the user here
    // corrupts two balances at once and nothing on screen would say so.
    expect(screen.getByTestId("manual-entry-no-cash")).toBeTruthy();
    expect(
      screen.getByTestId("manual-entry-wallet-bank-bpi").props.accessibilityState.selected,
    ).toBe(false);
    expect(
      screen.getByTestId("manual-entry-wallet-ewallet-gcash").props.accessibilityState.selected,
    ).toBe(false);
  });

  test("the prompt offers to create one", () => {
    renderForm(<Harness wallets={[BPI, GCASH]} />);

    fireEvent.press(screen.getByTestId("manual-entry-create-cash"));

    expect(onCreateCashWallet).toHaveBeenCalledTimes(1);
  });

  test("saving without picking a wallet is refused, and says why", () => {
    renderForm(<Harness wallets={[BPI, GCASH]} />);

    typeAmount("manual-amount", "1234");
    save();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("manual-entry-wallet-error")).toBeTruthy();
  });

  test("a wallet the user picks DELIBERATELY still works", () => {
    renderForm(<Harness wallets={[BPI, GCASH]} />);

    typeAmount("manual-amount", "1234");
    fireEvent.press(screen.getByTestId("manual-entry-wallet-bank-bpi"));
    save();

    // Manual entry also covers unsupported providers and gap backfill (spec
    // §manual transaction entry). The rule is that a non-cash wallet is never
    // the DEFAULT — not that it is forbidden.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ walletId: "bank-bpi" }));
    expect(screen.queryByTestId("manual-entry-no-cash")).toBeNull();
  });

  test("two unused cash wallets are a question, not a guess", () => {
    renderForm(<Harness wallets={[POCKET, JAR]} />);

    typeAmount("manual-amount", "1234");
    save();

    // There IS a cash wallet, so no create prompt — but the app has no evidence
    // which pocket this belongs to, and picking one at random puts real money
    // in the wrong place.
    expect(screen.queryByTestId("manual-entry-no-cash")).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("manual-entry-wallet-error")).toBeTruthy();
  });
});

describe("the wallet picker", () => {
  test("lists cash wallets first", () => {
    renderForm(<Harness wallets={[BPI, GCASH, POCKET]} />);

    const ids = screen
      .getAllByTestId(/^manual-entry-wallet-/)
      .map((row) => String(row.props.testID).replace("manual-entry-wallet-", ""));

    // Spec §manual transaction entry rule 2: "a picker with cash Wallets listed
    // first". This screen exists for cash; the rest are the exception.
    expect(ids[0]).toBe("cash-pocket");
    expect(ids).toEqual(["cash-pocket", "bank-bpi", "ewallet-gcash"]);
  });

  test("excludes archived wallets", () => {
    renderForm(<Harness wallets={[POCKET, { ...BPI, isArchived: true }]} />);

    // Spec §archive rule 2: archived wallets are "hidden from all pickers
    // (manual entry, …)".
    expect(screen.queryByTestId("manual-entry-wallet-bank-bpi")).toBeNull();
  });

  test("a chosen wallet replaces the default", () => {
    renderForm(<Harness />);

    typeAmount("manual-amount", "1234");
    fireEvent.press(screen.getByTestId("manual-entry-wallet-bank-bpi"));
    save();

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ walletId: "bank-bpi" }));
  });
});

// ---------------------------------------------------------------------------
// Direction, date and the optional fields
// ---------------------------------------------------------------------------

describe("the secondary fields", () => {
  test("direction can be switched to `in`", () => {
    renderForm(<Harness />);

    typeAmount("manual-amount", "1234");
    fireEvent.press(screen.getByTestId("manual-entry-direction-in"));
    save();

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ direction: "in" }));
  });

  test("a backdated entry lands on that day", () => {
    renderForm(<Harness />);

    typeAmount("manual-amount", "1234");
    pickDate("manual-entry-date", 2026, 8, 11);
    save();

    // Spec rule 24: the timestamp "may be backdated". Yesterday's forgotten
    // jeepney fare belongs on yesterday, or the day's total is wrong twice.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: new Date(2026, 7, 11, 0, 0, 0, 0).getTime() }),
    );
  });

  test("a future date is refused with an explanation", () => {
    renderForm(<Harness />);

    typeAmount("manual-amount", "1234");
    pickDate("manual-entry-date", 2026, 8, 20);
    save();

    // Spec rule 24: "never future-dated". Counting money that has not moved
    // against this period's spend makes every limit and total wrong.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("manual-entry-date-error")).toBeTruthy();
  });

  test("a merchant and a note travel with the entry, trimmed", () => {
    renderForm(<Harness />);

    typeAmount("manual-amount", "1234");
    fireEvent.changeText(screen.getByTestId("manual-entry-merchant"), "  Palengke  ");
    fireEvent.changeText(screen.getByTestId("manual-entry-note"), "  tinapa  ");
    save();

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: "Palengke", note: "tinapa" }),
    );
  });

  test("blank optional fields submit as null, never as empty strings", () => {
    renderForm(<Harness />);

    typeAmount("manual-amount", "1234");
    fireEvent.changeText(screen.getByTestId("manual-entry-merchant"), "   ");
    save();

    // `merchant: ""` is a merchant the app would then try to build rules and
    // defaults from — a name that matches everything and means nothing.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: null, note: null }),
    );
  });
});
