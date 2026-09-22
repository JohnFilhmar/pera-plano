// components/goals/__tests__/goal_card.test.tsx — m2b Task 4, rules 1-2.
//
// The card renders a verdict it is handed. `computeGoalProgress` decides pace
// (tested in lib/goals/__tests__/goal_math.test.ts); a card that re-derived it
// would be a second opinion about whether the user is on track.
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

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

// ---------------------------------------------------------------------------
// The reached beat (task-7-brief.md Step 4: "plays when a goal's progress
// first crosses 100%").
// ---------------------------------------------------------------------------
describe("the reached beat", () => {
  /** Same discriminator as brand_mark.test.tsx and brand_mark_motion.test.tsx:
   * the static branch renders the imported `.svg` directly, so its size
   * arrives as a `width` PROP under test_support/svg_mock.tsx; every animated
   * branch carries size in `style` instead. */
  function isStaticMark(node: { props: Record<string, unknown> }): boolean {
    return typeof node.props.width === "number";
  }

  let removeReduceMotionListener: jest.Mock;
  let emitReduceMotionChange: (enabled: boolean) => void;

  beforeEach(() => {
    removeReduceMotionListener = jest.fn();
    emitReduceMotionChange = () => {
      throw new Error("no reduceMotionChanged listener was registered");
    };
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation(((event: string, listener: (enabled: boolean) => void) => {
        if (event === "reduceMotionChanged") {
          emitReduceMotionChange = listener;
        }
        return { remove: removeReduceMotionListener };
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a goal that is ALREADY reached on first mount does not replay the beat", () => {
    // priorPace.current starts null — "unknown prior state" must not read as
    // a crossing, or every reached goal would replay its takeoff on every
    // screen visit.
    renderCard({
      name: "Emergency Fund",
      progress: progressOf({ pace: "reached", fraction: 1, requiredPerPeriod: null }),
      targetDate: "2026-12-31",
      testID: "goal",
    });

    expect(screen.queryByTestId("goal-reached-mark")).toBeNull();
  });

  test("crossing into reached plays the mark, which reduce motion degrades to static", async () => {
    const { rerender } = renderCard({
      name: "Emergency Fund",
      progress: progressOf({ pace: "on_track" }),
      targetDate: "2026-12-31",
      testID: "goal",
    });

    expect(screen.queryByTestId("goal-reached-mark")).toBeNull();

    rerender(
      <ThemeProvider>
        <GoalCard
          name="Emergency Fund"
          progress={progressOf({ pace: "reached", fraction: 1, requiredPerPeriod: null })}
          targetDate="2026-12-31"
          testID="goal"
        />
      </ThemeProvider>,
    );

    // Guard against a vacuous pass: confirm it actually animates first.
    await waitFor(() => {
      expect(isStaticMark(screen.getByTestId("goal-reached-mark"))).toBe(false);
    });

    act(() => {
      emitReduceMotionChange(true);
    });

    expect(isStaticMark(screen.getByTestId("goal-reached-mark"))).toBe(true);
  });

  test("staying on_track across a re-render never renders the mark", () => {
    const { rerender } = renderCard({
      name: "Emergency Fund",
      progress: progressOf({ pace: "on_track", fraction: 0.5 }),
      targetDate: "2026-12-31",
      testID: "goal",
    });

    rerender(
      <ThemeProvider>
        <GoalCard
          name="Emergency Fund"
          progress={progressOf({ pace: "on_track", fraction: 0.6 })}
          targetDate="2026-12-31"
          testID="goal"
        />
      </ThemeProvider>,
    );

    expect(screen.queryByTestId("goal-reached-mark")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pending allocation (GAP-056, the goals spec's states table): "the card shows
// '₱X planned this payday' until matched, recorded, skipped, or expired".
// ---------------------------------------------------------------------------
test("a pending payday contribution shows what is still planned", () => {
  renderCard({
    name: "Emergency Fund",
    progress: progressOf(),
    targetDate: null,
    plannedThisPayday: 150000,
    testID: "card",
  });

  expect(screen.getByTestId("card-planned")).toHaveTextContent("₱1,500.00 planned this payday");
});

test("no pending contribution, no planned line", () => {
  renderCard({ name: "Emergency Fund", progress: progressOf(), targetDate: null, testID: "card" });

  expect(screen.queryByTestId("card-planned")).toBeNull();
});
