// lib/__tests__/safe_to_spend_projection.test.ts — M3 Part 2 Task 3.
//
// The Plus curve. Its single hardest requirement is rule 2: the first point
// must equal today's hero number EXACTLY, because a curve that disagrees with
// the number above it on day one destroys confidence in both.
import { computeSafeToSpend, type SafeToSpendInput } from "@/lib/safe_to_spend";
import { projectToPeriodEnd } from "@/lib/safe_to_spend_projection";

/** The spec's worked example again — August 12 2026, ₱190.05 today. */
function workedExample(): SafeToSpendInput {
  return {
    today: "2026-08-12",
    limits: [
      {
        id: "lim-1",
        scope: "monthly",
        effectiveValue: 1_500_000,
        spendInPeriod: 620_000,
        filtered: false,
        filterLabel: null,
        categoryIds: null,
      },
    ],
    unpaidBills: [
      { id: "bill-1", name: "Meralco", amount: 230_000, dueDate: "2026-08-20" , categoryId: "cat_bills" },
      { id: "bill-2", name: "PLDT", amount: 169_900, dueDate: "2026-08-25" , categoryId: "cat_bills" },
    ],
    plannedContributions: [{ goalId: "goal-1", amount: 100_000, date: "2026-08-15" }],
    reviewQueueCount: 0,
  };
}

function project(input: SafeToSpendInput) {
  return projectToPeriodEnd(input, computeSafeToSpend(input));
}

// ---------------------------------------------------------------------------
// Rule 2 — the promise that matters most
// ---------------------------------------------------------------------------
test("THE FIRST POINT EQUALS TODAY'S HERO NUMBER EXACTLY", () => {
  const input = workedExample();
  const result = computeSafeToSpend(input);

  const points = projectToPeriodEnd(input, result);

  expect(points[0].date).toBe("2026-08-12");
  expect(points[0].perDay).toBe(result.perDay);
  expect(points[0].perDay).toBe(19_005); // ₱190.05
});

test("one point per remaining day, inclusive of today and the last day", () => {
  const points = project(workedExample());

  expect(points).toHaveLength(20); // Aug 12–31
  expect(points[0].date).toBe("2026-08-12");
  expect(points[19].date).toBe("2026-08-31");
});

// ---------------------------------------------------------------------------
// The shape of the curve — rules 1 and 3
// ---------------------------------------------------------------------------
test("THE ALLOWANCE RISES AS THE PERIOD SHORTENS, AND NEVER FALLS", () => {
  // Under zero further discretionary spend the numerator is constant — paying a
  // bill drops headroom and drops the bills term by the same amount — so only
  // the divisor shrinks. Money set aside for a bill was never spendable, so
  // spending it changes nothing about what is.
  const points = project(workedExample());

  for (let i = 1; i < points.length; i += 1) {
    expect(points[i].perDay).toBeGreaterThanOrEqual(points[i - 1].perDay);
  }
  expect(points[19].perDay).toBe(380_100); // the whole numerator, on the last day
});

test("A BILL'S DUE DATE IS MARKED WITHOUT THE ALLOWANCE LINE DIPPING", () => {
  // Rule 3's marker. The tempting alternative — dipping the allowance on the
  // day a bill falls due — DOUBLE-COUNTS it: the bill was already subtracted
  // from the numerator on day one, and subtracting it again on the 20th
  // charges the user twice for one Meralco bill.
  const points = project(workedExample());
  const byDate = new Map(points.map((point) => [point.date, point]));

  expect(byDate.get("2026-08-20")?.billsDue).toBe(230_000);
  expect(byDate.get("2026-08-25")?.billsDue).toBe(169_900);
  expect(byDate.get("2026-08-21")?.billsDue).toBe(0);

  // ...and the line keeps climbing straight through both.
  expect(byDate.get("2026-08-21")!.perDay).toBeGreaterThan(byDate.get("2026-08-20")!.perDay);
});

test("two bills on the same date are summed into one marker", () => {
  const input = workedExample();
  input.unpaidBills.push({ id: "bill-3", name: "Water", amount: 50_000, dueDate: "2026-08-20" , categoryId: "cat_bills" });

  const points = project(input);
  const twentieth = points.find((point) => point.date === "2026-08-20");

  expect(twentieth?.billsDue).toBe(280_000);
});

test("CUMULATIVE ALLOWANCE IS THE RUNNING TOTAL OF WHAT MAY BE SPENT", () => {
  // What the strip under the chart answers: "by the 15th I will have had ₱X to
  // spend". A total, not a balance — it never decreases.
  const points = project(workedExample());

  expect(points[0].cumulativeAllowance).toBe(points[0].perDay);
  expect(points[1].cumulativeAllowance).toBe(points[0].perDay + points[1].perDay);
  for (let i = 1; i < points.length; i += 1) {
    expect(points[i].cumulativeAllowance).toBeGreaterThan(points[i - 1].cumulativeAllowance);
  }
});

// ---------------------------------------------------------------------------
// The states with nothing to draw — rule 4
// ---------------------------------------------------------------------------
test("no_limit PROJECTS NOTHING", () => {
  const input = workedExample();
  input.limits = [];

  expect(project(input)).toEqual([]);
});

test("OVER PROJECTS NOTHING RATHER THAN A FLAT LINE AT ZERO", () => {
  // Every day's allowance is ₱0.00, and a flat line at zero would suggest the
  // shortfall is being worked off. The Over state's own copy — "over by
  // ₱3,499.00 this period" — says the true thing instead.
  const input = workedExample();
  input.limits[0].spendInPeriod = 1_350_000;

  expect(computeSafeToSpend(input).state).toBe("over");
  expect(project(input)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Scopes and determinism — rules 1 and 5
// ---------------------------------------------------------------------------
test("A DAILY LIMIT PROJECTS EXACTLY ONE POINT", () => {
  // Its period is today alone, so there is one day to draw and no averaging.
  const input = workedExample();
  input.limits = [
    {
      id: "lim-daily",
      scope: "daily",
      effectiveValue: 100_000,
      spendInPeriod: 20_000,
      filtered: false,
      filterLabel: null,
      categoryIds: null,
    },
  ];
  input.unpaidBills = [];
  input.plannedContributions = [];

  const points = project(input);

  expect(points).toHaveLength(1);
  expect(points[0]).toMatchObject({ date: "2026-08-12", perDay: 80_000, billsDue: 0 });
});

test("on the period's last day the curve is a single point equal to the headroom left", () => {
  const input = workedExample();
  input.today = "2026-08-31";
  input.unpaidBills = [];
  input.plannedContributions = [];

  const points = project(input);

  expect(points).toHaveLength(1);
  expect(points[0].perDay).toBe(880_000);
});

test("THE CURVE IS DETERMINISTIC — SAME INPUT, SAME OUTPUT", () => {
  // Rule 5. No clock and no I/O, so two calls cannot differ; asserted rather
  // than assumed, because a stray `Date.now()` would only show up as a chart
  // that redraws differently on every render.
  const input = workedExample();

  expect(project(input)).toEqual(project(input));
});

test("a bill due AFTER the period end is not marked on the curve", () => {
  // It belongs to next month's projection, and marking it here would put a
  // deduction on a day the chart does not draw.
  const input = workedExample();
  input.unpaidBills.push({ id: "bill-next", name: "Rent", amount: 800_000, dueDate: "2026-09-05" , categoryId: "cat_bills" });

  const points = project(input);

  expect(points.every((point) => point.date <= "2026-08-31")).toBe(true);
  expect(points.reduce((sum, point) => sum + point.billsDue, 0)).toBe(399_900);
});
