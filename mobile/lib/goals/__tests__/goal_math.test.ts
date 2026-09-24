// lib/goals/__tests__/goal_math.test.ts — m2b Task 2.
//
// docs/04-features/05-goals-savings.md rules 1, 9, 10. The m2b plan describes a
// different algorithm — linear expected progress with a tolerance band, and an
// "ahead" state — which the spec does not contain. The project owner settled it
// on 2026-08-15 the way the plan's own Global Constraints already do: the spec
// wins.
import { computeGoalProgress, milestoneFor, milestonesCrossed, previousMilestone } from "../goal_math";
import type { Goal, GoalMilestone } from "@/types/domain";

const on = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0).getTime();

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    name: "Emergency Fund",
    targetAmount: 5000000, // ₱50,000.00
    targetDate: "2026-12-31",
    linkedWalletId: "w-savings",
    contributionRule: null,
    archivedAt: null,
    createdAt: on(2026, 5, 1),
    updatedAt: on(2026, 5, 1),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Progress — rules 1 and 2
// ---------------------------------------------------------------------------
test("progress IS the linked wallet's balance", () => {
  // Rule 1, and the reason for it: money that reaches the savings wallet by any
  // route counts, so the number always matches what the bank says. A sum of
  // tagged contributions would disagree with the balance the moment interest
  // was credited.
  const progress = computeGoalProgress(goal(), 2500000, on(2026, 8, 1));

  expect(progress.saved).toBe(2500000);
  expect(progress.target).toBe(5000000);
  expect(progress.remaining).toBe(2500000);
  expect(progress.fraction).toBe(0.5);
});

test("an overfunded goal clamps to 1.0 and reads as REACHED", () => {
  // Rule 2: "a wallet holding more than the target reads as achieved, never
  // 120%" — a progress ring cannot draw 120% anyway.
  const progress = computeGoalProgress(goal(), 6000000, on(2026, 8, 1));

  expect(progress.fraction).toBe(1);
  expect(progress.pace).toBe("reached");
  expect(progress.remaining).toBe(0);
});

test("reached is balance AT OR ABOVE target", () => {
  // Rule 10: "Reached when balance ≥ targetAmount".
  expect(computeGoalProgress(goal(), 5000000, on(2026, 8, 1)).pace).toBe("reached");
  expect(computeGoalProgress(goal(), 4999999, on(2026, 8, 1)).pace).not.toBe("reached");
});

test("remaining floors at zero rather than going negative", () => {
  expect(computeGoalProgress(goal(), 9000000, on(2026, 8, 1)).remaining).toBe(0);
});

test("an empty wallet is 0, not NaN", () => {
  const progress = computeGoalProgress(goal(), 0, on(2026, 8, 1));

  expect(progress.fraction).toBe(0);
  expect(progress.remaining).toBe(5000000);
});

// ---------------------------------------------------------------------------
// No deadline — rule 10's last sentence
// ---------------------------------------------------------------------------
test("a goal with no deadline shows progress only", () => {
  // Rule 10: "Goals without targetDate show progress only — no pace chip."
  const progress = computeGoalProgress(goal({ targetDate: null }), 2500000, on(2026, 8, 1));

  expect(progress.pace).toBe("no_deadline");
  expect(progress.requiredPerPeriod).toBeNull();
  expect(progress.daysRemaining).toBeNull();
  expect(progress.fraction).toBe(0.5);
});

test("a reached goal with no deadline still reads as reached", () => {
  // Reaching the target is worth saying whether or not a date was ever set.
  expect(
    computeGoalProgress(goal({ targetDate: null }), 5000000, on(2026, 8, 1)).pace,
  ).toBe("reached");
});

// ---------------------------------------------------------------------------
// Past due — rules 10 and 6
// ---------------------------------------------------------------------------
test("past the deadline and short of target reads PAST DUE, not behind", () => {
  // The distinction changes the copy and the actions: the spec's Past due card
  // offers "Move the date, Lower the target, or Complete anyway", none of which
  // makes sense for a goal that still has time.
  const progress = computeGoalProgress(goal({ targetDate: "2026-07-31" }), 2500000, on(2026, 8, 5));

  expect(progress.pace).toBe("past_due");
  expect(progress.daysRemaining).toBeLessThan(0);
});

test("A DEADLINE OF TODAY IS NOT PAST DUE", () => {
  // Rule 6 of the plan: dates compare in device-local calendar DAYS, so a goal
  // due today does not flip to Past due at 00:30 while the user still has the
  // whole day to fund it.
  const progress = computeGoalProgress(
    goal({ targetDate: "2026-08-05" }),
    2500000,
    new Date(2026, 7, 5, 0, 30).getTime(),
  );

  expect(progress.pace).not.toBe("past_due");
  expect(progress.daysRemaining).toBe(0);
});

test("reached wins over past due", () => {
  // A goal funded after its date is a success, not a failure. Rule 10 lists
  // Reached first for this reason.
  expect(
    computeGoalProgress(goal({ targetDate: "2026-07-31" }), 5000000, on(2026, 8, 5)).pace,
  ).toBe("reached");
});

// ---------------------------------------------------------------------------
// Pace — rules 9 and 10
// ---------------------------------------------------------------------------
test("REQUIRED PACE IS PER PAYDAY FOR KINSENAS, not per month", () => {
  // Rule 9: R = (targetAmount − balance) ÷ PAYDAYS remaining. From Aug 5 to
  // Dec 31 the kinsenas anchors are Aug 15, Aug 31, Sep 15, Sep 30, Oct 15,
  // Oct 31, Nov 15, Nov 30, Dec 15, Dec 31 — ten paydays. ₱25,000 over ten is
  // ₱2,500.00 each. A per-month figure would say ₱5,000 and overstate what the
  // user has to set aside by double.
  const progress = computeGoalProgress(goal(), 2500000, on(2026, 7, 5), {
    cadence: "kinsenas",
    referencePace: 250000,
  });

  expect(progress.periodLabel).toBe("payday");
  expect(progress.requiredPerPeriod).toBe(250000);
});

test("on track when the reference pace meets the required pace", () => {
  // Rule 10: "On track when the reference pace P ≥ R".
  const progress = computeGoalProgress(goal(), 2500000, on(2026, 7, 5), {
    cadence: "kinsenas",
    referencePace: 250000, // exactly R
  });

  expect(progress.pace).toBe("on_track");
});

test("behind when the reference pace falls short", () => {
  const progress = computeGoalProgress(goal(), 2500000, on(2026, 7, 5), {
    cadence: "kinsenas",
    referencePace: 249999,
  });

  expect(progress.pace).toBe("behind");
});

test("saving MORE than required is still on track — there is no 'ahead'", () => {
  // The spec's four pace states are Reached, Past due, On track and Behind. The
  // m2b plan adds "ahead"; nothing in the spec distinguishes it, and a separate
  // chip for it would imply an action the app does not offer.
  const progress = computeGoalProgress(goal(), 2500000, on(2026, 7, 5), {
    cadence: "kinsenas",
    referencePace: 900000,
  });

  expect(progress.pace).toBe("on_track");
});

test("weekly counts weeks, monthly counts months", () => {
  const weekly = computeGoalProgress(goal({ targetDate: "2026-09-05" }), 4000000, on(2026, 7, 5), {
    cadence: "weekly",
    referencePace: 100000,
  });
  const monthly = computeGoalProgress(goal({ targetDate: "2026-12-31" }), 4000000, on(2026, 7, 5), {
    cadence: "monthly",
    referencePace: 100000,
  });

  // Aug 5 -> Sep 5 is 31 days: five weekly paydays (ceil).
  expect(weekly.periodLabel).toBe("payday");
  expect(weekly.requiredPerPeriod).toBe(200000); // ₱10,000 over 5
  // Aug 5 -> Dec 31 spans four monthly anniversaries plus the remainder.
  expect(monthly.periodLabel).toBe("payday");
  expect(monthly.requiredPerPeriod).toBe(200000); // ₱10,000 over 5
});

test("IRREGULAR INCOME IS PACED PER MONTH, not per payday", () => {
  // Rule 9's last sentence: "When cadence is irregular, pace is computed per
  // month instead of per payday." A gig worker has no paydays to divide by.
  const progress = computeGoalProgress(goal({ targetDate: "2026-12-31" }), 4000000, on(2026, 7, 5), {
    cadence: "irregular",
    referencePace: 100000,
  });

  expect(progress.periodLabel).toBe("month");
  expect(progress.requiredPerPeriod).toBe(200000);
});

test("an unknown cadence is paced per month, like irregular", () => {
  // No IncomeProfile yet. A month is the honest unit when the app does not know
  // when the user is paid, and it is what rule 9 falls back to.
  const progress = computeGoalProgress(goal({ targetDate: "2026-12-31" }), 4000000, on(2026, 7, 5), {
    cadence: null,
    referencePace: 100000,
  });

  expect(progress.periodLabel).toBe("month");
});

test("NO REFERENCE PACE READS AS BEHIND, and still states the fix", () => {
  // P is "the contributionRule amount when one is set; otherwise the average
  // net inflow ... over the trailing 3 periods". A brand-new goal has neither,
  // and saving nothing does not reach a target — rule 11 requires the concrete
  // figure regardless: "It never shows only a warning color."
  const progress = computeGoalProgress(goal(), 2500000, on(2026, 7, 5), {
    cadence: "kinsenas",
    referencePace: null,
  });

  expect(progress.pace).toBe("behind");
  expect(progress.requiredPerPeriod).toBe(250000);
});

test("pace inputs are optional — a caller with no income context still gets progress", () => {
  const progress = computeGoalProgress(goal(), 2500000, on(2026, 7, 5));

  expect(progress.fraction).toBe(0.5);
  expect(progress.pace).toBe("behind");
  expect(progress.periodLabel).toBe("month");
});

test("the required pace ROUNDS UP, so the target is actually reached", () => {
  // ₱10,000.01 over 3 periods is ₱3,333.336... Rounding down leaves the user a
  // centavo short after every payday they follow the advice exactly.
  const progress = computeGoalProgress(
    goal({ targetAmount: 1000001, targetDate: "2026-11-30" }),
    0,
    on(2026, 8, 20),
    { cadence: "monthly", referencePace: 0 },
  );

  expect(progress.requiredPerPeriod).toBe(333334);
});

test("a reached goal has no required pace", () => {
  const progress = computeGoalProgress(goal(), 5000000, on(2026, 7, 5), {
    cadence: "kinsenas",
    referencePace: 0,
  });

  expect(progress.requiredPerPeriod).toBeNull();
});

test("a past-due goal has no required pace either", () => {
  // There are no periods left to spread the shortfall over; dividing by zero
  // would report Infinity as a peso figure.
  const progress = computeGoalProgress(goal({ targetDate: "2026-07-31" }), 2500000, on(2026, 8, 5), {
    cadence: "kinsenas",
    referencePace: 0,
  });

  expect(progress.requiredPerPeriod).toBeNull();
});

test("daysRemaining counts local calendar days to the deadline", () => {
  expect(
    computeGoalProgress(goal({ targetDate: "2026-08-10" }), 0, on(2026, 7, 5)).daysRemaining,
  ).toBe(5);
});

test("computeGoalProgress is pure — same inputs, same answer", () => {
  const first = computeGoalProgress(goal(), 2500000, on(2026, 7, 5), {
    cadence: "kinsenas",
    referencePace: 250000,
  });
  const second = computeGoalProgress(goal(), 2500000, on(2026, 7, 5), {
    cadence: "kinsenas",
    referencePace: 250000,
  });

  expect(first).toEqual(second);
});

// ---------------------------------------------------------------------------
// Milestones (goals rule 12, GAP-055). The highest of 25, 50, 75 and 100
// percent the balance meets, in integer arithmetic so a centavo target that
// does not divide evenly is never a float comparison.
// ---------------------------------------------------------------------------
describe("milestoneFor", () => {
  test.each([
    [0, 1_000_000, 0],
    [249_999, 1_000_000, 0],
    [250_000, 1_000_000, 25],
    [499_999, 1_000_000, 25],
    [500_000, 1_000_000, 50],
    [750_000, 1_000_000, 75],
    [999_999, 1_000_000, 75],
    [1_000_000, 1_000_000, 100],
    [1_250_000, 1_000_000, 100],
    [-50_000, 1_000_000, 0],
    [1, 3, 25],
  ])("a balance of %i against a target of %i meets %i", (balance, target, expected) => {
    expect(milestoneFor(balance, target)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Which milestones one change crossed (owner's ruling, 2026-09-24: every one of
// them, not just the highest), and the level below a given one, which is how a
// new goal is seeded so that only the level it starts at is announced.
// ---------------------------------------------------------------------------
describe("milestonesCrossed", () => {
  test.each([
    [0, 0, 1_000_000, []],
    [0, 250_000, 1_000_000, [25]],
    [0, 800_000, 1_000_000, [25, 50, 75]],
    [0, 1_000_000, 1_000_000, [25, 50, 75, 100]],
    [25, 800_000, 1_000_000, [50, 75]],
    [75, 800_000, 1_000_000, []],
    [100, 1_000_000, 1_000_000, []],
    // A dip leaves the mark where it was, so nothing is owed on the way back up.
    [50, 300_000, 1_000_000, []],
  ])("from a mark of %i, a balance of %i against %i owes %j", (from, balance, target, expected) => {
    expect(milestonesCrossed(from as GoalMilestone, balance, target)).toEqual(expected);
  });
});

describe("previousMilestone", () => {
  test.each([
    [0, 0],
    [25, 0],
    [50, 25],
    [75, 50],
    [100, 75],
  ])("the level below %i is %i", (milestone, expected) => {
    expect(previousMilestone(milestone as GoalMilestone)).toBe(expected);
  });
});
