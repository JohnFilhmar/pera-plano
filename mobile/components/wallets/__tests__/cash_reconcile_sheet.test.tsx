// components/wallets/__tests__/cash_reconcile_sheet.test.tsx — m1c plan Task 5,
// rules 5 and 6.
//
// Cash cannot send notifications, so a cash wallet's balance is only ever as
// good as what the user remembered to type. Reconciliation is the repair, and
// it is the one flow in this milestone where the app writes money the user did
// not itemize — so it is tested END TO END against a real database rather than
// against a mocked mutation. Four of these assertions defend claims that would
// otherwise fail silently:
//
//   ONE ADJUSTMENT, FOR THE DIFFERENCE. Writing the physical total instead of
//   the delta is the worst arithmetic error available here, and the easy one to
//   write. The fixtures are chosen so the two figures can never be confused.
//
//   THE DIRECTION FOLLOWS THE SIGN. A shortfall recorded as income turns
//   missing money into a windfall and takes every spend total with it.
//
//   AGREEMENT WRITES NOTHING. Not a zero row — which `CHECK (amount > 0)`
//   would reject anyway, but the real cost is a ledger full of entries saying
//   nothing happened.
//
//   IT NEVER EDITS PAST TRANSACTIONS. The ledger is a history. Rewriting
//   yesterday to make today's number come out right is how a money app stops
//   being something a user can check — so the existing rows are captured before
//   and compared field-for-field after.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Modal } from "react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { setMatchers as setWalletMatchers } from "@/lib/db/repos/wallet_matchers_repo";
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { RECONCILE_NOTE } from "@/lib/wallets/reconcile";
import { freshDb } from "@/test_support/db";
import { typeAmount } from "@/test_support/keypad";
import type { Transaction, Wallet } from "@/types/domain";

import { CashReconcileSheet } from "../cash_reconcile_sheet";

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

// A ROOT KeypadHost, MOUNTED BEFORE THE SHEET (numeric-input-system Task 13).
// The amount is a NumericField now, and its `useKeypad()` throws with no
// provider above it. bottom_sheet.tsx mounts a SECOND host inside its Modal,
// and this root one is here so the suite proves the SHEET's host wins rather
// than merely being the only one present: the context gives the panel to the
// highest live token and effects flush in completion order, so the host
// declared FIRST registers the LOWER token and the Modal's host outranks it.
function renderSheet(wallet: Wallet): void {
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <KeypadProvider>
          <KeypadHost />
          {children}
        </KeypadProvider>
      </QueryClientProvider>
    );
  }
  render(<CashReconcileSheet wallet={wallet} visible onDismiss={jest.fn()} />, {
    wrapper: Wrapper,
  });
}

/**
 * Keys the physical figure IN PESOS on the app's own keypad, then confirms.
 *
 * Every caller's keystrokes shrank by two digits (numeric-input-system Task
 * 13) and not one of the amounts they assert moved: ₱500.00 was "50000" and
 * is now "500", because a digit is a peso rather than a centavo. "0" is the
 * one that stays as it was — an empty pocket is 0 either way.
 */
async function reconcile(pesos: string): Promise<void> {
  typeAmount("reconcile-amount", pesos);
  fireEvent.press(screen.getByTestId("reconcile-confirm"));
}

/** Every transaction on the device, oldest first, for before/after comparison. */
async function ledger(): Promise<Transaction[]> {
  const transactions = await listTransactions({});
  return [...transactions].sort((a, b) => a.id.localeCompare(b.id));
}

let cash: Wallet;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  // ₱1,000.00 opening, minus a ₱200.00 spend the app DID see → recorded ₱800.00.
  cash = await createWallet({ name: "Pocket", openingBalance: 100_000 });
  await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 20_000,
    direction: "out",
    occurredAt: 1_786_000_000_000,
    source: "manual",
    confidence: 1,
    merchant: "Jollibee",
  });
  cash = (await getWallet(cash.id)) as Wallet;
});

afterEach(async () => {
  await closeDatabase();
});

test("the sheet asks the spec's question and states the recorded figure", () => {
  renderSheet(cash);

  // The prompt is docs/04-features/02-wallets.md's string, not the plan's
  // ("How much is in your physical wallet right now?"). Global Constraints:
  // where the plan and a spec disagree, the spec wins.
  expect(screen.getByTestId("cash-reconcile-sheet")).toHaveTextContent(
    /How much cash do you have right now\?/,
  );
  expect(screen.getByTestId("reconcile-recorded")).toHaveTextContent("₱800.00");
});

// ---------------------------------------------------------------------------
// The keypad (numeric-input-system Task 13). A sheet is a Modal — its own
// native window — so which host draws the panel is not a detail: the root one
// paints BEHIND the dialog.
// ---------------------------------------------------------------------------

describe("the pocket figure is keyed on the app's own keypad", () => {
  test("the panel opens INSIDE the sheet's Modal, not behind it", () => {
    renderSheet(cash);

    fireEvent.press(screen.getByTestId("reconcile-amount"));

    // Scoped to the Modal deliberately: a bare `getAllByTestId("keypad-host")`
    // of length one cannot tell the sheet's host from the root one.
    expect(within(screen.UNSAFE_getByType(Modal)).getByTestId("keypad-host")).toBeTruthy();
    expect(screen.getByTestId("keypad-label")).toHaveTextContent("Cash you have right now");
  });

  test("a digit is a PESO — 100000 states a hundred thousand, not a thousand", async () => {
    renderSheet(cash);

    typeAmount("reconcile-amount", "100000");

    expect(screen.getByTestId("reconcile-preview")).toHaveTextContent("₱100,000.00");

    fireEvent.press(screen.getByTestId("reconcile-confirm"));
    await waitFor(async () => {
      expect((await getWallet(cash.id))?.balance).toBe(10_000_000);
    });
  });

  test("loose change needs an explicit decimal point", async () => {
    renderSheet(cash);

    await reconcile("500.25");

    await waitFor(async () => {
      expect((await getWallet(cash.id))?.balance).toBe(50_025);
    });
  });
});

describe("the adjustment it writes", () => {
  test("a shortfall writes ONE `out` transaction for the DIFFERENCE", async () => {
    // Recorded ₱800.00, pocket holds ₱500.00 → ₱300.00 spent unseen.
    renderSheet(cash);
    await reconcile("500");

    await waitFor(async () => {
      expect(await listTransactions({ walletId: cash.id })).toHaveLength(2);
    });

    const written = (await listTransactions({ walletId: cash.id })).find(
      (transaction) => transaction.note === RECONCILE_NOTE,
    );
    expect(written).toBeDefined();
    expect(written?.direction).toBe("out");
    // 30000, not 50000 (the physical total) and not 80000 (the recorded one).
    expect(written?.amount).toBe(30_000);
  });

  test("a surplus writes ONE `in` transaction for the DIFFERENCE", async () => {
    renderSheet(cash);
    await reconcile("950");

    await waitFor(async () => {
      expect(await listTransactions({ walletId: cash.id })).toHaveLength(2);
    });

    const written = (await listTransactions({ walletId: cash.id })).find(
      (transaction) => transaction.note === RECONCILE_NOTE,
    );
    expect(written?.direction).toBe("in");
    expect(written?.amount).toBe(15_000);
  });

  test("the wallet lands exactly on the figure the user typed", async () => {
    renderSheet(cash);
    await reconcile("500");

    // Spec rule 4: reconciliation resets the wallet's computed-balance anchor
    // to the entered amount. Writing the delta through the ordinary commit path
    // does exactly that — and does it without a `balanceAfter`, which would
    // make a cash wallet claim a PROVIDER-reported figure it never had.
    await waitFor(async () => {
      expect((await getWallet(cash.id))?.balance).toBe(50_000);
    });
  });

  test("it is a manual, recategorizable, uncategorized entry", async () => {
    renderSheet(cash);
    await reconcile("500");

    await waitFor(async () => {
      expect(await listTransactions({ walletId: cash.id })).toHaveLength(2);
    });

    const written = (await listTransactions({ walletId: cash.id })).find(
      (transaction) => transaction.note === RECONCILE_NOTE,
    );
    expect(written?.source).toBe("manual");
    expect(written?.confidence).toBe(1);
    expect(written?.rawNotificationId).toBeNull();
    // UNCATEGORIZED, per spec §cash Wallet reconciliation rule 3 — NOT the
    // plan's "Fees & Charges". Missing cash was spent, not charged; see
    // lib/wallets/reconcile.ts for the full reasoning.
    expect(written?.categoryId).toBe(UNCATEGORIZED_ID);
  });

  test("an explicitly typed zero is a real answer — an empty pocket", async () => {
    renderSheet(cash);
    await reconcile("0");

    await waitFor(async () => {
      expect(await listTransactions({ walletId: cash.id })).toHaveLength(2);
    });

    // This is what makes the empty-field refusal below discriminating rather
    // than a blanket ban on zero: "I have nothing left" must be sayable.
    const written = (await listTransactions({ walletId: cash.id })).find(
      (transaction) => transaction.note === RECONCILE_NOTE,
    );
    expect(written?.direction).toBe("out");
    expect(written?.amount).toBe(80_000);
  });

  test("reconciling with no difference writes NOTHING", async () => {
    const before = await ledger();
    renderSheet(cash);

    await reconcile("800");

    await waitFor(() => {
      expect(screen.getByTestId("reconcile-result")).toBeTruthy();
    });
    // Not a zero-amount row: `CHECK (amount > 0)` would reject it, and a weekly
    // habit of confirming your cash is right should leave no trace at all.
    expect(await ledger()).toEqual(before);
  });

  test("it NEVER edits past transactions", async () => {
    const before = await ledger();
    renderSheet(cash);

    await reconcile("500");

    await waitFor(async () => {
      expect(await listTransactions({ walletId: cash.id })).toHaveLength(2);
    });

    // Every field of every pre-existing row, unchanged — including
    // `updatedAt`, which a "fix up the old numbers" implementation would move.
    const after = await ledger();
    for (const original of before) {
      expect(after.find((transaction) => transaction.id === original.id)).toEqual(original);
    }
  });
});

describe("only wallets nothing routes to are offered reconciliation", () => {
  test.each(["com.bpi.ng.app", "com.globe.gcash.android"] as const)(
    "a wallet tracked through %s renders no sheet at all",
    async (packageName) => {
      const created = await createWallet({ name: `Tracked via ${packageName}` });
      await setWalletMatchers(created.id, [{ packageName, hint: null }]);
      const wallet = (await getWallet(created.id)) as Wallet;

      renderSheet(wallet);

      // Rule 6. Belt and braces with the detail screen, which does not offer
      // the action either: a non-cash balance is reconciled by the provider's
      // own reported figure, and a typed adjustment there would fight the snap.
      expect(screen.queryByTestId("cash-reconcile-sheet")).toBeNull();
    },
  );
});

test("confirming with nothing typed is refused rather than writing the wallet to zero", async () => {
  const before = await ledger();
  renderSheet(cash);

  fireEvent.press(screen.getByTestId("reconcile-confirm"));

  // An empty field reads as 0, and 0 is a real answer ("my pocket is empty") —
  // but it is not one the user gave. Committing it would write off their whole
  // recorded balance on a mis-tap.
  expect(await ledger()).toEqual(before);
  expect(screen.getByTestId("reconcile-amount-error")).toBeTruthy();
});
