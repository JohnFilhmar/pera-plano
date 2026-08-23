// app/__tests__/shared_budgets_screen.test.tsx — mobile UI revamp Part 3 Task
// 3. Covers app/(tabs)/more/shared_budgets.tsx in isolation, the same way
// app/__tests__/more_hub.test.tsx and more_tab.test.tsx cover the More hub's
// wiring to it rather than re-testing this screen's own content.
//
// NO PROVIDERS, NO ROUTER MOCK. The screen calls no expo-router hook and
// reads no query/theme context (see the screen's own header comment for why),
// so `render(<SharedBudgetsScreen />)` needs nothing wrapped around it.
import { fireEvent, render, screen } from "@testing-library/react-native";

import SharedBudgetsScreen from "../(tabs)/more/shared_budgets";

test("the screen says it is coming, without saying when", () => {
  render(<SharedBudgetsScreen />);
  screen.getByText("Shared budgets are coming in an update");
  expect(screen.queryByText(/\b20\d\d\b/)).toBeNull();
});

test("it lists what the feature will do", () => {
  render(<SharedBudgetsScreen />);
  screen.getByText("Invite by QR — still no accounts");
  screen.getByText("Each phone tracks its own alerts");
  screen.getByText("Shared limits, private transactions");
});

test("the notify action exists but promises nothing it cannot keep", () => {
  render(<SharedBudgetsScreen />);
  screen.getByTestId("shared-budgets-notify");
});

// The three tests above are the brief's own. The two below are this task's
// own guards for the two things its brief called out as easiest to get wrong
// silently: a button that quietly starts claiming a notification will
// arrive, and a stray brand-green token on the one screen that must never
// carry one (docs/11-mobile-app-design-prompt.md "TWO GATING STATES";
// components/ui/chip.tsx's tone contract).

test("pressing notify reveals an honest reason, not a fake confirmation", () => {
  render(<SharedBudgetsScreen />);

  // Nothing claims a notification is coming before the press either — the
  // button's label is a request, not a status update.
  expect(screen.queryByText(/we('| )ll (notify|let you know|email|text)/i)).toBeNull();

  fireEvent.press(screen.getByTestId("shared-budgets-notify"));

  // Owns up to there being no mechanism, rather than papering over it.
  const note = screen.getByTestId("shared-budgets-notify-note");
  expect(note.props.children).toMatch(/no (account|push notification)/i);
  // And does not lean on a second capability (a changelog / release-notes
  // feed) this codebase does not have either — grepping for "changelog" and
  // "release notes" anywhere under mobile/ turns up nothing.
  expect(note.props.children).not.toMatch(/changelog|release notes/i);
});

test("never renders brand green — grey means designed-not-built, brand green means built-needs-Plus", () => {
  render(<SharedBudgetsScreen />);
  // Whole-tree sweep, the same technique
  // components/ui/__tests__/primitives.test.tsx uses for its "no hex
  // literals anywhere" check — cheaper than walking the tree by hand, and it
  // catches a stray brand token on ANY node, not just the ones remembered by
  // name here. Matches `-brand`, `-brand-dark`, `-brand-soft`,
  // `-brand-soft-dark`, `-brand-ink` and `-brand-ink-dark` alike.
  expect(JSON.stringify(screen.toJSON())).not.toMatch(/-brand\b/);
});
