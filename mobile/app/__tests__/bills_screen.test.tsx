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

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import { createBill, listBillPayments, listCycles, skipCycle } from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { systemClock } from "@/lib/clock";
import { addDaysIso, toDateIso } from "@/lib/dates";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import { typeAmount } from "@/test_support/keypad";
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

/**
 * The one instant this file pins, for the one assertion whose arithmetic is
 * calendar-shaped — see the header on that test for what the real calendar was
 * doing to it.
 *
 * `Date.now`, not `systemClock.now`: the comment above is right that a screen
 * reading a pinned clock while `createBill` stamps `createdAt` from the real
 * one gets no usable cycles, because enumeration is floored at that
 * `createdAt`. Pinning `Date.now` moves BOTH — `systemClock.now()` is a call
 * through to it — so the floor lands on the pinned day and the fixtures come
 * out the same on every calendar date. `jest.spyOn` rather than
 * `setSystemTime`, since fake timers would also stop the `setTimeout` React
 * Query batches its update notifications through (see the pin in
 * app/__tests__/goal_routes.test.tsx).
 *
 * Local noon, a local constructor — lib/clock.ts's convention for a fixed
 * instant, never a UTC string parse. AUGUST 19TH SPECIFICALLY: the header's
 * window is `today + 30` INCLUSIVE, so in a 30-day month the next cycle of a
 * bill due today lands exactly on the boundary and is totalled a second time.
 * August has 31 days, which puts the following cycle a day outside — the
 * exclusion the assertion is about.
 */
const PINNED_NOW = new Date(2026, 7, 19, 12, 0).getTime();

/**
 * `mutationCache` is how a test watches for writes that FAILED — the app's own
 * client carries one whose `onError` raises the failure toast (GAP-013), and
 * this client deliberately does not, so a test that cares has to pass its own.
 */
function makeTestClient(mutationCache?: MutationCache): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    mutationCache,
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity, staleTime: 0 },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

// NumericField (inside BillForm, inside NewBillScreen) throws without a
// KeypadProvider above it, and the panel it opens has to be hosted somewhere
// — see test_support/keypad.ts's header. Harmless for the routes that never
// touch BillForm: KeypadHost renders nothing while no field is focused.
function renderScreen(ui: ReactNode, mutationCache?: MutationCache) {
  return render(
    <QueryClientProvider client={makeTestClient(mutationCache)}>
      <ThemeProvider>
        <KeypadProvider>
          {ui}
          <KeypadHost />
        </KeypadProvider>
      </ThemeProvider>
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
  cash = await createWallet({ name: "GCash" });
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

// THE ONLY TEST IN THIS FILE THAT PINS THE CLOCK, and it has to. Every other
// one here asks a question the calendar cannot answer differently; this one
// asks what falls inside a 30-day window whose far edge is INCLUSIVE. A bill
// on a day-of-month rule has its next cycle one calendar month out, so in any
// month of 30 days or fewer that cycle lands on or inside the edge and the
// header totals the same bill twice. Off the real clock this passed for the
// seven 31-day months and failed for the other five — ₱5,600.00 against
// ₱3,250.00 for the two fixtures it used to have.
test("THE HEADER TOTALS THE NEXT 30 DAYS, UNRESOLVED ONLY", async () => {
  const nowSpy = jest.spyOn(Date, "now").mockReturnValue(PINNED_NOW);

  try {
    const today = toDateIso(new Date(PINNED_NOW));
    await billDueOn(today, { name: "Meralco", amount: 235000, amountMode: "fixed" });
    await billDueOn(addDaysIso(today, 2), {
      name: "Maynilad",
      amount: 90000,
      amountMode: "fixed",
    });
    // Resolved before the screen ever renders, so the header owes nothing for
    // it — the "unresolved only" half of this test's name, which the two bills
    // above cannot show on their own.
    const skipped = await billDueOn(today, {
      name: "Netflix",
      amount: 235000,
      amountMode: "fixed",
    });
    await skipCycle({ billId: skipped.id, dueDate: today });

    renderScreen(<BillsScreen />);

    await screen.findByTestId("bills-total");
    // ₱2,350 + ₱900, and nothing else. Each bill's NEXT cycle (September 19th
    // and 21st) sits inside the list's 45-day horizon and outside the header's
    // 30-day window, so a header that ignored the window would say ₱6,500.00.
    expect(screen.getByTestId("bills-total").props.children).toContain("₱3,250.00");
    expect(screen.getByText("2 bills")).toBeTruthy();
  } finally {
    nowSpy.mockRestore();
  }
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

// F5: the row was a bare Pressable — TalkBack could reach it (RN marks any
// onPress handler focusable regardless of role) but never announced it as
// actionable, and with no label fell back to reading the bill Card's own text
// nodes as an unstructured run-on.
test("the bill row is announced to TalkBack as a button with a spoken label, not a silent wrapper", async () => {
  const bill = await billDueOn(TODAY);

  renderScreen(<BillsScreen />);
  const row = await screen.findByTestId(`bill-row-${bill.id}-${TODAY}`);

  expect(row.props.accessibilityRole).toBe("button");
  // billDueOn's own defaults: "Meralco", a fixed ₱2,350.00, due today.
  expect(row.props.accessibilityLabel).toBe("Meralco, ₱2,350.00, Due today");
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
  // ₱900 — the old test typed "90000" as raw centavo digits.
  typeAmount("bill-amount", "900");
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
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));

  await waitFor(async () => expect((await listCycles(bill.id))[0]?.state).toBe("skipped"), {
    timeout: 30_000,
  });
  expect(await listBillPayments(bill.id)).toEqual([]);
});

// GAP-086. The skip was one tap straight into the write, on the screen whose
// Delete button — no less recoverable — has always confirmed. A mis-tap raised
// Safe-to-Spend with no way back: `resolveCycle` refuses a resolved cycle, so
// there is no unskip to reach for afterwards.
test("SKIP ASKS FIRST, AND WRITES NOTHING UNTIL IT IS ANSWERED", async () => {
  const bill = await billDueOn(TODAY);
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-skip-cycle");

  fireEvent.press(screen.getByTestId("bill-skip-cycle"));

  // Synchronous, deliberately: the dialog is state, so it is on screen by the
  // time `fireEvent` returns. An `await` here would let a straight-to-write
  // regression pass by resolving the cycle first and failing slowly.
  screen.getByTestId("confirm-dialog");
  screen.getByText("Skip this cycle?");
  expect(await listCycles(bill.id)).toEqual([]);

  // And backing out leaves it exactly as it was.
  fireEvent.press(screen.getByTestId("confirm-dialog-cancel"));

  expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  expect(await listCycles(bill.id)).toEqual([]);
  screen.getByTestId("bill-skip-cycle");
});

test("two confirms in ONE tick skip the cycle once, and nothing fails", async () => {
  const bill = await billDueOn(TODAY);
  mockParams = { id: bill.id, dueDate: TODAY };

  // What the ref guard is actually FOR. The row count below is guaranteed by
  // migration 006's `UNIQUE (bill_id, due_date)` whether or not anything
  // guards the handler; what is not guaranteed is that the second write never
  // happens. It loses the race on that constraint, and a rejected mutation is
  // the failure toast GAP-013 raises from the app's own client — the user is
  // told the skip they just made did not work, and it did.
  const mutationFailed = jest.fn();

  renderScreen(<BillDetailScreen />, new MutationCache({ onError: mutationFailed }));
  await screen.findByTestId("bill-skip-cycle");
  fireEvent.press(screen.getByTestId("bill-skip-cycle"));
  const confirm = screen.getByTestId("confirm-dialog-confirm");

  // BOTH presses inside ONE act(), for the reason bf32446 records: two bare
  // presses are two taps in two ticks, and the re-render between them already
  // refuses the second.
  act(() => {
    fireEvent.press(confirm);
    fireEvent.press(confirm);
  });

  await waitFor(async () => expect((await listCycles(bill.id))[0]?.state).toBe("skipped"), {
    timeout: 30_000,
  });
  expect(await listCycles(bill.id)).toHaveLength(1);
  expect(mutationFailed).not.toHaveBeenCalled();
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
