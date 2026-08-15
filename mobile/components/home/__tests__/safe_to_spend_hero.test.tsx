// components/home/__tests__/safe_to_spend_hero.test.tsx — M3 Part 2 Task 4,
// rules 1-2.
//
// The one number, in its four states. What can go wrong here is not
// arithmetic — that is Task 1's — but presentation: a minus sign in the hero,
// a first-run state that reads as an error, or a figure with no stated source.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { SafeToSpendHero } from "@/components/home/safe_to_spend_hero";
import type { SafeToSpendResult } from "@/lib/safe_to_spend";

function result(over: Partial<SafeToSpendResult> = {}): SafeToSpendResult {
  return {
    state: "healthy",
    perDay: 19_005,
    headroom: 880_000,
    billsTerm: 399_900,
    contributionsTerm: 100_000,
    daysRemaining: 20,
    overBy: 0,
    drivingLimitId: "lim-1",
    drivingFilterLabel: null,
    periodEnd: "2026-08-31",
    reviewQueueCount: 0,
    ...over,
  };
}

function renderHero(over: Partial<SafeToSpendResult> = {}, scopeLabel: string | null = "monthly") {
  const onSetLimit = jest.fn();
  const onOpenReviewQueue = jest.fn();
  render(
    <SafeToSpendHero
      result={result(over)}
      scopeLabel={scopeLabel}
      onSetLimit={onSetLimit}
      onOpenReviewQueue={onOpenReviewQueue}
    />,
  );
  return { onSetLimit, onOpenReviewQueue };
}

// ---------------------------------------------------------------------------
// The four states — rule 1
// ---------------------------------------------------------------------------
test("HEALTHY SHOWS THE FIGURE IN BRAND GREEN", () => {
  renderHero();

  screen.getByText("Safe to spend today");
  screen.getByText("₱190.05");
  expect(screen.getByTestId("sts-amount").props.className).toMatch(/text-brand/);
});

test("TIGHT USES AMBER, NOT RED", () => {
  // At 80% the user is close, not past. Spending red here leaves nothing
  // louder for the day they actually go over — the same discipline as every
  // chip in the app.
  renderHero({ state: "tight" });

  screen.getByText("Safe to spend today");
  expect(screen.getByTestId("sts-amount").props.className).toMatch(/text-warn/);
  expect(screen.getByTestId("sts-amount").props.className).not.toMatch(/text-danger/);
});

test("OVER SHOWS ₱0.00 AND THE SHORTFALL, NEVER A NEGATIVE", () => {
  // Rule 1: "Never render a negative number." "-₱3,499.00 safe to spend" is
  // not a sentence, and a minus sign in the hero reads as a balance rather
  // than as a budget overrun.
  renderHero({ state: "over", perDay: 0, overBy: 349_900 });

  screen.getByText("₱0.00");
  screen.getByTestId("sts-over-by");
  screen.getByText("₱3,499.00");
  expect(screen.queryByText(/−|-₱/)).toBeNull();
  expect(screen.getByTestId("sts-amount").props.className).toMatch(/text-danger/);
});

test("NO LIMIT INVITES RATHER THAN SCOLDS, AND OFFERS THE ACTION", () => {
  // This is the FIRST-RUN state — the very first thing a new user sees. They
  // have not done anything wrong; the app just does not know their ceiling yet.
  const { onSetLimit } = renderHero({ state: "no_limit", perDay: 0, drivingLimitId: null }, null);

  screen.getByText("Set a limit to see what's safe to spend");
  expect(screen.queryByText("Safe to spend today")).toBeNull();
  expect(screen.queryByText("₱0.00")).toBeNull();

  fireEvent.press(screen.getByTestId("sts-set-limit"));
  expect(onSetLimit).toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// The caption — rule 2
// ---------------------------------------------------------------------------
test("THE CAPTION NAMES THE DRIVING LIMIT'S SCOPE", () => {
  // A figure with no stated source invites the user to wonder what it counts.
  renderHero();

  screen.getByText("from your monthly limit");
});

test("A FILTERED LIMIT IS NAMED BY ITS FILTER, NOT ITS SCOPE", () => {
  // Spec rule 3: when only filtered limits exist the caption must name the
  // filter, because the number then describes a slice rather than everything.
  renderHero({ drivingFilterLabel: "Food & Dining" });

  screen.getByText("from your Food & Dining limit");
});

test("A NON-ZERO REVIEW COUNT SAYS SO AND LINKS TO THE QUEUE", () => {
  // Rule 2: "Users must never wonder why the number looks off." An uncounted
  // queue is the one discrepancy the app knows about and can name.
  const { onOpenReviewQueue } = renderHero({ reviewQueueCount: 3 });

  screen.getByText("3 items awaiting review aren't counted yet");
  fireEvent.press(screen.getByTestId("sts-review-note"));
  expect(onOpenReviewQueue).toHaveBeenCalled();
});

test("one item is singular, and an empty queue says nothing at all", () => {
  renderHero({ reviewQueueCount: 1 });
  screen.getByText("1 item awaiting review isn't counted yet");

  renderHero({ reviewQueueCount: 0 });
  expect(screen.queryByTestId("sts-review-note")).toBeNull();
});
