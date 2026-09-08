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
        categoryIds: null,
      },
    ],
    unpaidBills: [
      { id: "bill-1", name: "Meralco", amount: 230_000, dueDate: "2026-08-20", categoryId: "cat_bills" },
      { id: "bill-2", name: "PLDT", amount: 169_900, dueDate: "2026-08-25", categoryId: "cat_bills" },
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
    categoryIds: null,
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
  input.unpaidBills.push({ id: "bill-late", name: "Maynilad", amount: 90_000, dueDate: "2026-08-05" , categoryId: "cat_bills" });

  const result = computeSafeToSpend(input);

  expect(result.billsTerm).toBe(489_900); // 399,900 + 90,000
  expect(result.perDay).toBe(14_505); // (880,000 − 489,900 − 100,000) ÷ 20
});

test("a bill due AFTER the period end is not counted", () => {
  // It is next month's problem, and next month's headroom.
  const input = workedExample();
  input.unpaidBills.push({ id: "bill-next", name: "Rent", amount: 800_000, dueDate: "2026-09-05" , categoryId: "cat_bills" });

  expect(computeSafeToSpend(input).billsTerm).toBe(399_900);
});

test("A DAILY LIMIT ONLY SUBTRACTS TODAY'S BILLS", () => {
  // Rule 7: a daily scope's period is today alone, so days remaining is 1 and
  // the figure equals headroom minus SAME-DAY bills. Subtracting the month's
  // bills from one day's headroom would show ₱0 every day of the month.
  const input = workedExample();
  input.limits = [limit({ id: "lim-daily", scope: "daily", effectiveValue: 100_000 })];
  input.unpaidBills = [
    { id: "b-today", name: "Water", amount: 20_000, dueDate: "2026-08-12" , categoryId: "cat_bills" },
    { id: "b-later", name: "Meralco", amount: 230_000, dueDate: "2026-08-20" , categoryId: "cat_bills" },
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

  // THE STATE IS ASSERTED WITH THE FIGURE, and it is the half that makes this
  // case mean anything. `perDay: 0` is also what `numerator <= 0` returns —
  // the over branch floors at zero too — so on its own this assertion holds
  // against an implementation that had run out of headroom entirely, which is
  // the opposite of the claim in the title. ₱0.19 still unspent, and floored
  // to nothing per day, is the rounding direction under test.
  const nearlyOut = computeSafeToSpend(input);
  expect(nearlyOut.headroom).toBe(19);
  expect(nearlyOut.overBy).toBe(0);
  expect(nearlyOut.state).toBe("tight");
  expect(nearlyOut.perDay).toBe(0);

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

// ---------------------------------------------------------------------------
// `committed` — a FILTERED limit whose shortfall is commitments, not spending.
//
// Owner's 2026-08-31 report, second round. Home read "You're ₱2,220.00 over
// for this period / from your 8 categories limit" while that very limit showed
// "₱0.00 / ₱280.00 · ₱280.00 left". The arithmetic was right (rule 7), and the
// disclosure line now explains it — but the SENTENCE was still false: the user
// had not gone over an 8-categories limit. They had spent nothing in those 8
// categories. A ₱2,500 payday transfer to savings did it, and a savings
// transfer is never spend in ANY limit (invariant I2), least of all in a
// category slice that does not contain it.
//
// SCOPED TO FILTERED LIMITS ON PURPOSE. Rule 3: a filtered limit "caps only a
// slice of spending", and only drives the home number when nothing unfiltered
// exists. An UNFILTERED limit does describe overall spendable money, so
// commitments genuinely eat its headroom and the spec's Over semantics stand —
// including the canonical worked example above, which is explicitly "no
// filters" and must keep reporting "over by ₱3,499.00".
// ---------------------------------------------------------------------------

/** The reported device state: daily ₱280 cap, nothing spent, ₱2,500 to a goal. */
function reportedScreen(): SafeToSpendInput {
  return {
    today: "2026-08-31",
    limits: [
      limit({
        id: "lim-daily",
        scope: "daily",
        effectiveValue: 28_000,
        spendInPeriod: 0,
        filtered: true,
        filterLabel: "8 categories",
      }),
    ],
    unpaidBills: [],
    plannedContributions: [{ goalId: "goal-1", amount: 250_000, date: "2026-08-31" }],
    reviewQueueCount: 0,
  };
}

/**
 * The same day, but commitment-driven through the one route still open to a
 * filtered limit: a bill IN its categories. Since the commitment scoping
 * landed, a goal contribution can no longer put a category cap under water —
 * see the test immediately below, which pins exactly that.
 */
function committedByBill(): SafeToSpendInput {
  const input = reportedScreen();
  input.limits[0].categoryIds = ["cat_bills"];
  input.plannedContributions = [];
  input.unpaidBills = [
    { id: "b-today", name: "Meralco", amount: 250_000, dueDate: "2026-08-31", categoryId: "cat_bills" },
  ];
  return input;
}

test("A FILTERED LIMIT IS NOT 'OVER' WHEN ONLY COMMITMENTS EXCEED IT", () => {
  const result = computeSafeToSpend(committedByBill());

  expect(result.state).toBe("committed");
  // The money is still reserved — this is a change of ATTRIBUTION, not of
  // arithmetic. Spending today would still eat the bill.
  expect(result.perDay).toBe(0);
  expect(result.headroom).toBe(28_000);
  expect(result.billsTerm).toBe(250_000);
  // Nothing was overspent, so there is no "over by" figure to quote.
  expect(result.overBy).toBe(0);
});

test("a FILTERED limit whose own spend really does exceed it is still over", () => {
  // The distinction is the whole point: headroom below zero means the user
  // genuinely spent past this limit, and softening that would hide a real
  // overspend behind a bill.
  const input = committedByBill();
  input.limits[0].spendInPeriod = 30_000; // ₱300 spent against a ₱280 cap

  const result = computeSafeToSpend(input);

  expect(result.state).toBe("over");
  expect(result.overBy).toBe(252_000); // |(28,000 − 30,000) − 250,000|
});

test("A GOAL CONTRIBUTION CAN NO LONGER PUT A FILTERED LIMIT UNDER WATER", () => {
  // The owner's 2026-09-01 question, as an assertion. Same fixture that used
  // to report `committed` on a ₱2,500 transfer: the cap is untouched now, and
  // the day reads as the ordinary day it always was.
  const result = computeSafeToSpend(reportedScreen());

  expect(result.state).toBe("healthy");
  expect(result.perDay).toBe(28_000);
  expect(result.contributionsTerm).toBe(0);
});

test("AN UNFILTERED LIMIT KEEPS THE SPEC'S OVER SEMANTICS UNDER THE SAME COMMITMENTS", () => {
  // Same numbers, filter removed. An unfiltered limit measures overall
  // spendable money, so a commitment really does exhaust it and rule 9's Over
  // state is the honest answer.
  const input = reportedScreen();
  input.limits[0].filtered = false;
  input.limits[0].filterLabel = null;

  const result = computeSafeToSpend(input);

  expect(result.state).toBe("over");
  expect(result.overBy).toBe(222_000);
});

test("the spec's own over-variant is unfiltered, so it is untouched by this change", () => {
  // Guards the change from creeping onto the canonical example: headroom
  // ₱1,500, numerator −₱3,499, "over by ₱3,499.00 this period".
  const input = workedExample();
  input.limits[0].spendInPeriod = 1_350_000;

  const result = computeSafeToSpend(input);

  expect(input.limits[0].filtered).toBe(false);
  expect(result.state).toBe("over");
  expect(result.overBy).toBe(349_900);
});

// ---------------------------------------------------------------------------
// Commitments are scoped to what the limit actually measures.
//
// Owner's 2026-09-01 question: with every limit at 0% consumed, why is
// Safe-to-Spend ₱0.00? Because a ₱2,500 goal contribution was subtracted from
// a ₱1,965.38 weekly CATEGORY cap. Those are different pots. A goal
// contribution is committed as two legs joined by `linkTransfer`
// (lib/goals/goals_service.ts), and invariant I2 keeps transfer legs out of
// every limit's spend — so it can never consume a category cap's headroom, and
// subtracting it there is comparing a slice against money that will never
// touch that slice.
//
// Same rule for bills, which DO become spend: a bill consumes a filtered
// limit only when its own category sits inside that limit's filter.
//
// UNFILTERED LIMITS ARE UNTOUCHED. One is the closest thing to "your whole
// budget", which is the reading the spec's canonical formula and worked
// example are written against — and that example must keep coming out at
// ₱190.05.
// ---------------------------------------------------------------------------

test("A BILL OUTSIDE A FILTERED LIMIT'S CATEGORIES IS NOT DEDUCTED", () => {
  const input = workedExample();
  input.limits = [
    limit({ id: "lim-food", filtered: true, filterLabel: "Food", categoryIds: ["cat_food"] }),
  ];
  input.plannedContributions = [];

  const result = computeSafeToSpend(input);

  // Both bills are `cat_bills`; a Food cap never pays an electricity bill.
  expect(result.billsTerm).toBe(0);
  expect(result.headroom).toBe(1_500_000);
});

test("a bill INSIDE a filtered limit's categories is still deducted", () => {
  const input = workedExample();
  input.limits = [
    limit({ id: "lim-bills", filtered: true, filterLabel: "Bills", categoryIds: ["cat_bills"] }),
  ];
  input.plannedContributions = [];

  expect(computeSafeToSpend(input).billsTerm).toBe(399_900);
});

test("an UNFILTERED limit still deducts every bill, whatever its category", () => {
  const input = workedExample();
  input.plannedContributions = [];

  expect(computeSafeToSpend(input).billsTerm).toBe(399_900);
});

test("GOAL CONTRIBUTIONS NEVER REDUCE A FILTERED LIMIT — a transfer is in no category", () => {
  const input = workedExample();
  input.limits = [
    limit({ id: "lim-food", filtered: true, filterLabel: "Food", categoryIds: ["cat_food"] }),
  ];

  expect(computeSafeToSpend(input).contributionsTerm).toBe(0);
});

test("an unfiltered limit keeps reserving contributions — the canonical formula is unchanged", () => {
  expect(computeSafeToSpend(workedExample()).contributionsTerm).toBe(100_000);
});

test("REPORTED DEVICE, 2026-09-01: every limit at 0% now yields a real figure, not ₱0.00", () => {
  // Four filtered limits sliced from one annual budget, nothing spent, and a
  // ₱2,500 kinsenas allocation dated the day the week started.
  const input: SafeToSpendInput = {
    today: "2026-09-01",
    limits: [
      limit({ id: "daily", scope: "daily", effectiveValue: 28_000, filtered: true, filterLabel: "8 categories", categoryIds: ["cat_food"] }),
      limit({ id: "weekly", scope: "weekly", effectiveValue: 196_538, filtered: true, filterLabel: "8 categories", categoryIds: ["cat_food"] }),
      limit({ id: "monthly", scope: "monthly", effectiveValue: 851_667, filtered: true, filterLabel: "8 categories", categoryIds: ["cat_food"] }),
    ],
    unpaidBills: [],
    plannedContributions: [{ goalId: "goal-1", amount: 250_000, date: "2026-08-31" }],
    reviewQueueCount: 0,
  };

  const result = computeSafeToSpend(input);

  // The daily cap is the tightest per-day figure: ₱280.00 against the weekly's
  // ₱1,965.38 / 6 = ₱327.56 and the monthly's larger still.
  expect(result.state).toBe("healthy");
  expect(result.perDay).toBe(28_000);
  expect(result.drivingLimitId).toBe("daily");
  expect(result.contributionsTerm).toBe(0);
});

test("committed requires headroom above zero — a filtered limit spent exactly to its cap is over", () => {
  // headroom === 0 is not "money set aside", it is "allowance gone". Calling
  // that `committed` would dress an exhausted limit up as a savings plan.
  const input = reportedScreen();
  input.limits[0].spendInPeriod = 28_000;
  input.plannedContributions = [];

  expect(computeSafeToSpend(input).state).toBe("over");
});
