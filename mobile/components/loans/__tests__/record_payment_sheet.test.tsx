// components/loans/__tests__/record_payment_sheet.test.tsx — GAP-079.
//
// What this sheet WRITES is already covered end to end by
// app/__tests__/loan_routes.test.tsx ("RECORDING A PAYMENT ON AN I-OWE LOAN
// WRITES MONEY OUT AND MOVES THE BALANCE", and its owed-to-me twin). This file
// is the other half: what the sheet DOES AROUND that write, which neither of
// those can reach because both render, press once, and assert the ledger.
//
// THREE FAULTS, ALL OF THEM ABOUT MONEY MOVING TWICE OR SILENTLY:
//
//   THE CONFIRM STAYED TAPPABLE WHILE A WRITE WAS IN FLIGHT.
//   `loading={record.isPending}` alone is not a guard — React Query notifies
//   its observers on a microtask, so two presses inside ONE JS tick both read
//   `isPending: false` and both commit. `recordManualPayment` is one unit of
//   work per call, not per finger, so that is two transactions AND two loan
//   payments for one collector visit: the outstanding balance drops by twice
//   what was handed over, and nothing on screen says so.
//
//   A REFUSED WRITE LOOKED LIKE NOTHING HAPPENING. `isError` was never read,
//   so the sheet sat open exactly as it had before the tap.
//
//   THE FORM SURVIVED A CLOSE. The loan screen keeps this sheet mounted and
//   toggles `visible`, and the backdrop and system back both go straight to
//   `onDismiss` — the Cancel button's own `reset` is no substitute — so an
//   amount typed and abandoned was still in the field, and still one tap from
//   being recorded, the next time the sheet opened.

// `useRecordPayment` cancels the loan's queued reminders after recording,
// which reaches expo-notifications. Mocked here for the same reason
// app/__tests__/loan_routes.test.tsx mocks it.
jest.mock("@/lib/alerts/alerts_service", () => ({
  scheduleReminder: jest.fn().mockResolvedValue(null),
  cancelScheduled: jest.fn().mockResolvedValue(undefined),
  postAlert: jest.fn().mockResolvedValue(undefined),
}));

// DateField imports the native picker at module load whether or not a test
// opens it — the same trivial stub date_field.test.tsx and the loan routes
// suite both use.
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: () => null,
}));

// "SUBMITS ONCE" IS A CLAIM ABOUT HOW MANY TIMES THE WRITE RAN, and reading it
// off the database is a race: a second write started in the same tick can land
// after the row count is taken, so the count agrees with a sheet that accepted
// both taps. A passthrough counter measures the thing itself. Everything else
// in the module is the real implementation, so both writes still go through
// the real `withUnitOfWork` against the real schema.
let mockRecordManualPaymentCalls = 0;
jest.mock("@/lib/loans/loans_service", () => {
  const actual = jest.requireActual<typeof import("@/lib/loans/loans_service")>(
    "@/lib/loans/loans_service",
  );
  return {
    ...actual,
    recordManualPayment: (...args: Parameters<typeof actual.recordManualPayment>) => {
      mockRecordManualPaymentCalls += 1;
      return actual.recordManualPayment(...args);
    },
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { createLoan, listPayments, outstandingBalance } from "@/lib/db/repos/loans_repo";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import { typeAmount } from "@/test_support/keypad";
import type { Loan, Wallet } from "@/types/domain";

import { RecordPaymentSheet } from "../record_payment_sheet";

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

/** Injected, never `Date.now()` — see the sheet's own `now` prop. */
const NOW = 1_786_000_000_000;

// The amount is a NumericField, whose `useKeypad()` throws with no provider
// above it; the root host goes in FIRST so the sheet's own host — mounted
// inside its Modal by bottom_sheet.tsx — outranks it.
function renderSheet(loan: Loan, wallets: Wallet[]) {
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
  return render(
    <RecordPaymentSheet loan={loan} wallets={wallets} visible onDismiss={jest.fn()} now={NOW} />,
    { wrapper: Wrapper },
  );
}

let loan: Loan;
let cash: Wallet;

beforeEach(async () => {
  mockRecordManualPaymentCalls = 0;
  await freshDb();
  await seedDefaultCategories();
  cash = await createWallet({ name: "Pocket", openingBalance: 200_000 });
  loan = await createLoan({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 600_000,
  });
});

afterEach(async () => {
  await closeDatabase();
});

/** Fills the sheet in and confirms, the way the loan screen's user does. */
function recordPesos(pesos: string): void {
  typeAmount("loan-payment-amount", pesos);
  fireEvent.press(screen.getByTestId(`loan-payment-wallet-${cash.id}`));
  fireEvent.press(screen.getByTestId("loan-payment-confirm"));
}

describe("a double tap on Record payment", () => {
  test("two presses inside one write record ONE payment", async () => {
    renderSheet(loan, [cash]);

    typeAmount("loan-payment-amount", "500");
    fireEvent.press(screen.getByTestId(`loan-payment-wallet-${cash.id}`));

    // BOTH PRESSES INSIDE ONE `act`, which is what makes this a double tap
    // rather than two taps. `fireEvent` wraps each press in an `act` of its
    // own, and that flush lets `useSyncExternalStore` pick up
    // `isPending: true` in between — so two bare `fireEvent.press` calls
    // measure a second tap arriving a frame later, which `loading` alone
    // already refused. A real double tap is two touches in ONE JS tick, before
    // React Query's observers have been notified of anything, and that is the
    // window the synchronous flag exists for (GAP-060).
    act(() => {
      fireEvent.press(screen.getByTestId("loan-payment-confirm"));
      fireEvent.press(screen.getByTestId("loan-payment-confirm"));
    });

    await waitFor(async () => expect(await listPayments(loan.id)).toHaveLength(1));

    // The claim itself: the second press never reached the service. Asserted
    // on the call count rather than only on the rows, because a second write
    // racing behind the first would be counted here whether or not it had
    // landed by the time the rows are read.
    expect(mockRecordManualPaymentCalls).toBe(1);
    // And the consequence, in the two figures the user would check: one
    // transaction and one link, the balance down by ₱500.00 rather than
    // ₱1,000.00 on a loan they have no reason to go back and re-check.
    expect(await listTransactions({ walletId: cash.id })).toHaveLength(1);
    expect(await outstandingBalance(loan.id)).toBe(600_000 - 50_000);
  });
});

describe("a write that is refused", () => {
  /** A loan this sheet accepts and `recordManualPayment`'s own read cannot find. */
  function missingLoan(): Loan {
    return { ...loan, id: "loan-not-in-the-database" };
  }

  test("leaves the sheet open, the form filled in, and the button back", async () => {
    renderSheet(missingLoan(), [cash]);

    recordPesos("500");

    await waitFor(() => expect(screen.getByTestId("loan-payment-error")).toBeTruthy());

    // Open, with the amount and the wallet still chosen, and nothing written.
    expect(screen.getByTestId("record-payment-sheet")).toBeTruthy();
    expect(screen.getByTestId("loan-payment-preview")).toHaveTextContent("₱500.00");
    expect(screen.getByTestId(`loan-payment-wallet-${cash.id}`).props.accessibilityState.selected)
      .toBe(true);
    expect(await listTransactions({ walletId: cash.id })).toHaveLength(0);
    // The message says to try again, so the retry it asks for has to be
    // tappable.
    expect(screen.getByTestId("loan-payment-confirm").props.accessibilityState.disabled).toBe(
      false,
    );
  });

  test("the refusal does not follow the sheet into its next opening", async () => {
    const broken = missingLoan();
    const view = renderSheet(broken, [cash]);

    recordPesos("500");
    await waitFor(() => expect(screen.getByTestId("loan-payment-error")).toBeTruthy());

    view.rerender(
      <RecordPaymentSheet
        loan={broken}
        wallets={[cash]}
        visible={false}
        onDismiss={jest.fn()}
        now={NOW}
      />,
    );
    view.rerender(
      <RecordPaymentSheet loan={broken} wallets={[cash]} visible onDismiss={jest.fn()} now={NOW} />,
    );

    expect(screen.queryByTestId("loan-payment-error")).toBeNull();
  });
});

test("reopening shows an empty form, not the amount typed and abandoned", () => {
  const view = renderSheet(loan, [cash]);

  typeAmount("loan-payment-amount", "500");
  expect(screen.getByTestId("loan-payment-preview")).toHaveTextContent("₱500.00");

  // Dismissed the way the backdrop and system back do it: `onDismiss` alone,
  // without the Cancel button's `reset` beside it.
  view.rerender(
    <RecordPaymentSheet
      loan={loan}
      wallets={[cash]}
      visible={false}
      onDismiss={jest.fn()}
      now={NOW}
    />,
  );
  view.rerender(
    <RecordPaymentSheet loan={loan} wallets={[cash]} visible onDismiss={jest.fn()} now={NOW} />,
  );

  expect(screen.getByTestId("loan-payment-preview")).toHaveTextContent("₱0.00");
});
