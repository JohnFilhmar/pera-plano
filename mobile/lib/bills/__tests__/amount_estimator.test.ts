// lib/bills/__tests__/amount_estimator.test.ts — m2c Task 3.
//
// Pure arithmetic over a payment history. What a bill CURRENTLY costs, which
// Safe-to-Spend subtracts (spec rule 9) and rule 8's ">30% deviation" is
// measured against.
import { estimateAmount, type PaymentAmount } from "@/lib/bills/amount_estimator";
import type { Bill } from "@/types/domain";

const BASE: Bill = {
  id: "bill_1",
  name: "Meralco",
  amount: 235000,
  amountMode: "estimated",
  dueRule: { kind: "day-of-month", day: 20 },
  reminderOffsets: [-3, 0],
  autoMatchRule: null,
  categoryId: "cat_bills_utilities",
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
};

function estimated(overrides: Partial<Bill> = {}): Bill {
  return { ...BASE, ...overrides };
}

function history(...entries: [string, number][]): PaymentAmount[] {
  return entries.map(([cycleDueDate, amount]) => ({ cycleDueDate, amount }));
}

// ---------------------------------------------------------------------------
// Fixed bills — rule 5 of the spec
// ---------------------------------------------------------------------------
test("A FIXED BILL RETURNS ITS AMOUNT AND NEVER DRIFTS", () => {
  // Spec rule 5: "it changes only when the user edits it". Rent that quietly
  // re-estimated itself from a month the user overpaid would be worse than
  // useless — they set an exact figure precisely because it is exact.
  const bill = estimated({ amountMode: "fixed", amount: 800000 });

  const estimate = estimateAmount(
    bill,
    history(["2026-01-05", 850000], ["2026-02-05", 900000], ["2026-03-05", 950000]),
  );

  expect(estimate).toEqual({ amount: 800000, basis: "fixed", sampleSize: 0, spread: 0 });
});

// ---------------------------------------------------------------------------
// The seed — spec rule 6's "starts from the user's initial figure"
// ---------------------------------------------------------------------------
test("an estimated bill with no history returns its seed", () => {
  const estimate = estimateAmount(estimated(), []);

  expect(estimate).toEqual({ amount: 235000, basis: "seed", sampleSize: 0, spread: 0 });
});

test("ONE PAYMENT IS ALREADY ENOUGH — THERE IS NO MINIMUM SAMPLE", () => {
  // The m2c plan gates history behind "the spec's minimum sample". The spec has
  // none: rule 6 is "the arithmetic mean of the last three matched payment
  // amounts (FEWER IF HISTORY IS SHORTER)". Withholding a real observed amount
  // in favour of a guess the user typed once would make the first month after
  // every bill's first payment knowingly wrong.
  const estimate = estimateAmount(estimated(), history(["2026-01-20", 412300]));

  expect(estimate.amount).toBe(412300);
  expect(estimate.basis).toBe("history");
  expect(estimate.sampleSize).toBe(1);
});

// ---------------------------------------------------------------------------
// The statistic — spec rule 6, and the plan's disagreement with it
// ---------------------------------------------------------------------------
test("THE ESTIMATE IS THE MEAN OF THE LAST THREE, WHICH IS NOT THEIR MEDIAN", () => {
  // The m2c plan specifies the MEDIAN, arguing a summer spike must not raise
  // every future estimate. The spec chose the mean deliberately and says why in
  // its own Open Questions: "The mean of the last three payments is simple and
  // explainable ... Median-of-five is more robust but needs longer history.
  // DECIDE AFTER REAL PAYMENT VARIANCE DATA EXISTS FROM BETA USERS." The plan
  // ships the deferred answer as though it were settled.
  //
  // The spike is not ignored, it EXPIRES: two cycles later it has left the
  // window of three, which is the bounded distortion the spec accepted.
  const estimate = estimateAmount(
    estimated(),
    history(["2026-01-20", 200000], ["2026-02-20", 250000], ["2026-03-20", 900000]),
  );

  expect(estimate.amount).toBe(450000); // the mean
  expect(estimate.amount).not.toBe(250000); // the median, had the plan won
});

test("ONLY THE LAST THREE COUNT, AND THE OLDER ONES ARE NOT AVERAGED IN", () => {
  const estimate = estimateAmount(
    estimated(),
    history(
      ["2026-01-20", 100000],
      ["2026-02-20", 100000],
      ["2026-03-20", 200000],
      ["2026-04-20", 300000],
      ["2026-05-20", 400000],
    ),
  );

  expect(estimate.amount).toBe(300000); // (200000 + 300000 + 400000) / 3
  expect(estimate.sampleSize).toBe(3);
});

test("RECENCY IS BY CYCLE, NOT BY INPUT ORDER", () => {
  // A payment confirmed today can belong to a cycle three months old, so the
  // caller's array order is not a reliable timeline. Trusting it would let one
  // late confirmation silently redefine which three payments count.
  const estimate = estimateAmount(
    estimated(),
    history(
      ["2026-05-20", 400000],
      ["2026-01-20", 100000],
      ["2026-03-20", 200000],
      ["2026-04-20", 300000],
      ["2026-02-20", 100000],
    ),
  );

  expect(estimate.amount).toBe(300000);
});

test("the mean is rounded to a whole centavo", () => {
  // Money is integer centavos everywhere (contract §1). A third of a peso that
  // survived as a float would spread through Safe-to-Spend as a fraction of a
  // centavo nobody can pay.
  const estimate = estimateAmount(
    estimated(),
    history(["2026-01-20", 100000], ["2026-02-20", 100000], ["2026-03-20", 100001]),
  );

  expect(estimate.amount).toBe(100000);
  expect(Number.isInteger(estimate.amount)).toBe(true);
});

// ---------------------------------------------------------------------------
// Spread — how the UI stays honest about a variable bill
// ---------------------------------------------------------------------------
test("SPREAD IS THE RANGE OF THE SAMPLE ACTUALLY USED", () => {
  // The plan asks for an interquartile range, so the UI can say "usually
  // ₱1,800-₱2,400" instead of a false-precision single figure. That goal is
  // right and this is the honest way to reach it at this sample size: the spec
  // never uses more than THREE payments, and an IQR of three points discards
  // the two that a three-point sample is almost entirely made of.
  const estimate = estimateAmount(
    estimated(),
    history(["2026-01-20", 180000], ["2026-02-20", 210000], ["2026-03-20", 240000]),
  );

  expect(estimate.spread).toBe(60000); // 240000 - 180000
});

test("a steady bill has no spread, and one payment has none either", () => {
  const steady = estimateAmount(
    estimated(),
    history(["2026-01-20", 200000], ["2026-02-20", 200000], ["2026-03-20", 200000]),
  );
  expect(steady.spread).toBe(0);

  expect(estimateAmount(estimated(), history(["2026-01-20", 200000])).spread).toBe(0);
});

test("spread ignores payments outside the window it averaged", () => {
  // A spike from four cycles ago has already stopped moving the estimate; it
  // must not still be widening the range the UI shows.
  const estimate = estimateAmount(
    estimated(),
    history(
      ["2026-01-20", 900000],
      ["2026-03-20", 200000],
      ["2026-04-20", 210000],
      ["2026-05-20", 220000],
    ),
  );

  expect(estimate.spread).toBe(20000);
  expect(estimate.amount).toBe(210000);
});

// ---------------------------------------------------------------------------
// Floors — plan rule 5
// ---------------------------------------------------------------------------
test("AN ESTIMATE IS NEVER ZERO OR NEGATIVE", () => {
  // A zero estimate reads as "this bill is free" and silently removes a real
  // obligation from Safe-to-Spend. Amounts arrive from ledger transactions,
  // which the schema already keeps positive; this is the belt to that braces.
  const zeroed = estimateAmount(estimated(), history(["2026-01-20", 0]));
  expect(zeroed.amount).toBe(235000);
  expect(zeroed.basis).toBe("seed");

  const negative = estimateAmount(estimated(), history(["2026-01-20", -5000]));
  expect(negative.amount).toBe(235000);
});

test("a fixed bill with no history still returns its own amount", () => {
  const bill = estimated({ amountMode: "fixed", amount: 800000 });

  expect(estimateAmount(bill, [])).toEqual({
    amount: 800000,
    basis: "fixed",
    sampleSize: 0,
    spread: 0,
  });
});
