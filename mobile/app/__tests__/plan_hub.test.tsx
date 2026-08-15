// app/__tests__/plan_hub.test.tsx — m2b Task 9.
//
// Two subjects: what the Plan hub invites the user into now that `goals` and
// `loans` have shipped, and the payday → allocation hand-off the shell wires up.
//
// The hand-off is tested through `usePaydayAllocations` rather than through the
// root layout. The shell needs fonts, a theme, an unlocked database and a
// finished bootstrap before it renders anything, so driving it here would test
// the shell; the hook is where the RULE lives.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { createGoal } from "@/lib/db/repos/goals_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { emitAppEvent } from "@/lib/events/app_events";
import { PAYDAY_EVENT } from "@/lib/income/income_service";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import { usePaydayAllocations } from "@/hooks/use_payday_allocations";

import PlanScreen from "../(tabs)/plan";

const mockPush = jest.fn();

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
  return render(<QueryClientProvider client={makeTestClient()}>{ui}</QueryClientProvider>);
}

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  __setTierForTests(null);
  await seedDefaultCategories();
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// The hub — rules 1 and 4
// ---------------------------------------------------------------------------
test("EVERY PLAN SECTION IS LIVE, AND NOTHING IS SOON", async () => {
  // m2c Task 6 rule 1: with Limits, Income, Goals, Loans and Bills all shipped
  // "the Plan tab has no Soon items left". This is the M2 control features
  // finished, asserted from the outside.
  renderScreen(<PlanScreen />);

  expect(screen.queryAllByTestId("soon-chip")).toHaveLength(0);

  for (const [section, route] of [
    ["limits", "/plan/limits"],
    ["goals", "/plan/goals"],
    ["loans", "/plan/loans"],
    ["bills", "/plan/bills"],
  ] as const) {
    mockPush.mockClear();
    fireEvent.press(screen.getByTestId(`plan-section-${section}`));
    expect(mockPush).toHaveBeenCalledWith(route);
  }
});

test("EVERY SECTION HAS A ROUTE, SO NONE CAN BE A DEAD END", async () => {
  // `SoonGate` is still wrapped around every section — a later plan adding one
  // must not have to rediscover where the gate goes — but with nothing soon it
  // no longer blocks anything, and a section whose `href` was forgotten would
  // now be a card that swallows taps in silence rather than an honest Soon chip.
  renderScreen(<PlanScreen />);

  for (const section of ["limits", "goals", "loans", "bills"]) {
    mockPush.mockClear();
    fireEvent.press(screen.getByTestId(`plan-section-${section}`));
    expect(mockPush).toHaveBeenCalledTimes(1);
  }
});

test("the hub still lists the IA's four sections, not five", async () => {
  // m2b Task 9 rule 4 names five, adding Income. IA §2's PlanTab subgraph is
  // explicit — "Plan hub: Limits, Goals, Loans, Bills" — and income is an
  // onboarding step (IA §5 step 7) reachable from the percent-of-income limit
  // flow. Same call as m2 Task 8, kept consistent.
  renderScreen(<PlanScreen />);

  screen.getByText("Limits");
  screen.getByText("Goals");
  screen.getByText("Loans");
  screen.getByText("Bills");
  expect(screen.queryByText("Income")).toBeNull();
});

// ---------------------------------------------------------------------------
// The payday hand-off — rule 2
// ---------------------------------------------------------------------------
const PAYDAY = {
  transactionId: "tx-payday",
  walletId: "w-payroll",
  amount: 1850000,
  occurredAt: Date.now(),
};

test("A PAYDAY WITH A CONTRIBUTION RULE PROPOSES AN ALLOCATION", async () => {
  const savings = await createWallet({ name: "GSave", type: "savings" });
  await createGoal({
    name: "Emergency Fund",
    targetAmount: 5000000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });

  const { result } = renderHook(() => usePaydayAllocations());
  await act(async () => {
    await emitAppEvent(PAYDAY_EVENT, PAYDAY);
  });

  // The summary comes first and the prompt waits behind it (m2-part2 Task 13
  // rule 5) — two sheets open at once would cover each other.
  expect(result.current.payday).toEqual(PAYDAY);
  expect(result.current.proposals).toEqual([]);

  act(() => result.current.acknowledgePayday());

  await waitFor(() => expect(result.current.proposals).toHaveLength(1));
  expect(result.current.proposals[0].amount).toBe(200000);
  expect(result.current.payday).toBeNull();
  // The sheet needs the payday's own figure to show "of ₱18,500.00", at the
  // exact moment `payday` has been cleared to make room for it.
  expect(result.current.paydayAmount).toBe(1850000);
});

test("THE SAME PAYDAY PROPOSES NOTHING ON THE FREE TIER", async () => {
  // Rule 2's "and the user is on Plus". The gate lives in
  // `proposePaydayAllocations` (docs/05 §3.2: the contributionRule is RETAINED,
  // only the prompt stops), so this hook needs no tier check of its own and
  // cannot drift out of step with the one the service applies.
  __setTierForTests("free");
  const savings = await createWallet({ name: "GSave", type: "savings" });
  await createGoal({
    name: "Emergency Fund",
    targetAmount: 5000000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });

  const { result } = renderHook(() => usePaydayAllocations());
  await act(async () => {
    await emitAppEvent(PAYDAY_EVENT, PAYDAY);
  });
  act(() => result.current.acknowledgePayday());

  // The payday itself is still announced — only the allocation prompt is Plus.
  expect(result.current.proposals).toEqual([]);
});

test("a payday with no contribution rules announces itself and proposes nothing", async () => {
  const savings = await createWallet({ name: "GSave", type: "savings" });
  await createGoal({ name: "Emergency Fund", targetAmount: 5000000, linkedWalletId: savings.id });

  const { result } = renderHook(() => usePaydayAllocations());
  await act(async () => {
    await emitAppEvent(PAYDAY_EVENT, PAYDAY);
  });

  expect(result.current.payday).toEqual(PAYDAY);
  act(() => result.current.acknowledgePayday());
  expect(result.current.proposals).toEqual([]);
});

test("dismissing the allocations clears everything", async () => {
  const savings = await createWallet({ name: "GSave", type: "savings" });
  await createGoal({
    name: "Emergency Fund",
    targetAmount: 5000000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });

  const { result } = renderHook(() => usePaydayAllocations());
  await act(async () => {
    await emitAppEvent(PAYDAY_EVENT, PAYDAY);
  });
  act(() => result.current.acknowledgePayday());
  await waitFor(() => expect(result.current.proposals).toHaveLength(1));

  act(() => result.current.dismissAllocations());

  expect(result.current.proposals).toEqual([]);
  expect(result.current.payday).toBeNull();
});

test("A FAILING PROPOSAL STILL LETS THE PAYDAY BE ANNOUNCED", async () => {
  // A payday is worth telling the user about even if the goal side breaks.
  // Letting the error escape would take the whole event handler down and lose
  // the summary too — and `emitAppEvent` would log a handler failure instead.
  await closeDatabase(); // every repository read now throws
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  const { result } = renderHook(() => usePaydayAllocations());
  await act(async () => {
    await emitAppEvent(PAYDAY_EVENT, PAYDAY);
  });

  expect(result.current.payday).toEqual(PAYDAY);
  await waitFor(() => expect(warn).toHaveBeenCalled());
  warn.mockRestore();
  await freshDb();
});
