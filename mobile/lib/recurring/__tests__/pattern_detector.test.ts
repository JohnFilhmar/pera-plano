// lib/recurring/__tests__/pattern_detector.test.ts — M3 Part 2 Task 5.
//
// Pure clustering over a ledger. Fixtures are hand-built transactions rather
// than a seeded database, because every case here is about the SHAPE of a
// history — five identical monthly charges, one with a price rise, one with a
// gap — and shapes are easier to read as literals.
import { detectPatterns, MIN_OCCURRENCES } from "@/lib/recurring/pattern_detector";
import type { Transaction } from "@/types/domain";

const DAY_MS = 86_400_000;
const NOW = new Date(2026, 7, 16, 10, 0).getTime();

let sequence = 0;

function tx(over: Partial<Transaction> = {}): Transaction {
  sequence += 1;
  return {
    id: `tx-${sequence}`,
    walletId: "w-1",
    categoryId: "cat_uncategorized",
    amount: 54_900,
    direction: "out",
    occurredAt: NOW,
    merchant: "NETFLIX",
    counterparty: null,
    referenceNo: null,
    source: "notification",
    confidence: 0.9,
    rawNotificationId: null,
    transferLinkId: null,
    note: null,
    balanceAfter: null,
    computedBalance: null,
    isAdjustment: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/** `count` charges, `everyDays` apart, the newest `NOW`. */
function series(
  count: number,
  everyDays: number,
  over: Partial<Transaction> = {},
): Transaction[] {
  return Array.from({ length: count }, (_, index) =>
    tx({ ...over, occurredAt: NOW - (count - 1 - index) * everyDays * DAY_MS }),
  );
}

beforeEach(() => {
  sequence = 0;
});

// ---------------------------------------------------------------------------
// Minimum evidence — rule 2, domain §3.10
// ---------------------------------------------------------------------------
test("SIX IDENTICAL MONTHLY CHARGES DETECT ONE PATTERN", () => {
  const patterns = detectPatterns(series(6, 30), NOW);

  expect(patterns).toHaveLength(1);
  expect(patterns[0]).toMatchObject({
    merchant: "NETFLIX",
    amount: 54_900,
    periodDays: 30,
    occurrences: 6,
  });
});

test("THREE CHARGES ARE ENOUGH; TWO ARE A COINCIDENCE", () => {
  // Domain §3.10: "after at least 3 instances at a consistent interval and
  // amount". Two points define an interval but not a pattern — every pair of
  // purchases from the same shop would qualify.
  expect(detectPatterns(series(MIN_OCCURRENCES, 30), NOW)).toHaveLength(1);
  expect(detectPatterns(series(MIN_OCCURRENCES - 1, 30), NOW)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Amount tolerance — rule 3
// ---------------------------------------------------------------------------
test("A PRICE RISE INSIDE THE BAND STAYS ONE SUBSCRIPTION", () => {
  // Netflix going ₱549 → ₱599 is a 9% rise and obviously still Netflix. The
  // cost of being too tight is a subscription the user never gets told about,
  // which is the whole point of the feature.
  const history = [
    ...series(3, 30),
    tx({ amount: 59_900, occurredAt: NOW + 30 * DAY_MS }),
  ];

  const patterns = detectPatterns(history, NOW);

  expect(patterns).toHaveLength(1);
  expect(patterns[0].occurrences).toBe(4);
});

test("AN AMOUNT FAR OUTSIDE THE BAND IS A DIFFERENT THING ENTIRELY", () => {
  // A telco can bill a ₱149 plan AND a ₱1,200 annual top-up. Averaging them
  // reports one charge that matches neither.
  const history = [
    ...series(3, 30, { merchant: "GLOBE", amount: 14_900 }),
    ...series(3, 30, { merchant: "GLOBE", amount: 120_000 }),
  ];

  const patterns = detectPatterns(history, NOW);

  expect(patterns).toHaveLength(2);
  expect(patterns.map((pattern) => pattern.amount).sort((a, b) => a - b)).toEqual([
    14_900, 120_000,
  ]);
});

test("THE REPORTED AMOUNT IS THE MEDIAN, NOT THE MEAN", () => {
  // One price rise mid-history drags a mean to a figure that was never
  // charged; the median lands on a real one.
  const history = [
    tx({ amount: 50_000, occurredAt: NOW - 60 * DAY_MS }),
    tx({ amount: 50_000, occurredAt: NOW - 30 * DAY_MS }),
    tx({ amount: 56_000, occurredAt: NOW }),
  ];

  const patterns = detectPatterns(history, NOW);

  expect(patterns[0].amount).toBe(50_000);
});

// ---------------------------------------------------------------------------
// Interval tolerance — rule 4
// ---------------------------------------------------------------------------
test("28-TO-31 DAY GAPS ARE ONE MONTHLY CADENCE, NOT FOUR", () => {
  // Real monthly billing lands on calendar days, so the gaps vary with month
  // length. A detector that treated each gap as its own cadence would find
  // nothing at all in a genuine subscription.
  const start = new Date(2026, 0, 15).getTime();
  const history = [
    tx({ occurredAt: start }),
    tx({ occurredAt: new Date(2026, 1, 15).getTime() }), // +31
    tx({ occurredAt: new Date(2026, 2, 15).getTime() }), // +28
    tx({ occurredAt: new Date(2026, 3, 15).getTime() }), // +31
    tx({ occurredAt: new Date(2026, 4, 15).getTime() }), // +30
  ];

  const patterns = detectPatterns(history, NOW);

  expect(patterns).toHaveLength(1);
  expect(patterns[0].periodDays).toBeGreaterThanOrEqual(29);
  expect(patterns[0].periodDays).toBeLessThanOrEqual(31);
});

test("A WEEKLY CADENCE IS DETECTED AS WEEKLY", () => {
  const patterns = detectPatterns(series(5, 7), NOW);

  expect(patterns[0].periodDays).toBe(7);
});

test("IRREGULAR GAPS ARE NOT A SUBSCRIPTION", () => {
  // A coffee shop visited whenever the user feels like it. Three charges at
  // 5, 40 and 12 days apart is a habit, not a commitment.
  const history = [
    tx({ merchant: "STARBUCKS", occurredAt: NOW - 57 * DAY_MS }),
    tx({ merchant: "STARBUCKS", occurredAt: NOW - 52 * DAY_MS }),
    tx({ merchant: "STARBUCKS", occurredAt: NOW - 12 * DAY_MS }),
    tx({ merchant: "STARBUCKS", occurredAt: NOW }),
  ];

  expect(detectPatterns(history, NOW)).toEqual([]);
});

test("several charges on the same day are not a cadence", () => {
  const history = [tx({ occurredAt: NOW }), tx({ occurredAt: NOW }), tx({ occurredAt: NOW })];

  expect(detectPatterns(history, NOW)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Exclusions — rule 5
// ---------------------------------------------------------------------------
test("TRANSFER-LINKED TRANSACTIONS ARE EXCLUDED", () => {
  // Rule 5: moving money to your own savings every payday is not a
  // subscription, and reporting it as one would tell the user their saving
  // habit is a bill.
  const history = series(6, 30, { merchant: "TO GSAVE", transferLinkId: "tl-1" });

  expect(detectPatterns(history, NOW)).toEqual([]);
});

test("INBOUND TRANSACTIONS ARE EXCLUDED", () => {
  // A salary arriving every 15 days is the most regular thing in the ledger,
  // and it is income — the income detector's business, not this one's.
  const history = series(6, 15, { direction: "in", merchant: "PAYROLL" });

  expect(detectPatterns(history, NOW)).toEqual([]);
});

test("transactions with no merchant are excluded", () => {
  expect(detectPatterns(series(6, 30, { merchant: null }), NOW)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Confidence — rule 6
// ---------------------------------------------------------------------------
test("CONFIDENCE RISES WITH OCCURRENCES", () => {
  // Three instances is evidence, not proof. A year-old subscription should
  // outrank one seen three times.
  const three = detectPatterns(series(3, 30), NOW)[0];
  const six = detectPatterns(series(6, 30), NOW)[0];

  expect(six.confidence).toBeGreaterThan(three.confidence);
  expect(six.confidence).toBeLessThanOrEqual(1);
});

test("VARIANCE LOWERS CONFIDENCE", () => {
  const steady = detectPatterns(series(4, 30), NOW)[0];
  const wobbly = detectPatterns(
    [
      tx({ amount: 50_000, occurredAt: NOW - 92 * DAY_MS }),
      tx({ amount: 55_000, occurredAt: NOW - 60 * DAY_MS }),
      tx({ amount: 50_000, occurredAt: NOW - 34 * DAY_MS }),
      tx({ amount: 56_000, occurredAt: NOW }),
    ],
    NOW,
  )[0];

  expect(wobbly.confidence).toBeLessThan(steady.confidence);
});

// ---------------------------------------------------------------------------
// Projection and ordering — rules 7 and 8
// ---------------------------------------------------------------------------
test("NEXT EXPECTED IS PROJECTED FROM THE LAST CHARGE, NOT FROM TODAY", () => {
  // A subscription whose last charge was 33 days ago on a 30-day cycle is
  // THREE DAYS OVERDUE, and must read that way. Projecting from `now` instead
  // would quietly reschedule it forward and keep the app looking right while
  // the user's card has silently stopped being billed.
  const lastCharge = NOW - 33 * DAY_MS;
  const history = [
    tx({ occurredAt: lastCharge - 60 * DAY_MS }),
    tx({ occurredAt: lastCharge - 30 * DAY_MS }),
    tx({ occurredAt: lastCharge }),
  ];

  const pattern = detectPatterns(history, NOW)[0];

  expect(pattern.lastSeenAt).toBe(lastCharge);
  expect(pattern.nextExpectedAt).toBe(lastCharge + 30 * DAY_MS);
  expect(pattern.nextExpectedAt).toBeLessThan(NOW); // i.e. overdue
});

test("RESULTS ARE ORDERED BY MONTHLY COST, DEAREST FIRST", () => {
  // Rule 8. The list answers "what is this costing me", so a ₱1,200 monthly
  // gym belongs above a ₱59 weekly game pass even though the weekly one is
  // seen more often.
  const history = [
    ...series(4, 30, { merchant: "GYM", amount: 120_000 }),
    ...series(6, 7, { merchant: "GAMEPASS", amount: 5_900 }),
  ];

  const patterns = detectPatterns(history, NOW);

  expect(patterns.map((pattern) => pattern.merchant)).toEqual(["GYM", "GAMEPASS"]);
});

test("A WEEKLY CHARGE CAN OUTRANK A DEARER MONTHLY ONE ON MONTHLY COST", () => {
  // ₱500/week is ₱2,167/month and beats ₱1,200/month — which is exactly the
  // insight the feature exists to deliver, and why the ordering is by monthly
  // cost rather than by the sticker amount.
  const history = [
    ...series(4, 30, { merchant: "GYM", amount: 120_000 }),
    ...series(6, 7, { merchant: "LOAD", amount: 50_000 }),
  ];

  expect(detectPatterns(history, NOW).map((pattern) => pattern.merchant)).toEqual([
    "LOAD",
    "GYM",
  ]);
});

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
test("MERCHANTS ARE MATCHED NORMALISED BUT REPORTED AS THE USER SAW THEM", () => {
  // Normalisation is for MATCHING. Showing "NETFLIX COM" back to someone whose
  // statement said "Netflix.com" would look like the app mangled it.
  const history = [
    tx({ merchant: "Netflix.com", occurredAt: NOW - 60 * DAY_MS }),
    tx({ merchant: "Netflix.com", occurredAt: NOW - 30 * DAY_MS }),
    tx({ merchant: "NETFLIX COM", occurredAt: NOW }),
  ];

  const patterns = detectPatterns(history, NOW);

  expect(patterns).toHaveLength(1);
  expect(patterns[0].merchant).toBe("Netflix.com");
});

test("an empty ledger detects nothing and does not throw", () => {
  expect(detectPatterns([], NOW)).toEqual([]);
});

test("the detector is deterministic", () => {
  const history = [
    ...series(4, 30, { merchant: "GYM", amount: 120_000 }),
    ...series(4, 30, { merchant: "NETFLIX", amount: 54_900 }),
  ];

  expect(detectPatterns(history, NOW)).toEqual(detectPatterns(history, NOW));
});
