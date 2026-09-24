// components/privacy/__tests__/user_rules_list.test.tsx — GAP-128, review-queue
// rule 16.
//
// Presentational, like health_card.test.tsx: the list takes rules and callbacks
// as props, so nothing here touches a database or the native module.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { UserRulesList } from "../user_rules_list";
import type { UserRule } from "@/types/domain";

const T0 = 1_700_000_000_000;

function rule(overrides: Partial<UserRule> = {}): UserRule {
  return {
    id: "rule_1",
    matcher: { merchantPattern: "JOLLIBEE" },
    action: { kind: "set-category", categoryId: "cat_food" },
    priority: 0,
    isEnabled: true,
    createdFrom: "tx_1",
    appliedCount: 0,
    lastAppliedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

const CATEGORIES = [{ id: "cat_food", name: "Food & dining" }];
const WALLETS = [{ id: "w_1", name: "GCash" }];

function renderList(rules: UserRule[], overrides: Record<string, unknown> = {}) {
  return render(
    <UserRulesList
      rules={rules}
      categories={CATEGORIES}
      wallets={WALLETS}
      onToggle={jest.fn()}
      onDelete={jest.fn()}
      {...overrides}
    />,
  );
}

test("a rule says what it matches and what it does, in words", () => {
  // Rule 16's "listed" is not satisfied by a row of ids. A user deciding whether
  // to switch a rule off has to recognise it first.
  renderList([rule()]);

  screen.getByText(/JOLLIBEE/);
  screen.getByText(/Food & dining/);
});

test("an action pointing at a name the app cannot resolve falls back to the id, never to blank", () => {
  // A category hidden after the rule was made is the ordinary way here: a row
  // that silently rendered nothing would look like a rule that does nothing.
  renderList([rule({ action: { kind: "set-category", categoryId: "cat_gone" } })]);

  screen.getByText(/cat_gone/);
});

test("the toggle reports the rule's own state and reverses it on press", () => {
  const onToggle = jest.fn();
  renderList([rule({ isEnabled: true })], { onToggle });

  const toggle = screen.getByTestId("user-rule-toggle-rule_1");
  expect(toggle.props.value).toBe(true);

  fireEvent(toggle, "valueChange", false);
  expect(onToggle).toHaveBeenCalledWith({ id: "rule_1", isEnabled: false });
});

test("a disabled rule is still listed, and says so", () => {
  // It has to be: hiding what was just switched off would strand it off for
  // good, which is the trap `listUserRules`'s own doc warns about.
  renderList([rule({ isEnabled: false })]);

  screen.getByTestId("user-rule-row-rule_1");
  screen.getByText("Off");
});

test("delete asks first, and only then reports the id", () => {
  // Deleting is the one irreversible thing on this screen.
  const onDelete = jest.fn();
  renderList([rule()], { onDelete });

  fireEvent.press(screen.getByTestId("user-rule-delete-rule_1"));
  expect(onDelete).not.toHaveBeenCalled();

  // `ConfirmDialog` owns this testID; it takes none of its own.
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  expect(onDelete).toHaveBeenCalledWith("rule_1");
});

test("the confirmation says that past transactions are left alone", () => {
  // Rule 16: "Deleting a rule stops future replays but never reverts
  // transactions it already changed." A user who expects a cleanup to undo a
  // month of miscategorized rows has to be told before they press, not after.
  renderList([rule()]);
  fireEvent.press(screen.getByTestId("user-rule-delete-rule_1"));

  screen.getByText(/already|past|history/i);
});

test("how often a rule has fired is shown, because it is the evidence for switching it off", () => {
  renderList([rule({ appliedCount: 12 })]);

  screen.getByText(/12/);
});

test("no rules reads as an explanation, not as an empty box", () => {
  renderList([]);

  screen.getByTestId("user-rules-empty");
});
