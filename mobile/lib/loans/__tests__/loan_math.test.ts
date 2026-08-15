// lib/loans/__tests__/loan_math.test.ts — m2b Task 6.
//
// Every figure is centavos and every assertion is exact. An amortization
// schedule that ends ₱0.03 short is the kind of bug a user notices and cannot
// explain, and it destroys confidence in every other number the app shows.
import type { Loan } from "@/types/domain";

import {
  buildAmortizationSchedule,
  buildFlatSchedule,
  monthlyPayment,
  nextDue,
} from "../loan_math";

function loanOf(over: Partial<Loan> = {}): Loan {
  return {
    id: "l1",
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 5000000,
    interestRate: 12,
    schedule: null,
    linkedWalletId: null,
    nextDueDate: null,
    nextDueAmount: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// monthlyPayment — rule 1
// ---------------------------------------------------------------------------
test("THE WORKED VECTOR IS EXACT: ₱50,000 at 12% over 12 months is ₱4,442.44", () => {
  // Rule 6's pinned vector. `payment = P × i × (1+i)^n / ((1+i)^n − 1)` with
  // i = 12/100/12 = 0.01 and n = 12.
  expect(monthlyPayment(5000000, 12, 12)).toBe(444244);
});

test("A ZERO RATE FALLS BACK TO principal / n and never returns NaN", () => {
  // Rule 1: at i = 0 the formula's denominator `(1+i)^n − 1` is zero. Family
  // lending at no interest is the COMMON case in this market, so the fallback
  // is not an edge case — it is most of the informal loans the app will see.
  expect(monthlyPayment(1200000, 0, 12)).toBe(100000);
  expect(Number.isNaN(monthlyPayment(1200000, 0, 12))).toBe(false);
});

test("a zero-rate payment rounds rather than truncating", () => {
  // ₱10,000.01 over 3 months is 333,333.67 centavos.
  expect(monthlyPayment(1000001, 0, 3)).toBe(333334);
});

test("a one-month term is the whole principal plus one month of interest", () => {
  expect(monthlyPayment(1000000, 12, 1)).toBe(1010000);
});

// ---------------------------------------------------------------------------
// buildAmortizationSchedule — rules 2, 3, 6
// ---------------------------------------------------------------------------
test("the worked vector's schedule has 12 rows and ends at exactly zero", () => {
  const rows = buildAmortizationSchedule(5000000, 12, 12, "2026-09-15");

  expect(rows).toHaveLength(12);
  expect(rows[rows.length - 1].balanceAfter).toBe(0);
});

test("THE PRINCIPAL COLUMN SUMS TO EXACTLY THE PRINCIPAL", () => {
  // Rule 2: "absorb the accumulated rounding drift into the final row so the
  // schedule's principal column sums to exactly the principal."
  const rows = buildAmortizationSchedule(5000000, 12, 12, "2026-09-15");

  const summed = rows.reduce((total, row) => total + row.principal, 0);
  expect(summed).toBe(5000000);
});

test.each([
  [5000000, 12, 12],
  [1234567, 7.5, 24],
  [999999, 36, 6],
  [50000000, 0, 60],
  [100, 18, 3],
] as const)(
  "principal %i at %s%% over %i months still sums exactly and lands on zero",
  (principal, rate, term) => {
    // Parametrized because the drift only shows on awkward numbers. A schedule
    // that balances for ₱50,000 at 12% and not for ₱12,345.67 at 7.5% is a
    // schedule that balances by luck.
    const rows = buildAmortizationSchedule(principal, rate, term, "2026-09-15");

    expect(rows).toHaveLength(term);
    expect(rows.reduce((total, row) => total + row.principal, 0)).toBe(principal);
    expect(rows[rows.length - 1].balanceAfter).toBe(0);
  },
);

test("every row's payment is its principal plus its interest", () => {
  // Including the final row, which absorbs the drift — the absorption has to
  // move the PAYMENT too, or the row stops adding up on screen.
  const rows = buildAmortizationSchedule(1234567, 7.5, 24, "2026-09-15");

  for (const row of rows) {
    expect([row.index, row.payment]).toEqual([row.index, row.principal + row.interest]);
  }
});

test("the balance walks down monotonically to zero", () => {
  const rows = buildAmortizationSchedule(5000000, 12, 12, "2026-09-15");

  let previous = 5000000;
  for (const row of rows) {
    expect(row.balanceAfter).toBeLessThan(previous);
    expect(row.balanceAfter).toBeGreaterThanOrEqual(0);
    previous = row.balanceAfter;
  }
});

test("DUE DATES ADVANCE BY CALENDAR MONTH AND CLAMP AT A MONTH END", () => {
  // Rule 3: "a loan due the 31st is due the 28th in February". An unclamped
  // `setMonth` turns Jan 31 into Mar 3 and the loan silently skips February.
  const rows = buildAmortizationSchedule(1200000, 0, 4, "2025-12-31");

  expect(rows.map((row) => row.dueDate)).toEqual([
    "2025-12-31",
    "2026-01-31",
    "2026-02-28", // clamped
    "2026-03-31", // and back to the 31st, not stuck at the 28th
  ]);
});

test("clamping is measured from the ORIGINAL day, not carried forward", () => {
  // A schedule that carried the clamp would walk a month-end loan backwards a
  // few days a year and drift off the lender's actual due date.
  const rows = buildAmortizationSchedule(1200000, 0, 3, "2028-01-31");

  expect(rows.map((row) => row.dueDate)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
});

test("a zero-rate schedule has no interest at all", () => {
  const rows = buildAmortizationSchedule(1200000, 0, 12, "2026-09-15");

  expect(rows.every((row) => row.interest === 0)).toBe(true);
});

test("rows are indexed from 1, the way an installment is spoken about", () => {
  const rows = buildAmortizationSchedule(1200000, 0, 3, "2026-09-15");

  expect(rows.map((row) => row.index)).toEqual([1, 2, 3]);
});

// ---------------------------------------------------------------------------
// buildFlatSchedule — rule 4
// ---------------------------------------------------------------------------
test("A FLAT SCHEDULE IS N EQUAL INSTALLMENTS AT A FIXED INTERVAL", () => {
  // Rule 4, and spec rule 4: 5-6 "never gets an interest formula ... the
  // interest is already baked into the installment".
  const rows = buildFlatSchedule(100000, 6, "2026-08-22", 7);

  expect(rows).toHaveLength(6);
  expect(rows.every((row) => row.payment === 100000)).toBe(true);
  expect(rows.map((row) => row.dueDate)).toEqual([
    "2026-08-22",
    "2026-08-29",
    "2026-09-05",
    "2026-09-12",
    "2026-09-19",
    "2026-09-26",
  ]);
});

test("EVERY PESO OF A FLAT INSTALLMENT IS PRINCIPAL", () => {
  // Rule 4: "splits nothing into interest ... because informal lending states a
  // total, not a rate." Inventing a split would be the app deriving an interest
  // rate for 5-6, which spec rule 4 forbids outright.
  const rows = buildFlatSchedule(100000, 6, "2026-08-22", 7);

  expect(rows.every((row) => row.interest === 0)).toBe(true);
  expect(rows.every((row) => row.principal === row.payment)).toBe(true);
  expect(rows[rows.length - 1].balanceAfter).toBe(0);
});

test("a flat schedule's balance walks down from the stated total", () => {
  // The total repayable is the installment times the count — the figure the
  // collector states, not a computed principal.
  const rows = buildFlatSchedule(100000, 6, "2026-08-22", 7);

  expect(rows[0].balanceAfter).toBe(500000); // 600,000 total less the first
  expect(rows.reduce((total, row) => total + row.principal, 0)).toBe(600000);
});

test("a daily collector interval works as well as a weekly one", () => {
  // "collected on whatever schedule the collector keeps" (spec rule 4).
  const rows = buildFlatSchedule(5000, 3, "2026-08-22", 1);

  expect(rows.map((row) => row.dueDate)).toEqual(["2026-08-22", "2026-08-23", "2026-08-24"]);
});

// ---------------------------------------------------------------------------
// nextDue — rule 5
// ---------------------------------------------------------------------------
const SCHEDULE = [
  { dueDate: "2026-09-15", amountDue: 444244 },
  { dueDate: "2026-10-15", amountDue: 444244 },
  { dueDate: "2026-11-15", amountDue: 444244 },
];

test("nextDue returns the EARLIEST UNPAID row", () => {
  expect(nextDue(loanOf({ schedule: SCHEDULE }), 0)).toEqual({
    dueDate: "2026-09-15",
    amount: 444244,
  });
});

test("a fully covered installment advances to the next one", () => {
  expect(nextDue(loanOf({ schedule: SCHEDULE }), 444244)).toEqual({
    dueDate: "2026-10-15",
    amount: 444244,
  });
});

test("A PARTIAL PAYMENT DOES NOT SKIP THE ROW IT PARTIALLY PAID", () => {
  // Spec rule 11: "a partial payment reduces the outstanding nextDueAmount
  // remainder WITHOUT advancing the date." Advancing would tell the user their
  // September installment is settled when ₱2,442.44 of it is not, and the loan
  // would silently fall behind.
  expect(nextDue(loanOf({ schedule: SCHEDULE }), 200000)).toEqual({
    dueDate: "2026-09-15",
    amount: 244244,
  });
});

test("an overpayment carries into the following installment", () => {
  // Rule 11's third case: "an overpayment applies the excess to the balance."
  expect(nextDue(loanOf({ schedule: SCHEDULE }), 500000)).toEqual({
    dueDate: "2026-10-15",
    amount: 388488, // 444,244 less the ₱557.56 that spilled over
  });
});

test("nextDue is NULL for a free-form loan", () => {
  // Rule 5, and spec rule 1: free-form has "no schedule; nextDueDate /
  // nextDueAmount optional and user-managed". Inventing a due date for a loan
  // from a cousin would put a reminder on a promise nobody made.
  expect(nextDue(loanOf({ schedule: null }), 0)).toBeNull();
  expect(nextDue(loanOf({ schedule: [] }), 0)).toBeNull();
});

test("nextDue is NULL once the schedule is fully paid", () => {
  expect(nextDue(loanOf({ schedule: SCHEDULE }), 444244 * 3)).toBeNull();
});

test("nextDue is null when the loan is overpaid past the whole schedule", () => {
  expect(nextDue(loanOf({ schedule: SCHEDULE }), 9999999)).toBeNull();
});

test("nextDue reads the schedule in date order, not array order", () => {
  // The stored schedule comes back from JSON as written; a loan edited by hand
  // could hold it out of order, and a reminder for a date already past is
  // worse than none.
  const shuffled = [SCHEDULE[2], SCHEDULE[0], SCHEDULE[1]];

  expect(nextDue(loanOf({ schedule: shuffled }), 0)?.dueDate).toBe("2026-09-15");
});
