// lib/recurring/__tests__/recurring_service.test.ts — M3 Part 2 Task 6, step 2
// (fix round 1: identity match moved to merchant + period bucket + amount
// tolerance; see recurring_patterns_repo.ts's header. Fix round 2: dismissal
// also writes a suppressing UserRule — Reports rule 18, its Data-touched
// table, and domain §3.10 invariant 2.)
//
// `createUserRule` is wrapped so exactly one test can force its rejection —
// the LAST step of `dismissPattern`'s unit of work — and prove the pattern's
// own `dismissed_at` write rolls back with it. Same shape as
// `lib/review/__tests__/resolve_actions.test.ts`'s `resolve` wrap.
jest.mock("@/lib/db/repos/user_rules_repo", () => {
  const actual = jest.requireActual("@/lib/db/repos/user_rules_repo");
  return {
    ...actual,
    createUserRule: jest.fn((...args: unknown[]) =>
      (actual.createUserRule as (...a: unknown[]) => Promise<unknown>)(...args),
    ),
  };
});

import { setSetting } from "@/lib/db/repos/app_settings_repo";
import { listBills } from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import {
  acknowledgePattern,
  dismissPattern,
  findMatchingPattern,
  getPattern,
  listPatterns,
  RecurringPatternNotFoundError,
  upsertPattern,
} from "@/lib/db/repos/recurring_patterns_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createUserRule, listUserRules } from "@/lib/db/repos/user_rules_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { closeDatabase } from "@/lib/db/database";
import { __setTierForTests } from "@/lib/entitlements";
import { normalizeMerchant } from "@/lib/recurring/pattern_detector";
import {
  dismissPattern as dismissPatternService,
  monthlyLockedIn,
  promotePatternToBill,
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
  cash = await createWallet({ name: "GCash" });
});

afterEach(async () => {
  __setTierForTests(null);
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

  test("normalizes a 7-day and a 30-day pattern by their own cadence and sums them", () => {
    // Converted from the row's own periodDays against a 30.44-day mean month,
    // not from the three-value bucket: 20,000 x 30.44 / 7 = 86,971.43, plus
    // 50,000 x 30.44 / 30 = 50,733.33, giving 137,704.76 rounded once.
    const weekly = locked({ id: "w1", period: "weekly", periodDays: 7, amount: 20_000 });
    const monthly = locked({ id: "m1", period: "monthly", periodDays: 30, amount: 50_000 });

    const total = monthlyLockedIn([weekly, monthly]);
    expect(total).toBe(137_705);
  });

  test("a fortnightly pattern counts about HALF what its weekly bucket would give", () => {
    // The whole point of converting from periodDays. A 14-day charge buckets
    // as `weekly` (periodFor's boundary is about 14.6 days) and MUST NOT be
    // scaled as if it were weekly: ₱320 every 14 days is 32,000 x 30.44 / 14
    // = 69,577 centavos a month, ₱695.77 — not the ₱1,386.67 the bucket gives.
    const fortnightly = locked({ id: "f1", period: "weekly", periodDays: 14, amount: 32_000 });

    const total = monthlyLockedIn([fortnightly]);

    expect(total).toBe(69_577);
    // Stated the other way round, so the assertion still means something if
    // the mean-month constant is ever retuned: it is half the bucket figure.
    const bucketFigure = Math.round(32_000 * (52 / 12));
    expect(total).toBeGreaterThan(bucketFigure * 0.45);
    expect(total).toBeLessThan(bucketFigure * 0.55);
  });

  test("annual normalizes by its own 365-day cadence", () => {
    // 120,000 x 30.44 / 365 = 10,007.67.
    const annual = locked({ id: "a1", period: "annual", periodDays: 365, amount: 120_000 });
    expect(monthlyLockedIn([annual])).toBe(10_008);
  });

  test("a pre-migration-007 row with no periodDays falls back to the bucket factor", () => {
    // `periodDays` is null only on a row written before migration 007. There
    // is no exact cadence to divide by, so the bucket nominal is the only
    // cadence there is: annual /12 exactly, 120,000 / 12 = 10,000.
    const legacy = locked({ id: "l1", period: "annual", periodDays: null, amount: 120_000 });
    expect(monthlyLockedIn([legacy])).toBe(10_000);
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
    const stored = await findMatchingPattern("NETFLIX", 30, 54_900);
    expect(stored?.id).toBe(created.id);
    expect(stored?.dismissedAt).not.toBeNull();
    // Untouched — refreshPatterns must not even refresh confidence/lastSeenAt
    // on a dismissed-and-unchanged row.
    expect(stored?.amount).toBe(54_900);
  });

  test("a materially changed dismissed pattern is proposed again, as a fresh row", async () => {
    // Fix round 1 (I-2): a candidate whose amount has moved past
    // findMatchingPattern's own tolerance simply no longer MATCHES the old
    // dismissed row, so it is upserted as a distinct, undismissed row rather
    // than un-dismissing the original. The old row is untouched and stays
    // dismissed forever — it genuinely was a different (now stale) figure.
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

    const oldRow = await findMatchingPattern("NETFLIX", 30, 54_900);
    expect(oldRow?.id).toBe(created.id);
    expect(oldRow?.dismissedAt).not.toBeNull();

    const newRow = await findMatchingPattern("NETFLIX", 30, 99_900);
    expect(newRow?.id).not.toBe(created.id);
    expect(newRow?.dismissedAt).toBeNull();
    expect(result.some((p) => p.id === newRow?.id && p.amount === 99_900)).toBe(true);
  });

  test("a fresh (never-dismissed) pattern refreshes normally", async () => {
    await series("SPOTIFY", 14_900, 6, 30);

    const result = await refreshPatterns(NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ merchant: "SPOTIFY", amount: 14_900, periodDays: 30 });
  });

  // -------------------------------------------------------------------------
  // I-2 — periodDays is Math.round(meanGap) over a sliding window and legitimately
  // wobbles pass to pass for one unchanged subscription; the identity match must
  // not be fooled by that wobble.
  // -------------------------------------------------------------------------
  test("a periodDays wobble (31 -> 30) across two refreshPatterns passes stays ONE row, updated not duplicated", async () => {
    const first = NOW - 90 * DAY_MS;
    const second = first + 31 * DAY_MS;
    const third = second + 31 * DAY_MS;

    for (const at of [first, second, third]) {
      await insertTransaction({
        walletId: cash.id,
        categoryId: DEFAULT_BILL_CATEGORY_ID,
        amount: 100_000,
        direction: "out",
        occurredAt: at,
        merchant: "GYM",
        source: "notification",
        confidence: 0.9,
      });
    }

    const pass1 = await refreshPatterns(third);
    expect(pass1).toHaveLength(1);
    expect(pass1[0]).toMatchObject({ merchant: "GYM", periodDays: 31 });
    const patternId = pass1[0].id;

    // A fourth occurrence 28 days later shifts the mean gap from 31 to 30 —
    // Math.round((31 + 31 + 28) / 3) = 30 — with the merchant and amount
    // otherwise completely unchanged.
    const fourth = third + 28 * DAY_MS;
    await insertTransaction({
      walletId: cash.id,
      categoryId: DEFAULT_BILL_CATEGORY_ID,
      amount: 100_000,
      direction: "out",
      occurredAt: fourth,
      merchant: "GYM",
      source: "notification",
      confidence: 0.9,
    });

    const pass2 = await refreshPatterns(fourth);
    expect(pass2).toHaveLength(1);
    expect(pass2[0].id).toBe(patternId);
    expect(pass2[0].periodDays).toBe(30);
  });

  test("the same periodDays wobble on a DISMISSED pattern stays dismissed and is not re-proposed", async () => {
    const first = NOW - 90 * DAY_MS;
    const second = first + 31 * DAY_MS;
    const third = second + 31 * DAY_MS;

    for (const at of [first, second, third]) {
      await insertTransaction({
        walletId: cash.id,
        categoryId: DEFAULT_BILL_CATEGORY_ID,
        amount: 100_000,
        direction: "out",
        occurredAt: at,
        merchant: "GYM",
        source: "notification",
        confidence: 0.9,
      });
    }

    const pass1 = await refreshPatterns(third);
    const patternId = pass1[0].id;
    await dismissPattern(patternId);

    const fourth = third + 28 * DAY_MS;
    await insertTransaction({
      walletId: cash.id,
      categoryId: DEFAULT_BILL_CATEGORY_ID,
      amount: 100_000,
      direction: "out",
      occurredAt: fourth,
      merchant: "GYM",
      source: "notification",
      confidence: 0.9,
    });

    const pass2 = await refreshPatterns(fourth);

    expect(pass2).toHaveLength(0);
    expect(await listPatterns()).toHaveLength(0);
    const stored = await getPattern(patternId);
    expect(stored?.dismissedAt).not.toBeNull();
    // Skipped entirely, not merely re-hidden: the wobble never got written.
    expect(stored?.periodDays).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// dismissPattern (service) — fix round 2: the spec's suppressing UserRule
// coexists with dismissed_at, not instead of it (Reports rule 18, its
// Data-touched table, and domain §3.10 invariant 2).
// ---------------------------------------------------------------------------
describe("dismissPattern (service) writes a suppressing UserRule", () => {
  test("dismissing a pattern writes a suppress-recurring UserRule carrying the merchant", async () => {
    const pattern = await upsertPattern({
      merchant: "Netflix.com",
      amount: 54_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 150 * DAY_MS,
      lastSeenAt: NOW,
      nextExpectedAt: NOW + 30 * DAY_MS,
      transactionIds: [],
    });

    await dismissPatternService(pattern.id, NOW);

    // `dismissed_at` is repo bookkeeping (recurring_patterns_repo's own
    // `Date.now()`, not the injected `now` — same as every other timestamp
    // column that repo stamps); only that it got SET is this test's concern.
    const stored = await getPattern(pattern.id);
    expect(stored?.dismissedAt).not.toBeNull();

    const rules = await listUserRules("suppress-recurring");
    expect(rules).toHaveLength(1);
    expect(rules[0].action).toEqual({
      kind: "suppress-recurring",
      merchant: normalizeMerchant("Netflix.com"),
    });
    expect(rules[0].createdFrom).toBe(pattern.id);
  });

  test("throws for an unknown pattern id and writes nothing", async () => {
    await expect(dismissPatternService("no-such-pattern", NOW)).rejects.toThrow(
      RecurringPatternNotFoundError,
    );
    expect(await listUserRules("suppress-recurring")).toEqual([]);
  });

  test("dismissal is atomic: a UserRule write failure leaves the pattern un-dismissed", async () => {
    const pattern = await upsertPattern({
      merchant: "SPOTIFY",
      amount: 14_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 150 * DAY_MS,
      lastSeenAt: NOW,
      nextExpectedAt: NOW + 30 * DAY_MS,
      transactionIds: [],
    });
    (createUserRule as jest.Mock).mockRejectedValueOnce(new Error("db went away"));

    await expect(dismissPatternService(pattern.id, NOW)).rejects.toThrow("db went away");

    // Neither write landed: `repoDismissPattern` runs BEFORE `createUserRule`
    // inside the same unit of work, so if they were not in the same SQL
    // transaction the pattern would be left dismissed with no rule to back it
    // up — exactly the half-done state this test exists to catch.
    const stored = await getPattern(pattern.id);
    expect(stored?.dismissedAt).toBeNull();
    expect(await listUserRules("suppress-recurring")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// refreshPatterns honours a suppress-recurring UserRule directly — fix round
// 2's whole point: the rule outlives the pattern row, so this must hold even
// when NO row exists for the merchant at all (dismissed_at alone cannot).
// ---------------------------------------------------------------------------
describe("refreshPatterns honours an existing suppress-recurring UserRule", () => {
  test("a merchant suppressed by UserRule is not proposed even with no prior pattern row", async () => {
    await createUserRule({
      matcher: { merchantPattern: "NETFLIX" },
      action: { kind: "suppress-recurring", merchant: normalizeMerchant("NETFLIX") },
    });

    await series("NETFLIX", 54_900, 6, 30);

    const result = await refreshPatterns(NOW);

    expect(result).toHaveLength(0);
    expect(await findMatchingPattern("NETFLIX", 30, 54_900)).toBeNull();
  });

  test("an unrelated merchant is unaffected by another merchant's suppression", async () => {
    await createUserRule({
      matcher: { merchantPattern: "NETFLIX" },
      action: { kind: "suppress-recurring", merchant: normalizeMerchant("NETFLIX") },
    });

    await series("SPOTIFY", 14_900, 6, 30);

    const result = await refreshPatterns(NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ merchant: "SPOTIFY", amount: 14_900 });
  });
});

// ---------------------------------------------------------------------------
// refreshPatterns — confidence-decay removal (Reports rule 18: "a pattern
// whose confidence decays below the floor is removed silently"; domain
// §3.10's "automatic removal when confidence decays below the floor after
// repeated missed periods"). The owner's rule: "1.5 missed payments, scaled
// to the pattern's own cadence" — recurring_forget_multiplier (default 1.5)
// times max(periodDays, PERIOD_NOMINAL_DAYS[period]), measured from the
// pattern's stored lastSeenAt. The bucket nominal leads because periodDays
// wobbles pass to pass (recurring_patterns_repo.ts's header explains why),
// but it can never pull the threshold BELOW the pattern's own cadence — the
// fortnightly case below. And NOT a flat day count either (a flat 45 days
// would forget an annual subscription six weeks after it charged).
// ---------------------------------------------------------------------------
describe("refreshPatterns removes patterns that have gone silent past the forget threshold", () => {
  test("a monthly pattern silent for 46 days is forgotten (1.5 x 30 = 45-day threshold)", async () => {
    const created = await upsertPattern({
      merchant: "NETFLIX",
      amount: 54_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 200 * DAY_MS,
      lastSeenAt: NOW - 46 * DAY_MS,
      nextExpectedAt: NOW - 16 * DAY_MS,
      transactionIds: [],
    });

    const result = await refreshPatterns(NOW);

    expect(result.some((p) => p.id === created.id)).toBe(false);
    expect(await getPattern(created.id)).toBeNull();
  });

  test("a monthly pattern silent for only 44 days is kept", async () => {
    const created = await upsertPattern({
      merchant: "NETFLIX",
      amount: 54_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 200 * DAY_MS,
      lastSeenAt: NOW - 44 * DAY_MS,
      nextExpectedAt: NOW - 14 * DAY_MS,
      transactionIds: [],
    });

    const result = await refreshPatterns(NOW);

    expect(result.some((p) => p.id === created.id)).toBe(true);
    expect(await getPattern(created.id)).not.toBeNull();
  });

  test("an ANNUAL pattern silent for 46 days is KEPT — the case a fixed day count would have broken", async () => {
    const created = await upsertPattern({
      merchant: "AMAZON PRIME",
      amount: 200_000,
      periodDays: 365,
      occurrences: 3,
      confidence: 0.8,
      firstSeenAt: NOW - 800 * DAY_MS,
      lastSeenAt: NOW - 46 * DAY_MS,
      nextExpectedAt: NOW + 319 * DAY_MS,
      transactionIds: [],
    });

    const result = await refreshPatterns(NOW);

    expect(result.some((p) => p.id === created.id)).toBe(true);
    expect(await getPattern(created.id)).not.toBeNull();
  });

  test("a weekly pattern is forgotten on its own much shorter threshold (1.5 x 7 = 10.5 days)", async () => {
    const created = await upsertPattern({
      merchant: "LOAD PROMO",
      amount: 5_000,
      periodDays: 7,
      occurrences: 4,
      confidence: 0.7,
      firstSeenAt: NOW - 60 * DAY_MS,
      lastSeenAt: NOW - 11 * DAY_MS,
      nextExpectedAt: NOW - 4 * DAY_MS,
      transactionIds: [],
    });

    const result = await refreshPatterns(NOW);

    expect(result.some((p) => p.id === created.id)).toBe(false);
    expect(await getPattern(created.id)).toBeNull();
  });

  // A FORTNIGHTLY charge is the case the bucket nominal alone gets wrong: 14
  // days is under the repo's ~14.6-day weekly/monthly boundary, so `period`
  // is "weekly" and a threshold of 1.5 x 7 = 10.5 days would forget the
  // pattern three days before its next charge was even due. The threshold is
  // scaled by max(periodDays, nominal), so the real one here is 1.5 x 14 = 21.
  test("a fortnightly acknowledged pattern silent for 11 days is KEPT — its own cadence is not up yet", async () => {
    const created = await upsertPattern({
      merchant: "HERBALIFE CLUB",
      amount: 32_000,
      periodDays: 14,
      occurrences: 5,
      confidence: 0.85,
      firstSeenAt: NOW - 70 * DAY_MS,
      lastSeenAt: NOW - 11 * DAY_MS,
      nextExpectedAt: NOW + 3 * DAY_MS,
      transactionIds: [],
    });
    // The premise: it really does land in the weekly bucket, cadence intact.
    expect(created.period).toBe("weekly");
    expect(created.periodDays).toBe(14);
    await acknowledgePattern(created.id);

    const result = await refreshPatterns(NOW);

    expect(result.some((p) => p.id === created.id)).toBe(true);
    const stillThere = await getPattern(created.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.acknowledged).toBe(true);
    // Still IN the total, and in it at its REAL cost: `monthlyLockedIn`
    // converts from the row's own 14-day cadence (32,000 x 30.44 / 14 =
    // 69,577), not from the `weekly` bucket it shares with a 7-day charge.
    // The bucket stays weekly on purpose — that is what the decay threshold
    // above is asserting — and the money math no longer follows it there.
    expect(monthlyLockedIn(result)).toBe(69_577);
  });

  test("a fortnightly pattern silent for 22 days IS forgotten (1.5 x 14 = 21-day threshold)", async () => {
    const created = await upsertPattern({
      merchant: "HERBALIFE CLUB",
      amount: 32_000,
      periodDays: 14,
      occurrences: 5,
      confidence: 0.85,
      firstSeenAt: NOW - 70 * DAY_MS,
      lastSeenAt: NOW - 22 * DAY_MS,
      nextExpectedAt: NOW - 8 * DAY_MS,
      transactionIds: [],
    });
    await acknowledgePattern(created.id);

    const result = await refreshPatterns(NOW);

    expect(result.some((p) => p.id === created.id)).toBe(false);
    expect(await getPattern(created.id)).toBeNull();
    expect(monthlyLockedIn(result)).toBe(0);
  });

  test("changing the multiplier changes the threshold: 3x survives what 1.5x would have forgotten", async () => {
    await setSetting("recurring_forget_multiplier", 3);
    const created = await upsertPattern({
      merchant: "NETFLIX",
      amount: 54_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 200 * DAY_MS,
      // 46 days silent — past the default 1.5x (45-day) threshold, but well
      // inside the 3x (90-day) threshold this test sets instead.
      lastSeenAt: NOW - 46 * DAY_MS,
      nextExpectedAt: NOW - 16 * DAY_MS,
      transactionIds: [],
    });

    const result = await refreshPatterns(NOW);

    expect(result.some((p) => p.id === created.id)).toBe(true);
    expect(await getPattern(created.id)).not.toBeNull();
  });

  test("an acknowledged pattern decays on the same terms as an unacknowledged one", async () => {
    // Rule 17 counts only ACKNOWLEDGED, not-bill-linked patterns into the
    // headline — an acknowledged pattern going silent is exactly the case
    // that corrupts that figure, so decay must not spare it.
    const created = await upsertPattern({
      merchant: "NETFLIX",
      amount: 54_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 200 * DAY_MS,
      lastSeenAt: NOW - 46 * DAY_MS,
      nextExpectedAt: NOW - 16 * DAY_MS,
      transactionIds: [],
    });
    await acknowledgePattern(created.id);

    const result = await refreshPatterns(NOW);

    expect(result.some((p) => p.id === created.id)).toBe(false);
    expect(await getPattern(created.id)).toBeNull();
  });

  test("a pattern linked to a Bill is never removed by decay, no matter how stale (bills rules 28-29)", async () => {
    const created = await upsertPattern({
      merchant: "SPOTIFY",
      amount: 14_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 500 * DAY_MS,
      // Wildly past any monthly threshold this setting could produce.
      lastSeenAt: NOW - 400 * DAY_MS,
      nextExpectedAt: NOW - 370 * DAY_MS,
      transactionIds: [],
    });
    await promotePatternToBill(created.id, NOW);

    const result = await refreshPatterns(NOW);

    const stillThere = await getPattern(created.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.billId).not.toBeNull();
    expect(result.some((p) => p.id === created.id)).toBe(true);
  });

  test("the locked-in headline drops when a pattern is forgotten", async () => {
    const created = await upsertPattern({
      merchant: "NETFLIX",
      amount: 54_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 200 * DAY_MS,
      // Fresh enough to survive the first pass.
      lastSeenAt: NOW - 30 * DAY_MS,
      nextExpectedAt: NOW,
      transactionIds: [],
    });
    await acknowledgePattern(created.id);

    const before = await refreshPatterns(NOW);
    // 54,900 every 30 days against a 30.44-day mean month: 55,705.
    expect(monthlyLockedIn(before)).toBe(55_705);

    // 16 days later, still no new charge: 46 days of total silence, past the
    // 45-day monthly threshold.
    const after = await refreshPatterns(NOW + 16 * DAY_MS);

    expect(after.some((p) => p.id === created.id)).toBe(false);
    expect(monthlyLockedIn(after)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The detection sample does not move with the tier (GAP-122)
// ---------------------------------------------------------------------------
// Reports rule 19 owes a free user "the count of detected patterns only", so a
// free device has to detect. Read through `listTransactions`, `historyFloor()`
// clamped the 800-day window `LEDGER_WINDOW_DAYS` asks for down to the free
// tier's 90-day browsing floor — which cannot hold the three instances
// `MIN_OCCURRENCES` wants of anything slower than monthly, so the annual
// subscription a user most wants flagged was undetectable by construction and
// the teaser would have understated in the one direction that costs a
// conversion. `refreshPatterns` reads `listFullLedgerBetween` instead: the
// floor is a browsing gate and this is a computation (GAP-105, GAP-111,
// GAP-118). What stays tier-gated is the SURFACE — see
// components/recurring/__tests__/subscriptions_screen.test.tsx.
describe("refreshPatterns reads its full window in both tiers", () => {
  test("ON FREE, AN ANNUAL PATTERN WHOSE EVIDENCE IS OLDER THAN 90 DAYS IS STILL DETECTED", async () => {
    __setTierForTests("free");
    // Charges at NOW-730, NOW-365 and NOW: three instances, two of them far
    // outside anything a free user is allowed to BROWSE.
    await series("AMAZON PRIME", 200_000, 3, 365);

    const result = await refreshPatterns(NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      merchant: "AMAZON PRIME",
      amount: 200_000,
      period: "annual",
      periodDays: 365,
    });
  });

  test("the free count is the whole count, not the fraction inside the browsing floor", async () => {
    __setTierForTests("free");
    await series("NETFLIX", 54_900, 3, 30);
    await series("SPOTIFY", 14_900, 3, 30);
    await series("AMAZON PRIME", 200_000, 3, 365);

    const result = await refreshPatterns(NOW);

    // Three, not the two whose evidence happens to sit inside 90 days. This is
    // the number app/(tabs)/more/subscriptions.tsx renders to a free user.
    expect(result).toHaveLength(3);
  });

  test("free and plus detect the identical set from the identical ledger", async () => {
    await series("NETFLIX", 54_900, 3, 30);
    await series("AMAZON PRIME", 200_000, 3, 365);

    __setTierForTests("plus");
    const onPlus = (await refreshPatterns(NOW)).map((p) => `${p.merchant}:${p.periodDays}`);

    __setTierForTests("free");
    const onFree = (await refreshPatterns(NOW)).map((p) => `${p.merchant}:${p.periodDays}`);

    expect(onFree).toEqual(onPlus);
    expect(onFree).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// `decayStalePatterns` on free — GAP-122's re-derived answer
// ---------------------------------------------------------------------------
// GAP-118 skipped the pass on free and argued that skipping decay along with it
// was right, because a free period quietly forgetting what a plus period found
// would be the gate deleting data (gate principle 1, docs/05-monetization.md
// §3.1). The pass runs on free now, so the answer had to be re-derived rather
// than inherited — and it survives only because the SAMPLE stopped moving with
// the tier. Decay infers removal from silence, silence is measured against
// `lastSeenAt`, and `lastSeenAt` is refreshed by the merge that reads the
// ledger. Clamp that read and the inference breaks on exactly the cadence it
// matters most for, which is the first test below.
describe("decay runs on free, and the floor-exempt window is what makes that safe", () => {
  test("ON FREE, AN ANNUAL PATTERN THAT CHARGED TODAY SURVIVES — A CLAMPED WINDOW WOULD HAVE DELETED IT", async () => {
    __setTierForTests("free");
    // The row a plus period left behind, last confirmed two years ago.
    const created = await upsertPattern({
      merchant: "AMAZON PRIME",
      amount: 200_000,
      periodDays: 365,
      occurrences: 3,
      confidence: 0.8,
      firstSeenAt: NOW - 730 * DAY_MS,
      lastSeenAt: NOW - 730 * DAY_MS,
      nextExpectedAt: NOW - 365 * DAY_MS,
      transactionIds: [],
    });
    // The ledger that says it is alive: charged a year ago, and again today.
    await series("AMAZON PRIME", 200_000, 3, 365);

    const result = await refreshPatterns(NOW);

    // 730 days of stored silence against a 1.5 x 365 = 547.5-day threshold. Had
    // the merge been unable to see past 90 days it could not have refreshed
    // `lastSeenAt`, and decay would have deleted a live subscription on the
    // strength of a window the tier chose.
    const stored = await getPattern(created.id);
    expect(stored).not.toBeNull();
    expect(stored?.lastSeenAt).toBe(NOW);
    expect(result.some((p) => p.id === created.id)).toBe(true);
  });

  test("a genuinely cancelled subscription is forgotten on free exactly as on plus", async () => {
    // The other half: decay is not disabled on free either. A free count
    // inflated by subscriptions the user already cancelled is rule 19's teaser
    // lying in the other direction, and a pattern is derived data whose silent
    // removal changes no Transaction (rule 18, domain §3.10).
    __setTierForTests("free");
    const created = await upsertPattern({
      merchant: "NETFLIX",
      amount: 54_900,
      periodDays: 30,
      occurrences: 6,
      confidence: 0.9,
      firstSeenAt: NOW - 200 * DAY_MS,
      lastSeenAt: NOW - 46 * DAY_MS,
      nextExpectedAt: NOW - 16 * DAY_MS,
      transactionIds: [],
    });

    const result = await refreshPatterns(NOW);

    expect(result.some((p) => p.id === created.id)).toBe(false);
    expect(await getPattern(created.id)).toBeNull();
  });
});
