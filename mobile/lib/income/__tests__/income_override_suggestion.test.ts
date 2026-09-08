// lib/income/__tests__/income_override_suggestion.test.ts — income rule 14's
// divergence suggestion, over a DECLARED income (docs/04-features/04-income.md).
//
// "Detection continues in the background and raises a suggestion card only when
// the detected `averageAmount` diverges from the declared amount by more than
// 20%, or a different cadence reaches confirmed status. Suggestions are
// dismissible and never auto-apply."
//
// TWO CHOICES THIS FILE PINS, because the rule leaves them implicit:
//
// 1. THE DENOMINATOR IS THE DECLARED AMOUNT. The sentence says the detected
//    figure diverges FROM the declared one, and the declared one is the only
//    figure that holds still: a ratio taken against a median-based detection
//    would move the threshold every payday.
// 2. THE BOUNDARY BELONGS TO SILENCE. "More than 20%" names the far side of it,
//    so exactly 20.0% raises nothing.
//
// Integration, against the real migrations and the real detector. Nothing is
// mocked: the whole question here is whether detection's own belief reaches a
// declared profile, and a stubbed detector would answer it by construction.
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { getIncomeDetectionState, getIncomeProfile } from "@/lib/db/repos/income_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import {
  confirmDetectedIncome,
  dismissDetectedIncome,
  refreshIncomeDetection,
  setManualIncome,
} from "../income_service";

/** Aug 5 2026, noon — just past a Jul 31 payday, before the Aug 15 one. */
const NOW = new Date(2026, 7, 5, 12, 0).getTime();
const on = (y: number, m: number, d: number, hour = 10) => new Date(y, m, d, hour, 0).getTime();

/**
 * 20,000.00 declared puts rule 14's boundary at a 4,000.00 gap, which is what
 * makes 23,800 / 24,000 / 24,200 read as 19% / exactly 20% / 21%.
 */
const DECLARED = 2000000;

let payroll: Wallet;

async function credit(amount: number, at: number): Promise<void> {
  await insertTransaction({
    walletId: payroll.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "in",
    occurredAt: at,
    merchant: "ACME PAYROLL",
    source: "notification",
    confidence: 1,
  });
}

/**
 * Six kinsenas paydays ending Jul 31, all at `amount` — rule 6's confirmed
 * threshold (4 of the last 5 expected windows), and six identical amounts make
 * rule 9's median exactly `amount`, which is what lets the percentages below be
 * stated to the centavo.
 */
async function seedConfirmedKinsenas(amount: number): Promise<void> {
  await credit(amount, on(2026, 4, 15));
  await credit(amount, on(2026, 4, 31));
  await credit(amount, on(2026, 5, 15));
  await credit(amount, on(2026, 5, 30));
  await credit(amount, on(2026, 6, 15));
  await credit(amount, on(2026, 6, 31));
}

async function declareKinsenas(amount = DECLARED): Promise<void> {
  await setManualIncome(
    { cadence: "kinsenas", averageAmount: amount, sourceWalletIds: [payroll.id] },
    NOW,
  );
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
// The threshold, from both sides and on it
// ---------------------------------------------------------------------------
test("a 19% divergence from the declared amount raises nothing", async () => {
  await declareKinsenas();
  await seedConfirmedKinsenas(2380000);

  const summary = await refreshIncomeDetection(NOW);

  // Detection really did see the other figure. Without this line the test would
  // still pass on a build where detection never ran at all.
  expect((await getIncomeDetectionState()).averageAmount).toBe(2380000);
  expect((await getIncomeDetectionState()).status).toBe("confirmed");
  expect(summary.hasPendingSuggestion).toBe(false);
});

test("EXACTLY 20% RAISES NOTHING EITHER: rule 14 says MORE THAN 20%", async () => {
  // A rule that fires AT its own threshold makes ordinary payroll rounding into
  // news, and the doc's wording is the whole reason to prefer silence here.
  await declareKinsenas();
  await seedConfirmedKinsenas(2400000);

  const summary = await refreshIncomeDetection(NOW);

  expect((await getIncomeDetectionState()).averageAmount).toBe(2400000);
  expect(summary.hasPendingSuggestion).toBe(false);
});

test("A 21% DIVERGENCE RAISES THE SUGGESTION, CARRYING THE DETECTED FIGURE", async () => {
  await declareKinsenas();
  await seedConfirmedKinsenas(2420000);

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.hasPendingSuggestion).toBe(true);
  // The card shows the user's OWN figures, so the suggestion has to carry the
  // new one or it is asking them to accept a number that is nowhere on screen.
  expect(summary.suggestedChange).toEqual({ cadence: "kinsenas", averageAmount: 2420000 });
});

test("a 21% divergence DOWNWARDS raises it too", async () => {
  // A pay cut is as much news as a raise; a signed comparison would report half
  // of rule 14.
  await declareKinsenas();
  await seedConfirmedKinsenas(1580000);

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.hasPendingSuggestion).toBe(true);
  expect(summary.suggestedChange).toEqual({ cadence: "kinsenas", averageAmount: 1580000 });
});

// ---------------------------------------------------------------------------
// What a raised suggestion must NOT do
// ---------------------------------------------------------------------------
test("A RAISED SUGGESTION CHANGES NOTHING UNTIL THE USER ACTS ON IT", async () => {
  // Rule 14: "Manual override always wins." An offer is not a change, and every
  // consumer of income keeps reading the declaration meanwhile.
  await declareKinsenas();
  await seedConfirmedKinsenas(2420000);

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.hasPendingSuggestion).toBe(true);
  expect(summary.averageAmount).toBe(DECLARED);
  expect(summary.monthlyEquivalent).toBe(DECLARED * 2);
  const profile = await getIncomeProfile();
  expect(profile?.averageAmount).toBe(DECLARED);
  expect(profile?.isManualOverride).toBe(true);
});

// ---------------------------------------------------------------------------
// Rule 14's second clause
// ---------------------------------------------------------------------------
test("A DIFFERENT CADENCE REACHING CONFIRMED RAISES IT WITH NO DIVERGENCE AT ALL", async () => {
  // The amount is identical to the declared one, so only the schedule changed:
  // the user declared monthly, the ledger says twice a month. Rule 16 doubles
  // kinsenas into M, so leaving this unsaid holds every percent-of-income limit
  // at half its real base.
  await setManualIncome(
    { cadence: "monthly", averageAmount: 1850000, sourceWalletIds: [payroll.id] },
    NOW,
  );
  await seedConfirmedKinsenas(1850000);

  const summary = await refreshIncomeDetection(NOW);

  expect(summary.hasPendingSuggestion).toBe(true);
  expect(summary.suggestedChange).toEqual({ cadence: "kinsenas", averageAmount: 1850000 });
  // Still the declared cadence until they take the offer.
  expect(summary.cadence).toBe("monthly");
});

test("a merely PROVISIONAL divergence does not interrupt a declared income", async () => {
  // Rule 14's cadence clause says "reaches confirmed status", and the amount
  // clause beside it cannot be reading weaker evidence: a guess that may not
  // say the schedule changed may not say the salary did either. Three
  // consecutive windows is rule 6's PROVISIONAL threshold.
  await declareKinsenas();
  await credit(2420000, on(2026, 5, 30));
  await credit(2420000, on(2026, 6, 15));
  await credit(2420000, on(2026, 6, 31));

  const summary = await refreshIncomeDetection(NOW);

  expect((await getIncomeDetectionState()).status).toBe("provisional");
  expect((await getIncomeDetectionState()).averageAmount).toBe(2420000);
  expect(summary.hasPendingSuggestion).toBe(false);
});

// ---------------------------------------------------------------------------
// Acting on it
// ---------------------------------------------------------------------------
test("ACCEPTING THE SUGGESTION UPDATES THE FIGURES AND KEEPS THE OVERRIDE", async () => {
  // Override flow step 3: "applying it updates the values but keeps
  // isManualOverride true (the user made the change)". Clearing it would turn
  // "yes, my pay changed" into handing detection standing permission to rewrite
  // the figure unasked, which is the one thing rule 14 exists to prevent.
  await declareKinsenas();
  await seedConfirmedKinsenas(2420000);
  await refreshIncomeDetection(NOW);

  const summary = await confirmDetectedIncome(NOW);

  expect(summary.averageAmount).toBe(2420000);
  expect(summary.isManualOverride).toBe(true);
  const profile = await getIncomeProfile();
  expect(profile?.averageAmount).toBe(2420000);
  expect(profile?.isManualOverride).toBe(true);
  // Nothing left to ask: the declaration and the detection now agree.
  expect(summary.hasPendingSuggestion).toBe(false);
});

test("DISMISSING IT SILENCES IT AND LEAVES THE DECLARATION STANDING", async () => {
  // Rule 14: "Suggestions are dismissible and never auto-apply."
  await declareKinsenas();
  await seedConfirmedKinsenas(2420000);
  await refreshIncomeDetection(NOW);

  await dismissDetectedIncome(NOW);

  const summary = await refreshIncomeDetection(NOW);
  expect(summary.hasPendingSuggestion).toBe(false);
  expect(summary.averageAmount).toBe(DECLARED);
  expect((await getIncomeProfile())?.averageAmount).toBe(DECLARED);
});

test("a dismissed divergence asks again once the detected figure moves again", async () => {
  // Same reason the detection-only path stores a SIGNATURE rather than a flag:
  // a second raise is not the suggestion the user turned down.
  await declareKinsenas();
  await seedConfirmedKinsenas(2420000);
  await refreshIncomeDetection(NOW);
  await dismissDetectedIncome(NOW);
  expect((await refreshIncomeDetection(NOW)).hasPendingSuggestion).toBe(false);

  // Four paydays at a higher figure, each landing two days early — the same
  // windows still match, so detection stays confirmed while rule 9's median
  // moves off the dismissed figure.
  await credit(3000000, on(2026, 5, 13));
  await credit(3000000, on(2026, 5, 28));
  await credit(3000000, on(2026, 6, 13));
  await credit(3000000, on(2026, 6, 29));

  const summary = await refreshIncomeDetection(NOW);

  expect((await getIncomeDetectionState()).status).toBe("confirmed");
  expect(summary.hasPendingSuggestion).toBe(true);
  expect(summary.suggestedChange?.averageAmount).toBe(3000000);
});
