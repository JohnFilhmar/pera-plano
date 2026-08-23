// app/__tests__/shared_budgets_screen.test.tsx — mobile UI revamp Part 3 Task
// 3. Covers app/(tabs)/more/shared_budgets.tsx in isolation, the same way
// app/__tests__/more_hub.test.tsx and more_tab.test.tsx cover the More hub's
// wiring to it rather than re-testing this screen's own content.
//
// NO PROVIDERS, NO ROUTER MOCK. The screen calls no expo-router hook and
// reads no query/theme context (see the screen's own header comment for why),
// so `render(<SharedBudgetsScreen />)` needs nothing wrapped around it.
//
// NO BUTTON HERE ANYMORE. An earlier revision of this screen shipped a
// "Notify me when it ships" control whose press was honest but whose REST
// STATE was not — a normal, enabled pill is what nearly every viewer of a
// Soon screen with nothing else to tap actually sees, and this app has no
// mechanism that could ever make that label true. Removed per
// docs/11-mobile-app-design-prompt.md's "TWO GATING STATES" section, which
// specifies Soon full-screen placeholders as non-interactive (see the
// screen's own header comment for the exact quote). The tests this replaces
// covered the button's testID and its press-reveals-a-disclosure behaviour;
// both are gone along with the control. "renders no pressable at all" below
// is what stops it being reintroduced silently.
import { render, screen } from "@testing-library/react-native";

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

test("renders no pressable at all — informational only, per docs/11 TWO GATING STATES", () => {
  render(<SharedBudgetsScreen />);
  // NOT a role query. `queryByRole("button")` only matches an element
  // carrying an explicit `accessibilityRole`/`role` of "button" — a bare
  // `<Pressable>` with no role at all slips straight through it (proved
  // empirically: injecting one left a `queryByRole("button")` version of
  // this exact assertion green; see task-3-report.md for the transcript).
  // React Native's `Pressable` marks itself `focusable: true` purely because
  // it has a press handler — WITH OR WITHOUT an explicit role — while every
  // plain, non-interactive `View`/`Text` on this screen carries no such prop
  // (confirmed by dumping this screen's own rendered JSON with a role-less
  // probe attached: every ordinary node here has only `className`, or no
  // props at all). Whole-tree structural sweep, the same technique the
  // brand-green guard below uses, keyed on that signal instead of role.
  expect(JSON.stringify(screen.toJSON())).not.toMatch(/"focusable":true/);
});

test("the disclosure is honest and does not lean on a mechanism that doesn't exist", () => {
  render(<SharedBudgetsScreen />);
  const disclosure = screen.getByTestId("shared-budgets-disclosure");
  // Owns up to there being no mechanism, rather than papering over it.
  expect(disclosure.props.children).toMatch(/no (account|push notification)/i);
  // And does not lean on a second capability (a changelog / release-notes
  // feed) this codebase does not have either — grepping for "changelog" and
  // "release notes" anywhere under mobile/ turns up nothing.
  expect(disclosure.props.children).not.toMatch(/changelog|release notes/i);
});

// The test below is this task's own guard for the thing its brief called out
// as easiest to get wrong silently: a stray brand-green token on the one
// screen that must never carry one (docs/11-mobile-app-design-prompt.md "TWO
// GATING STATES"; components/ui/chip.tsx's tone contract). Fault-injected
// once (temporarily changed a grey token to a brand one and watched this go
// red) before this screen had a button at all, and again after the button
// was removed — still catches a real violation either way.
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
