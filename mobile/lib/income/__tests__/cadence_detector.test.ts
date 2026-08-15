// lib/income/__tests__/cadence_detector.test.ts — m2-part2 Task 10.
//
// Every fixture is an explicit local date. Cadence is a claim about the user's
// wall calendar — "the 15th", "katapusan" — so a UTC-parsed fixture would agree
// with a UTC-based bug instead of catching it.
//
// Calendar facts these fixtures rest on:
//   2026 is a common year (February ends on the 28th); 2028 is a leap year.
//   June and November have 30 days; May, July, August have 31.
import {
  CONFIRMED_CONFIDENCE,
  detectCadence,
  PROVISIONAL_CONFIDENCE,
  UNCONFIRMED_CONFIDENCE,
} from "../cadence_detector";
import type { CandidateEvent } from "../candidates";

/** A candidate credit on a local date. Amount is irrelevant to cadence. */
function at(id: string, y: number, m: number, d: number): CandidateEvent {
  return {
    transactionId: id,
    walletId: "w-payroll",
    amount: 1850000,
    occurredAt: new Date(y, m, d, 10, 0).getTime(),
    merchant: "ACME PAYROLL",
    counterparty: null,
  };
}

const on = (y: number, m: number, d: number) => new Date(y, m, d, 10, 0).getTime();

// ---------------------------------------------------------------------------
// Kinsenas — the default hypothesis (rules 5, 6, 7)
// ---------------------------------------------------------------------------
test("six deposits on the 15th and month-end detect kinsenas, confirmed", () => {
  const events = [
    at("e1", 2026, 4, 15), // May 15
    at("e2", 2026, 4, 31), // May 31
    at("e3", 2026, 5, 15), // Jun 15
    at("e4", 2026, 5, 30), // Jun 30 — month-end is the 30th here, not the 31st
    at("e5", 2026, 6, 15), // Jul 15
    at("e6", 2026, 6, 31), // Jul 31
  ];

  const evidence = detectCadence(events, on(2026, 7, 5));

  expect(evidence.cadence).toBe("kinsenas");
  expect(evidence.confidence).toBe(CONFIRMED_CONFIDENCE);
  expect(evidence.matchedEventIds.sort()).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
});

test("kinsenas survives a payday sliding earlier across a weekend", () => {
  // Rule 7: the ±3-day windows "deliberately absorb the Philippine practice of
  // moving payday earlier when the 15th or 30th falls on a weekend or holiday".
  const events = [
    at("e1", 2026, 4, 13), // two days early
    at("e2", 2026, 4, 29), // two days early
    at("e3", 2026, 5, 12), // three days early — the edge of the window
    at("e4", 2026, 5, 30),
    at("e5", 2026, 6, 15),
    at("e6", 2026, 6, 31),
  ];

  const evidence = detectCadence(events, on(2026, 7, 5));

  expect(evidence.cadence).toBe("kinsenas");
  expect(evidence.confidence).toBe(CONFIRMED_CONFIDENCE);
});

test("kinsenas holds in February, where month-end is the 28th", () => {
  // Rule 6 anchors katapusan to "the last calendar day for short months, incl.
  // February". A detector that hard-codes the 30th sees nothing here.
  const events = [
    at("e1", 2025, 11, 15), // Dec 15 2025
    at("e2", 2025, 11, 31), // Dec 31
    at("e3", 2026, 0, 15), // Jan 15
    at("e4", 2026, 0, 31), // Jan 31
    at("e5", 2026, 1, 15), // Feb 15
    at("e6", 2026, 1, 28), // Feb 28 — the last day of a common-year February
  ];

  const evidence = detectCadence(events, on(2026, 2, 5));

  expect(evidence.cadence).toBe("kinsenas");
  expect(evidence.confidence).toBe(CONFIRMED_CONFIDENCE);
  expect(evidence.matchedEventIds).toContain("e6");
});

test("kinsenas holds in a leap February, where month-end is the 29th", () => {
  const events = [
    at("e1", 2027, 11, 15),
    at("e2", 2027, 11, 31),
    at("e3", 2028, 0, 15),
    at("e4", 2028, 0, 31),
    at("e5", 2028, 1, 15),
    at("e6", 2028, 1, 29), // Feb 29 2028
  ];

  const evidence = detectCadence(events, on(2028, 2, 5));

  expect(evidence.cadence).toBe("kinsenas");
  expect(evidence.matchedEventIds).toContain("e6");
});

test("kinsenas holds in a 31-day month, where month-end is the 31st", () => {
  const events = [
    at("e1", 2026, 4, 15),
    at("e2", 2026, 4, 31), // May has 31 days
    at("e3", 2026, 5, 15),
    at("e4", 2026, 5, 30), // June has 30
    at("e5", 2026, 6, 15),
    at("e6", 2026, 6, 31), // July has 31
  ];

  const evidence = detectCadence(events, on(2026, 7, 5));

  expect(evidence.cadence).toBe("kinsenas");
  expect(evidence.matchedEventIds).toEqual(expect.arrayContaining(["e2", "e4", "e6"]));
});

test("a credit outside the ±3-day window does not count as a match", () => {
  // The 19th is four days past the 15th. Rule 6's window is the 12th-18th.
  const events = [
    at("e1", 2026, 4, 15),
    at("e2", 2026, 4, 31),
    at("e3", 2026, 5, 19), // outside
    at("e4", 2026, 5, 30),
    at("e5", 2026, 6, 15),
    at("e6", 2026, 6, 31),
  ];

  const evidence = detectCadence(events, on(2026, 7, 5));

  expect(evidence.matchedEventIds).not.toContain("e3");
});

// ---------------------------------------------------------------------------
// Weekly and monthly (rule 6)
// ---------------------------------------------------------------------------
test("four weekly deposits on the same weekday detect weekly", () => {
  // Rule 6 weekly: "Gaps of 7 ±1 days between events, same weekday ±1".
  // Confirmed at 4 events / 3 qualifying gaps. These land on the 3rd, 10th,
  // 17th and 24th — none of them inside a kinsenas window, so kinsenas cannot
  // claim them first.
  const events = [
    at("e1", 2026, 6, 3),
    at("e2", 2026, 6, 10),
    at("e3", 2026, 6, 17),
    at("e4", 2026, 6, 24),
  ];

  const evidence = detectCadence(events, on(2026, 6, 27));

  expect(evidence.cadence).toBe("weekly");
  expect(evidence.confidence).toBe(CONFIRMED_CONFIDENCE);
  expect(evidence.matchedEventIds).toEqual(["e1", "e2", "e3", "e4"]);
});

test("four deposits on the SAME DAY OF MONTH detect monthly, not kinsenas", () => {
  // Deliberately the 15th, which IS inside a kinsenas window. Rule 6's kinsenas
  // test is credits landing ALTERNATELY in the two pay windows — one window
  // hit four times is not that, and a detector that only counts matches
  // without requiring both windows calls this kinsenas and doubles the user's
  // income (rule 16: M = 2 × averageAmount).
  const events = [
    at("e1", 2026, 3, 15),
    at("e2", 2026, 4, 15),
    at("e3", 2026, 5, 15),
    at("e4", 2026, 6, 15),
  ];

  const evidence = detectCadence(events, on(2026, 6, 20));

  expect(evidence.cadence).toBe("monthly");
  expect(evidence.confidence).toBe(CONFIRMED_CONFIDENCE);
});

test("monthly tolerates the same calendar date ±3", () => {
  // Rule 6 monthly: "gap 28-33 days, same calendar date ±3 (clamped for short
  // months)".
  const events = [at("e1", 2026, 3, 8), at("e2", 2026, 4, 10), at("e3", 2026, 5, 7)];

  const evidence = detectCadence(events, on(2026, 5, 20));

  expect(evidence.cadence).toBe("monthly");
});

// ---------------------------------------------------------------------------
// Irregular (rule 6's fallback) and the evidence threshold (rule 4)
// ---------------------------------------------------------------------------
test("scattered deposits fitting no pattern detect irregular, applied as the fallback", () => {
  // Rule 6's irregular row: "≥3 candidate events from the primary stream in the
  // trailing 90 days, fitting none of the above", and its Confirmed column
  // reads "Applied directly as the fallback classification". The m2-part2 plan
  // calls for "irregular with LOW confidence" here; the spec makes it a real
  // classification, and rule 11 then treats it as a working profile. Per this
  // plan's own Global Constraints, the spec wins.
  const events = [at("e1", 2026, 5, 2), at("e2", 2026, 5, 19), at("e3", 2026, 6, 8)];

  const evidence = detectCadence(events, on(2026, 6, 20));

  expect(evidence.cadence).toBe("irregular");
  expect(evidence.confidence).toBe(CONFIRMED_CONFIDENCE);
  expect(evidence.matchedEventIds.sort()).toEqual(["e1", "e2", "e3"]);
});

test("a SINGLE deposit detects irregular, unconfirmed — never a guessed cadence", () => {
  // Rule 4 of the plan, and the reason it matters: a cadence proposed from one
  // deposit sets `expectedNextAt`, which drives the payday event and the goals
  // auto-allocation prompt.
  const evidence = detectCadence([at("e1", 2026, 6, 15)], on(2026, 6, 20));

  expect(evidence.cadence).toBe("irregular");
  expect(evidence.confidence).toBe(UNCONFIRMED_CONFIDENCE);
});

test("no events at all is irregular and unconfirmed, not a throw", () => {
  const evidence = detectCadence([], on(2026, 6, 20));

  expect(evidence.cadence).toBe("irregular");
  expect(evidence.confidence).toBe(UNCONFIRMED_CONFIDENCE);
  expect(evidence.matchedEventIds).toEqual([]);
  expect(evidence.expectedNextAt).toBeNull();
});

test("two kinsenas windows are PROVISIONAL, not confirmed", () => {
  // Rule 6: provisional is 3 consecutive matched windows, confirmed is 4 of the
  // last 5. Two matches is neither — but it is also not nothing, and reporting
  // it as confirmed would auto-apply an income figure from a fortnight of data
  // (income flow 3).
  const events = [at("e1", 2026, 6, 15), at("e2", 2026, 6, 31)];

  const evidence = detectCadence(events, on(2026, 7, 5));

  expect(evidence.cadence).toBe("kinsenas");
  expect(evidence.confidence).toBe(PROVISIONAL_CONFIDENCE);
});

// ---------------------------------------------------------------------------
// The trailing window (rule 5) and expectedNextAt (plan rule 7)
// ---------------------------------------------------------------------------
test("only the trailing 120 days are considered", () => {
  // Rule 5: "Detection evaluates the trailing 120 days of candidate events".
  // A job the user left last year must not keep confirming a cadence.
  const events = [
    at("old1", 2025, 0, 15),
    at("old2", 2025, 0, 31),
    at("old3", 2025, 1, 15),
    at("old4", 2025, 1, 28),
    at("recent", 2026, 6, 15),
  ];

  const evidence = detectCadence(events, on(2026, 7, 5));

  expect(evidence.matchedEventIds).not.toContain("old1");
  expect(evidence.confidence).not.toBe(CONFIRMED_CONFIDENCE);
});

test("expectedNextAt for kinsenas is the next 15th or month-end after now", () => {
  const events = [
    at("e1", 2026, 4, 15),
    at("e2", 2026, 4, 31),
    at("e3", 2026, 5, 15),
    at("e4", 2026, 5, 30),
    at("e5", 2026, 6, 15),
    at("e6", 2026, 6, 31),
  ];

  // now = Aug 5 → the next anchor is Aug 15.
  expect(detectCadence(events, on(2026, 7, 5)).expectedNextAt).toBe(
    new Date(2026, 7, 15).getTime(),
  );
  // now = Aug 20 → the next anchor is Aug 31, August's last day.
  expect(detectCadence(events, on(2026, 7, 20)).expectedNextAt).toBe(
    new Date(2026, 7, 31).getTime(),
  );
});

test("expectedNextAt for weekly is seven days past the last matched event", () => {
  const events = [
    at("e1", 2026, 6, 3),
    at("e2", 2026, 6, 10),
    at("e3", 2026, 6, 17),
    at("e4", 2026, 6, 24),
  ];

  expect(detectCadence(events, on(2026, 6, 27)).expectedNextAt).toBe(
    new Date(2026, 6, 31).getTime(),
  );
});

test("expectedNextAt for monthly clamps into a short month", () => {
  // Jan 31 + one month is Feb 28, never March 3 — the same clamp
  // `addMonthsClampedIso` exists for.
  const events = [at("e1", 2025, 10, 30), at("e2", 2025, 11, 31), at("e3", 2026, 0, 31)];

  const evidence = detectCadence(events, on(2026, 1, 5));

  expect(evidence.cadence).toBe("monthly");
  expect(evidence.expectedNextAt).toBe(new Date(2026, 1, 28).getTime());
});

test("expectedNextAt is null for irregular", () => {
  // There is no next window to project. A number here would be a fabricated
  // payday that the goals auto-allocation prompt would key off.
  const events = [at("e1", 2026, 5, 2), at("e2", 2026, 5, 19), at("e3", 2026, 6, 8)];

  expect(detectCadence(events, on(2026, 6, 20)).expectedNextAt).toBeNull();
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------
test("detection is pure — same fixtures and same now, same answer, input untouched", () => {
  const events = [
    at("e1", 2026, 4, 15),
    at("e2", 2026, 4, 31),
    at("e3", 2026, 5, 15),
    at("e4", 2026, 5, 30),
  ];
  const snapshot = events.map((event) => event.transactionId);

  const first = detectCadence(events, on(2026, 6, 5));
  const second = detectCadence(events, on(2026, 6, 5));

  expect(first).toEqual(second);
  expect(events.map((event) => event.transactionId)).toEqual(snapshot);
});

test("event order in does not change the answer", () => {
  // The service hands over whatever the repository returned; a detector that
  // depended on arrival order would answer differently after a re-sort.
  const chronological = [
    at("e1", 2026, 4, 15),
    at("e2", 2026, 4, 31),
    at("e3", 2026, 5, 15),
    at("e4", 2026, 5, 30),
    at("e5", 2026, 6, 15),
    at("e6", 2026, 6, 31),
  ];
  const shuffled = [chronological[3], chronological[0], chronological[5], chronological[1], chronological[4], chronological[2]];

  expect(detectCadence(shuffled, on(2026, 7, 5))).toEqual(
    detectCadence(chronological, on(2026, 7, 5)),
  );
});
