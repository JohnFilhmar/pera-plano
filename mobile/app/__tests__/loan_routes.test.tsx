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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { createLoan, listLoans, outstandingBalance } from "@/lib/db/repos/loans_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import LoansScreen from "../(tabs)/plan/loans";
import NewLoanScreen from "../(tabs)/plan/loans/new";
import LoanDetailScreen from "../(tabs)/plan/loans/[id]";

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

function renderScreen(ui: ReactNode) {
  return render(
    <QueryClientProvider client={makeTestClient()}>
      <ThemeProvider>{ui}</ThemeProvider>
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
  fireEvent.changeText(screen.getByTestId("loan-principal"), "500000");
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

test("no candidates means no match button at all", async () => {
  // An empty suggestion affordance is worse than none — it invites a tap that
  // shows nothing.
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });
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
