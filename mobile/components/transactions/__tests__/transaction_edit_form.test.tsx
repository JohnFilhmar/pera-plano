// components/transactions/__tests__/transaction_edit_form.test.tsx — GAP-061.
//
// THE LOAD-BEARING ASSERTION IS THE PATCH, not the rendering. This form reports
// only the fields that actually changed, and that is correctness rather than
// tidiness: `useUpdateTransaction` narrows its cache invalidation on
// `patch.walletId === undefined`, so a form that always sent every field would
// make that test permanently false and silently widen every edit to a
// whole-wallets-family invalidation. A test that only checked "save was called"
// would pass against exactly that bug.
//
// Presentational: it validates and reports. What is WRITTEN, and the balance
// the repository settles, are asserted against the real database in
// app/__tests__/transaction_edit.test.tsx.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { typeAmount } from "@/test_support/keypad";
import type { Transaction, Wallet } from "@/types/domain";

import { TransactionEditForm } from "../transaction_edit_form";

const GCASH: Wallet = {
  id: "w_gcash",
  name: "GCash",
  type: "ewallet",
  balance: 500_000,
  isArchived: false,
} as unknown as Wallet;

const BPI: Wallet = {
  id: "w_bpi",
  name: "BPI",
  type: "bank",
  balance: 1_000_000,
  isArchived: false,
} as unknown as Wallet;

const OLD_CASH: Wallet = {
  id: "w_old",
  name: "Old cash",
  type: "cash",
  balance: 0,
  isArchived: true,
} as unknown as Wallet;

const TX: Transaction = {
  id: "tx_1",
  walletId: GCASH.id,
  categoryId: "cat_food_dining",
  amount: 66_261,
  direction: "out",
  occurredAt: 1_700_000_000_000,
  merchant: "Jollibee",
  counterparty: null,
  referenceNo: null,
  note: null,
  source: "notification",
  confidence: 0.9,
  transferLinkId: null,
} as unknown as Transaction;

function renderForm(
  overrides: Partial<{
    transaction: Transaction;
    wallets: readonly Wallet[];
    onSave: (patch: unknown) => void;
    onCancel: () => void;
  }> = {},
) {
  const props = {
    transaction: TX,
    wallets: [GCASH, BPI] as readonly Wallet[],
    onSave: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
  render(
    <KeypadProvider>
      <TransactionEditForm {...props} />
      <KeypadHost />
    </KeypadProvider>,
  );
  return props;
}

test("saving an untouched form reports an EMPTY patch, so an opened-and-closed form is not an edit", () => {
  const { onSave } = renderForm();

  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).toHaveBeenCalledWith({});
});

test("a changed amount is the only thing reported", () => {
  const { onSave } = renderForm();

  typeAmount("transaction-edit-amount", "1500");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).toHaveBeenCalledWith({ amount: 150_000 });
});

test("a direction flip is reported on its own", () => {
  const { onSave } = renderForm();

  fireEvent.press(screen.getByTestId("transaction-edit-direction-in"));
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).toHaveBeenCalledWith({ direction: "in" });
});

test("a wallet move is reported on its own -- the key useUpdateTransaction branches on", () => {
  const { onSave } = renderForm();

  fireEvent.press(screen.getByTestId(`transaction-edit-wallet-${BPI.id}`));
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).toHaveBeenCalledWith({ walletId: BPI.id });
});

test("several edits at once arrive as one patch", () => {
  const { onSave } = renderForm();

  typeAmount("transaction-edit-amount", "2000");
  fireEvent.press(screen.getByTestId("transaction-edit-direction-in"));
  fireEvent.press(screen.getByTestId(`transaction-edit-wallet-${BPI.id}`));
  fireEvent.changeText(screen.getByTestId("transaction-edit-merchant"), "Mercury Drug");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).toHaveBeenCalledWith({
    amount: 200_000,
    direction: "in",
    walletId: BPI.id,
    merchant: "Mercury Drug",
  });
});

// docs/07 §11.2 rule 4 promises the label can be REMOVED, not merely blanked,
// and "Not recorded" is what null renders as on the detail screen.
test("clearing the merchant reports null, and whitespace counts as cleared", () => {
  const { onSave } = renderForm();

  fireEvent.changeText(screen.getByTestId("transaction-edit-merchant"), "   ");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).toHaveBeenCalledWith({ merchant: null });
});

// THE COUNTERPARTY FALLBACK IS THE TRAP. The detail screen renders
// `merchant ?? counterparty`, so a removal that nulls only `merchant` makes the
// parser's raw counterparty surface in its place and the deleted name comes
// straight back — the opposite of what docs/07 §11.2 rule 4 promises.
const WITH_COUNTERPARTY = {
  ...TX,
  merchant: null,
  counterparty: "JOLLIBEE PHILS CORP",
} as Transaction;

test("a row carrying only a counterparty opens showing it, not an empty field", () => {
  renderForm({ transaction: WITH_COUNTERPARTY });

  expect(screen.getByTestId("transaction-edit-merchant").props.value).toBe(
    "JOLLIBEE PHILS CORP",
  );
});

test("an untouched counterparty-only row reports NOTHING, not a merchant it never had", () => {
  const { onSave } = renderForm({ transaction: WITH_COUNTERPARTY });

  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).toHaveBeenCalledWith({});
});

test("clearing a counterparty-only row erases the counterparty, or the name reappears", () => {
  const { onSave } = renderForm({ transaction: WITH_COUNTERPARTY });

  fireEvent.changeText(screen.getByTestId("transaction-edit-merchant"), "");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  // `merchant` is already null, so only the field that actually holds the name
  // is reported.
  expect(onSave).toHaveBeenCalledWith({ counterparty: null });
});

test("clearing a row that has BOTH erases both", () => {
  const { onSave } = renderForm({
    transaction: { ...TX, merchant: "Jollibee", counterparty: "JOLLIBEE PHILS CORP" } as Transaction,
  });

  fireEvent.changeText(screen.getByTestId("transaction-edit-merchant"), "");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).toHaveBeenCalledWith({ merchant: null, counterparty: null });
});

// A relabel is not an erasure: `counterparty` is the parser's own record of
// what the notification said, and loan payment matching reads it.
test("relabelling leaves the counterparty alone", () => {
  const { onSave } = renderForm({ transaction: WITH_COUNTERPARTY });

  fireEvent.changeText(screen.getByTestId("transaction-edit-merchant"), "Jollibee");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).toHaveBeenCalledWith({ merchant: "Jollibee" });
});

test("re-typing the merchant it already had reports nothing", () => {
  const { onSave } = renderForm();

  fireEvent.changeText(screen.getByTestId("transaction-edit-merchant"), "Jollibee");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).toHaveBeenCalledWith({});
});

test("an amount of zero is refused, with a reason, and nothing is reported", () => {
  const { onSave } = renderForm();

  typeAmount("transaction-edit-amount", "0");

  expect(screen.getByTestId("transaction-edit-amount-error")).toBeTruthy();
  fireEvent.press(screen.getByTestId("transaction-edit-save"));
  expect(onSave).not.toHaveBeenCalled();
});

// A row can sit on a wallet that was archived after it was recorded. Hiding
// archived wallets from the picker without this exception would mean the user
// could not keep their own wallet: saving would force the row onto a different
// one just to correct a typo in the amount.
test("the row's own wallet stays pickable even when archived, and is labelled", () => {
  renderForm({
    transaction: { ...TX, walletId: OLD_CASH.id } as Transaction,
    wallets: [GCASH, BPI, OLD_CASH],
  });

  expect(screen.getByTestId(`transaction-edit-wallet-${OLD_CASH.id}`)).toBeTruthy();
  expect(
    screen.getByTestId(`transaction-edit-wallet-${OLD_CASH.id}`).props.accessibilityState.selected,
  ).toBe(true);
});

test("an archived wallet the row is NOT on stays out of the picker", () => {
  renderForm({ wallets: [GCASH, BPI, OLD_CASH] });

  expect(screen.queryByTestId(`transaction-edit-wallet-${OLD_CASH.id}`)).toBeNull();
});

test("cancel reports nothing at all", () => {
  const { onSave, onCancel } = renderForm();

  typeAmount("transaction-edit-amount", "9999");
  fireEvent.press(screen.getByTestId("transaction-edit-cancel"));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});

test("no failure line until the route supplies one", () => {
  renderForm();

  expect(screen.queryByTestId("transaction-edit-error")).toBeNull();
});

test("the route's failure message is rendered, so a failed save is not silent", () => {
  render(
    <KeypadProvider>
      <TransactionEditForm
        transaction={TX}
        wallets={[GCASH, BPI]}
        onSave={jest.fn()}
        onCancel={jest.fn()}
        errorMessage="That didn't save. Check the amount and try again."
      />
      <KeypadHost />
    </KeypadProvider>,
  );

  expect(screen.getByTestId("transaction-edit-error")).toHaveTextContent(/didn't save/);
});

test("Save is inert while the route's write is in flight", () => {
  const onSave = jest.fn();
  render(
    <KeypadProvider>
      <TransactionEditForm
        transaction={TX}
        wallets={[GCASH, BPI]}
        onSave={onSave}
        onCancel={jest.fn()}
        saving
      />
      <KeypadHost />
    </KeypadProvider>,
  );

  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  expect(onSave).not.toHaveBeenCalled();
});
