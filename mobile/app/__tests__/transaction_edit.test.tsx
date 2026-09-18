// app/__tests__/transaction_edit.test.tsx — app/transaction/[id]/edit.tsx
// against a REAL database (GAP-061).
//
// WHAT LIVES HERE RATHER THAN NEXT DOOR. The form's diffing is pinned in
// components/transactions/__tests__/transaction_edit_form.test.tsx. What can
// only be true end to end is the BALANCE: `updateTransaction` settles the
// wallet reverse-then-apply, so an amount change, a direction flip and a wallet
// move each move real money, and a wallet move has to leave BOTH wallets right.
// A test that only asserted the stored row would pass against a repository that
// wrote the row and forgot the balance entirely, which is the failure mode that
// costs a user their totals rather than one field.
//
// THE TRANSFER REFUSAL IS ASSERTED HERE TOO, not only on the detail screen.
// `/transaction/<id>/edit` is addressable, so a guard that lives only on the
// button that usually opens it is not a guard.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
    replace: (...args: unknown[]) => mockReplace(...args),
  }),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { getTransaction, insertTransaction, sumSpend } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { typeAmount } from "@/test_support/keypad";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import EditTransactionScreen from "../transaction/[id]/edit";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: { id: string } = { id: "" };

const FOOD = "cat_food_dining";
const NOW = Date.now();

let gcash: Wallet;
let bpi: Wallet;

function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

async function renderEdit(transactionId: string): Promise<void> {
  mockParams = { id: transactionId };
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <KeypadProvider>
          {children}
          <KeypadHost />
        </KeypadProvider>
      </QueryClientProvider>
    );
  }
  render(<EditTransactionScreen />, { wrapper: Wrapper });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await freshDb();
  await seedDefaultCategories();
  gcash = await createWallet({ name: "GCash", openingBalance: 500_000 });
  bpi = await createWallet({ name: "BPI Savings", openingBalance: 1_000_000 });
});

afterEach(async () => {
  await closeDatabase();
});

async function anExpense(amount = 66_261) {
  return insertTransaction({
    walletId: gcash.id,
    categoryId: FOOD,
    amount,
    direction: "out",
    occurredAt: NOW,
    merchant: "Jollibee",
    source: "notification",
    confidence: 0.9,
  });
}

test("a corrected amount is stored AND the wallet balance moves by the difference", async () => {
  const before = await getWallet(gcash.id);
  const tx = await anExpense();
  const afterInsert = await getWallet(gcash.id);
  expect(afterInsert?.balance).toBe((before?.balance ?? 0) - 66_261);

  await renderEdit(tx.id);
  await waitFor(() => expect(screen.getByTestId("transaction-edit-form")).toBeTruthy());

  typeAmount("transaction-edit-amount", "500");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect((await getTransaction(tx.id))?.amount).toBe(50_000);
  // Not "some smaller number": the balance is the opening figure minus the NEW
  // amount exactly, which is only true if the old effect was reversed rather
  // than the new one merely applied on top.
  expect((await getWallet(gcash.id))?.balance).toBe((before?.balance ?? 0) - 50_000);
});

test("flipping direction moves the balance by twice the amount, not by zero", async () => {
  const opening = (await getWallet(gcash.id))?.balance ?? 0;
  const tx = await anExpense(100_000);
  expect((await getWallet(gcash.id))?.balance).toBe(opening - 100_000);

  await renderEdit(tx.id);
  await waitFor(() => expect(screen.getByTestId("transaction-edit-form")).toBeTruthy());

  fireEvent.press(screen.getByTestId("transaction-edit-direction-in"));
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect((await getTransaction(tx.id))?.direction).toBe("in");
  expect((await getWallet(gcash.id))?.balance).toBe(opening + 100_000);
});

test("moving a row to another wallet settles BOTH balances", async () => {
  const gcashOpening = (await getWallet(gcash.id))?.balance ?? 0;
  const bpiOpening = (await getWallet(bpi.id))?.balance ?? 0;
  const tx = await anExpense(100_000);

  await renderEdit(tx.id);
  await waitFor(() => expect(screen.getByTestId("transaction-edit-form")).toBeTruthy());

  fireEvent.press(screen.getByTestId(`transaction-edit-wallet-${bpi.id}`));
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect((await getTransaction(tx.id))?.walletId).toBe(bpi.id);
  // The origin gets its money back and the destination pays. Asserting only
  // the destination would pass against a repository that never reversed.
  expect((await getWallet(gcash.id))?.balance).toBe(gcashOpening);
  expect((await getWallet(bpi.id))?.balance).toBe(bpiOpening - 100_000);
});

test("clearing the merchant removes it rather than storing an empty string", async () => {
  const tx = await anExpense();

  await renderEdit(tx.id);
  await waitFor(() => expect(screen.getByTestId("transaction-edit-form")).toBeTruthy());

  fireEvent.changeText(screen.getByTestId("transaction-edit-merchant"), "");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect((await getTransaction(tx.id))?.merchant).toBeNull();
});

// docs/07 §11.2 rules 2 and 4: a third party's name must not linger on the
// device, and the label must be REMOVABLE. The detail screen renders
// `merchant ?? counterparty`, so a removal that nulls one column and leaves the
// name in the other has hidden which column it is in and erased nothing.
test("removing the label erases BOTH columns, so the name cannot come back from the fallback", async () => {
  const tx = await insertTransaction({
    walletId: gcash.id,
    categoryId: FOOD,
    amount: 66_261,
    direction: "out",
    occurredAt: NOW,
    merchant: "Jollibee",
    counterparty: "JOLLIBEE PHILS CORP",
    source: "notification",
    confidence: 0.9,
  });

  await renderEdit(tx.id);
  await waitFor(() => expect(screen.getByTestId("transaction-edit-form")).toBeTruthy());

  fireEvent.changeText(screen.getByTestId("transaction-edit-merchant"), "");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  const after = await getTransaction(tx.id);
  expect(after?.merchant).toBeNull();
  expect(after?.counterparty).toBeNull();
});

test("a relabel keeps the parser's counterparty, which loan matching reads", async () => {
  const tx = await insertTransaction({
    walletId: gcash.id,
    categoryId: FOOD,
    amount: 66_261,
    direction: "out",
    occurredAt: NOW,
    merchant: null,
    counterparty: "JOLLIBEE PHILS CORP",
    source: "notification",
    confidence: 0.9,
  });

  await renderEdit(tx.id);
  await waitFor(() => expect(screen.getByTestId("transaction-edit-form")).toBeTruthy());

  fireEvent.changeText(screen.getByTestId("transaction-edit-merchant"), "Jollibee");
  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  const after = await getTransaction(tx.id);
  expect(after?.merchant).toBe("Jollibee");
  expect(after?.counterparty).toBe("JOLLIBEE PHILS CORP");
});

test("saving an untouched form writes NOTHING and still leaves the screen", async () => {
  const tx = await anExpense();
  const balanceBefore = (await getWallet(gcash.id))?.balance;
  const updatedBefore = (await getTransaction(tx.id))?.updatedAt;

  await renderEdit(tx.id);
  await waitFor(() => expect(screen.getByTestId("transaction-edit-form")).toBeTruthy());

  fireEvent.press(screen.getByTestId("transaction-edit-save"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  // `updated_at` is the tell: an empty patch that still ran would settle the
  // balance to the same number and bump this, making an opened-and-closed form
  // indistinguishable from a real edit in the row's own history.
  expect((await getTransaction(tx.id))?.updatedAt).toBe(updatedBefore);
  expect((await getWallet(gcash.id))?.balance).toBe(balanceBefore);
});

// The owner's ruling, 2026-09-18. Asserted at the ROUTE because this path is
// addressable directly, not only through the detail screen's button.
test("a linked transfer leg is refused here too, and offers no form to submit", async () => {
  const outLeg = await insertTransaction({
    walletId: gcash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 500_000,
    direction: "out",
    occurredAt: NOW - 60_000,
    merchant: "Transfer out",
    source: "notification",
    confidence: 0.9,
  });
  const inLeg = await insertTransaction({
    walletId: bpi.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 500_000,
    direction: "in",
    occurredAt: NOW,
    merchant: "Transfer in",
    source: "notification",
    confidence: 0.9,
  });
  await linkTransfer(outLeg.id, inLeg.id, 0);
  const spendBefore = await sumSpend({ from: 0, to: NOW + 1 });

  await renderEdit(outLeg.id);

  await waitFor(() =>
    expect(screen.getByTestId("transaction-edit-transfer-blocked")).toBeTruthy(),
  );
  expect(screen.queryByTestId("transaction-edit-form")).toBeNull();
  expect(screen.queryByTestId("transaction-edit-save")).toBeNull();
  // And the pair is untouched, so the legs are still out of spend.
  expect(await sumSpend({ from: 0, to: NOW + 1 })).toBe(spendBefore);
  expect((await getTransaction(outLeg.id))?.amount).toBe(500_000);
});

test("an unknown id says so rather than rendering an empty form", async () => {
  await renderEdit("no-such-transaction");

  await waitFor(() => expect(screen.getByTestId("transaction-edit-missing")).toBeTruthy());
  expect(screen.queryByTestId("transaction-edit-form")).toBeNull();
});
