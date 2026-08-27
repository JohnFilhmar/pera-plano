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

// DateField (inside GoalForm, for the optional deadline) imports the native
// picker at module load regardless of whether a test ever opens it — matches
// components/ui/__tests__/date_field.test.tsx's own mock and
// loan_form.test.tsx's. `mock`-prefixed so babel-plugin-jest-hoist allows the
// factory to close over it. Captures the `minimumDate` the real picker would
// have received, so a test can assert the bound is actually wired up (same
// pattern as numeric-input-system Task 10's `loan-first-due`).
let mockPickedDate = new Date(2026, 7, 13);
let mockReceivedMinimumDate: Date | undefined;

jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({
      onChange,
      minimumDate,
    }: {
      onChange: (event: { type: string }, date?: Date) => void;
      minimumDate?: Date;
    }) => {
      mockReceivedMinimumDate = minimumDate;
      return (
        <Pressable testID="date-picker-pick" onPress={() => onChange({ type: "set" }, mockPickedDate)}>
          <Text>pick</Text>
        </Pressable>
      );
    },
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { createGoal, listGoals } from "@/lib/db/repos/goals_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import { typeAmount } from "@/test_support/keypad";
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

// NumericField (inside GoalForm's target and auto-move fields) throws without
// a KeypadProvider above it, and the panel it opens has to be hosted
// somewhere — see test_support/keypad.ts's header. Harmless for the routes
// that never touch GoalForm: KeypadHost renders nothing while no field is
// focused.
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

/** Opens the deadline field, mock-picks the given local day, and closes the dialog. */
function pickDate(testID: string, year: number, month: number, day: number): void {
  mockPickedDate = new Date(year, month - 1, day);
  fireEvent.press(screen.getByTestId(testID));
  fireEvent.press(screen.getByTestId("date-picker-pick"));
}

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  mockParams = {};
  __setTierForTests(null);
  await seedDefaultCategories();
  gsave = await createWallet({ name: "GSave" });
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

// F5: the row was a bare Pressable — TalkBack could reach it (RN marks any
// onPress handler focusable regardless of role) but never announced it as
// actionable, and with no label fell back to reading GoalCard's own text
// nodes as an unstructured run-on.
test("the goal row is announced to TalkBack as a button with a spoken label, not a silent wrapper", async () => {
  const funded = await createWallet({
    name: "GSave Funded",
    openingBalance: 2500000,
  });
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5000000,
    linkedWalletId: funded.id,
  });

  renderScreen(<GoalsScreen />);

  const row = await screen.findByTestId(`goal-row-${goal.id}`);
  expect(row.props.accessibilityRole).toBe("button");
  // Matches what GoalCard actually draws for this fixture (goal_card.test.tsx's
  // own "50%" / "₱25,000.00 of ₱50,000.00" for the identical saved/target pair).
  expect(row.props.accessibilityLabel).toBe(
    "Emergency Fund goal, 50% saved, ₱25,000.00 of ₱50,000.00 saved",
  );
});

// F4: the AUTO chip rendered on goal detail but never on this list, though the
// list already holds `status.goal.contributionRule` — the identical field.
test("a goal with an automatic contribution rule shows the AUTO chip on the list, not only on detail", async () => {
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });

  renderScreen(<GoalsScreen />);

  await screen.findByTestId(`goal-card-${goal.id}-auto`);
  screen.getByText("AUTO");
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
  // Name and target, still no wallet. ₱50,000 — the old test typed "5000000"
  // as raw centavo digits.
  typeAmount("goal-target", "50000");
  fireEvent.press(screen.getByTestId("goal-save"));

  await waitFor(async () => expect(await listGoals()).toEqual([]));
  expect(mockBack).not.toHaveBeenCalled();
});

test("a complete form creates the goal", async () => {
  renderScreen(<NewGoalScreen />);
  await screen.findByTestId(`goal-wallet-${gsave.id}`);

  fireEvent.changeText(screen.getByTestId("goal-name"), "Emergency Fund");
  // ₱50,000 — the old test typed "5000000" as raw centavo digits.
  typeAmount("goal-target", "50000");
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
  const spending = await createWallet({ name: "GCash" });
  const taken = await createWallet({ name: "SeaBank" });
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

test("the contribution rule shows the unlocked badge on Plus, not a gate", async () => {
  __setTierForTests("plus");

  renderScreen(<NewGoalScreen />);

  await screen.findByTestId("goal-rule-amount");
  screen.getByTestId("plus-badge");
  expect(screen.queryByTestId("plus-gate")).toBeNull();
});

test("a contribution amount is saved as a fixed rule", async () => {
  __setTierForTests("plus");
  renderScreen(<NewGoalScreen />);
  await screen.findByTestId(`goal-wallet-${gsave.id}`);

  fireEvent.changeText(screen.getByTestId("goal-name"), "Emergency Fund");
  // ₱50,000 target, ₱2,000 contribution — the old test typed "5000000" and
  // "200000" as raw centavo digits.
  typeAmount("goal-target", "50000");
  fireEvent.press(screen.getByTestId(`goal-wallet-${gsave.id}`));
  typeAmount("goal-rule-amount", "2000");
  fireEvent.press(screen.getByTestId("goal-save"));

  await waitFor(async () => expect((await listGoals()).length).toBe(1));
  expect((await listGoals())[0].contributionRule).toEqual({ kind: "fixed", amount: 200000 });
});

// ---------------------------------------------------------------------------
// The deadline field — numeric-input-system Task 11
// ---------------------------------------------------------------------------
test("the deadline picker's floor is today, so a past date cannot be picked", async () => {
  // GoalForm has no injected clock (no `now`/`today` prop) — it reads
  // `new Date()` directly for minimumDate. Freeze the wall clock so this
  // assertion is not flaky against whatever instant the suite runs at.
  // goal-target-date is present on the very first synchronous render, unlike
  // the wallet-dependent fields elsewhere in this file, so the assertion
  // itself needs no `await`.
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 7, 19, 9, 0));
  try {
    renderScreen(<NewGoalScreen />);

    fireEvent.press(screen.getByTestId("goal-target-date"));

    expect(mockReceivedMinimumDate).toEqual(new Date(2026, 7, 19, 9, 0));
  } finally {
    jest.useRealTimers();
  }
  // renderScreen still kicked off real (SQLite-backed) useWallets/useGoals
  // queries. React Query batches its update notification through a
  // setTimeout, which fake timers above would have blocked — awaiting this,
  // AFTER real timers are restored, lets that update land inside this test's
  // act scope instead of leaking into whichever test runs next.
  await screen.findByTestId(`goal-wallet-${gsave.id}`);
});

test("a picked deadline is saved as the goal's target date", async () => {
  renderScreen(<NewGoalScreen />);
  await screen.findByTestId(`goal-wallet-${gsave.id}`);

  fireEvent.changeText(screen.getByTestId("goal-name"), "Emergency Fund");
  typeAmount("goal-target", "50000");
  fireEvent.press(screen.getByTestId(`goal-wallet-${gsave.id}`));
  pickDate("goal-target-date", 2027, 6, 1);
  fireEvent.press(screen.getByTestId("goal-save"));

  await waitFor(async () => expect((await listGoals()).length).toBe(1));
  expect((await listGoals())[0].targetDate).toBe("2027-06-01");
});
