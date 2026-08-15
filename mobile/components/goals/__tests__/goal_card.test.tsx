// components/goals/__tests__/goal_card.test.tsx — m2b Task 4, rules 1-2.
//
// The card renders a verdict it is handed. `computeGoalProgress` decides pace
// (tested in lib/goals/__tests__/goal_math.test.ts); a card that re-derived it
// would be a second opinion about whether the user is on track.
import { render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "@/contexts/theme_context";
import type { GoalProgress } from "@/lib/goals/goal_math";

import { GoalCard } from "../goal_card";

function progressOf(over: Partial<GoalProgress> = {}): GoalProgress {
  return {
    saved: 2500000,
    target: 5000000,
    remaining: 2500000,
    fraction: 0.5,
    pace: "on_track",
    requiredPerPeriod: 250000,
    periodLabel: "payday",
    daysRemaining: 100,
    ...over,
  };
}

function renderCard(props: Parameters<typeof GoalCard>[0]) {
  return render(
    <ThemeProvider>
      <GoalCard {...props} />
    </ThemeProvider>,
  );
}

test("renders the name, the ring and BOTH amounts", async () => {
  // Rule 1: the ring "shows the fraction plus the saved-of-target amounts in
  // the center". A percentage alone answers neither "how far" nor "how much
  // more" in pesos, which is the unit the user thinks in.
  renderCard({
    name: "Emergency Fund",
    progress: progressOf(),
    targetDate: "2026-12-31",
    testID: "goal",
  });

  await screen.findByText("Emergency Fund");
  screen.getByTestId("goal-ring");
  screen.getByText("₱25,000.00 of ₱50,000.00");
  screen.getByText("50%");
});

test.each([
  ["on_track", "On track"],
  ["behind", "Behind"],
  ["past_due", "Past due"],
  ["reached", "Reached"],
] as const)("the %s pace renders its own chip", async (pace, label) => {
  renderCard({
    name: "Goal",
    progress: progressOf({ pace, requiredPerPeriod: pace === "reached" ? null : 250000 }),
    targetDate: "2026-12-31",
    testID: "goal",
  });

  await screen.findByTestId("goal-pace");
  screen.getByText(label);
});

test("a goal with NO DEADLINE shows no pace chip at all", async () => {
  // Spec rule 10: "Goals without targetDate show progress only — no pace chip."
  renderCard({
    name: "Someday",
    progress: progressOf({ pace: "no_deadline", requiredPerPeriod: null, daysRemaining: null }),
    targetDate: null,
    testID: "goal",
  });

  await screen.findByText("Someday");
  expect(screen.queryByTestId("goal-pace")).toBeNull();
  // Progress is still shown — the goal is real, it just has no date to miss.
  screen.getByText("₱25,000.00 of ₱50,000.00");
});

test("BEHIND STATES THE CONCRETE FIX, not just a colour", async () => {
  // Spec rule 11: "The Behind state always shows the concrete fix: 'Save
  // ₱1,250.00 per payday to hit June 1.' It never shows only a warning color."
  renderCard({
    name: "Emergency Fund",
    progress: progressOf({ pace: "behind", requiredPerPeriod: 125000, periodLabel: "payday" }),
    targetDate: "2027-06-01",
    testID: "goal",
  });

  await screen.findByTestId("goal-fix");
  screen.getByText("Save ₱1,250.00 per payday to hit Jun 1, 2027.");
});

test("the fix says 'per month' when income is irregular or unknown", async () => {
  // Spec rule 9's fallback. Telling a gig worker to save an amount "per payday"
  // names a thing they do not have.
  renderCard({
    name: "Emergency Fund",
    progress: progressOf({ pace: "behind", requiredPerPeriod: 125000, periodLabel: "month" }),
    targetDate: "2027-06-01",
    testID: "goal",
  });

  await screen.findByText("Save ₱1,250.00 per month to hit Jun 1, 2027.");
});

test("PAST DUE names the shortfall and the three ways out", async () => {
  // The spec's Past due card "offers Move the date, Lower the target, or
  // Complete anyway" — so the copy has to name all three, and the figure that
  // makes the choice possible.
  renderCard({
    name: "Emergency Fund",
    progress: progressOf({
      pace: "past_due",
      remaining: 1200000,
      requiredPerPeriod: null,
      daysRemaining: -14,
    }),
    targetDate: "2026-07-31",
    testID: "goal",
  });

  await screen.findByTestId("goal-overdue");
  screen.getByText(/₱12,000\.00 short/);
  screen.getByText(/Move the date, lower the target, or complete it anyway/);
});

test("REACHED shows a check instead of a percentage", async () => {
  // 100% is the least interesting thing to say about a goal that is done.
  renderCard({
    name: "Emergency Fund",
    progress: progressOf({
      saved: 5000000,
      remaining: 0,
      fraction: 1,
      pace: "reached",
      requiredPerPeriod: null,
    }),
    targetDate: "2026-12-31",
    testID: "goal",
  });

  await screen.findByText("Reached");
  expect(screen.queryByText("100%")).toBeNull();
  screen.getByText("₱50,000.00 of ₱50,000.00");
});

test("an empty goal renders a ring with no arc at all", async () => {
  // A zero-length dash array still paints a round line-cap dot, which reads as
  // "a little bit saved" when nothing has been.
  renderCard({
    name: "New",
    progress: progressOf({ saved: 0, remaining: 5000000, fraction: 0, pace: "behind" }),
    targetDate: "2026-12-31",
    testID: "goal",
  });

  await screen.findByTestId("goal-ring");
  expect(screen.queryByTestId("goal-ring-arc")).toBeNull();
  screen.getByText("0%");
});

test("an overfunded fraction cannot draw past the ring", async () => {
  // Clamped upstream too, but a ring is the one place a bad number is visible
  // as a wrong picture rather than a wrong digit.
  renderCard({
    name: "Overfunded",
    progress: progressOf({ saved: 9000000, remaining: 0, fraction: 1.8, pace: "reached" }),
    targetDate: null,
    testID: "goal",
  });

  // react-native-svg normalises `strokeDasharray` into an ARRAY of strings,
  // not the space-joined string it was given.
  const arc = await screen.findByTestId("goal-ring-arc");
  const [filled, total] = (arc.props.strokeDasharray as string[]).map(Number);

  expect(filled).toBeLessThanOrEqual(total);
  // And it is exactly a full ring — a clamp that merely stopped it growing
  // could still have left it short.
  expect(filled).toBeCloseTo(total, 6);
});
