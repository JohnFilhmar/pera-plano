// components/home/__tests__/safe_to_spend_hero.test.tsx — mobile-ui-revamp
// Part 2 Task 2.
//
// The one number, in its four states, on three different fills. What can go
// wrong here is not arithmetic — that is lib/safe_to_spend.ts's own suite —
// but presentation: the wrong ink on a fill, a hardcoded weekday, or a hero
// that stops offering the review-queue disclosure it always had.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { SafeToSpendHero } from "../safe_to_spend_hero";
import type { SafeToSpendResult } from "@/lib/safe_to_spend";

function result(over: Partial<SafeToSpendResult> = {}): SafeToSpendResult {
  return {
    state: "healthy",
    perDay: 41200,
    headroom: 1_200_000,
    billsTerm: 0,
    contributionsTerm: 0,
    daysRemaining: 20,
    overBy: 0,
    drivingLimitId: "limit-1",
    drivingFilterLabel: null,
    periodEnd: "2026-08-31",
    reviewQueueCount: 0,
    ...over,
  };
}

const BASE = {
  scopeLabel: "monthly",
  dailySeries: [1000, 2000, 1500, 3000, 2200, 1800, 4000] as const,
  startLabel: "Mon",
  endLabel: "Sun",
  paused: false,
  amountsHidden: false,
  onToggleAmounts: () => {},
  onSetLimit: () => {},
  onOpenReviewQueue: () => {},
};

/**
 * Token-exact, not substring. `INK_CLASS.tight` is `"text-fg
 * dark:text-on-brand-dark"` — a plain `string.includes("text-on-brand")`
 * check is TRUE for that string, because "text-on-brand" is a literal
 * substring of "dark:text-on-brand-dark". A `.not.toContain("text-on-brand")`
 * assertion against the raw string would therefore fail on the one state it
 * exists to prove correct. Splitting into tokens and letting Jest's array
 * `toContain` do exact-element matching is what makes that assertion (below,
 * in the "tight" test) actually test what it claims to.
 */
function classesOf(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

test("healthy fills with brand and inks white", () => {
  render(<SafeToSpendHero {...BASE} result={result()} />);
  expect(classesOf("sts-hero")).toContain("bg-brand");
  expect(classesOf("sts-amount")).toContain("text-on-brand");
});

test("tight fills with warn and inks DARK — white on amber is 3.2:1 and fails AA", () => {
  render(<SafeToSpendHero {...BASE} result={result({ state: "tight" })} />);
  expect(classesOf("sts-hero")).toContain("bg-warn");
  expect(classesOf("sts-amount")).toContain("text-fg");
  expect(classesOf("sts-amount")).not.toContain("text-on-brand");
});

test("over fills with danger and inks white", () => {
  render(<SafeToSpendHero {...BASE} result={result({ state: "over", overBy: 31200 })} />);
  expect(classesOf("sts-hero")).toContain("bg-danger");
  expect(classesOf("sts-amount")).toContain("text-on-brand");
});

test("paused drops the fill entirely and says the number is stale", () => {
  render(<SafeToSpendHero {...BASE} paused result={result()} />);
  expect(classesOf("sts-hero")).toContain("bg-surface");
  expect(classesOf("sts-hero")).not.toContain("bg-brand");
  screen.getByTestId("sts-paused-chip");
});

test("the bar strip renders one bar per day given", () => {
  render(<SafeToSpendHero {...BASE} result={result()} />);
  for (let index = 0; index < 7; index += 1) {
    screen.getByTestId(`sts-bars-bar-${index}`);
  }
});

test("hiding amounts replaces the figure without unmounting the hero", () => {
  render(<SafeToSpendHero {...BASE} amountsHidden result={result()} />);
  expect(screen.getByTestId("sts-amount")).toHaveTextContent("₱•••••");
  expect(screen.queryByText("₱412.00")).toBeNull();
});

test("the eye toggle reports a press", () => {
  const onToggleAmounts = jest.fn();
  render(<SafeToSpendHero {...BASE} onToggleAmounts={onToggleAmounts} result={result()} />);
  fireEvent.press(screen.getByTestId("sts-eye"));
  expect(onToggleAmounts).toHaveBeenCalledTimes(1);
});

test("no_limit still offers the set-a-limit route and draws no bars", () => {
  render(<SafeToSpendHero {...BASE} result={result({ state: "no_limit" })} />);
  screen.getByTestId("sts-set-limit");
  expect(screen.queryByTestId("sts-bars-bar-0")).toBeNull();
});

test("the review-queue disclosure survives the restyle", () => {
  render(<SafeToSpendHero {...BASE} result={result({ reviewQueueCount: 3 })} />);
  screen.getByTestId("sts-review-note");
});

// ---------------------------------------------------------------------------
// The StatTile-style ink regression, guarded structurally
// ---------------------------------------------------------------------------
test("the amount is a direct string on the toned Text, not a nested element that could silently eat the ink", () => {
  // components/ui/stat_tile.tsx documents the shape of this bug: nesting
  // AmountText (which always sets its own colour) inside a toned wrapper
  // compiles, looks plausible, and passes a test that only reads the
  // wrapper's own className. Asserting the child is a plain STRING — not a
  // React element — is the one check that would actually break if this ever
  // regressed back to a nested <AmountText>.
  render(<SafeToSpendHero {...BASE} result={result({ state: "over", overBy: 31200 })} />);
  const amount = screen.getByTestId("sts-amount");
  expect(typeof amount.props.children).toBe("string");
  expect(amount.props.children).toBe("₱412.00");
});
