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
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import {
  createBill,
  listBillPayments,
  listCycles,
  recordBillPayment,
  resolveCycleExternally,
  skipCycle,
} from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { systemClock } from "@/lib/clock";
import { addDaysIso, toDateIso } from "@/lib/dates";
import { formatDate } from "@/lib/datetime";
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

// GAP-065. Every history row printed `status.estimate.amount` — ONE figure
// computed for the whole bill and copied onto each of its cycles — so a bill
// paid ₱2,100 one month and ₱2,600 the next showed two rows of the same
// number, and neither was a number the user had ever paid. The spec calls this
// list "payment history (matched transactions)", and the matched transaction
// is where both the amount and the date actually live.
//
// A FIXED bill, so the estimate is pinned to what was typed at setup and
// cannot drift into agreeing with either payment. Scoped with `within`,
// because the estimate is on this screen twice already — the row at the top
// and the Expected card — and an unscoped query would find one of those.
test("EACH HISTORY ROW SHOWS ITS OWN PAYMENT, NOT THE BILL'S ESTIMATE", async () => {
  const bill = await billDueOn(TODAY);
  const cheaperDue = addDaysIso(TODAY, -60);
  const dearerDue = addDaysIso(TODAY, -30);
  const cheaper = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 210000,
    direction: "out",
    occurredAt: systemClock.now() - 59 * DAY_MS,
    merchant: "MERALCO PAYMENT",
    source: "notification",
    confidence: 0.9,
  });
  const dearer = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 260000,
    direction: "out",
    occurredAt: systemClock.now() - 29 * DAY_MS,
    merchant: "MERALCO PAYMENT",
    source: "notification",
    confidence: 0.9,
  });
  await recordBillPayment({ billId: bill.id, dueDate: cheaperDue, transactionId: cheaper.id });
  await recordBillPayment({ billId: bill.id, dueDate: dearerDue, transactionId: dearer.id });
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-detail");

  const cheaperRow = within(await screen.findByTestId(`bill-history-${cheaperDue}`));
  cheaperRow.getByText("₱2,100.00");
  // The TRANSACTION's date, not the payment row's `createdAt` — that is when
  // the match was made, which for both of these is right now.
  cheaperRow.getByText(`Paid ${formatDate(cheaper.occurredAt)}`);

  const dearerRow = within(screen.getByTestId(`bill-history-${dearerDue}`));
  dearerRow.getByText("₱2,600.00");
  dearerRow.getByText(`Paid ${formatDate(dearer.occurredAt)}`);

  // Untouched, and still the ₱2,350.00 the user set — the figure both rows
  // above used to print in place of what was paid.
  expect(screen.getByTestId("bill-detail-estimate").props.children).toBe("₱2,350.00");
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

// ₱2,410.00 AGAINST A ₱2,350.00 BILL, and the merchant is what makes it a
// candidate — the amount is only ever a scoring reason (the rejection test
// below matches on "MERALCO KIOSK" with no amount agreement at all). An exact
// ₱2,350.00 here would have made the rendered history row unreadable as
// evidence: it is the estimate as well, so the row would look right whether
// the screen printed the payment or the estimate, which is precisely the bug
// GAP-065 fixed one test above.
test("CONFIRMING A MATCH RECORDS THE PAYMENT, RESOLVES THE CYCLE, AND SHOWS IT IN HISTORY", async () => {
  const bill = await billDueOn(TODAY);
  const tx = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 241000,
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

  // AND ON SCREEN. Two rows in `bill_payments` is not what the user gets out
  // of confirming a match — a history entry is, and the write landing while
  // the screen never refetches is a real failure mode this test could not see.
  const row = within(await screen.findByTestId(`bill-history-${TODAY}`));
  row.getByText("₱2,410.00");
  row.getByText(`Paid ${formatDate(tx.occurredAt)}`);
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

// ---------------------------------------------------------------------------
// Paid outside my wallets — the spec's third mark-paid option (GAP-085)
// ---------------------------------------------------------------------------
// The cash payer had no truthful action on this screen. Leaving the cycle open
// keeps it subtracting from Safe-to-Spend for a bill that is paid; skipping it
// clears the number but records "no payment was expected", which is not what
// happened. `resolved_external` has been in the schema since migration 006 and
// nothing in the app could write it.
test("PAID OUTSIDE MY WALLETS SETTLES THE CYCLE, AND THE USER SEES IT SETTLE", async () => {
  const bill = await billDueOn(TODAY);
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-paid-externally");

  fireEvent.press(screen.getByTestId("bill-paid-externally"));
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));

  await waitFor(
    async () => expect((await listCycles(bill.id))[0]?.state).toBe("resolved_external"),
    { timeout: 30_000 },
  );

  // AND THE SCREEN SAYS SO. A write nobody can see on the screen that made it
  // is the failure this campaign has caught before: the state is right, the
  // estimator is untouched, and the user is looking at a cycle that still
  // offers to settle itself. "Settled elsewhere" is `due_chip.tsx`'s word for
  // this state and is deliberately not "Paid" — no transaction to open.
  await waitFor(() => screen.getByText("Settled elsewhere"), { timeout: 30_000 });
  expect(screen.queryByTestId("bill-paid-externally")).toBeNull();
  expect(screen.queryByTestId("bill-skip-cycle")).toBeNull();
});

test("PAID OUTSIDE MY WALLETS WRITES NO PAYMENT AND NO TRANSACTION", async () => {
  // The entry's one "do not": a synthetic transaction for the cash would
  // double-count against every limit, every category total and Safe-to-Spend's
  // committed spend.
  const bill = await billDueOn(TODAY);
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-paid-externally");

  fireEvent.press(screen.getByTestId("bill-paid-externally"));
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));

  await waitFor(
    async () => expect((await listCycles(bill.id))[0]?.state).toBe("resolved_external"),
    { timeout: 30_000 },
  );
  expect(await listBillPayments(bill.id)).toEqual([]);
  expect(await listTransactions({})).toEqual([]);
  expect((await listCycles(bill.id))[0]?.billPaymentId).toBeNull();
});

test("PAID OUTSIDE MY WALLETS ASKS FIRST, AND WRITES NOTHING UNTIL IT IS ANSWERED", async () => {
  // Same one-way write as the skip beside it (GAP-086): `resolveCycle` refuses
  // to re-resolve, so there is nothing to reach for after a mis-tap.
  const bill = await billDueOn(TODAY);
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-paid-externally");

  fireEvent.press(screen.getByTestId("bill-paid-externally"));

  screen.getByTestId("confirm-dialog");
  screen.getByText("Already paid this one?");
  expect(await listCycles(bill.id)).toEqual([]);

  fireEvent.press(screen.getByTestId("confirm-dialog-cancel"));

  expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  expect(await listCycles(bill.id)).toEqual([]);
  screen.getByTestId("bill-paid-externally");
});

// THE NEW STATE MADE AN OLD LINE WRONG. The screen picks the soonest
// UNRESOLVED cycle when the link carries no `dueDate` — a notification tap, a
// bare bill link — and that predicate excluded only `paid` and `skipped`.
// Nothing could write `resolved_external`, so the omission cost nothing; the
// moment this feature exists it opens a settled cycle with every action already
// spent and no way to reach the one still owed.
test("WITHOUT A CYCLE IN THE LINK, A SETTLED CYCLE IS NOT THE ONE THAT OPENS", async () => {
  const bill = await billDueOn(TODAY);
  await resolveCycleExternally({ billId: bill.id, dueDate: TODAY });
  mockParams = { id: bill.id };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-detail");

  // Next month's cycle, which is still owed — not the one just settled.
  expect(screen.queryByText("Settled elsewhere")).toBeNull();
  screen.getByTestId("bill-paid-externally");
  screen.getByTestId("bill-skip-cycle");
});

test("two confirms in ONE tick settle the cycle once, and nothing fails", async () => {
  const bill = await billDueOn(TODAY);
  mockParams = { id: bill.id, dueDate: TODAY };

  const mutationFailed = jest.fn();

  renderScreen(<BillDetailScreen />, new MutationCache({ onError: mutationFailed }));
  await screen.findByTestId("bill-paid-externally");
  fireEvent.press(screen.getByTestId("bill-paid-externally"));
  const confirm = screen.getByTestId("confirm-dialog-confirm");

  act(() => {
    fireEvent.press(confirm);
    fireEvent.press(confirm);
  });

  await waitFor(
    async () => expect((await listCycles(bill.id))[0]?.state).toBe("resolved_external"),
    { timeout: 30_000 },
  );
  expect(await listCycles(bill.id)).toHaveLength(1);
  expect(mutationFailed).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// The rule rows the spec lists and the screen never drew (GAP-085)
// ---------------------------------------------------------------------------
test("THE DETAIL RENDERS THE DUE RULE, THE REMINDER SCHEDULE AND THE AUTO-MATCH SUMMARY", async () => {
  // docs/04-features/07-bills.md, Bill detail: "Due rule in plain words ...,
  // amount and its type, reminder schedule, payment history (matched
  // transactions), auto-match rule summary". Three of the five were nowhere in
  // the app; every one is a setting made once at creation and never seen again.
  //
  // The reminder and match strings are clock-independent; the due rule is not,
  // so it is checked for the day `billDueOn` actually used. The exact wording
  // of every rule form is pinned in components/bills/__tests__.
  const bill = await billDueOn(TODAY);
  mockParams = { id: bill.id, dueDate: TODAY };

  renderScreen(<BillDetailScreen />);
  await screen.findByTestId("bill-rules");

  const due = screen.getByTestId("bill-rule-due").props.children as string;
  expect(due.startsWith("Every ")).toBe(true);
  expect(due).toContain(String(Number(TODAY.slice(8, 10))));

  // Rule 10's default, applied by `createBill` without anyone asking for it.
  expect(screen.getByTestId("bill-rule-reminders").props.children).toBe(
    "3 days before and on the due date.",
  );
  // Rule 13's "merchant keyword set + amount tolerance + date window", and the
  // ladder position, which is otherwise invisible. ₱70.50 is rule 14's 3% of a
  // FIXED ₱2,350.00 — the estimated band would be ₱705.00.
  expect(screen.getByTestId("bill-rule-automatch").props.children).toBe(
    'Looks for "MERALCO" in what you spend.',
  );
  expect(screen.getByTestId("bill-rule-tolerance").props.children).toBe(
    "Amounts within ₱70.50 of the expected figure.",
  );
  expect(screen.getByTestId("bill-rule-window").props.children).toBe(
    "From 7 days before the due date to 15 days after — 30 days once it is overdue.",
  );
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
