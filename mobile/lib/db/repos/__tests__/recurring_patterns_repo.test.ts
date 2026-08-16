// lib/db/repos/__tests__/recurring_patterns_repo.test.ts — M3 Part 2 Task 6,
// step 1 (fix round 1: identity match moved to merchant + period bucket +
// amount tolerance; see this repo's own header comment for why).
import { closeDatabase } from "@/lib/db/database";
import { createBill } from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import {
  acknowledgePattern,
  clearDismissal,
  dismissPattern,
  findMatchingPattern,
  getPattern,
  linkPatternToBill,
  listPatterns,
  periodFor,
  upsertPattern,
} from "@/lib/db/repos/recurring_patterns_repo";
import { freshDb } from "@/test_support/db";
import type { Bill } from "@/types/domain";
import type { DetectedPattern } from "@/lib/recurring/pattern_detector";

const DAY_MS = 86_400_000;
const NOW = new Date(2026, 7, 16, 10, 0).getTime();

function pattern(over: Partial<DetectedPattern> = {}): DetectedPattern {
  const lastSeenAt = NOW;
  const periodDays = over.periodDays ?? 30;
  return {
    merchant: "NETFLIX",
    amount: 54_900,
    periodDays,
    occurrences: 6,
    confidence: 0.9,
    firstSeenAt: NOW - 5 * periodDays * DAY_MS,
    lastSeenAt,
    nextExpectedAt: lastSeenAt + periodDays * DAY_MS,
    transactionIds: ["tx-1", "tx-2", "tx-3"],
    ...over,
  };
}

let bill: Bill;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  bill = await createBill({
    name: "Netflix",
    amount: 54_900,
    amountMode: "estimated",
    dueRule: { kind: "day-of-month", day: 8 },
  });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Upsert — keyed on normalized merchant + periodDays
// ---------------------------------------------------------------------------
describe("upsertPattern", () => {
  test("the same merchant and periodDays twice does not duplicate", async () => {
    await upsertPattern(pattern());
    await upsertPattern(pattern({ amount: 59_900, confidence: 0.95 }));

    const rows = await listPatterns({ includeAcknowledged: true });
    expect(rows).toHaveLength(1);
    // The second call's fresher figures won, not the first's.
    expect(rows[0]).toMatchObject({ amount: 59_900, confidence: 0.95 });
  });

  test("a shift in which label is 'most common' still merges into one row", async () => {
    // DetectedPattern.merchant is `mostCommonMerchant` — the label most often
    // seen in the CURRENT evidence, which can change as more transactions
    // arrive. Matching on the literal string would read that drift as a new
    // merchant; matching on the normalized form must not. "Netflix" and
    // "NETFLIX" normalize identically (case only); "Netflix.com" does NOT
    // (normalizeMerchant turns the dot into a space, not nothing), so it is a
    // separate normalized key and is deliberately not used here.
    await upsertPattern(pattern({ merchant: "Netflix" }));
    await upsertPattern(pattern({ merchant: "NETFLIX" }));

    const rows = await listPatterns({ includeAcknowledged: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe("NETFLIX");
  });

  test("a different period BUCKET is a DIFFERENT pattern, even for the same merchant", async () => {
    // A telco can bill a weekly load promo and a separate annual top-up.
    // periodDays 7 and 365 land in different buckets (weekly vs. annual), so
    // this is unaffected by fix round 1's move away from exact periodDays.
    await upsertPattern(pattern({ merchant: "GLOBE", periodDays: 7, amount: 5_000 }));
    await upsertPattern(pattern({ merchant: "GLOBE", periodDays: 365, amount: 120_000 }));

    const rows = await listPatterns({ includeAcknowledged: true });
    expect(rows).toHaveLength(2);
  });

  test("I-2: the SAME bucket with amounts far apart is still TWO distinct rows", async () => {
    // A telco billing a ₱149 monthly plan and a separate ₱1,200 monthly
    // top-up must not merge just because both round to the "monthly" bucket —
    // the detector already keeps these apart by amount, and the identity key
    // must not re-merge what it deliberately split.
    await upsertPattern(
      pattern({ merchant: "GLOBE", periodDays: 30, amount: 14_900 }),
    );
    await upsertPattern(
      pattern({ merchant: "GLOBE", periodDays: 30, amount: 120_000 }),
    );

    const rows = await listPatterns({ includeAcknowledged: true });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([14_900, 120_000]);
  });

  test("I-2: a periodDays wobble (31 -> 30) with the amount unchanged still merges into one row", async () => {
    // The exact scenario the reviewer found: periodDays is Math.round(meanGap)
    // over a sliding window and legitimately shifts pass to pass for one real,
    // unchanged subscription. The bucket (monthly, for both 30 and 31) and the
    // amount are what decide identity now, not the wobbling integer.
    const created = await upsertPattern(pattern({ periodDays: 31 }));
    const merged = await upsertPattern(pattern({ periodDays: 30 }));

    expect(merged.id).toBe(created.id);
    expect(merged.periodDays).toBe(30);
    expect(await listPatterns({ includeAcknowledged: true })).toHaveLength(1);
  });

  test("upsert never touches acknowledged, bill_id or dismissed_at on an existing row", async () => {
    const created = await upsertPattern(pattern());
    await acknowledgePattern(created.id);
    await linkPatternToBill(created.id, bill.id);

    const merged = await upsertPattern(pattern({ amount: 60_000 }));

    expect(merged.id).toBe(created.id);
    expect(merged.amount).toBe(60_000);
    expect(merged.acknowledged).toBe(true);
    expect(merged.billId).toBe(bill.id);
  });

  test("carries periodDays, first/last seen, and derives the period bucket", async () => {
    const created = await upsertPattern(pattern({ periodDays: 14 }));
    expect(created.periodDays).toBe(14);
    expect(created.period).toBe(periodFor(14));
    expect(created.firstSeenAt).not.toBeNull();
    expect(created.lastSeenAt).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// listPatterns — acknowledge/dismiss filtering
// ---------------------------------------------------------------------------
describe("acknowledge and dismiss filter listPatterns correctly", () => {
  test("a fresh pattern is visible by default (a pending suggestion)", async () => {
    await upsertPattern(pattern());
    expect(await listPatterns()).toHaveLength(1);
  });

  test("acknowledging hides it from the default list but not from includeAcknowledged", async () => {
    const created = await upsertPattern(pattern());
    await acknowledgePattern(created.id);

    expect(await listPatterns()).toHaveLength(0);

    const all = await listPatterns({ includeAcknowledged: true });
    expect(all).toHaveLength(1);
    expect(all[0].acknowledged).toBe(true);
  });

  test("dismissing hides it from BOTH list modes", async () => {
    const created = await upsertPattern(pattern());
    await dismissPattern(created.id);

    expect(await listPatterns()).toHaveLength(0);
    expect(await listPatterns({ includeAcknowledged: true })).toHaveLength(0);

    const stored = await getPattern(created.id);
    expect(stored?.dismissedAt).not.toBeNull();
  });

  test("clearDismissal re-arms a dismissed pattern", async () => {
    const created = await upsertPattern(pattern());
    await dismissPattern(created.id);
    await clearDismissal(created.id);

    expect(await listPatterns()).toHaveLength(1);
    expect((await getPattern(created.id))?.dismissedAt).toBeNull();
  });

  test("findMatchingPattern finds a dismissed row that listPatterns hides", async () => {
    const created = await upsertPattern(pattern({ merchant: "SPOTIFY" }));
    await dismissPattern(created.id);

    expect(await listPatterns({ includeAcknowledged: true })).toHaveLength(0);
    const found = await findMatchingPattern("SPOTIFY", 30, 54_900);
    expect(found?.id).toBe(created.id);
    expect(found?.dismissedAt).not.toBeNull();
  });

  test("findMatchingPattern returns null once the amount is past tolerance", async () => {
    const created = await upsertPattern(pattern({ merchant: "SPOTIFY", amount: 54_900 }));
    expect(await findMatchingPattern("SPOTIFY", 30, 99_900)).toBeNull();
    expect((await findMatchingPattern("SPOTIFY", 30, 54_900))?.id).toBe(created.id);
  });
});

// ---------------------------------------------------------------------------
// Ordering — stable, most expensive-per-month first
// ---------------------------------------------------------------------------
describe("listPatterns ordering is stable", () => {
  test("descending by monthly-equivalent cost: weekly x52/12, monthly x1, annual /12", async () => {
    // Weekly ₱200 -> ~₱866.67/mo. Monthly ₱500 -> ₱500/mo. Annual ₱120,000 ->
    // ₱10,000/mo. Annual should lead despite the smallest raw `amount` gap.
    await upsertPattern(pattern({ merchant: "WEEKLY-CO", periodDays: 7, amount: 20_000 }));
    await upsertPattern(pattern({ merchant: "MONTHLY-CO", periodDays: 30, amount: 50_000 }));
    await upsertPattern(pattern({ merchant: "ANNUAL-CO", periodDays: 365, amount: 12_000_000 }));

    const rows = await listPatterns({ includeAcknowledged: true });
    expect(rows.map((r) => r.merchant)).toEqual(["ANNUAL-CO", "WEEKLY-CO", "MONTHLY-CO"]);
  });

  test("equal monthly cost breaks the tie by merchant name, and the order never reshuffles", async () => {
    await upsertPattern(pattern({ merchant: "ZOO", periodDays: 30, amount: 50_000 }));
    await upsertPattern(pattern({ merchant: "ALPHA", periodDays: 30, amount: 50_000 }));

    const first = await listPatterns({ includeAcknowledged: true });
    const second = await listPatterns({ includeAcknowledged: true });
    expect(first.map((r) => r.merchant)).toEqual(["ALPHA", "ZOO"]);
    expect(second.map((r) => r.merchant)).toEqual(["ALPHA", "ZOO"]);
  });
});

// ---------------------------------------------------------------------------
// linkPatternToBill — bills rules 28-29's other half
// ---------------------------------------------------------------------------
describe("linkPatternToBill", () => {
  test("sets bill_id, acknowledges, and clears any dismissal in one write", async () => {
    const created = await upsertPattern(pattern());
    await dismissPattern(created.id);

    await linkPatternToBill(created.id, bill.id);

    const stored = await getPattern(created.id);
    expect(stored).toMatchObject({ billId: bill.id, acknowledged: true, dismissedAt: null });
  });
});
