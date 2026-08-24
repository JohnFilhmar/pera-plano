// lib/income/__tests__/candidates.test.ts — m2 Task 9, income rules 1-4.
//
// Pure functions over ledger rows. Every instant is a LOCAL constructor, and
// every amount is centavos.
import type { Transaction } from "@/types/domain";

import { primaryStream, selectCandidates, type CandidateEvent } from "../candidates";

const ms = (y: number, m: number, d: number) => new Date(y, m, d, 10).getTime();

function tx(
  over: Partial<Transaction> & { id: string; amount: number; occurredAt: number },
): Transaction {
  return {
    walletId: "w1",
    categoryId: "c1",
    direction: "in",
    merchant: "ACME PAYROLL",
    counterparty: null,
    referenceNo: null,
    source: "notification",
    confidence: 1,
    rawNotificationId: null,
    transferLinkId: null,
    balanceAfter: null,
    computedBalance: null,
    note: null,
    createdAt: over.occurredAt,
    updatedAt: over.occurredAt,
    ...over,
  } as Transaction;
}

// ---------------------------------------------------------------------------
// selectCandidates — income rules 1-3
// ---------------------------------------------------------------------------
test("keeps committed inbound credits at or above ₱500 and drops everything else", async () => {
  const transactions = [
    tx({ id: "ok", amount: 1850000, occurredAt: ms(2026, 6, 15) }),
    tx({ id: "out", amount: 1850000, occurredAt: ms(2026, 6, 15), direction: "out" }),
    tx({ id: "transfer", amount: 1850000, occurredAt: ms(2026, 6, 15), transferLinkId: "tl1" }),
    tx({ id: "loanpay", amount: 1850000, occurredAt: ms(2026, 6, 15) }),
    tx({ id: "tiny", amount: 49900, occurredAt: ms(2026, 6, 15) }), // ₱499.00
    tx({ id: "edge", amount: 50000, occurredAt: ms(2026, 6, 16) }), // exactly ₱500.00
  ];

  const kept = selectCandidates(transactions, new Set(["loanpay"]));

  // The noise floor is INCLUSIVE at ₱500.00 (rule 1 says "≥"), which `edge`
  // pins and `tiny` pins from the other side.
  expect(kept.map((event) => event.transactionId).sort()).toEqual(["edge", "ok"]);
});

test("a transfer leg is never income, whichever direction it points", () => {
  // Domain invariant 2: internal movements are never income. Moving ₱20,000
  // from BPI to GCash produces a real inbound row, and counting it would let a
  // user manufacture income by shuffling their own money.
  const kept = selectCandidates(
    [tx({ id: "leg", amount: 2000000, occurredAt: ms(2026, 6, 15), transferLinkId: "tl1" })],
    new Set(),
  );

  expect(kept).toEqual([]);
});

test("a loan repayment is never income (rule 1 / loans rule 17)", () => {
  // Money someone owed you coming back is your own money, and counting it
  // inflates the figure every percent-of-income limit is measured against.
  const kept = selectCandidates(
    [tx({ id: "repay", amount: 500000, occurredAt: ms(2026, 6, 15) })],
    new Set(["repay"]),
  );

  expect(kept).toEqual([]);
});

test("manual entries qualify (rule 3)", () => {
  // "so a user who enters a missed pay credit by hand keeps their IncomeProfile
  // healthy" — an ingest interruption must not look like a missed payday.
  const kept = selectCandidates(
    [tx({ id: "m1", amount: 1850000, occurredAt: ms(2026, 6, 15), source: "manual" })],
    new Set(),
  );

  expect(kept).toHaveLength(1);
  expect(kept[0].transactionId).toBe("m1");
});

test("excludes a refund: same amount, same merchant, within 7 days of a PRIOR outflow", () => {
  const transactions = [
    tx({ id: "buy", amount: 250000, occurredAt: ms(2026, 6, 10), direction: "out", merchant: "SHOPEE" }),
    tx({ id: "refund", amount: 250000, occurredAt: ms(2026, 6, 14), merchant: "SHOPEE" }),
    tx({ id: "late", amount: 250000, occurredAt: ms(2026, 6, 20), merchant: "SHOPEE" }), // 10 days
  ];

  expect(selectCandidates(transactions, new Set()).map((event) => event.transactionId)).toEqual([
    "late",
  ]);
});

test("the refund window is the PREVIOUS 7 days, not a 7-day radius", () => {
  // An outflow AFTER the credit cannot be what the credit refunds. Dropping the
  // ordering check would silence a genuine payday that happens to be followed
  // by a purchase of the same size at the same merchant.
  const transactions = [
    tx({ id: "credit", amount: 250000, occurredAt: ms(2026, 6, 10), merchant: "SHOPEE" }),
    tx({ id: "buy", amount: 250000, occurredAt: ms(2026, 6, 12), direction: "out", merchant: "SHOPEE" }),
  ];

  expect(selectCandidates(transactions, new Set()).map((event) => event.transactionId)).toEqual([
    "credit",
  ]);
});

test("a different merchant or a different amount is not a refund", () => {
  const transactions = [
    tx({ id: "buy", amount: 250000, occurredAt: ms(2026, 6, 10), direction: "out", merchant: "SHOPEE" }),
    tx({ id: "other-merchant", amount: 250000, occurredAt: ms(2026, 6, 12), merchant: "LAZADA" }),
    tx({ id: "other-amount", amount: 260000, occurredAt: ms(2026, 6, 12), merchant: "SHOPEE" }),
  ];

  expect(
    selectCandidates(transactions, new Set()).map((event) => event.transactionId).sort(),
  ).toEqual(["other-amount", "other-merchant"]);
});

test("merchant matching for refunds ignores case and surrounding space", () => {
  // Provider notifications are not consistent about either, and a refund that
  // slips through becomes a phantom payday in the cadence evidence.
  const transactions = [
    tx({ id: "buy", amount: 250000, occurredAt: ms(2026, 6, 10), direction: "out", merchant: " shopee " }),
    tx({ id: "refund", amount: 250000, occurredAt: ms(2026, 6, 12), merchant: "SHOPEE" }),
  ];

  expect(selectCandidates(transactions, new Set())).toEqual([]);
});

test("a credit with NO merchant is never treated as a refund", () => {
  // Two unnamed rows of the same size are not evidence of anything, and
  // matching them would drop real income from providers that name nobody.
  const transactions = [
    tx({ id: "buy", amount: 250000, occurredAt: ms(2026, 6, 10), direction: "out", merchant: null }),
    tx({ id: "credit", amount: 250000, occurredAt: ms(2026, 6, 12), merchant: null }),
  ];

  expect(selectCandidates(transactions, new Set()).map((event) => event.transactionId)).toEqual([
    "credit",
  ]);
});

test("candidates carry the counterparty as well as the merchant", () => {
  // Rule 4 groups on "normalized merchant/COUNTERPARTY where present". A padala
  // names a person, not a merchant, and the m2 plan's CandidateEvent has no
  // field to carry it — so every padala would group under the same empty key.
  const kept = selectCandidates(
    [
      tx({
        id: "padala",
        amount: 300000,
        occurredAt: ms(2026, 6, 15),
        merchant: null,
        counterparty: "JUAN DELA CRUZ",
      }),
    ],
    new Set(),
  );

  expect(kept[0]).toEqual({
    transactionId: "padala",
    walletId: "w1",
    amount: 300000,
    occurredAt: ms(2026, 6, 15),
    merchant: null,
    counterparty: "JUAN DELA CRUZ",
  });
});

test("no transactions yields no candidates", () => {
  expect(selectCandidates([], new Set())).toEqual([]);
});

// ---------------------------------------------------------------------------
// primaryStream — income rule 4
// ---------------------------------------------------------------------------
const ev = (
  id: string,
  amount: number,
  day: number,
  merchant: string | null = "ACME PAYROLL",
  walletId = "w1",
  counterparty: string | null = null,
): CandidateEvent => ({
  transactionId: id,
  walletId,
  amount,
  occurredAt: ms(2026, 6, day),
  merchant,
  counterparty,
});

test("picks the largest group by wallet + payer + amount band", () => {
  const stream = primaryStream([
    ev("s1", 1850000, 1),
    ev("s2", 1900000, 15),
    ev("s3", 1820000, 30),
    ev("s4", 1850000, 31),
    ev("p1", 300000, 5, "PADALA JUAN", "w2"),
    ev("p2", 310000, 20, "PADALA JUAN", "w2"),
  ]);

  expect(stream.map((event) => event.transactionId).sort()).toEqual(["s1", "s2", "s3", "s4"]);
});

test("the same payer splits into bands when amounts differ beyond ±30%", () => {
  // ₱18,500 and ₱1,000 from the same wallet and merchant are two different
  // things — a salary and something else — and averaging them would produce a
  // figure that describes neither.
  const stream = primaryStream([
    ev("a1", 1850000, 1),
    ev("a2", 1850000, 15),
    ev("b1", 100000, 2),
    ev("b2", 100000, 16),
    ev("b3", 100000, 28),
  ]);

  expect(stream.map((event) => event.transactionId).sort()).toEqual(["b1", "b2", "b3"]);
});

test("the band is measured against the group's RUNNING median, so it tracks drift", () => {
  // A raise arriving gradually stays one stream. Each event is compared to the
  // median of what the group holds SO FAR, not to the group's first member —
  // ₱14,000 is 40% above ₱10,000 and would start a second band, but only 24%
  // above the ₱11,250 median the group actually holds by then.
  const stream = primaryStream([
    ev("r1", 1000000, 1),
    ev("r2", 1250000, 8), // +25% of the ₱10,000 median — in band
    ev("r3", 1400000, 15), // +24% of the ₱11,250 median — still in band
  ]);

  expect(stream.map((event) => event.transactionId)).toEqual(["r1", "r2", "r3"]);
});

test("different wallets are different streams even for the same payer", () => {
  // Rule 4 keys on walletId first: the same employer paying into two accounts
  // is two streams, and MVP models exactly one.
  const stream = primaryStream([
    ev("a1", 1850000, 1, "ACME PAYROLL", "w1"),
    ev("b1", 1850000, 2, "ACME PAYROLL", "w2"),
    ev("b2", 1850000, 16, "ACME PAYROLL", "w2"),
  ]);

  expect(stream.map((event) => event.transactionId)).toEqual(["b1", "b2"]);
});

test("a counterparty groups a padala that names no merchant", () => {
  const stream = primaryStream([
    ev("j1", 300000, 1, null, "w1", "JUAN DELA CRUZ"),
    ev("j2", 310000, 15, null, "w1", "JUAN DELA CRUZ"),
    ev("m1", 300000, 2, null, "w1", "MARIA SANTOS"),
  ]);

  // Without the counterparty in the key all three share the empty payer and one
  // ₱3,000 band, and the largest "stream" is three unrelated people.
  expect(stream.map((event) => event.transactionId)).toEqual(["j1", "j2"]);
});

test("payer matching ignores case and surrounding space", () => {
  const stream = primaryStream([
    ev("a1", 1850000, 1, " acme payroll "),
    ev("a2", 1850000, 15, "ACME PAYROLL"),
    ev("z1", 1850000, 2, "OTHER", "w2"),
  ]);

  expect(stream.map((event) => event.transactionId)).toEqual(["a1", "a2"]);
});

test("empty input yields an empty stream", () => {
  expect(primaryStream([])).toEqual([]);
});

test("a single credit IS returned — 'recurring' is judged downstream", () => {
  // Rule 6's evidence thresholds decide whether a stream is established;
  // suppressing a one-event group here would hide the FIRST payday of a
  // genuinely new stream, which is exactly one event until the second arrives.
  const stream = primaryStream([ev("first", 1850000, 15)]);

  expect(stream.map((event) => event.transactionId)).toEqual(["first"]);
});

test("does not mutate the array it is given", () => {
  const events = [ev("late", 1850000, 30), ev("early", 1850000, 1)];

  primaryStream(events);

  expect(events.map((event) => event.transactionId)).toEqual(["late", "early"]);
});

test("returns each group's events in chronological order", () => {
  // Cadence detection reads gaps between consecutive events (rule 6), so an
  // unordered stream would compute negative gaps and confirm nothing.
  const stream = primaryStream([ev("c", 1850000, 30), ev("a", 1850000, 1), ev("b", 1850000, 15)]);

  expect(stream.map((event) => event.transactionId)).toEqual(["a", "b", "c"]);
});
