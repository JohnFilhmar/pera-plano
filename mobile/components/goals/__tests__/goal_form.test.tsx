// components/goals/__tests__/goal_form.test.tsx — rule 13's two rule kinds.
//
// THE FORM COULD ONLY EVER PRODUCE A FIXED RULE. `ContributionRule` has had a
// `percent` variant since m2b, `goals_service.ts`'s `requestedFor` and
// `safe_to_spend_service.ts`'s `contributionAmount` both read it, and docs/04
// rule 13 promises "a fixed ₱ amount or a percent of payday income" — but the
// only control on this form was a peso field, so the percent half was
// unreachable, and an existing percent rule that reached the EDIT form matched
// no branch and was written back as `null`.
//
// The routes are covered next door in app/__tests__/goal_routes.test.tsx
// (against a real database); this file drives the component directly, which is
// where the rule payload is actually built.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { __setTierForTests } from "@/lib/entitlements";
import { typeAmount } from "@/test_support/keypad";
import type { Wallet } from "@/types/domain";

import { GoalForm } from "../goal_form";
import type { GoalFormValues } from "../goal_form";

// DateField (the optional deadline) imports the native picker at module load
// whether or not a test ever opens it — the same mock loan_form.test.tsx and
// goal_routes.test.tsx both carry.
jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ onChange }: { onChange: (event: { type: string }, date?: Date) => void }) => (
      <Pressable
        testID="date-picker-pick"
        onPress={() => onChange({ type: "set" }, new Date(2026, 7, 13))}
      >
        <Text>pick</Text>
      </Pressable>
    ),
  };
});

const gsave: Wallet = {
  id: "w-gsave",
  name: "GSave",
  balance: 500_000,
  currency: "PHP",
  isArchived: false,
  driftDismissedTransactionId: null,
  owedBalance: false,
  owedPinned: false,
  matcherCount: 1,
  createdAt: 1_000,
  updatedAt: 1_000,
};

// NumericField throws without a KeypadProvider above it, and the panel it
// opens has to be hosted somewhere — see test_support/keypad.ts's header.
function renderForm(initial?: GoalFormValues) {
  const onSubmit = jest.fn();
  render(
    <KeypadProvider>
      <GoalForm
        availableWallets={[gsave]}
        onSubmit={onSubmit}
        onCreateWallet={jest.fn()}
        initial={initial}
      />
      <KeypadHost />
    </KeypadProvider>,
  );
  return { onSubmit };
}

const submitted = (onSubmit: jest.Mock): GoalFormValues => onSubmit.mock.calls[0][0];

beforeEach(() => {
  // The contribution rule is PlusGated; on free the gate wraps it in a
  // `pointerEvents="none"` view and the fields cannot be driven at all.
  __setTierForTests("plus");
});

afterEach(() => {
  __setTierForTests(null);
});

test("THE PESO FIELD IS THE DEFAULT, so the fixed rule is unchanged", () => {
  // A create form opens on ₱, the shape every existing goal was made with.
  const { onSubmit } = renderForm();

  screen.getByTestId("goal-rule-amount");
  expect(screen.queryByTestId("goal-rule-percent")).toBeNull();

  fireEvent.changeText(screen.getByTestId("goal-name"), "Emergency Fund");
  typeAmount("goal-target", "50000");
  fireEvent.press(screen.getByTestId(`goal-wallet-${gsave.id}`));
  typeAmount("goal-rule-amount", "2000");
  fireEvent.press(screen.getByTestId("goal-save"));

  expect(submitted(onSubmit).contributionRule).toEqual({ kind: "fixed", amount: 200000 });
});

test("A PERCENT-OF-PAYDAY RULE CAN BE CREATED — rule 13's other half", () => {
  const { onSubmit } = renderForm();

  fireEvent.press(screen.getByTestId("goal-rule-kind-percent"));
  // The peso field is gone, so there is no second amount to disagree with.
  expect(screen.queryByTestId("goal-rule-amount")).toBeNull();

  fireEvent.changeText(screen.getByTestId("goal-name"), "Emergency Fund");
  typeAmount("goal-target", "50000");
  fireEvent.press(screen.getByTestId(`goal-wallet-${gsave.id}`));
  typeAmount("goal-rule-percent", "10");
  fireEvent.press(screen.getByTestId("goal-save"));

  // 10, not 1000: `percent` is a PLAIN percentage, unlike Limit.value.
  expect(submitted(onSubmit).contributionRule).toEqual({ kind: "percent", percent: 10 });
});

test("EDITING A PERCENT GOAL PRESERVES IT — the form must not rewrite the kind", () => {
  const { onSubmit } = renderForm({
    name: "Emergency Fund",
    targetAmount: 5000000,
    targetDate: null,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "percent", percent: 10 },
  });

  // Seeded on the percent segment with the stored figure, not on ₱ with a
  // blank field — which is what silently dropped the rule on save.
  expect(screen.getByTestId("goal-rule-kind-percent").props.accessibilityState.selected).toBe(true);
  expect(screen.queryByTestId("goal-rule-amount")).toBeNull();
  expect(screen.getByTestId("goal-rule-percent").props.accessibilityLabel).toBe(
    "Percent of each payday, 10%",
  );

  fireEvent.press(screen.getByTestId("goal-save"));

  expect(submitted(onSubmit).contributionRule).toEqual({ kind: "percent", percent: 10 });
});

test("a percent over 100 blocks the save rather than being dropped", () => {
  // Saving a goal with the rule silently discarded looks identical to saving
  // one with the rule attached, until the payday prompt never fires.
  const { onSubmit } = renderForm();

  fireEvent.changeText(screen.getByTestId("goal-name"), "Emergency Fund");
  typeAmount("goal-target", "50000");
  fireEvent.press(screen.getByTestId(`goal-wallet-${gsave.id}`));
  fireEvent.press(screen.getByTestId("goal-rule-kind-percent"));
  typeAmount("goal-rule-percent", "120");

  screen.getByTestId("goal-rule-percent-error");
  fireEvent.press(screen.getByTestId("goal-save"));
  expect(onSubmit).not.toHaveBeenCalled();
});
