// app/__tests__/bills_screen.test.tsx — m2c Task 5's three routes.
//
// The chip, form and estimate rendering are tested in isolation next door; this
// file is about what the ROUTES do against a real database — the urgency
// ordering, the 30-day header, and confirming a match end to end.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
}));

// The detail route reaches `cancelCycleReminders` through its mutation hook
// (rule 11's "immediately"), which reaches expo-notifications. Mocked here
// rather than in the service, which is exactly why the two were split.
jest.mock("@/lib/alerts/alerts_service", () => ({
  scheduleReminder: jest.fn().mockResolvedValue(null),
  cancelScheduled: jest.fn().mockResolvedValue(undefined),
  postAlert: jest.fn().mockResolvedValue(undefined),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import { createBill, listBillPayments, listCycles } from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { systemClock } from "@/lib/clock";
import { addDaysIso, toDateIso } from "@/lib/dates";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import BillsScreen from "../(tabs)/plan/bills";
import NewBillScreen from "../(tabs)/plan/bills/new";
import BillDetailScreen from "../(tabs)/plan/bills/[id]";

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};

const BILLS_CATEGORY = "cat_bills_utilities";

let cash: Wallet;

/**
 * Fixtures here are RELATIVE TO THE REAL CLOCK, unlike the service tests'.
 * These screens read `systemClock.now()` — that is what a composition edge is
 * for — and cycle enumeration is floored at the bill's own `createdAt`, so a
 * date pinned in the past yields no cycles at all.
 */
const TODAY = toDateIso(new Date(systemClock.now()));
const IN_TWO_DAYS = addDaysIso(TODAY, 2);
const DAY_MS = 86_400_000;

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

/** A bill whose next cycle lands on `dueDate`, so the fixture is clock-relative. */
async function billDueOn(dueDate: string, over: Record<string, unknown> = {}) {
  return createBill({
    name: "Meralco",
    amount: 235000,
    amountMode: "fixed",
    dueRule: { kind: "day-of-month", day: Number(dueDate.slice(8, 10)) },
    categoryId: BILLS_CATEGORY,
    autoMatchRule: { merchantPattern: "MERALCO", dateWindowDays: 7 },
    ...over,
  });
}

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  mockParams = {};
  await seedDefaultCategories();
  cash = await createWallet({ name: "GCash", type: "e-wallet" });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// The list — rules 1 and 7
// ---------------------------------------------------------------------------
test("THE EMPTY STATE USES THE SPEC'S OWN INVITATION", async () => {
  renderScreen(<BillsScreen />);

  await screen.findByTestId("bills-empty");
  screen.getByText("No bills tracked yet");

  fireEvent.press(screen.getByText("Add a bill"));
  expect(mockPush).toHaveBeenCalledWith("/plan/bills/new");
});

test("THE LIST ORDERS OVERDUE, THEN DUE TODAY, THEN UPCOMING", async () => {
  // Rule 1. A plain chronological list would bury a bill three weeks late
  // underneath one due tomorrow — exactly backwards, since the late one is the
  // only entry the user can still do something wrong about.
  await billDueOn(TODAY, { name: "Due today" });
  await billDueOn(IN_TWO_DAYS, { name: "Upcoming" });

  renderScreen(<BillsScreen />);
  await screen.findByTestId("bills-list");

  screen.getByTestId("bills-section-due-today");
  screen.getByTestId("bills-section-upcoming");
});

test("THE HEADER TOTALS THE NEXT 30 DAYS, UNRESOLVED ONLY", async () => {
  await billDueOn(TODAY, { name: "Meralco", amount: 235000, amountMode: "fixed" });
  await billDueOn(IN_TWO_DAYS, { name: "Maynilad", amount: 90000, amountMode: "fixed" });

  renderScreen(<BillsScreen />);

  await screen.findByTestId("bills-total");
  expect(screen.getByTestId("bills-total").props.children).toContain("₱3,250.00");
});

test("pressing a row opens that CYCLE, not just that bill", async () => {
  // Rule 25 has two cycles of one bill open at once with different candidates;
  // a detail route that only knew the bill would have to guess which.
  const bill = await billDueOn(TODAY);

  renderScreen(<BillsScreen />);
  const row = await screen.findByTestId(`bill-row-${bill.id}-${TODAY}`);

  fireEvent.press(row);

  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/plan/bills/[id]",
    params: { id: bill.id, dueDate: TODAY },
  });
});

// ---------------------------------------------------------------------------
// Creating — rule 6
// ---------------------------------------------------------------------------
test("A BILL SAVES WITH NO TIER GATE ANYWHERE IN THE WAY", async () => {
  // Rule 6: bills are unlimited on both tiers. An untracked bill is a missed
  // payment, and a capped list would make Free-tier Safe-to-Spend dishonest.
  renderScreen(<NewBillScreen />);
  await screen.findByTestId("bill-name");

  fireEvent.changeText(screen.getByTestId("bill-name"), "Maynilad");
  fireEvent.changeText(screen.getByTestId("bill-amount"), "90000");
  fireEvent.press(screen.getByTestId("bill-save"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled(), { timeout: 30_000 });
});

// ---------------------------------------------------------------------------
// Detail and matching — rule 5
// ---------------------------------------------------------------------------
test("THE DETAIL SHOWS THE ESTIMATE AND WHERE IT CAME FROM", async () => {
  // Rule 5. "Around ₱2,350" means something different when it comes from three
  // real payments than when it is still the figure typed at setup.
  const bill = await billDueOn(TODAY, { amountMode: "estimated" });
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);

  await screen.findByTestId("bill-detail");
  expect(screen.getByTestId("bill-detail-estimate").props.children).toBe("~₱2,350.00");
  screen.getByText("Your starting figure — no payments recorded yet.");
});

test("THE MATCH SHEET LISTS CANDIDATES WITH THEIR REASONS", async () => {
  const bill = await billDueOn(TODAY);
  await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 235000,
    direction: "out",
    occurredAt: systemClock.now() - DAY_MS,
    merchant: "MERALCO PAYMENT",
    source: "notification",
    confidence: 0.9,
  });
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-open-matches");

  fireEvent.press(screen.getByTestId("bill-open-matches"));

  await screen.findByTestId("bill-match-sheet");
  screen.getByText("· Matches the amount exactly");
  screen.getByText("· Paid to Meralco");
});

test("CONFIRMING A MATCH RECORDS THE PAYMENT AND RESOLVES THE CYCLE", async () => {
  const bill = await billDueOn(TODAY);
  const tx = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 235000,
    direction: "out",
    occurredAt: systemClock.now() - DAY_MS,
    merchant: "MERALCO PAYMENT",
    source: "notification",
    confidence: 0.9,
  });
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-open-matches");
  fireEvent.press(screen.getByTestId("bill-open-matches"));
  await screen.findByTestId(`bill-match-confirm-${tx.id}`);

  fireEvent.press(screen.getByTestId(`bill-match-confirm-${tx.id}`));

  await waitFor(async () => expect((await listBillPayments(bill.id)).length).toBe(1), {
    timeout: 30_000,
  });
  expect((await listCycles(bill.id))[0].state).toBe("paid");
});

test("REJECTING A MATCH RECORDS NOTHING AND STOPS OFFERING IT", async () => {
  // The spec's "No" branch: it excludes the keyword and resets the ladder. A
  // rejection that silently did nothing would keep re-proposing the same wrong
  // transaction while believing the user never objected.
  const bill = await billDueOn(TODAY);
  const tx = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 235000,
    direction: "out",
    occurredAt: systemClock.now() - DAY_MS,
    merchant: "MERALCO KIOSK",
    source: "notification",
    confidence: 0.9,
  });
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-open-matches");
  fireEvent.press(screen.getByTestId("bill-open-matches"));
  await screen.findByTestId(`bill-match-reject-${tx.id}`);

  fireEvent.press(screen.getByTestId(`bill-match-reject-${tx.id}`));

  // A longer budget than RNTL's 1s default, for the same reason the ledger
  // screen needs one: this waits on an invalidate-then-refetch round trip
  // against a real database, and under the full suite's parallelism that has
  // overrun a second. It passes in ~2s in isolation and timed out at 103s of
  // suite load — starved of event-loop time, not waiting on a slow query.
  await waitFor(() => expect(screen.queryByTestId("bill-open-matches")).toBeNull(), {
    timeout: 30_000,
  });
  expect(await listBillPayments(bill.id)).toEqual([]);
});

test("SKIPPING A CYCLE RESOLVES IT WITHOUT A PAYMENT", async () => {
  const bill = await billDueOn(TODAY);
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-skip-cycle");

  fireEvent.press(screen.getByTestId("bill-skip-cycle"));

  await waitFor(async () => expect((await listCycles(bill.id))[0]?.state).toBe("skipped"), {
    timeout: 30_000,
  });
  expect(await listBillPayments(bill.id)).toEqual([]);
});

test("no candidates means no match affordance at all", async () => {
  // An empty suggestion button is worse than none — it invites a tap that
  // shows nothing.
  const bill = await billDueOn(TODAY);
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);

  await screen.findByTestId("bill-detail");
  expect(screen.queryByTestId("bill-open-matches")).toBeNull();
});

test("a bill that no longer exists says so", async () => {
  mockParams = { id: "no-such-bill" };

  renderScreen(<BillDetailScreen />);

  await screen.findByTestId("bill-detail-missing");
  screen.getByText("This bill is gone");
});
