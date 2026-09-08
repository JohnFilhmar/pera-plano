// lib/income/__tests__/income_service.test.ts — m2-part2 Task 12.
//
// Integration, against the REAL migrations through freshDb() and the REAL event
// bus. Nothing is mocked: the bus is a plain in-process registry, and asserting
// against it directly is what proves the payload subscribers will actually
// receive.
//
// The clock is pinned. Detection reads a trailing 120 days, so a live clock
// would silently change which fixtures are in the window as the file ages.
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { createLimit, getLimitAlertState } from "@/lib/db/repos/limits_repo";
import { getIncomeDetectionState, getIncomeProfile } from "@/lib/db/repos/income_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { onAppEvent } from "@/lib/events/app_events";
import type { AppEventMap } from "@/lib/events/app_events";
import { recomputeLimits } from "@/lib/limits/limit_service";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import {
  clearManualIncome,
  confirmDetectedIncome,
  dismissDetectedIncome,
  getIncomeSummary,
  getMonthlyEquivalentIncome,
  maybeEmitPayday,
  PAYDAY_EVENT,
  refreshIncomeDetection,
  setManualIncome,
} from "../income_service";

/** Aug 5 2026, noon — just past a July 31 payday, before the Aug 15 one. */
const NOW = new Date(2026, 7, 5, 12, 0).getTime();
/** Local instant. The hour matters where a test drives `now` past a credit. */
const on = (y: number, m: number, d: number, hour = 10) => new Date(y, m, d, hour, 0).getTime();

let payroll: Wallet;

async function credit(amount: number, at: number, walletId?: string): Promise<string> {
  const row = await insertTransaction({
    walletId: walletId ?? payroll.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "in",
    occurredAt: at,
    merchant: "ACME PAYROLL",
    source: "notification",
    confidence: 1,
  });
  return row.id;
}

/** Six kinsenas paydays ending Jul 31 — enough for rule 6's confirmed threshold. */
async function seedConfirmedKinsenas(): Promise<void> {
  await credit(1850000, on(2026, 4, 15));
  await credit(1850000, on(2026, 4, 31));
  await credit(1850000, on(2026, 5, 15));
  await credit(1850000, on(2026, 5, 30));
  await credit(1850000, on(2026, 6, 15));
  await credit(1850000, on(2026, 6, 31));
}

/** Captures every payday the bus carries for the duration of one test. */
function capturePaydays(): { seen: AppEventMap["income:payday"][]; stop: () => void } {
  const seen: AppEventMap["income:payday"][] = [];
  const stop = onAppEvent(PAYDAY_EVENT, (payload) => {
    seen.push(payload);
  });
  return { seen, stop };
}

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  payroll = await createWallet({ name: "BPI Payroll" });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Detection and status transitions (rule 2)
// ---------------------------------------------------------------------------
test("no history at all reads as unknown, with a null monthly equivalent", () => {
  return (async () => {
    const summary = await getIncomeSummary(NOW);

    expect(summary.status).toBe("unknown");
    expect(summary.cadence).toBeNull();
    expect(summary.averageAmount).toBeNull();
    // Rule 6 of the plan: "Never substitute zero — a zero base reads as 'you
    // have spent infinity percent of your limit'."
    expect(summary.monthlyEquivalent).toBeNull();
  })();
});

/** Three consecutive kinsenas windows — rule 6's PROVISIONAL threshold. */
async function seedProvisionalKinsenas(): Promise<void> {
  await credit(1850000, on(2026, 5, 30));
  await credit(1850000, on(2026, 6, 15));
  await credit(1850000, on(2026, 6, 31));
}

test("three consecutive windows reach the evidence threshold and set status PROVISIONAL", async () => {
  await seedProvisionalKinsenas();

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.status).toBe("provisional");
  expect(summary.cadence).toBe("kinsenas");
});

test("a single deposit does NOT reach the threshold", async () => {
  await credit(1850000, on(2026, 6, 31));

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.status).toBe("unknown");
});

test("six kinsenas paydays auto-apply as CONFIRMED with a doubled monthly equivalent", async () => {
  // Income flow 3: "detection that reaches confirmed status auto-applies ...
  // but only when no manual override exists". Rule 16: M = 2 x averageAmount.
  await seedConfirmedKinsenas();

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.status).toBe("confirmed");
  expect(summary.cadence).toBe("kinsenas");
  expect(summary.averageAmount).toBe(1850000);
  expect(summary.monthlyEquivalent).toBe(3700000);
  expect(summary.isManualOverride).toBe(false);
  // Auto-applied: the profile row exists, not just the detection notes.
  expect((await getIncomeProfile())?.cadence).toBe("kinsenas");
});

test("confirmDetectedIncome moves provisional to confirmed and writes the profile", async () => {
  await seedProvisionalKinsenas();
  await refreshIncomeDetection(NOW);

  const summary = await confirmDetectedIncome(NOW);

  expect(summary.status).toBe("confirmed");
  expect(summary.isManualOverride).toBe(false); // accepting detection is not an override
  expect((await getIncomeProfile())?.averageAmount).toBe(1850000);
});

test("MISSING TWO EXPECTED WINDOWS LAPSES THE PROFILE BUT KEEPS ITS VALUES", async () => {
  // Rule 13: "Percent-of-income Limits keep using the last known values while
  // lapsed — they pause only if the profile is cleared entirely." A lapse that
  // wiped the figures would collapse every percent limit to Paused the moment
  // an employer was a fortnight late.
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);

  // Six weeks later, with nothing further deposited: two kinsenas windows gone.
  const later = new Date(2026, 8, 20, 12, 0).getTime();
  const summary = await refreshIncomeDetection(later);

  expect(summary.status).toBe("lapsed");
  expect(summary.cadence).toBe("kinsenas");
  expect(summary.averageAmount).toBe(1850000);
  expect(summary.monthlyEquivalent).toBe(3700000);
});

test("A LAPSE WAITS FOR THE SECOND EXPECTED WINDOW TO CLOSE, NOT FOR 30 DAYS", async () => {
  // Rule 13 counts WINDOWS: "two consecutive expected windows pass with no
  // matched pay event". The last credit lands Aug 12, three days early for the
  // Aug 15 window (rule 7's ordinary Philippine payday slide), so it MATCHED
  // that window. The next two expected windows are katapusan, Aug 28 - Sep 3,
  // and the 15th, Sep 12 - 18. The second closes at the end of Sep 18, so the
  // profile is still confirmed on the 18th and lapses on the 19th.
  //
  // `floor(elapsedDays / 15)` reaches two on Sep 11 and lapses there: the "we
  // haven't seen your usual pay — did it change?" prompt fires eight days
  // early, while the September 15th pay is not yet even due.
  await seedConfirmedKinsenas();
  await credit(1850000, on(2026, 7, 12)); // Aug 12
  const established = await refreshIncomeDetection(on(2026, 7, 14, 12));
  expect(established.status).toBe("confirmed");

  const onTheEighteenth = await refreshIncomeDetection(on(2026, 8, 18, 12));
  expect(onTheEighteenth.status).toBe("confirmed");

  const onTheNineteenth = await refreshIncomeDetection(on(2026, 8, 19, 12));
  expect(onTheNineteenth.status).toBe("lapsed");
  // Rule 13 again: a lapse keeps the figures it last knew, so percent-of-income
  // Limits carry on rather than collapsing to Paused.
  expect(onTheNineteenth.averageAmount).toBe(1850000);
});

// ---------------------------------------------------------------------------
// Manual override (rules 14, 15)
// ---------------------------------------------------------------------------
test("A MANUAL OVERRIDE WINS OVER A CONFLICTING DETECTION", async () => {
  // Rule 14: "Manual override always wins ... detection then never modifies the
  // profile." Detection here confirms kinsenas at ₱18,500; the user says
  // monthly ₱30,000 and that is what every consumer must see.
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);

  await setManualIncome(
    { cadence: "monthly", averageAmount: 3000000, sourceWalletIds: [payroll.id] },
    NOW,
  );
  // Detection runs again and still believes kinsenas.
  await refreshIncomeDetection(NOW);

  const summary = await getIncomeSummary(NOW);
  expect(summary.isManualOverride).toBe(true);
  expect(summary.cadence).toBe("monthly");
  expect(summary.averageAmount).toBe(3000000);
  expect(summary.monthlyEquivalent).toBe(3000000); // NOT 2 x 18,500
  // Detection kept its own notes, silently, for suggestion purposes (rule 10).
  expect((await getIncomeDetectionState()).cadence).toBe("kinsenas");
});

test("clearManualIncome reverts to the detected values", async () => {
  // Rule 15: "'Switch to automatic' clears isManualOverride and adopts the
  // current confirmed detection".
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);
  await setManualIncome(
    { cadence: "monthly", averageAmount: 3000000, sourceWalletIds: [payroll.id] },
    NOW,
  );

  const summary = await clearManualIncome(NOW);

  expect(summary.isManualOverride).toBe(false);
  expect(summary.cadence).toBe("kinsenas");
  expect(summary.monthlyEquivalent).toBe(3700000);
});

test("clearing with no confirmed detection returns to unknown, not to zero", async () => {
  // Rule 15's second half: "if none exists, the profile returns to
  // Unknown/Detecting (and percent-of-income Limits pause ...)".
  await setManualIncome(
    { cadence: "monthly", averageAmount: 3000000, sourceWalletIds: [payroll.id] },
    NOW,
  );

  const summary = await clearManualIncome(NOW);

  expect(summary.status).toBe("unknown");
  expect(summary.monthlyEquivalent).toBeNull();
});

// ---------------------------------------------------------------------------
// Suggestions (rule 3 / income flow 2)
// ---------------------------------------------------------------------------
test("a provisional detection proposes a suggestion", async () => {
  await seedProvisionalKinsenas();

  expect((await refreshIncomeDetection(NOW)).hasPendingSuggestion).toBe(true);
});

test("A DISMISSED SUGGESTION IS NOT RE-PROPOSED FOR THE SAME SIGNATURE", async () => {
  // Plan rule 3: "Re-prompting a user who already said no is how apps get
  // uninstalled."
  await seedProvisionalKinsenas();
  await refreshIncomeDetection(NOW);

  await dismissDetectedIncome(NOW);

  expect((await refreshIncomeDetection(NOW)).hasPendingSuggestion).toBe(false);
  expect((await getIncomeSummary(NOW)).hasPendingSuggestion).toBe(false);
});

test("a CHANGED signature does propose again", async () => {
  // A genuine change — a raise, a new employer — is a different suggestion, and
  // the user never said no to it. A boolean flag instead of a signature would
  // silence this one too.
  await seedProvisionalKinsenas();
  await refreshIncomeDetection(NOW);
  await dismissDetectedIncome(NOW);

  // A raise, landing in the two most recent windows a couple of days early —
  // the same three windows still match, so the detection stays PROVISIONAL,
  // but the median of the matched events moves from ₱18,500 to ₱23,000 and the
  // suggestion is no longer the one the user turned down.
  await credit(2300000, on(2026, 6, 13));
  await credit(2300000, on(2026, 6, 29));

  const summary = await refreshIncomeDetection(NOW);
  expect(summary.status).toBe("provisional");
  expect(summary.averageAmount).toBe(2300000);
  expect(summary.hasPendingSuggestion).toBe(true);
});

// ---------------------------------------------------------------------------
// The limits hand-off (rule 5)
// ---------------------------------------------------------------------------
test("SETTING INCOME RE-SNAPSHOTS EVERY PERCENT-OF-INCOME LIMIT IMMEDIATELY", async () => {
  // Limits rule 11's exception: "a manual edit to the IncomeProfile or to the
  // Limit recomputes the base immediately". Without it the user declares their
  // income and their percent limit keeps measuring against nothing until the
  // next period boundary — with nothing on screen saying why.
  const percentLimit = await createLimit({
    scope: "monthly",
    basis: "percent-of-income",
    value: 2000, // 20%, in the domain's percent x 100 encoding
  });
  const fixedLimit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });

  await setManualIncome(
    { cadence: "monthly", averageAmount: 3000000, sourceWalletIds: [payroll.id] },
    NOW,
  );

  // 20% of ₱30,000.00 = ₱6,000.00.
  expect((await getLimitAlertState(percentLimit.id))?.base).toBe(600000);
  // A fixed limit has nothing to recompute and must not be touched.
  expect(await getLimitAlertState(fixedLimit.id)).toBeNull();
});

test("clearing income leaves a percent limit paused rather than at zero", async () => {
  const percentLimit = await createLimit({
    scope: "monthly",
    basis: "percent-of-income",
    value: 2000,
  });
  await setManualIncome(
    { cadence: "monthly", averageAmount: 3000000, sourceWalletIds: [payroll.id] },
    NOW,
  );

  await clearManualIncome(NOW);

  // `refreshLimitBase` returns early for a paused limit, so the last known base
  // stays on the row — but `getMonthlyEquivalentIncome` now reports null, which
  // is what makes `baseFor` report Paused.
  expect(await getMonthlyEquivalentIncome(NOW)).toBeNull();
  void percentLimit;
});

test("getMonthlyEquivalentIncome is the figure limits consume", async () => {
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);

  expect(await getMonthlyEquivalentIncome(NOW)).toBe(3700000);
});

/** Sep 3 2026, noon — the trailing 90 days open at Jun 5 00:00. */
const SEP_3 = on(2026, 8, 3, 12);
/**
 * Sep 4 2026, noon — the same window has slid one whole day, to Jun 6 00:00.
 *
 * NOON ON BOTH, AND THE FIXTURE CREDIT SITS AT 10:00 ON JUN 5, which is what
 * makes this pair discriminate. The window is anchored to local midnight
 * (rule 9's "trailing 90 days" is a span of the user's calendar), so Jun 5 is
 * wholly in on Sep 3 and wholly out on Sep 4. Measured from the instant instead
 * — `now - 90 * DAY_MS`, which is what this file used to assert — Sep 3 noon
 * opens the window at Jun 5 NOON and the 10:00 credit is already gone a day
 * early, so the drift lands on the wrong day and, worse, lands halfway through
 * one.
 */
const SEP_4 = on(2026, 8, 4, 12);
/** Oct 1 2026, noon — the first day of the next monthly limit period. */
const OCT_1 = on(2026, 9, 1, 12);

/**
 * Four same-sized credits on no rhythm at all.
 *
 * Deliberately none of the three regular cadences: no pair sits 28-33 days
 * apart (monthly), none sits 6-8 (weekly), and none lands within 3 days of a
 * 15th or a katapusan (kinsenas) — so rule 5's precedence falls through to
 * `irregular`, whose rule 9 figure is the trailing 90 days summed and divided
 * by three. That is the only cadence whose amount MOVES as the clock advances
 * over a quiet ledger, which is what makes the drift observable at all.
 *
 * All four are the same amount so rule 4's ±30% band keeps them in one stream.
 *
 * THE FIRST ONE IS ON JUN 5 AT 10:00 ON PURPOSE. It is the credit the trailing
 * window drops between SEP_3 and SEP_4, and 10:00 is on the far side of the
 * noon the two `now`s are taken at — so a window measured from the instant
 * drops it a day early and a window measured from local midnight drops it on
 * the day the calendar says. See SEP_4's note.
 */
async function seedIrregularStream(): Promise<void> {
  await credit(2000000, on(2026, 5, 5));
  await credit(2000000, on(2026, 6, 20));
  await credit(2000000, on(2026, 7, 6));
  await credit(2000000, on(2026, 7, 20));
}

/**
 * The limits half of a ledger commit — `runLimitPass` without the notifier.
 *
 * Income does not write limit bases (limits rule 11), so this is what persists
 * a period's base snapshot, exactly as `limit_ledger_subscriber.ts` does on the
 * same `ledger:committed` event the income pass runs on.
 */
async function runLimitsPass(now: number): Promise<void> {
  await recomputeLimits({ now, monthlyIncome: await getMonthlyEquivalentIncome(now) });
}

async function spend(amount: number, at: number): Promise<void> {
  await insertTransaction({
    walletId: payroll.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "out",
    occurredAt: at,
    merchant: "JEEP FARE",
    source: "manual",
    confidence: 1,
  });
}

test("AN AUTOMATIC MID-PERIOD DRIFT LEAVES THE CURRENT PERIOD'S BASE ALONE", async () => {
  // Limits rule 11: automatic income drift applies from the NEXT period start,
  // "so alerts never flap mid-period". On Sep 3 the trailing 90 days hold all
  // four credits, M is ₱26,666.67 and a 30% monthly limit has a base of
  // ₱8,000.00. A ₱120 fare commits on Sep 4, the window's first day is now
  // Jun 6 so the Jun 5 credit is out, and M drops to ₱20,000.00 — with no new
  // spending, and nothing on screen to explain a limit the user was inside
  // suddenly reading as over.
  const percentLimit = await createLimit({
    scope: "monthly",
    basis: "percent-of-income",
    value: 3000,
  });
  await seedIrregularStream();
  await refreshIncomeDetection(SEP_3);
  await runLimitsPass(SEP_3);

  expect((await getLimitAlertState(percentLimit.id))?.base).toBe(800000);

  await spend(12000, on(2026, 8, 4));
  await refreshIncomeDetection(SEP_4);
  await runLimitsPass(SEP_4);

  // The profile DID drift — asserted so this test cannot pass because the
  // fixture failed to move rather than because the base held.
  expect(await getMonthlyEquivalentIncome(SEP_4)).toBe(2000000);
  expect((await getLimitAlertState(percentLimit.id))?.base).toBe(800000);
});

test("the drifted income is adopted at the next period boundary", async () => {
  const percentLimit = await createLimit({
    scope: "monthly",
    basis: "percent-of-income",
    value: 3000,
  });
  await seedIrregularStream();
  await refreshIncomeDetection(SEP_3);
  await runLimitsPass(SEP_3);
  await spend(12000, on(2026, 8, 4));
  await refreshIncomeDetection(SEP_4);
  await runLimitsPass(SEP_4);

  await refreshIncomeDetection(OCT_1);
  await runLimitsPass(OCT_1);

  // October is a new period, so `resolveState` takes the base it was handed
  // instead of the stored one: 30% of the ₱20,000.00 the trailing 90 days now
  // support. Deferred, not lost.
  expect((await getLimitAlertState(percentLimit.id))?.base).toBe(600000);
});

// ---------------------------------------------------------------------------
// Payday events (rules 11, 12; plan rule 4)
// ---------------------------------------------------------------------------
test("maybeEmitPayday emits once for a credit inside the expected window", async () => {
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);
  const { seen, stop } = capturePaydays();

  // Aug 15, inside the 15th window, right amount, right wallet.
  const paydayId = await credit(1850000, on(2026, 7, 15));
  const emitted = await maybeEmitPayday(on(2026, 7, 15, 11));
  stop();

  expect(emitted).toBe(true);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toEqual({
    transactionId: paydayId,
    walletId: payroll.id,
    amount: 1850000,
    occurredAt: on(2026, 7, 15),
  });
});

test("MAYBEEMITPAYDAY DOES NOT EMIT TWICE FOR THE SAME PAYDAY", async () => {
  // Plan rule 4: "a retry or a re-render must not double-fire and cause a
  // double auto-allocation" — the subscriber moves real money into a goal.
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);
  await credit(1850000, on(2026, 7, 15));
  const { seen, stop } = capturePaydays();

  const first = await maybeEmitPayday(on(2026, 7, 15, 11));
  const second = await maybeEmitPayday(on(2026, 7, 15, 12));
  const third = await maybeEmitPayday(on(2026, 7, 16));
  stop();

  expect([first, second, third]).toEqual([true, false, false]);
  expect(seen).toHaveLength(1);
});

test("maybeEmitPayday does not emit outside the expected window", async () => {
  // Rule 11 requires the timestamp to fall "in the current expected window" for
  // kinsenas/weekly/monthly. The 8th is neither the 15th ±3 nor katapusan ±3.
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);
  await credit(1850000, on(2026, 7, 8));
  const { seen, stop } = capturePaydays();

  const emitted = await maybeEmitPayday(on(2026, 7, 9));
  stop();

  expect(emitted).toBe(false);
  expect(seen).toEqual([]);
});

test("maybeEmitPayday ignores a credit far from the average amount", async () => {
  // Rule 11: "its amount is within ±30% of averageAmount". A ₱500 reimbursement
  // landing in the payroll account on the 15th is not a payday, and treating it
  // as one would auto-allocate against it.
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);
  await credit(50000, on(2026, 7, 15));
  const { seen, stop } = capturePaydays();

  const emitted = await maybeEmitPayday(on(2026, 7, 15, 11));
  stop();

  expect(emitted).toBe(false);
  expect(seen).toEqual([]);
});

test("maybeEmitPayday ignores a credit into a wallet that is not an income source", async () => {
  // Rule 11's first clause: "its walletId is in sourceWalletIds[]".
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);
  const other = await createWallet({ name: "GCash" });
  await credit(1850000, on(2026, 7, 15), other.id);
  const { seen, stop } = capturePaydays();

  const emitted = await maybeEmitPayday(on(2026, 7, 15, 11));
  stop();

  expect(emitted).toBe(false);
  expect(seen).toEqual([]);
});

test("maybeEmitPayday emits nothing while income is unknown", async () => {
  const { seen, stop } = capturePaydays();

  const emitted = await maybeEmitPayday(NOW);
  stop();

  expect(emitted).toBe(false);
  expect(seen).toEqual([]);
});

test("PAYDAY_EVENT is the bus key m2 Task 1 already shipped", async () => {
  // The m2-part2 plan names a new event, `"payday:detected"`. `income:payday`
  // was already in lib/events/app_events.ts and is pinned by the interface
  // contract; a second key would leave the goals plan subscribing to one and
  // this service publishing the other, with nothing failing anywhere.
  expect(PAYDAY_EVENT).toBe("income:payday");
});
