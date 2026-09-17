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
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { createLimit, getLimitAlertState } from "@/lib/db/repos/limits_repo";
import {
  getIncomeDetectionState,
  getIncomeProfile,
  setIncomeDetectionState,
} from "@/lib/db/repos/income_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { onAppEvent } from "@/lib/events/app_events";
import type { AppEventMap } from "@/lib/events/app_events";
import { recomputeLimits } from "@/lib/limits/limit_service";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import {
  clearManualIncome,
  confirmDetectedIncome,
  dismissDetectedIncome,
  dismissSplitPaydayNotice,
  getIncomeSummary,
  getMonthlyEquivalentIncome,
  maybeEmitPayday,
  PAYDAY_EVENT,
  refreshIncomeDetection,
  setManualIncome,
  UNKNOWN_INCOME,
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

/**
 * The same six kinsenas paydays, each deposited in two equal halves — an
 * employer who splits every payday, which is ordinary in this market.
 *
 * Kinsenas is scored over WINDOWS rather than events, so this confirms. And
 * since GAP-117 it produces the SAME figures as `seedConfirmedKinsenas`:
 * `tryKinsenas` records every credit of the payday that matched a window and
 * `averageAmountFor` medians paydays rather than deposits, so this user's
 * `averageAmount` is ₱18,500.00 — the pay they actually receive. It used to be
 * ₱9,250.00, which halved the monthly equivalent and with it the headroom of
 * every percent-of-income Limit.
 */
async function seedHabitualSplitKinsenas(): Promise<void> {
  for (const [month, day] of [
    [4, 15],
    [4, 31],
    [5, 15],
    [5, 30],
    [6, 15],
    [6, 31],
  ] as const) {
    await credit(925000, on(2026, month, day, 9));
    await credit(925000, on(2026, month, day, 16));
  }
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
  __setTierForTests(null);
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
    transactionIds: [paydayId],
    walletId: payroll.id,
    amount: 1850000,
    occurredAt: on(2026, 7, 15),
  });
});

test("A PAYDAY SPLIT INTO TWO CREDITS ON ONE LOCAL DATE FIRES ONE PROMPT FOR THE PAIR", async () => {
  // GAP-110. Rule 11's ±30% band is a test of "is this your pay", which is a
  // fact about a PAYDAY; screening it per credit asks the wrong question of an
  // employer who deposits half in the morning and half in the afternoon. Goals
  // rule 13 settles the amount: a percent contribution computes "from the sum of
  // income Transactions detected on that payday date", so the prompt has to
  // announce the pair, not one half of it.
  //
  await seedHabitualSplitKinsenas();
  await refreshIncomeDetection(NOW);

  const morning = await credit(925000, on(2026, 7, 15, 9));
  const afternoon = await credit(925000, on(2026, 7, 15, 16));
  const { seen, stop } = capturePaydays();

  const first = await maybeEmitPayday(on(2026, 7, 15, 17));
  // The sibling credit must not announce the same payday again on the next pass
  // — the subscriber moves real money into a Goal.
  const second = await maybeEmitPayday(on(2026, 7, 15, 18));
  stop();

  expect([first, second]).toEqual([true, false]);
  expect(seen).toEqual([
    {
      transactionIds: [morning, afternoon],
      walletId: payroll.id,
      amount: 1850000,
      occurredAt: on(2026, 7, 15, 16),
    },
  ]);
  // BOTH ids are remembered, which is what makes the second pass silent even
  // after the app is killed between the two credits landing.
  expect((await getIncomeDetectionState()).emittedPaydayTransactionIds).toEqual([
    morning,
    afternoon,
  ]);
});

test("credits on DIFFERENT local dates are judged separately, not added together", async () => {
  // The collapse keys on the local CALENDAR DAY, not on the expected window.
  // Aug 14 and Aug 15 both sit inside the 15th's ±3-day window, so a screen that
  // collapsed by window would add two full paydays into one ₱37,000.00 figure
  // that never landed on any one day — and `proposePaydayAllocations` would take
  // its percentage of it. Two paydays of ₱18,500.00 is the right reading, and
  // one call announces one of them.
  //
  // RE-AIMED FOR GAP-117. It used to seed the habitual splitter and assert a
  // ₱9,250.00 prompt, which only held because that user's `averageAmount` was
  // itself half a payday. It no longer is, so a lone half is correctly not a
  // payday and the fixture had to become pay that arrives whole — which tests
  // the day-versus-window question just as directly.
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);
  await credit(1850000, on(2026, 7, 14, 16));
  await credit(1850000, on(2026, 7, 15, 9));
  const { seen, stop } = capturePaydays();

  const emitted = await maybeEmitPayday(on(2026, 7, 15, 11));
  stop();

  expect(emitted).toBe(true);
  expect(seen).toHaveLength(1);
  expect(seen[0].amount).toBe(1850000);
  expect(seen[0].transactionIds).toHaveLength(1);
});

test("SIX WHOLE PAYDAYS PLUS ONE SPLIT PAYDAY PROMPTS ONCE, FOR THE COMBINED TOTAL", async () => {
  // GAP-117, and the case GAP-110's title named but could not reach. For a user
  // whose pay normally lands whole, one payday arriving in two deposits used to
  // be filtered out by `primaryStream` a stage before this screen ran: neither
  // ₱9,250.00 half could join the ₱18,500.00 band, the pair formed a second
  // group, and that group lost the largest-group sort. No prompt fired, so no
  // auto-allocation ran and the money Safe-to-Spend had reserved against that
  // pay was never moved. It failed silently, and only for the payday that was
  // split.
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);

  const morning = await credit(925000, on(2026, 7, 15, 9));
  const afternoon = await credit(925000, on(2026, 7, 15, 16));
  const { seen, stop } = capturePaydays();

  const first = await maybeEmitPayday(on(2026, 7, 15, 17));
  const second = await maybeEmitPayday(on(2026, 7, 15, 18));
  stop();

  expect([first, second]).toEqual([true, false]);
  expect(seen).toEqual([
    {
      transactionIds: [morning, afternoon],
      walletId: payroll.id,
      amount: 1850000,
      occurredAt: on(2026, 7, 15, 16),
    },
  ]);
  // And the figure every percent-of-income Limit is measured against did NOT
  // move: the split payday is a whole payday, so the median is unchanged.
  expect((await refreshIncomeDetection(on(2026, 7, 15, 18))).averageAmount).toBe(1850000);
});

test("A USER PAID IN HALVES EVERY TIME HAS THE WHOLE PAYDAY AS THEIR averageAmount", async () => {
  // The blast radius GAP-117 needed an owner decision for. `detectCadence` used
  // to record one matched CREDIT per expected window and `averageAmountFor` took
  // the median of those, so an employer who splits every payday gave this user a
  // ₱9,250.00 average and a ₱18,500.00 monthly equivalent — half the income they
  // actually have, and therefore half the headroom on every percent-of-income
  // Limit built on it. Rule 9's "matched pay events" are paydays (rule 11), not
  // deposits.
  await seedHabitualSplitKinsenas();

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.status).toBe("confirmed");
  expect(summary.cadence).toBe("kinsenas");
  expect(summary.averageAmount).toBe(1850000);
  expect(summary.monthlyEquivalent).toBe(3700000);
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

test("a ₱500 reimbursement never reaches the payday screen: the pay STREAM drops it", async () => {
  // RENAMED FOR GAP-117. This test used to be called "ignores a credit far from
  // the average amount" and claimed to exercise rule 11's ±30% tolerance. It
  // never did, and could not: the stream band and rule 11's tolerance are both
  // 30% of essentially the same median, so a ₱500 credit is already outside the
  // pay stream and `maybeEmitPayday` is handed nothing to reject. What it really
  // asserts is where the exclusion happens, so that is what it now says — and it
  // proves it, rather than inferring it from a silent bus.
  //
  // The test that does exercise rule 11 is the next one.
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);
  const reimbursement = await credit(50000, on(2026, 7, 15));
  const { seen, stop } = capturePaydays();

  const emitted = await maybeEmitPayday(on(2026, 7, 15, 11));
  stop();

  expect(emitted).toBe(false);
  expect(seen).toEqual([]);
  // Income rule 4's band, not rule 11's: it never became evidence at all.
  expect((await refreshIncomeDetection(on(2026, 7, 15, 11))).averageAmount).toBe(1850000);
  expect((await getIncomeDetectionState()).matchedTransactionIds).not.toContain(reimbursement);
});

test("RULE 11'S ±30% BAND REJECTS A DAY WHOSE COMBINED PAY IS DOUBLE THE AVERAGE", async () => {
  // Rule 11: "its amount is within ±30% of averageAmount", asked of the PAYDAY.
  // Two ₱18,500.00 credits on one day — a duplicated deposit, or a base payment
  // and an allowance of similar size — come to ₱37,000.00, which is not this
  // user's pay. `proposePaydayAllocations` takes its percentage of the emitted
  // amount, so announcing it would move double the money into a Goal.
  //
  // NOT VACUOUS, and the two assertions before the bus check are what prove it:
  // both credits sit INSIDE income rule 4's stream band (each is exactly the
  // median) and both are recorded as matched evidence for the Aug 15 window, so
  // everything upstream of rule 11 accepted them. Only the ±30% amount test
  // rejects the day.
  //
  // It is also the regression test for GAP-110's second `looksLikePay` clause,
  // which accepted a day where any single credit fell in the band and would have
  // emitted ₱37,000.00 here.
  await seedConfirmedKinsenas();
  await refreshIncomeDetection(NOW);
  const first = await credit(1850000, on(2026, 7, 15, 9));
  const second = await credit(1850000, on(2026, 7, 15, 16));

  const summary = await refreshIncomeDetection(on(2026, 7, 15, 17));
  const state = await getIncomeDetectionState();
  // The median resists the doubled day, which is rule 9's whole reason for being
  // a median — so the figure rule 11 measures against is still the real payday.
  expect(summary.averageAmount).toBe(1850000);
  expect(state.matchedTransactionIds).toContain(first);
  expect(state.matchedTransactionIds).toContain(second);

  const { seen, stop } = capturePaydays();
  const emitted = await maybeEmitPayday(on(2026, 7, 15, 17));
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

test("an irregular cadence collapses one day's gigs into one prompt for their total", async () => {
  // Rule 11's irregular clause has no windows and no average: "any primary-stream
  // candidate ≥ ₱1,000.00 counts as a payday". The FLOOR stays per credit there —
  // it is the only thing separating pay from noise, so summing sub-floor credits
  // until they clear it would invent paydays. The COLLAPSE still applies: two gigs
  // paid on one day are one day's pay, announced once, for what they came to.
  await seedIrregularStream();
  await refreshIncomeDetection(SEP_3);
  await credit(2000000, on(2026, 8, 2, 9));
  await credit(2000000, on(2026, 8, 2, 15));
  const { seen, stop } = capturePaydays();

  const first = await maybeEmitPayday(on(2026, 8, 2, 16));
  const second = await maybeEmitPayday(on(2026, 8, 2, 17));
  stop();

  expect([first, second]).toEqual([true, false]);
  expect(seen).toHaveLength(1);
  expect(seen[0].amount).toBe(4000000);
  expect(seen[0].transactionIds).toHaveLength(2);
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

// ---------------------------------------------------------------------------
// The one-time "your income figure changed" notice (GAP-117, owner decision
// 2026-09-10: fix it, and tell the user)
// ---------------------------------------------------------------------------
//
// THERE IS NOTHING TO MIGRATE, which is why these tests seed a pre-upgrade
// detection state rather than running a migration. `detect` recomputes the whole
// belief from the ledger on every pass and `refreshIncomeDetection` rewrites the
// profile from it, so the new figure lands on the first pass after the upgrade by
// itself. The only thing that has to be persisted is that the user has yet to be
// told, and `income_split_payday_notice` is that.

/** The state the OLD build left behind for a user paid in halves: a half figure. */
async function seedPreUpgradeState(averageAmount: number): Promise<void> {
  await setIncomeDetectionState({
    ...UNKNOWN_INCOME,
    status: "confirmed",
    cadence: "kinsenas",
    averageAmount,
    sourceWalletIds: [payroll.id],
  });
}

test("THE NOTICE FIRES ONCE FOR A USER WHOSE FIGURE ACTUALLY MOVED", async () => {
  await seedHabitualSplitKinsenas();
  await seedPreUpgradeState(925000);

  // The first pass after the upgrade: ₱9,250.00 becomes ₱18,500.00.
  const upgraded = await refreshIncomeDetection(NOW);
  expect(upgraded.averageAmount).toBe(1850000);
  expect(upgraded.hasSplitPaydayNotice).toBe(true);

  // Still pending after another pass — a detection pass must not clear a notice
  // the user has not seen, and detection runs on every ledger commit.
  expect((await refreshIncomeDetection(NOW)).hasSplitPaydayNotice).toBe(true);

  await dismissSplitPaydayNotice();

  expect((await getIncomeSummary(NOW)).hasSplitPaydayNotice).toBe(false);
  // ONCE, EVER. Not "once per launch": the figure it explains only moved once.
  expect((await refreshIncomeDetection(NOW)).hasSplitPaydayNotice).toBe(false);
});

test("the notice does NOT fire for a user whose figure did not move", async () => {
  // Pay that always arrived whole is banded, matched and medianed exactly as
  // before, so there is nothing to explain and nothing to interrupt them with.
  await seedConfirmedKinsenas();
  await seedPreUpgradeState(1850000);

  const upgraded = await refreshIncomeDetection(NOW);

  expect(upgraded.averageAmount).toBe(1850000);
  expect(upgraded.hasSplitPaydayNotice).toBe(false);
  expect(await getSetting("income_split_payday_notice")).toBe("done");
});

test("A FRESH INSTALL IS SETTLED BEFORE IT CAN EVER BE OWED THE NOTICE", async () => {
  // The trap this guards. A new user's `averageAmount` moves on its own as
  // evidence accumulates — rule 9's median walks as paydays arrive — so
  // "the figure moved and there are split paydays" is true for a brand-new
  // habitual splitter too, and would show them a notice about a change that
  // never happened to them. What separates the two is that an upgrading device
  // already had a stored figure and a fresh one did not, so the first pass on a
  // device with no stored figure settles the question for good.
  await seedHabitualSplitKinsenas();

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.averageAmount).toBe(1850000);
  expect(summary.hasSplitPaydayNotice).toBe(false);
  // Settled, so no later pass can raise it however far the median walks.
  expect(await getSetting("income_split_payday_notice")).toBe("done");
});

test("a DECLARED income is exempt: neither its figure nor its limits moved", async () => {
  // Rule 14: detection never modifies a declared profile, so the figure on
  // screen and every limit built on it are exactly where the user left them. A
  // notice announcing a change that did not happen is worse than silence; rule
  // 14's own suggestion card is the surface for what detection now believes.
  await seedHabitualSplitKinsenas();
  await setManualIncome(
    { cadence: "kinsenas", averageAmount: 900000, sourceWalletIds: [payroll.id] },
    NOW,
  );
  await seedPreUpgradeState(925000);

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.averageAmount).toBe(900000);
  expect(summary.hasSplitPaydayNotice).toBe(false);
  expect(await getSetting("income_split_payday_notice")).toBe("done");
});

// ---------------------------------------------------------------------------
// The detection sample does not move with the tier (GAP-118)
// ---------------------------------------------------------------------------
//
// `detect` asks for a trailing 130 days so `detectCadence` can judge 120 of
// them, and rule 9 medians a cadence-sized window of paydays out of that —
// four for the monthly fixture below. Read through
// `listTransactions` it was clamped to the Free tier's 90-day BROWSING floor,
// which is not what that floor is for: limits rule 8 says totals "are always
// computed from the full ledger, regardless of the free tier's 90-day history
// view gate". Nothing gates income detection, so nothing may gate its sample —
// `averageAmount` becomes `monthlyEquivalent` (rule 16) and then the base of
// every percent-of-income Limit (limits rule 10).

/**
 * Four monthly paydays on the 1st, rising ₱16,000 -> ₱22,000.
 *
 * CHOSEN SO THE FLOOR IS THE ONLY VARIABLE. May 1 is 96 days before `NOW` — in
 * the 120-day detection window, under the 90-day floor — so on Free it was the
 * one payday that disappeared. The cadence confirms either way (`tryMonthly`
 * needs two qualifying gaps), and the four amounts all sit inside rule 4's ±30%
 * band, so the ONLY thing the missing row changes is the median: four paydays
 * median ₱19,000.00, the surviving three median ₱20,000.00.
 */
async function seedFourMonthlyPaydays(): Promise<void> {
  await credit(1600000, on(2026, 4, 1)); // May 1 — 96 days back, below the free floor
  await credit(1800000, on(2026, 5, 1)); // Jun 1
  await credit(2000000, on(2026, 6, 1)); // Jul 1
  await credit(2200000, on(2026, 7, 1)); // Aug 1
}

test("ON FREE, CADENCE DETECTION STILL READS ALL 130 DAYS", async () => {
  await seedFourMonthlyPaydays();
  __setTierForTests("free");

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.status).toBe("confirmed");
  expect(summary.cadence).toBe("monthly");
  // The four-payday median. Clamped to 90 days this was ₱20,000.00 — the same
  // ledger, the same instant, a different tier, a different income.
  expect(summary.averageAmount).toBe(1900000);
  expect(summary.monthlyEquivalent).toBe(1900000);
});

test("free and plus reach the same income from the same ledger", async () => {
  await seedFourMonthlyPaydays();

  __setTierForTests("plus");
  const onPlus = await refreshIncomeDetection(NOW);

  __setTierForTests("free");
  const onFree = await refreshIncomeDetection(NOW);

  expect(onFree.averageAmount).toBe(onPlus.averageAmount);
  expect(onFree.monthlyEquivalent).toBe(onPlus.monthlyEquivalent);
  expect(onFree.cadence).toBe(onPlus.cadence);
});

test("browsing keeps its 90-day gate while detection reads past it", async () => {
  // The exemption is for the computation only. If this ever starts returning
  // the May 1 row, the browsing gate itself has been removed — which is the one
  // thing GAP-105, GAP-111 and GAP-118 all say not to do.
  await seedFourMonthlyPaydays();
  __setTierForTests("free");

  const visible = await listTransactions({ now: NOW });

  expect(visible).toHaveLength(3);
  expect(await refreshIncomeDetection(NOW)).toMatchObject({ averageAmount: 1900000 });
});
