// lib/recurring/__tests__/recurring_service.test.ts — M3 Part 2 Task 6, step 2.
import { listBills } from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import {
  dismissPattern,
  getPattern,
  getPatternByMerchantAndPeriod,
  listPatterns,
  upsertPattern,
} from "@/lib/db/repos/recurring_patterns_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { closeDatabase } from "@/lib/db/database";
import {
  monthlyLockedIn,
  promotePatternToBill,
  RecurringPatternNotFoundError,
  refreshPatterns,
} from "@/lib/recurring/recurring_service";
import { freshDb } from "@/test_support/db";
import type { RecurringPattern, Wallet } from "@/types/domain";

const DAY_MS = 86_400_000;
const NOW = new Date(2026, 7, 16, 10, 0).getTime();
const DEFAULT_BILL_CATEGORY_ID = "cat_bills_utilities";

let cash: Wallet;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  cash = await createWallet({ name: "GCash", type: "e-wallet" });
});

afterEach(async () => {
  await closeDatabase();
});

/** `count` charges, `everyDays` apart, newest at NOW — same shape as the detector's own suite. */
async function series(
  merchant: string,
  amount: number,
  count: number,
  everyDays: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await insertTransaction({
      walletId: cash.id,
      categoryId: DEFAULT_BILL_CATEGORY_ID,
      amount,
      direction: "out",
      occurredAt: NOW - (count - 1 - index) * everyDays * DAY_MS,
      merchant,
      source: "notification",
      confidence: 0.9,
    });
  }
}

// ---------------------------------------------------------------------------
// monthlyLockedIn — Reports rule 17, pure
// ---------------------------------------------------------------------------
describe("monthlyLockedIn", () => {
  function locked(over: Partial<RecurringPattern> = {}): RecurringPattern {
    return {
      id: "p1",
      merchant: "NETFLIX",
      amount: 54_900,
      period: "monthly",
      periodDays: 30,
      confidence: 0.9,
      acknowledged: true,
      billId: null,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      dismissedAt: null,
      nextExpectedAt: NOW + 30 * DAY_MS,
      createdAt: NOW,
      updatedAt: NOW,
      ...over,
    };
  }

  test("normalizes weekly (x52/12) and monthly (x1) and sums them", () => {
    const weekly = locked({ id: "w1", period: "weekly", amount: 20_000 }); // ~86,666.67
    const monthly = locked({ id: "m1", period: "monthly", amount: 50_000 });

    const total = monthlyLockedIn([weekly, monthly]);
    expect(total).toBe(Math.round((20_000 * 52) / 12 + 50_000));
  });

  test("annual normalizes by /12", () => {
    const annual = locked({ id: "a1", period: "annual", amount: 120_000 });
    expect(monthlyLockedIn([annual])).toBe(10_000);
  });

  test("excludes unacknowledged (suggested) patterns", () => {
    const suggested = locked({ acknowledged: false });
    expect(monthlyLockedIn([suggested])).toBe(0);
  });

  test("excludes bill-linked patterns, even if acknowledged (rules 28-29 double-count guard)", () => {
    const linked = locked({ billId: "bill-1" });
    expect(monthlyLockedIn([linked])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// promotePatternToBill — plan rule 2, bills rules 28-29
// ---------------------------------------------------------------------------
describe("promotePatternToBill", () => {
  test("calls the bills promotion and acknowledges the pattern", async () => {
    const pattern = await upsertPattern({
      merchant: "NETFLIX",
      amount: 54_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 150 * DAY_MS,
      lastSeenAt: NOW,
      nextExpectedAt: NOW + 30 * DAY_MS,
      transactionIds: [],
    });

    const bill = await promotePatternToBill(pattern.id, NOW);

    expect(bill.name).toBe("NETFLIX");
    expect(bill.amount).toBe(54_900);
    expect(bill.amountMode).toBe("estimated");
    expect(bill.categoryId).toBe(DEFAULT_BILL_CATEGORY_ID);

    const stored = await getPattern(pattern.id);
    expect(stored?.acknowledged).toBe(true);
    expect(stored?.billId).toBe(bill.id);
  });

  test("promoting twice does not create two bills", async () => {
    const pattern = await upsertPattern({
      merchant: "SPOTIFY",
      amount: 14_900,
      periodDays: 30,
      occurrences: 4,
      confidence: 0.8,
      firstSeenAt: NOW - 120 * DAY_MS,
      lastSeenAt: NOW,
      nextExpectedAt: NOW + 30 * DAY_MS,
      transactionIds: [],
    });

    const first = await promotePatternToBill(pattern.id, NOW);
    const second = await promotePatternToBill(pattern.id, NOW + DAY_MS);

    expect(second.id).toBe(first.id);
    expect(await listBills()).toHaveLength(1);
  });

  test("throws for an unknown pattern id", async () => {
    await expect(promotePatternToBill("no-such-pattern", NOW)).rejects.toThrow(
      RecurringPatternNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// refreshPatterns — dismissal stays sticky unless the evidence changes materially
// ---------------------------------------------------------------------------
describe("refreshPatterns and dismissal (plan rule 3)", () => {
  test("a dismissed pattern is not re-proposed when the ledger still agrees with it", async () => {
    const created = await upsertPattern({
      merchant: "NETFLIX",
      amount: 54_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 150 * DAY_MS,
      lastSeenAt: NOW - 30 * DAY_MS,
      nextExpectedAt: NOW,
      transactionIds: [],
    });
    await dismissPattern(created.id);

    // Real ledger evidence for the SAME merchant, amount and cadence.
    await series("NETFLIX", 54_900, 6, 30);

    await refreshPatterns(NOW);

    expect(await listPatterns()).toHaveLength(0);
    const stored = await getPatternByMerchantAndPeriod("NETFLIX", 30);
    expect(stored?.dismissedAt).not.toBeNull();
    // Untouched — refreshPatterns must not even refresh confidence/lastSeenAt
    // on a dismissed-and-unchanged row.
    expect(stored?.amount).toBe(54_900);
  });

  test("a materially changed dismissed pattern is proposed again", async () => {
    const created = await upsertPattern({
      merchant: "NETFLIX",
      amount: 54_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 150 * DAY_MS,
      lastSeenAt: NOW - 30 * DAY_MS,
      nextExpectedAt: NOW,
      transactionIds: [],
    });
    await dismissPattern(created.id);

    // A price hike well past the 15% material-change tolerance.
    await series("NETFLIX", 99_900, 6, 30);

    const result = await refreshPatterns(NOW);

    const stored = await getPatternByMerchantAndPeriod("NETFLIX", 30);
    expect(stored?.dismissedAt).toBeNull();
    expect(stored?.amount).toBe(99_900);
    expect(result.some((p) => p.id === created.id && p.amount === 99_900)).toBe(true);
  });

  test("a fresh (never-dismissed) pattern refreshes normally", async () => {
    await series("SPOTIFY", 14_900, 6, 30);

    const result = await refreshPatterns(NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ merchant: "SPOTIFY", amount: 14_900, periodDays: 30 });
  });
});
