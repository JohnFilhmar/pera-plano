// hooks/__tests__/use_payday_allocations.test.tsx — m2b Task 9, rule 2.
//
// EXTRACTED FROM app/__tests__/plan_hub.test.tsx (mobile-ui-revamp Part 2
// Task 7). That file bundled two unrelated subjects because m2b Task 9
// shipped them together: what the Plan hub invited the user into, and the
// payday → allocation hand-off `usePaydayAllocations` drives. Task 7 deletes
// the hub — a segmented control replaces it, and `getByText("Loans")` /
// `expect(mockPush)...` against a card list are now assertions about a screen
// that no longer exists — but this hook is not part of that screen. It is
// never rendered through `PlanScreen`; `app/_layout.tsx` calls it directly at
// the root, and every test below drives it with bare `renderHook`, no router
// mock and no `<PlanScreen />` in sight. Deleting the file it happened to live
// in would have deleted this coverage along with it for no reason connected
// to the hub going away, so it moves here instead — same tests, unchanged.
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { createGoal } from "@/lib/db/repos/goals_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { emitAppEvent } from "@/lib/events/app_events";
import { PAYDAY_EVENT } from "@/lib/income/income_service";
import { freshDb } from "@/test_support/db";
import { usePaydayAllocations } from "@/hooks/use_payday_allocations";

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
// The payday hand-off — rule 2
// ---------------------------------------------------------------------------
const PAYDAY = {
  transactionIds: ["tx-payday"],
  walletId: "w-payroll",
  amount: 1850000,
  occurredAt: Date.now(),
};

test("A PAYDAY WITH A CONTRIBUTION RULE PROPOSES AN ALLOCATION", async () => {
  const savings = await createWallet({ name: "GSave" });
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
  const savings = await createWallet({ name: "GSave" });
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
  const savings = await createWallet({ name: "GSave" });
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
  const savings = await createWallet({ name: "GSave" });
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
