// app/__tests__/loan_routes.test.tsx — m2b Task 8's three routes.
//
// The card, form and schedule table are tested in isolation next door; this
// file is about what the ROUTES do against a real database — the two sections
// and their separate totals, the entitlement gate, and confirming a match.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
}));

// The detail route now reaches `cancelLoanReminders` through its payment
// mutation hooks (m3c Task 8 audit fix: a paid installment must not leave a
// stale reminder queued), which reaches expo-notifications. Mocked here
// rather than in the service, which is exactly why the two were split — same
// pattern as `app/__tests__/bills_screen.test.tsx`.
jest.mock("@/lib/alerts/alerts_service", () => ({
  scheduleReminder: jest.fn().mockResolvedValue(null),
  cancelScheduled: jest.fn().mockResolvedValue(undefined),
  postAlert: jest.fn().mockResolvedValue(undefined),
}));

// DateField (inside LoanForm's amortized/flat branches) imports the native
// picker at module load regardless of whether a test ever opens it —
// components/ui/__tests__/date_field.test.tsx's own mock exists for the same
// reason. Nothing here presses the date field, so a trivial stub is enough.
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: () => null,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { cancelScheduled } from "@/lib/alerts/alerts_service";
import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import {
  createLoan,
  listAdjustments,
  listLoans,
  listPayments,
  outstandingBalance,
  recordPayment,
} from "@/lib/db/repos/loans_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import { typeAmount } from "@/test_support/keypad";
import type { Wallet } from "@/types/domain";

import LoansScreen from "../(tabs)/plan/loans";
import NewLoanScreen from "../(tabs)/plan/loans/new";
import LoanDetailScreen from "../(tabs)/plan/loans/[id]";

const mockCancelScheduled = cancelScheduled as jest.Mock;

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};

let cash: Wallet;

/**
 * Fixtures here are RELATIVE TO THE REAL CLOCK, unlike the service tests'.
 * These screens read `systemClock.now()` — that is what a composition edge is
 * for — and `findPaymentCandidates` only looks at the trailing 60 days, so a
 * transaction pinned to a fixed future date is filtered out and the match
 * affordance never appears.
 */
const TODAY_ISO = new Date().toISOString().slice(0, 10);
const YESTERDAY = Date.now() - 86_400_000;

function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity, staleTime: 0 },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

// NumericField (inside LoanForm) throws without a KeypadProvider above it,
// and the panel it opens has to be hosted somewhere — see
// test_support/keypad.ts's header. Harmless for the routes that never touch
// LoanForm: KeypadHost renders nothing while no field is focused.
function renderScreen(ui: ReactNode) {
  return render(
    <QueryClientProvider client={makeTestClient()}>
      <ThemeProvider>
        <KeypadProvider>
          {ui}
          <KeypadHost />
        </KeypadProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  mockParams = {};
  __setTierForTests(null);
  await seedDefaultCategories();
  cash = await createWallet({ name: "Cash", type: "cash" });
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// The list — rules 1 and 7
// ---------------------------------------------------------------------------
test("THE TWO DIRECTIONS GET SEPARATE SECTIONS AND SEPARATE TOTALS", async () => {
  // Rule 1: mixing them "would misrepresent the user's position". A ₱5,000 debt
  // and ₱3,000 lent out are not a ₱2,000 net — they are two obligations
  // pointing opposite ways, and only one is under the user's control.
  await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });
  await createLoan({ direction: "owed-to-me", counterparty: "Kuya Ben", principal: 300000 });

  renderScreen(<LoansScreen />);

  await screen.findByTestId("loans-i-owe");
  expect(screen.getByTestId("loans-i-owe-total").props.children).toContain("₱5,000.00");
  expect(screen.getByTestId("loans-owed-to-me-total").props.children).toContain("₱3,000.00");
});

test("EACH SECTION HAS ITS OWN EMPTY COPY", async () => {
  // Rule 7. An empty debt list is good news; an empty lending list is neutral.
  // One shared "nothing here" would flatten the difference.
  await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });

  renderScreen(<LoansScreen />);

  await screen.findByTestId("loans-owed-to-me-empty");
  screen.getByText("No one owes you right now.");
  expect(screen.queryByTestId("loans-i-owe-empty")).toBeNull();
});

test("with no loans at all the screen offers one action", async () => {
  renderScreen(<LoansScreen />);

  await screen.findByTestId("loans-empty");
  fireEvent.press(screen.getByText("Add a loan"));
  expect(mockPush).toHaveBeenCalledWith("/plan/loans/new");
});

test("pressing a loan opens its detail route", async () => {
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });

  renderScreen(<LoansScreen />);
  await screen.findByTestId(`loan-row-${loan.id}`);

  fireEvent.press(screen.getByTestId(`loan-row-${loan.id}`));

  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/plan/loans/[id]",
    params: { id: loan.id },
  });
});

// F5: the row was a bare Pressable — TalkBack could reach it (RN marks any
// onPress handler focusable regardless of role) but never announced it as
// actionable, and with no label fell back to reading LoanCard's own text
// nodes as an unstructured run-on.
test("the loan row is announced to TalkBack as a button with a spoken label, not a silent wrapper", async () => {
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });

  renderScreen(<LoansScreen />);
  const row = await screen.findByTestId(`loan-row-${loan.id}`);

  expect(row.props.accessibilityRole).toBe("button");
  // No nextDueDate on this fixture, so dueChip is null — the label states
  // just who and how much, matching the loan created here exactly.
  expect(row.props.accessibilityLabel).toBe("GLoan, ₱5,000.00 outstanding");
});

// ---------------------------------------------------------------------------
// The gate — rule 6
// ---------------------------------------------------------------------------
test("A SECOND LOAN ON THE FREE TIER IS GATED, and the first is untouched", async () => {
  __setTierForTests("free");
  const existing = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 500000,
  });

  renderScreen(<LoansScreen />);
  await screen.findByTestId("loans-add");

  fireEvent.press(screen.getByTestId("loans-add"));

  expect(mockPush).toHaveBeenCalledWith("/plan/loans/new?gated=1");
  expect((await listLoans()).map((loan) => loan.id)).toEqual([existing.id]);
});

test("the gated screen says what free KEEPS, not only what it loses", async () => {
  // Spec rule 16: "Reminders are available on both tiers — the free tier's
  // 'balance + next due' tracking includes being reminded of that next due."
  mockParams = { gated: "1" };

  renderScreen(<NewLoanScreen />);

  await screen.findByTestId("loans-gated");
  screen.getByText(/keeps its balance, next due date and reminders/);
  expect(screen.queryByTestId("loan-counterparty")).toBeNull();
});

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------
test("a free-form loan saves from counterparty and amount alone", async () => {
  renderScreen(<NewLoanScreen />);
  await screen.findByTestId("loan-counterparty");

  fireEvent.changeText(screen.getByTestId("loan-counterparty"), "Aling Nena");
  // ₱5,000 — the old test typed "500000" as raw centavo digits.
  typeAmount("loan-principal", "5000");
  fireEvent.press(screen.getByTestId("loan-save"));

  await waitFor(async () => expect((await listLoans()).length).toBe(1));
  const [saved] = await listLoans();
  expect(saved.counterparty).toBe("Aling Nena");
  expect(saved.principal).toBe(500000);
  expect(saved.schedule).toBeNull();
  expect(mockBack).toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Detail and matching — rule 5
// ---------------------------------------------------------------------------
test("THE MATCH SHEET LISTS CANDIDATES WITH THEIR REASONS", async () => {
  // Rule 5: each candidate shows "its amount, date, and why it matched". A
  // score alone asks the user to trust a number they cannot check.
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 5000000,
    linkedWalletId: cash.id,
    nextDueDate: TODAY_ISO,
    nextDueAmount: 444244,
  });
  await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 444244,
    direction: "out",
    occurredAt: YESTERDAY,
    merchant: "GLOAN PAYMENT",
    source: "manual",
    confidence: 1,
  });
  mockParams = { id: loan.id };

  renderScreen(<LoanDetailScreen />);

  await screen.findByTestId("loan-open-matches");
  fireEvent.press(screen.getByTestId("loan-open-matches"));

  await screen.findByTestId("match-sheet");
  screen.getByText("· Paid to GLoan");
  screen.getByText("· Matches the amount due");
});

test("CONFIRMING A MATCH RECORDS IT AND MOVES THE BALANCE", async () => {
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 5000000,
    linkedWalletId: cash.id,
    nextDueDate: TODAY_ISO,
    nextDueAmount: 444244,
  });
  const tx = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 444244,
    direction: "out",
    occurredAt: YESTERDAY,
    merchant: "GLOAN PAYMENT",
    source: "manual",
    confidence: 1,
  });
  mockParams = { id: loan.id };

  renderScreen(<LoanDetailScreen />);
  await screen.findByTestId("loan-open-matches");
  fireEvent.press(screen.getByTestId("loan-open-matches"));
  await screen.findByTestId(`match-confirm-${tx.id}`);

  fireEvent.press(screen.getByTestId(`match-confirm-${tx.id}`));

  await waitFor(async () =>
    expect(await outstandingBalance(loan.id)).toBe(5000000 - 444244),
  );
});

test("CONFIRMING A MATCH CANCELS THE LOAN'S STALE QUEUED REMINDERS (m3c Task 8 audit fix)", async () => {
  // Regression: before this fix, a reminder scheduled for the OLD due date
  // stayed queued after the installment was paid — the same failure mode
  // `bills` rule 11 exists to prevent, just missing on the loans side.
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 5000000,
    linkedWalletId: cash.id,
    nextDueDate: TODAY_ISO,
    nextDueAmount: 444244,
  });
  // Seeds the state a real `scheduleLoanReminders` bootstrap pass would have
  // left behind, so this test does not depend on that unrelated code path.
  await setSetting("loan_reminder_ids", { [loan.id]: ["os-id-stale-1", "os-id-stale-2"] });
  const tx = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 444244,
    direction: "out",
    occurredAt: YESTERDAY,
    merchant: "GLOAN PAYMENT",
    source: "manual",
    confidence: 1,
  });
  mockParams = { id: loan.id };

  renderScreen(<LoanDetailScreen />);
  await screen.findByTestId("loan-open-matches");
  fireEvent.press(screen.getByTestId("loan-open-matches"));
  await screen.findByTestId(`match-confirm-${tx.id}`);

  fireEvent.press(screen.getByTestId(`match-confirm-${tx.id}`));

  await waitFor(() => expect(mockCancelScheduled).toHaveBeenCalledWith("os-id-stale-1"));
  expect(mockCancelScheduled).toHaveBeenCalledWith("os-id-stale-2");
  await waitFor(async () => expect(await getSetting("loan_reminder_ids")).toEqual({}));
});

test("NO SUGGESTIONS STILL LEAVES A WAY TO RECORD A PAYMENT", async () => {
  // This used to assert the opposite — no candidates, no button — on the
  // reasoning that an empty affordance invites a tap showing nothing. That
  // reasoning holds only if "nothing scored above the floor" meant "no payment
  // arrived", and for owed-to-me lending it does not: a partial amount, from a
  // person, on a loan with no schedule fires no strong signal at all. The
  // button became the only thing standing between the user and money they
  // watched land, so it stays and opens the unfiltered list directly.
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });
  mockParams = { id: loan.id };

  renderScreen(<LoanDetailScreen />);

  await screen.findByTestId("loan-detail");
  expect(screen.getByTestId("loan-open-matches")).toBeTruthy();
});

test("a settled loan offers no match button", async () => {
  // The one case where the affordance really is empty: nothing is owed, so
  // nothing can pay it — `findPaymentCandidates` returns [] for a settled loan
  // however wide the search.
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });
  const paid = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 500000,
    direction: "out",
    occurredAt: YESTERDAY,
    source: "manual",
    confidence: 1,
  });
  await recordPayment({ loanId: loan.id, transactionId: paid.id });
  mockParams = { id: loan.id };

  renderScreen(<LoanDetailScreen />);

  await screen.findByTestId("loan-detail");
  expect(screen.queryByTestId("loan-open-matches")).toBeNull();
});

test("a loan that no longer exists says so", async () => {
  mockParams = { id: "no-such-loan" };

  renderScreen(<LoanDetailScreen />);

  await screen.findByTestId("loan-detail-missing");
  screen.getByText("This loan is gone");
});

// ---------------------------------------------------------------------------
// Recording a payment by hand — the spec's "Flow: manual payment recording"
// ---------------------------------------------------------------------------
//
// THESE TWO TESTS EXIST BECAUSE THE FLOW HAD NO CALLER. `recordManualPayment`
// and `useRecordPayment` were both written, both tested, and imported by
// nothing — so the app shipped with no way at all to record a collector taking
// cash or a cousin handing money back, which are the two situations the loans
// feature was written for. The DIRECTION assertion is the load-bearing half:
// the two directions of a loan are not one obligation, and a repayment written
// as an outflow corrupts the loan balance and the user's income detection at
// once (rules 8 and 17), with nothing on screen to announce either.
test("RECORDING A PAYMENT ON AN I-OWE LOAN WRITES MONEY OUT AND MOVES THE BALANCE", async () => {
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 600000,
  });
  mockParams = { id: loan.id };

  renderScreen(<LoanDetailScreen />);
  await screen.findByTestId("loan-record-payment");

  fireEvent.press(screen.getByTestId("loan-record-payment"));
  await screen.findByTestId("record-payment-sheet");
  typeAmount("loan-payment-amount", "500");
  fireEvent.press(screen.getByTestId(`loan-payment-wallet-${cash.id}`));
  fireEvent.press(screen.getByTestId("loan-payment-confirm"));

  await waitFor(async () => expect(await outstandingBalance(loan.id)).toBe(600000 - 50000));

  const written = await listTransactions({ walletId: cash.id });
  expect(written).toHaveLength(1);
  // `out`: money LEAVING pays a debt (rule 17, and `PaymentDirectionMismatchError`).
  expect(written[0].direction).toBe("out");
  expect(written[0].amount).toBe(50000);
  expect(written[0].source).toBe("manual");
  // Rule 18's default, which applies to I-owe loans only.
  expect(written[0].categoryId).toBe("cat_utang_loan_payments");
  // Rule 7: both writes or neither — the transaction is linked, not free-floating.
  expect((await listPayments(loan.id)).map((payment) => payment.transactionId)).toEqual([
    written[0].id,
  ]);
});

test("RECORDING A PAYMENT ON AN OWED-TO-ME LOAN WRITES MONEY IN AND MOVES THE BALANCE", async () => {
  const loan = await createLoan({
    direction: "owed-to-me",
    counterparty: "Kuya Ben",
    principal: 300000,
  });
  mockParams = { id: loan.id };

  renderScreen(<LoanDetailScreen />);
  await screen.findByTestId("loan-record-payment");
  // The copy flips with the loan, because the user did not pay anything here —
  // somebody paid THEM, and "Record a payment" over a form that will write money
  // INTO their wallet describes the wrong side of the transaction.
  screen.getByText("Record what they paid");

  fireEvent.press(screen.getByTestId("loan-record-payment"));
  await screen.findByTestId("record-payment-sheet");
  typeAmount("loan-payment-amount", "1000");
  fireEvent.press(screen.getByTestId(`loan-payment-wallet-${cash.id}`));
  fireEvent.press(screen.getByTestId("loan-payment-confirm"));

  await waitFor(async () => expect(await outstandingBalance(loan.id)).toBe(300000 - 100000));

  const written = await listTransactions({ walletId: cash.id });
  expect(written).toHaveLength(1);
  // `in`: money ARRIVING repays a loan owed to you. The user never chose this —
  // there is no direction control on the sheet at all.
  expect(written[0].direction).toBe("in");
  expect(written[0].amount).toBe(100000);
  // NOT the Utang category. Rule 18 is about I-owe loans; filing an arriving
  // repayment under the category that names the user's OWN debts is what makes
  // it read, in the ledger and in Reports, as if they had paid something.
  expect(written[0].categoryId).toBe(UNCATEGORIZED_ID);
});

// ---------------------------------------------------------------------------
// Balance adjustments — rule 13
// ---------------------------------------------------------------------------
test("AN ADJUSTMENT WITH A BLANK NOTE IS REFUSED IN WORDS, NOT BY THROWING", async () => {
  // `recordAdjustment` throws `AdjustmentNoteRequiredError` on a blank note and
  // should keep doing so — every caller must meet that rule. But an error class
  // is not a message: reaching the user, it is an unhandled rejection over a
  // half-filled form. The sheet checks first so the throw is unreachable from
  // here, and this test pins that the refusal is a sentence, that it says WHY,
  // and that nothing was written.
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });
  mockParams = { id: loan.id };

  renderScreen(<LoanDetailScreen />);
  await screen.findByTestId("loan-record-adjustment");

  fireEvent.press(screen.getByTestId("loan-record-adjustment"));
  await screen.findByTestId("balance-adjustment-sheet");
  typeAmount("loan-adjustment-amount", "150");
  fireEvent.press(screen.getByTestId("loan-adjustment-confirm"));

  await screen.findByTestId("loan-adjustment-note-error");
  screen.getByText(/only record of why the balance changed/);
  // Nothing written, and the sheet is still standing rather than torn down by a
  // thrown error the user never asked to see.
  expect(await listAdjustments(loan.id)).toEqual([]);
  expect(await outstandingBalance(loan.id)).toBe(500000);
  expect(screen.getByTestId("balance-adjustment-sheet")).toBeTruthy();
});

test("AN ADJUSTMENT MOVES THE BALANCE AND SHOWS IN HISTORY MARKED AS AN ADJUSTMENT", async () => {
  // Rule 12: "The app never applies penalties or late fees on its own; if the
  // lender charges one, the user records it as a balance adjustment." Rule 13
  // then requires it to appear "clearly marked as an adjustment, not a payment"
  // — so the marking and the note are asserted, not only the arithmetic.
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });
  mockParams = { id: loan.id };

  renderScreen(<LoanDetailScreen />);
  await screen.findByTestId("loan-record-adjustment");

  fireEvent.press(screen.getByTestId("loan-record-adjustment"));
  await screen.findByTestId("balance-adjustment-sheet");
  typeAmount("loan-adjustment-amount", "150");
  fireEvent.changeText(screen.getByTestId("loan-adjustment-note"), "Late fee from GLoan");
  fireEvent.press(screen.getByTestId("loan-adjustment-confirm"));

  // "Adds to what I owe" is the sheet's default, so the balance goes UP — the
  // one thing a payment can never do, and the reason the sign is asked in words
  // rather than typed.
  await waitFor(async () => expect(await outstandingBalance(loan.id)).toBe(500000 + 15000));

  const [adjustment] = await listAdjustments(loan.id);
  expect(adjustment.amount).toBe(15000);
  expect(adjustment.note).toBe("Late fee from GLoan");
  // NO LEDGER ROW, which is the whole difference from a payment: the money never
  // touched a wallet the app tracks, so writing one would leave that wallet's
  // balance wrong by exactly the amount.
  expect(await listTransactions({ walletId: cash.id })).toEqual([]);

  await screen.findByTestId(`loan-history-adjustment-${adjustment.id}`);
  screen.getByText("Adjustment");
  screen.getByText("Late fee from GLoan");
  screen.getByText(/Adjustment, not a payment/);
});
