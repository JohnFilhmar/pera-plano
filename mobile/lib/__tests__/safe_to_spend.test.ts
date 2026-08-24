// lib/__tests__/safe_to_spend.test.ts — M3 Task 1.
//
// The spec's worked ₱ example is the centrepiece: if this file is right, the
// number on the home screen is right. Every amount is centavos.
import {
  computeSafeToSpend,
  type CandidateLimit,
  type SafeToSpendInput,
} from "@/lib/safe_to_spend";

/** docs/04-features/09-safe-to-spend.md §Worked example, August 12 2026. */
function workedExample(): SafeToSpendInput {
  return {
    today: "2026-08-12",
    limits: [
      {
        id: "lim-1",
        scope: "monthly",
        effectiveValue: 1_500_000, // ₱15,000.00 fixed, no filters
        spendInPeriod: 620_000, // ₱6,200.00 committed Aug 1–11
        filtered: false,
        filterLabel: null,
      },
    ],
    unpaidBills: [
      { id: "bill-1", name: "Meralco", amount: 230_000, dueDate: "2026-08-20" },
      { id: "bill-2", name: "PLDT", amount: 169_900, dueDate: "2026-08-25" },
    ],
    plannedContributions: [{ goalId: "goal-1", amount: 100_000, date: "2026-08-15" }],
    reviewQueueCount: 0,
  };
}

function limit(over: Partial<CandidateLimit> = {}): CandidateLimit {
  return {
    id: "lim",
    scope: "monthly",
    effectiveValue: 1_500_000,
    spendInPeriod: 0,
    filtered: false,
    filterLabel: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The worked example
// ---------------------------------------------------------------------------
test("THE SPEC'S WORKED EXAMPLE COMES OUT AT EXACTLY ₱190.05", () => {
  const result = computeSafeToSpend(workedExample());

  expect(result.headroom).toBe(880_000); // 1,500,000 − 620,000
  expect(result.billsTerm).toBe(399_900); // 230,000 + 169,900
  expect(result.contributionsTerm).toBe(100_000);
  expect(result.daysRemaining).toBe(20); // Aug 12–31 inclusive
  expect(result.perDay).toBe(19_005); // 380,100 ÷ 20
  expect(result.state).toBe("healthy"); // 6,200/15,000 = 41%
  expect(result.overBy).toBe(0);
  expect(result.drivingLimitId).toBe("lim-1");
  expect(result.periodEnd).toBe("2026-08-31");
});

test("THE OVER VARIANT FLOORS AT ZERO AND REPORTS THE WHOLE-PERIOD SHORTFALL", () => {
  // Spec: spend ₱13,500.00 → headroom ₱1,500.00, numerator −₱3,499.00 →
  // "₱0.00, over by ₱3,499.00 this period". Rule 9 is explicit that overBy is
  // the whole-period shortfall — dividing it would tell a user who is ₱3,499
  // over that they are ₱175 over.
  const input = workedExample();
  input.limits[0].spendInPeriod = 1_350_000;

  const result = computeSafeToSpend(input);

  expect(result.state).toBe("over");
  expect(result.perDay).toBe(0);
  expect(result.overBy).toBe(349_900);
});

// ---------------------------------------------------------------------------
// Candidates and the driving limit — rules 1-3
// ---------------------------------------------------------------------------
test("no candidate limits is its own state, not a zero", () => {
  // ₱0.00 means "you have spent your allowance". No limit means the app has
  // not been told what the allowance is. Showing the first for the second
  // would be a lie the user cannot act on.
  const result = computeSafeToSpend({ ...workedExample(), limits: [] });

  expect(result.state).toBe("no_limit");
  expect(result.drivingLimitId).toBeNull();
  expect(result.periodEnd).toBeNull();
});

test("TIGHTEST WINS: THE LOWEST RESULTING VALUE DRIVES", () => {
  const input = workedExample();
  input.limits.push(limit({ id: "lim-2", effectiveValue: 900_000, spendInPeriod: 620_000 }));

  expect(computeSafeToSpend(input).drivingLimitId).toBe("lim-2");
});

test("TIES BREAK TOWARD THE SHORTER SCOPE", () => {
  // Two limits both floored to ₱0 have an identical perDay. The daily one is
  // the constraint the user runs into first, so it is the honest one to name.
  const input: SafeToSpendInput = {
    today: "2026-08-12",
    limits: [
      limit({ id: "lim-monthly", scope: "monthly", effectiveValue: 100, spendInPeriod: 500_000 }),
      limit({ id: "lim-daily", scope: "daily", effectiveValue: 100, spendInPeriod: 500_000 }),
    ],
    unpaidBills: [],
    plannedContributions: [],
    reviewQueueCount: 0,
  };

  const result = computeSafeToSpend(input);

  expect(result.perDay).toBe(0);
  expect(result.drivingLimitId).toBe("lim-daily");
});

test("A FILTERED LIMIT NEVER DRIVES WHILE AN UNFILTERED ONE EXISTS", () => {
  // Rule 3: a category cap describes a SLICE of spending; the home number
  // describes overall spendable money. A ₱500 Food limit driving the headline
  // would tell a user with ₱8,800 of real headroom that they have ₱25 a day.
  const input = workedExample();
  input.limits.push(
    limit({
      id: "lim-food",
      effectiveValue: 50_000,
      spendInPeriod: 40_000,
      filtered: true,
      filterLabel: "Food & Dining",
    }),
  );

  const result = computeSafeToSpend(input);

  expect(result.drivingLimitId).toBe("lim-1");
  expect(result.drivingFilterLabel).toBeNull();
});

test("WITH ONLY FILTERED LIMITS, THE TIGHTEST DRIVES AND THE CAPTION NAMES IT", () => {
  // Rule 3's second half. The number is then honest only if the user is told
  // which slice it describes.
  const input = workedExample();
  input.limits = [
    limit({ id: "lim-food", effectiveValue: 300_000, filtered: true, filterLabel: "Food & Dining" }),
    limit({ id: "lim-transport", effectiveValue: 100_000, filtered: true, filterLabel: "Transport" }),
  ];
  input.unpaidBills = [];
  input.plannedContributions = [];

  const result = computeSafeToSpend(input);

  expect(result.drivingLimitId).toBe("lim-transport");
  expect(result.drivingFilterLabel).toBe("Transport");
});

// ---------------------------------------------------------------------------
// The bills term — rule 5
// ---------------------------------------------------------------------------
test("AN OVERDUE BILL KEEPS SUBTRACTING — MONEY OWED IS MONEY NOT SPENDABLE", () => {
  // Bills rules 24-25 via safe-to-spend rule 5(a). The obvious
  // `dueDate >= today` filter would drop exactly these, which are the bills the
  // user most needs counted.
  const input = workedExample();
  input.unpaidBills.push({ id: "bill-late", name: "Maynilad", amount: 90_000, dueDate: "2026-08-05" });

  const result = computeSafeToSpend(input);

  expect(result.billsTerm).toBe(489_900); // 399,900 + 90,000
  expect(result.perDay).toBe(14_505); // (880,000 − 489,900 − 100,000) ÷ 20
});

test("a bill due AFTER the period end is not counted", () => {
  // It is next month's problem, and next month's headroom.
  const input = workedExample();
  input.unpaidBills.push({ id: "bill-next", name: "Rent", amount: 800_000, dueDate: "2026-09-05" });

  expect(computeSafeToSpend(input).billsTerm).toBe(399_900);
});

test("A DAILY LIMIT ONLY SUBTRACTS TODAY'S BILLS", () => {
  // Rule 7: a daily scope's period is today alone, so days remaining is 1 and
  // the figure equals headroom minus SAME-DAY bills. Subtracting the month's
  // bills from one day's headroom would show ₱0 every day of the month.
  const input = workedExample();
  input.limits = [limit({ id: "lim-daily", scope: "daily", effectiveValue: 100_000 })];
  input.unpaidBills = [
    { id: "b-today", name: "Water", amount: 20_000, dueDate: "2026-08-12" },
    { id: "b-later", name: "Meralco", amount: 230_000, dueDate: "2026-08-20" },
  ];
  input.plannedContributions = [];

  const result = computeSafeToSpend(input);

  expect(result.daysRemaining).toBe(1);
  expect(result.billsTerm).toBe(20_000);
  expect(result.perDay).toBe(80_000);
});

// ---------------------------------------------------------------------------
// The contributions term — rule 6
// ---------------------------------------------------------------------------
test("A CONTRIBUTION WHOSE DATE HAS PASSED IS STILL COMMITTED MONEY", () => {
  // Rule 6 counts contributions "from the START of the period", not from today.
  // The Aug 15 allocation is still reserved on Aug 20 — dropping it once its
  // date passed would hand the user back money they have already moved.
  const input = workedExample();
  input.today = "2026-08-20";

  const result = computeSafeToSpend(input);

  expect(result.contributionsTerm).toBe(100_000);
  expect(result.daysRemaining).toBe(12); // Aug 20–31
});

test("a contribution outside the period is not counted", () => {
  const input = workedExample();
  input.plannedContributions.push({ goalId: "goal-2", amount: 500_000, date: "2026-09-15" });

  expect(computeSafeToSpend(input).contributionsTerm).toBe(100_000);
});

test("no contribution rules at all leaves the term at zero", () => {
  // Spec: "₱0 when none exists" — auto-allocation is Plus, and a free user's
  // number must not be reduced by a feature they do not have.
  const input = workedExample();
  input.plannedContributions = [];

  const result = computeSafeToSpend(input);

  expect(result.contributionsTerm).toBe(0);
  expect(result.perDay).toBe(24_005); // (880,000 − 399,900) ÷ 20
});

// ---------------------------------------------------------------------------
// States, rounding, and boundaries
// ---------------------------------------------------------------------------
test("TIGHT BEGINS AT 80% OF THE LIMIT SPENT", () => {
  const input = workedExample();
  input.unpaidBills = [];
  input.plannedContributions = [];

  input.limits[0].spendInPeriod = 1_199_999; // 79.99%
  expect(computeSafeToSpend(input).state).toBe("healthy");

  input.limits[0].spendInPeriod = 1_200_000; // exactly 80%
  expect(computeSafeToSpend(input).state).toBe("tight");
});

test("EXACTLY ZERO LEFT IS OVER, NOT HEALTHY", () => {
  // Rule 9 floors "≤ ₱0" into the Over state. Nothing left to spend is not a
  // healthy position, and ₱0.00 with a healthy tone would read as fine.
  const input = workedExample();
  input.unpaidBills = [];
  input.plannedContributions = [];
  input.limits[0].spendInPeriod = 1_500_000;

  const result = computeSafeToSpend(input);

  expect(result.state).toBe("over");
  expect(result.perDay).toBe(0);
  expect(result.overBy).toBe(0);
});

test("THE PER-DAY FIGURE ROUNDS DOWN, NEVER UP", () => {
  // ₱190.049 shown as ₱190.05 is the direction that overspends — by one
  // centavo a day, every day, on the one number the user is trusting.
  const input = workedExample();
  input.unpaidBills = [];
  input.plannedContributions = [];
  input.limits[0].spendInPeriod = 1_500_000 - 19; // 19 centavos over 20 days

  expect(computeSafeToSpend(input).perDay).toBe(0);

  input.limits[0].spendInPeriod = 1_500_000 - 39; // 39 centavos over 20 days
  expect(computeSafeToSpend(input).perDay).toBe(1);
});

test("ON THE LAST DAY THE FIGURE IS THE WHOLE REMAINING HEADROOM", () => {
  // Rule 15: days remaining = 1, "no averaging".
  const input = workedExample();
  input.today = "2026-08-31";
  input.unpaidBills = [];
  input.plannedContributions = [];

  const result = computeSafeToSpend(input);

  expect(result.daysRemaining).toBe(1);
  expect(result.perDay).toBe(880_000);
});

test("REVIEW QUEUE ITEMS ARE CARRIED, NEVER SUBTRACTED", () => {
  // Rule 12: uncommitted items are excluded until confirmed, and the UI
  // discloses it. Silently subtracting them would make the number move when
  // nothing was spent.
  const input = workedExample();
  input.reviewQueueCount = 3;

  const result = computeSafeToSpend(input);

  expect(result.reviewQueueCount).toBe(3);
  expect(result.perDay).toBe(19_005); // unchanged from the worked example
});

test("a limit already at zero value does not divide by zero or report NaN", () => {
  const input = workedExample();
  input.limits = [limit({ id: "lim-zero", effectiveValue: 0, spendInPeriod: 0 })];
  input.unpaidBills = [];
  input.plannedContributions = [];

  const result = computeSafeToSpend(input);

  expect(result.state).toBe("over");
  expect(Number.isFinite(result.perDay)).toBe(true);
  expect(result.perDay).toBe(0);
});
