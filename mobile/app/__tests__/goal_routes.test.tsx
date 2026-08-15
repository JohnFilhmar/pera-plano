// app/__tests__/goal_routes.test.tsx — m2b Task 4's three routes.
//
// The card and the allocation sheet are tested in isolation next door; this
// file is about what the ROUTES do against a real database — the entitlement
// gate, invariant I10's wallet filtering, and the dead end rule 3 exists to
// prevent.
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
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { createGoal, listGoals } from "@/lib/db/repos/goals_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import GoalsScreen from "../(tabs)/plan/goals";
import NewGoalScreen from "../(tabs)/plan/goals/new";

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};

let gsave: Wallet;

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
  gsave = await createWallet({ name: "GSave", type: "savings" });
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------
test("the empty state names the action, not the absence", async () => {
  // Rule 7's copy. "No goals yet" alone tells the user something they can see.
  renderScreen(<GoalsScreen />);

  await screen.findByTestId("goals-empty");
  screen.getByText("No goals yet");
  fireEvent.press(screen.getByText("Create a goal"));
  expect(mockPush).toHaveBeenCalledWith("/plan/goals/new");
});

test("a goal renders as a card and opens its detail route", async () => {
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
  });

  renderScreen(<GoalsScreen />);

  await screen.findByTestId(`goal-card-${goal.id}`);
  screen.getByText("Emergency Fund");

  fireEvent.press(screen.getByTestId(`goal-row-${goal.id}`));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/plan/goals/[id]",
    params: { id: goal.id },
  });
});

test("A SECOND GOAL ON THE FREE TIER IS GATED, and the first is untouched", async () => {
  // Rule 4, and m2 Global Constraint 11: a cap blocks a NEW record and never
  // deletes data.
  __setTierForTests("free");
  const existing = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
  });

  renderScreen(<GoalsScreen />);
  await screen.findByTestId("goals-add");

  fireEvent.press(screen.getByTestId("goals-add"));

  expect(mockPush).toHaveBeenCalledWith("/plan/goals/new?gated=1");
  expect((await listGoals()).map((goal) => goal.id)).toEqual([existing.id]);
});

test("the gated route explains the cap and shows no form", async () => {
  mockParams = { gated: "1" };

  renderScreen(<NewGoalScreen />);

  await screen.findByTestId("goals-gated");
  screen.getByText("Goal cap reached");
  expect(screen.queryByTestId("goal-name")).toBeNull();
});

// ---------------------------------------------------------------------------
// The create form — rules 3 and 5
// ---------------------------------------------------------------------------
test("THE FORM REQUIRES A NAME, A TARGET AND A WALLET", async () => {
  renderScreen(<NewGoalScreen />);
  await screen.findByTestId("goal-name");

  // Nothing filled in.
  fireEvent.press(screen.getByTestId("goal-save"));
  // Name only.
  fireEvent.changeText(screen.getByTestId("goal-name"), "Emergency Fund");
  fireEvent.press(screen.getByTestId("goal-save"));
  // Name and target, still no wallet.
  fireEvent.changeText(screen.getByTestId("goal-target"), "5000000");
  fireEvent.press(screen.getByTestId("goal-save"));

  await waitFor(async () => expect(await listGoals()).toEqual([]));
  expect(mockBack).not.toHaveBeenCalled();
});

test("a complete form creates the goal", async () => {
  renderScreen(<NewGoalScreen />);
  await screen.findByTestId(`goal-wallet-${gsave.id}`);

  fireEvent.changeText(screen.getByTestId("goal-name"), "Emergency Fund");
  fireEvent.changeText(screen.getByTestId("goal-target"), "5000000");
  fireEvent.press(screen.getByTestId(`goal-wallet-${gsave.id}`));
  fireEvent.press(screen.getByTestId("goal-save"));

  await waitFor(async () => expect((await listGoals()).length).toBe(1));
  const [saved] = await listGoals();
  expect(saved.name).toBe("Emergency Fund");
  expect(saved.targetAmount).toBe(5000000); // ₱50,000.00, from the digits
  expect(saved.linkedWalletId).toBe(gsave.id);
  // An empty date field is NO deadline, not an invalid one (repo rule 4).
  expect(saved.targetDate).toBeNull();
  expect(mockBack).toHaveBeenCalled();
});

test("ONLY UNCLAIMED SAVINGS WALLETS ARE OFFERED", async () => {
  // Invariant I10, both halves, enforced before the user can trip it: a
  // spending wallet is not a savings wallet, and a savings wallet another goal
  // already backs would each claim the same pesos.
  const spending = await createWallet({ name: "GCash", type: "e-wallet" });
  const taken = await createWallet({ name: "SeaBank", type: "savings" });
  await createGoal({ name: "Taken", targetAmount: 100000, linkedWalletId: taken.id });

  renderScreen(<NewGoalScreen />);

  await screen.findByTestId(`goal-wallet-${gsave.id}`);
  expect(screen.queryByTestId(`goal-wallet-${spending.id}`)).toBeNull();
  expect(screen.queryByTestId(`goal-wallet-${taken.id}`)).toBeNull();
});

test("WITH NO SAVINGS WALLET THE FORM OFFERS TO MAKE ONE", async () => {
  // Rule 3, and the reason for it: a first-time user has no savings wallet, and
  // a picker showing nothing is a dead end at the exact moment they decided to
  // start saving.
  await freshDb();
  await seedDefaultCategories();

  renderScreen(<NewGoalScreen />);

  await screen.findByTestId("goal-no-wallets");
  fireEvent.press(screen.getByTestId("goal-create-wallet"));
  // Hands off to the flow that already knows how to make a wallet, rather than
  // reimplementing wallet creation inside a goal form.
  expect(mockPush).toHaveBeenCalledWith("/wallet/new");
});

test("THE CONTRIBUTION RULE CARRIES THE PLUS BADGE ON FREE", async () => {
  // Rule 5. PlusGate renders the field in normal colours with a badge — never
  // desaturated, which is SoonGate's meaning for "designed, not built".
  __setTierForTests("free");

  renderScreen(<NewGoalScreen />);

  await screen.findByTestId("plus-badge");
  // The field is still visible and explained, not hidden.
  screen.getByText("Move money automatically on payday");
});

test("the contribution rule is plain on Plus", async () => {
  __setTierForTests("plus");

  renderScreen(<NewGoalScreen />);

  await screen.findByTestId("goal-rule-amount");
  expect(screen.queryByTestId("plus-badge")).toBeNull();
});

test("a contribution amount is saved as a fixed rule", async () => {
  __setTierForTests("plus");
  renderScreen(<NewGoalScreen />);
  await screen.findByTestId(`goal-wallet-${gsave.id}`);

  fireEvent.changeText(screen.getByTestId("goal-name"), "Emergency Fund");
  fireEvent.changeText(screen.getByTestId("goal-target"), "5000000");
  fireEvent.press(screen.getByTestId(`goal-wallet-${gsave.id}`));
  fireEvent.changeText(screen.getByTestId("goal-rule-amount"), "200000");
  fireEvent.press(screen.getByTestId("goal-save"));

  await waitFor(async () => expect((await listGoals()).length).toBe(1));
  expect((await listGoals())[0].contributionRule).toEqual({ kind: "fixed", amount: 200000 });
});
