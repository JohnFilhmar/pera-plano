// lib/recurring/recurring_service.ts — refresh, the locked-in figure, and
// promotion (M3 Part 2 Task 6; docs/04-features/10-reports.md rules 17-19,
// docs/04-features/07-bills.md rules 28-29).
//
// `pattern_detector.ts` decides what a recurring charge IS, purely, from a
// slice of the ledger; `recurring_patterns_repo.ts` is the SQL surface that
// stores what detection found and what the user did with it. This file owns
// the order those run in, the money math the headline figure needs, and
// promotion — the same split `income_service.ts` and `bills_service.ts` keep
// for their own detectors.
//
// CLOCK-INJECTED THROUGHOUT, same rule as every service under lib/ (lib/clock.ts):
// no bare `Date.now()` here. The real clock enters at the composition edge —
// a hook, or `recurring_ledger_subscriber.ts`.
import { DEFAULT_BILL_CATEGORY_ID } from "@/constants/bills";
import { promoteRecurringPatternToBill } from "@/lib/bills/bills_service";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { getBill } from "@/lib/db/repos/bills_repo";
import {
  deletePattern,
  dismissPattern as repoDismissPattern,
  findMatchingPattern,
  getPattern,
  linkPatternToBill,
  listPatterns,
  RecurringPatternNotFoundError,
  upsertPattern,
} from "@/lib/db/repos/recurring_patterns_repo";
import { listFullLedgerBetween } from "@/lib/db/repos/transactions_repo";
import { createUserRule, listUserRules } from "@/lib/db/repos/user_rules_repo";
import { withUnitOfWork } from "@/lib/db/unit_of_work";
import { detectPatterns, normalizeMerchant } from "@/lib/recurring/pattern_detector";
import type { Bill, Centavos, RecurringPattern, RecurringPeriod } from "@/types/domain";

const DAY_MS = 86_400_000;

/**
 * How far back `refreshPatterns` reads the ledger. The detector's own floor
 * is `MIN_OCCURRENCES = 3` (pattern_detector.ts), so an ANNUAL pattern needs
 * roughly two full years of history before three instances even exist — three
 * charges a year apart span about 730 days. Rounded up with slack for a
 * charge that lands a few weeks early or late.
 *
 * NOTHING CLAMPS THIS, BECAUSE THE READ BELOW IS FLOOR-EXEMPT (GAP-122). It
 * used to: read through `listTransactions`, `historyFloor()` cut these 800 days
 * down to the Free tier's 90-day browsing window (entitlements.ts), which
 * cannot hold three instances of anything slower than monthly — the detector
 * was asked for annual subscriptions and given a window that excludes them by
 * construction. GAP-118 answered that by not running the pass on Free at all;
 * GAP-122 reverses that, because Reports rule 19 promises a Free user the COUNT
 * of detected patterns and a count taken from 90 days understates it — worst of
 * all for the annual subscription a user most wants flagged, which 90 days
 * cannot hold at any confidence.
 *
 * SO `refreshPatterns` READS `listFullLedgerBetween` INSTEAD. The floor is a
 * browsing gate and this is a computation: the same line GAP-105 drew for
 * `sumSpend`, GAP-111 for the categorizer and GAP-118 for income cadence
 * detection. What recurring detection has that those three do not is a
 * tier-gated OUTPUT — and that gate lives at the surface, where
 * app/(tabs)/more/subscriptions.tsx shows Free the count and nothing else, not
 * in the sample this constant describes.
 */
const LEDGER_WINDOW_DAYS = 800;

/**
 * Nominal length of each `period` bucket. Three callers:
 *
 *   `promotePatternToBill`, for the rare row that predates migration 007 and
 *   so has no `periodDays` of its own to promote from.
 *
 *   `decayStalePatterns`, which scales the forget threshold by the LARGER of
 *   this and `periodDays` — see that function's own doc for why neither
 *   number is safe on its own.
 *
 *   `MONTHLY_FACTOR` below, which is these same lengths expressed as
 *   payments-per-month, and is what `monthlyLockedIn` falls back to for that
 *   same pre-007 row.
 */
const PERIOD_NOMINAL_DAYS: Record<RecurringPeriod, number> = {
  weekly: 7,
  monthly: 30,
  annual: 365,
};

/**
 * Mean calendar month — the same 30.44 `recurring_patterns_repo.ts` builds its
 * bucket boundaries from. `monthlyRate` divides a pattern's exact cadence into
 * this to get how many times a month that pattern charges.
 */
const DAYS_PER_MONTH = 30.44;

/**
 * FALLBACK ONLY — no longer the primary conversion. Reports rule 17 writes its
 * formula in `period` terms (weekly ×52÷12, monthly ×1, annual ÷12), and that
 * reading is exactly right for a row whose only cadence information IS its
 * bucket: one written before migration 007, with no `periodDays`. Every row
 * that carries a real cadence is converted from that instead — `monthlyRate`.
 */
const MONTHLY_FACTOR: Record<RecurringPeriod, number> = {
  weekly: 52 / 12,
  monthly: 1,
  annual: 1 / 12,
};

/**
 * Re-runs detection over the ledger and merges the result into storage.
 * Returns every live (non-dismissed) pattern afterward, acknowledged and
 * suggested alike — the same read `listPatterns({ includeAcknowledged: true })`
 * gives a caller directly, returned here too so a caller that just triggered a
 * refresh does not have to make a second call to see its result.
 *
 * A DISMISSED PATTERN THAT STILL MATCHES IS SKIPPED ENTIRELY (rule 3) — not
 * merely hidden by `listPatterns`. Upserting its confidence and `lastSeenAt`
 * on every pass would let the stored row drift silently out of sync with what
 * the user actually saw and said no to, so it stays exactly as dismissed for
 * as long as `findMatchingPattern` still considers it the same commitment.
 *
 * MATERIAL CHANGE NEEDS NO SEPARATE CHECK HERE (fix round 1). Once a
 * candidate's amount has drifted past `findMatchingPattern`'s own tolerance —
 * or its cadence bucket has changed — the dismissed row simply stops
 * matching, `existing` comes back `null`, and the ordinary `upsertPattern`
 * branch below creates a fresh, non-dismissed row for it. That is rule 3's
 * "unless … changes materially" clause, arrived at by the same tolerance the
 * repository already uses to decide identity, rather than a second,
 * independently-tuned threshold that could disagree with it.
 *
 * A `suppress-recurring` USERRULE IS CHECKED TOO, ahead of the row-level check
 * above (fix round 2; Reports rule 18, its Data-touched table, and domain
 * §3.10 invariant 2 all name this rule as what makes a dismissal permanent).
 * `dismissPattern` below writes one alongside `dismissed_at` for exactly this
 * reason: `dismissed_at` lives on a DERIVED row that this same function is
 * free to delete and rebuild from scratch (confidence-decay removal, domain
 * §3.10's "Deleted by" clause) — the UserRule is what makes the suppression
 * survive that. Checked by normalized merchant only, the same identity
 * `pattern_detector.ts`'s own clustering already uses, so a candidate with no
 * existing pattern row at all (the case the column literally cannot cover)
 * is still skipped.
 *
 * FINALLY, A CONFIDENCE-DECAY REMOVAL PASS RUNS, AFTER the merge above —
 * see `decayStalePatterns`'s own doc for the full reasoning (M3b Task 5;
 * Reports rule 18; domain §3.10). Ordered last so a charge that arrived
 * THIS SAME PASS (and just refreshed a pattern's `lastSeenAt` via the merge
 * above) is judged against its own fresh silence, not the stale value from
 * before this call — a subscription that just charged must never be forgotten
 * in the same breath.
 */
export async function refreshPatterns(now: number): Promise<RecurringPattern[]> {
  const from = now - LEDGER_WINDOW_DAYS * DAY_MS;
  // FLOOR-EXEMPT, AND THAT IS THE WHOLE POINT OF USING THIS READ (GAP-122) —
  // see `LEDGER_WINDOW_DAYS` above for why 800 days a Free device cannot see
  // would leave rule 19's count wrong in the worst direction.
  //
  // BOUNDED, NOT `listFullLedger`. That read is unfiltered by design; using it
  // here would quietly turn "the last 800 days" into "everything ever", and the
  // window above is a deliberate two-annual-cycles-plus-slack.
  //
  // `to: now + 1`, NOT `to: now`: ranges are half-open `[from, to)` everywhere
  // in this codebase (interface contract §3), and the charge that just landed is
  // exactly the one that may complete a cadence.
  //
  // `now` NO LONGER GOES TO THE REPOSITORY, because nothing there measures
  // against it any more. It stays the pinned instant every calculation below
  // uses, which is what lib/clock.ts asks of this file.
  const transactions = await listFullLedgerBetween({ from, to: now + 1 });
  const detected = detectPatterns(transactions, now);

  const suppressRules = await listUserRules("suppress-recurring");
  const suppressedMerchants = new Set<string>();
  for (const rule of suppressRules) {
    if (rule.action.kind !== "suppress-recurring") continue;
    suppressedMerchants.add(normalizeMerchant(rule.action.merchant));
  }

  for (const candidate of detected) {
    if (suppressedMerchants.has(normalizeMerchant(candidate.merchant))) continue;

    const existing = await findMatchingPattern(candidate.merchant, candidate.periodDays, candidate.amount);
    if (existing !== null && existing.dismissedAt !== null) continue;

    await upsertPattern(candidate);
  }

  await decayStalePatterns(now);

  return listPatterns({ includeAcknowledged: true });
}

/**
 * DECISIONS — confidence-decay removal (Settings screen, M3b Task 5; Reports
 * rule 18: "a pattern whose confidence decays below the floor is removed
 * silently"; domain §3.10's "Deleted by ... automatic removal when confidence
 * decays below the floor after repeated missed periods"; owner ruling
 * 2026-08-16, recorded in full at `app_settings_repo.ts`'s
 * `recurring_forget_multiplier` JSDoc — read that first, this is its
 * implementation).
 *
 * THE MECHANISM IS SILENCE, NOT CANCELLATION. The notification listener only
 * ever sees a charge ARRIVE — it cannot observe "the user cancelled this". So
 * "gone" is inferred from an absence: no matching charge for more than
 * `recurring_forget_multiplier` × the pattern's OWN cadence, measured from its
 * stored `lastSeenAt`.
 *
 * SCALED BY THE LONGER OF `PERIOD_NOMINAL_DAYS[period]` AND `periodDays`.
 * Neither number is safe alone.
 *
 * The bucket nominal is the STABLE one, for the same reason
 * `recurring_patterns_repo.ts`'s own file header gives for keeping
 * `periodDays` out of pattern IDENTITY: it is `Math.round(meanGap)` over a
 * sliding window and legitimately wobbles pass to pass for one real,
 * unchanged subscription (31 -> 30, that file's own worked example). A
 * silence THRESHOLD built on a wobbling number alone would make a pattern's
 * forget date jitter with no material change in the user's actual behaviour,
 * the exact defect the identity key was fixed to avoid.
 *
 * But the bucket nominal alone runs SHORT at the top of a bucket, because
 * `period` is a three-value enum and every real cadence has to land in one of
 * the three. A fortnightly charge buckets as `weekly` (the repo's
 * weekly/monthly boundary sits at about 14.6 days), so 1.5 x 7 = 10.5 days
 * would forget it three days BEFORE its next charge was even due — every
 * cycle, with the next charge re-detecting it as a fresh, unacknowledged
 * suggestion and the acknowledgement lost each time. A forget threshold
 * shorter than the pattern's own cadence is never what "1.5 missed payments"
 * means. `Math.max` keeps both properties: the threshold can never fall below
 * the pattern's own cadence, and for the ordinary pattern sitting at or under
 * its bucket nominal the stable number is still the one that decides.
 *
 * A FIXED day count (the owner's own first draft, explicitly rejected) fails
 * for a related reason: flat 45 days is 1.5 missed cycles for a monthly
 * subscription but would delete an ANNUAL one six weeks after it charged,
 * then re-detect it the next time it actually charged — flickering in and out
 * of the locked-in total all year. The multiplier framing is what keeps "1.5"
 * meaning "one and a half missed payments" regardless of cadence: monthly ->
 * 45 days, weekly -> ~10 days, fortnightly -> 21 days, annual -> ~18 months,
 * all from the same stored `1.5`.
 *
 * ACKNOWLEDGED PATTERNS DECAY ON THE SAME TERMS AS UNACKNOWLEDGED ONES. Rule
 * 17's headline "locked in" figure counts only ACKNOWLEDGED, not-bill-linked
 * patterns — an acknowledged pattern going silent is exactly the case that
 * corrupts that number (this feature's own motivating example: cancel
 * Netflix, and an unremoved acknowledged pattern keeps counting ₱549 a month
 * forever). Rule 18 says the removal is SILENT with no carve-out for
 * acknowledged rows, and domain §3.10's lifecycle clause is the same blanket
 * statement. Sparing acknowledged patterns would leave the headline bug this
 * feature exists to fix completely unfixed — a stronger act than removal is
 * exactly what "silently" rules out, so both acknowledged and unacknowledged
 * live patterns are eligible, on the identical threshold.
 *
 * A BILL-LINKED PATTERN (`billId !== null`) IS NEVER REMOVED BY THIS PASS.
 * Bills rules 28-29 make the pattern -> bill link load-bearing: it is what
 * keeps one obligation from being double-counted across two surfaces (the
 * same reason a linked pattern is already excluded from `monthlyLockedIn`
 * below). Deleting the row out from under a live `bill_id` would orphan that
 * relationship for no benefit — the Bill has its own cycle tracking
 * (bills_service.ts) and is not silenced by a quiet notification listener, so
 * the pattern's silence says nothing about whether the underlying obligation
 * is still real. If the bill itself is later archived or deleted, that is
 * bills rule 27's lifecycle to own, not this one's.
 *
 * THIS RUNS ON FREE, AND IT IS THE FLOOR-EXEMPT READ ABOVE THAT MAKES THAT
 * CORRECT (GAP-122). GAP-118 skipped the whole pass on Free and argued the skip
 * was right, because "a Free period that quietly forgot the patterns a Plus
 * period found would be the gate deleting data", which gate principle 1
 * (docs/05-monetization.md §3.1) forbids outright. That argument was made about
 * a world where the pass does not run. It runs now, and the argument survives
 * only because the SAMPLE stopped moving with the tier.
 *
 * Removal here is inferred from silence, and silence is measured against
 * `lastSeenAt` — which the merge above refreshes from the ledger. Give that
 * merge a 90-day window and the inference breaks on exactly the cadence it
 * matters most for. An annual subscription charged at `now - 730`, `now - 365`
 * and TODAY has one visible instance inside 90 days, never reaches
 * `MIN_OCCURRENCES = 3`, is never upserted, and so keeps a stored `lastSeenAt`
 * of `now - 365`; a year later that reads as 730 days of silence against a
 * 1.5 x 365 = 547-day threshold, and the row is deleted for a subscription that
 * charged this morning. THAT is the gate deleting data, and it is what a
 * clamped window plus a running decay pass would actually have produced.
 * Reading the full 800 days in both tiers takes the tier out of the calculation
 * entirely: same evidence, same `lastSeenAt`, same verdict, which is what
 * principle 2 — existing records keep working fully, including after a
 * downgrade — asks for in the first place.
 *
 * SKIPPING IT WOULD ALSO HAVE PRESERVED NOTHING. A RecurringPattern is derived
 * data: Reports rule 18 and domain §3.10 both say a decayed pattern is removed
 * silently, and removing one changes no Transaction. Merging without decaying
 * leaves a store no Plus pass would ever produce, and the first pass after an
 * upgrade deletes those rows anyway — so the only lasting effect would be a
 * Free count inflated by subscriptions the user has already cancelled, which is
 * rule 19's teaser lying in the other direction.
 *
 * A DISMISSED PATTERN IS NEVER CONSIDERED. `listPatterns` below already
 * excludes every `dismissed_at IS NOT NULL` row unconditionally — the same
 * clause the merge loop above relies on — so a dismissed row never reaches
 * this pass at all. That is intentional, not incidental: dismissal's
 * suppression lives in the UserRule `dismissPattern` writes alongside
 * `dismissed_at`, and that UserRule outlives the row either way (fix round 2,
 * this file's own `dismissPattern` doc). There is nothing this pass could
 * usefully clean up by touching a dismissed row, and every dismissed row
 * already reads as "gone" to every caller that matters.
 */
async function decayStalePatterns(now: number): Promise<void> {
  const multiplier = await getSetting("recurring_forget_multiplier");
  const live = await listPatterns({ includeAcknowledged: true });

  for (const pattern of live) {
    if (pattern.billId !== null) continue;
    // No confirmed sighting to measure silence from — nothing to decay yet.
    if (pattern.lastSeenAt === null) continue;

    const cadenceDays = Math.max(pattern.periodDays ?? 0, PERIOD_NOMINAL_DAYS[pattern.period]);
    const thresholdDays = multiplier * cadenceDays;
    const silentDays = (now - pattern.lastSeenAt) / DAY_MS;
    if (silentDays > thresholdDays) {
      await deletePattern(pattern.id);
    }
  }
}

/**
 * Dismisses a suggested pattern (plan rule 3; Reports rule 18) — and, per the
 * spec's own wording in three places (Reports rule 18 and its Data-touched
 * table; domain §3.10 invariant 2), also writes the suppressing UserRule that
 * makes the dismissal outlive this derived row. Both mechanisms coexist by
 * design: `dismissed_at` stays because it is what makes the dismissal cheap
 * to query on the pattern's own row (the check `refreshPatterns` above makes
 * first); the UserRule is what a later Settings screen can list and undo, and
 * what `refreshPatterns` above ALSO consults so the dismissal survives even a
 * pattern row that gets deleted and rebuilt from scratch.
 *
 * BOTH WRITES OR NEITHER — same shape as `loans_service.ts`'s
 * `recordManualPayment`. A pattern marked dismissed with no backing UserRule
 * is a suggestion that resurfaces the moment its row is rebuilt; a UserRule
 * with no dismissed pattern to justify it is a suppression the user never
 * asked for landing on whatever candidate matches its merchant next.
 *
 * The rule's `action.merchant` is the pattern's NORMALIZED merchant — the same
 * `normalizeMerchant` `refreshPatterns` above compares against, so the two
 * ends of this mechanism cannot disagree on what "the same merchant" means.
 */
export async function dismissPattern(patternId: string, now: number): Promise<void> {
  const pattern = await getPattern(patternId);
  if (pattern === null) throw new RecurringPatternNotFoundError(patternId);

  await withUnitOfWork(async () => {
    await repoDismissPattern(patternId);
    await createUserRule(
      {
        matcher: { merchantPattern: pattern.merchant },
        action: { kind: "suppress-recurring", merchant: normalizeMerchant(pattern.merchant) },
        createdFrom: pattern.id,
      },
      now,
    );
  });
}

/**
 * How many times a month a pattern charges.
 *
 * THE EXACT CADENCE WINS OVER THE BUCKET. `period` is a three-value enum and
 * `periodFor` buckets any cadence up to about 14.6 days as `weekly`, so a
 * fortnightly charge scaled by the weekly factor gets counted 52 times a year
 * instead of 26 — very nearly double its real cost, on exactly the cadence PH
 * payroll runs on. The bucket is the right identity for a pattern and the
 * wrong divisor for its money; `periodDays` is the row's own measured cadence
 * and has no such collision.
 *
 * Only a row with no usable cadence falls back to `MONTHLY_FACTOR`: `null` on
 * a pre-migration-007 row, and `<= 0` defensively, since dividing by that
 * would return `Infinity` and poison the whole sum rather than one row of it.
 */
function monthlyRate(pattern: RecurringPattern): number {
  const cadenceDays = pattern.periodDays;
  if (cadenceDays === null || cadenceDays <= 0) return MONTHLY_FACTOR[pattern.period];
  return DAYS_PER_MONTH / cadenceDays;
}

/**
 * Reports rule 17's headline figure: acknowledged patterns not linked to a
 * Bill, normalized to a monthly equivalent and summed. Rounded once at the
 * end, not per pattern, so several fractional conversions do not each shave
 * off a centavo before they are added.
 *
 * The rule writes its formula in `period` terms; `monthlyRate` reads that same
 * formula off the pattern's exact `periodDays` instead, because the enum
 * cannot tell a weekly charge from a fortnightly one and this is the one place
 * where that difference doubles the number the user reads.
 */
export function monthlyLockedIn(patterns: RecurringPattern[]): Centavos {
  const total = patterns
    .filter((pattern) => pattern.acknowledged && pattern.billId === null)
    .reduce((sum, pattern) => sum + pattern.amount * monthlyRate(pattern), 0);
  return Math.round(total);
}

/**
 * Turns a pattern into a tracked Bill (plan rule 2). Delegates the actual
 * cadence-to-DueRule mapping to `promoteRecurringPatternToBill`
 * (lib/bills/bills_service.ts) rather than reimplementing it, then does the
 * half of bills rules 28-29 that call is responsible for: acknowledging the
 * pattern and writing the pattern -> bill link (`linkPatternToBill`).
 *
 * PROMOTING TWICE RETURNS THE SAME BILL, never a second one. A pattern
 * already linked to a Bill has already done this work — a double-tap or a
 * retried mutation must not create a duplicate for the same subscription.
 */
export async function promotePatternToBill(patternId: string, now: number): Promise<Bill> {
  const pattern = await getPattern(patternId);
  if (pattern === null) throw new RecurringPatternNotFoundError(patternId);

  if (pattern.billId !== null) {
    const existingBill = await getBill(pattern.billId);
    if (existingBill !== null) return existingBill;
    // The linked bill is gone somehow (bills are never hard-deleted in this
    // app, so this should not happen in practice) — fall through and promote
    // fresh rather than get stuck unable to promote at all.
  }

  const bill = await promoteRecurringPatternToBill(
    {
      merchant: pattern.merchant,
      amount: pattern.amount,
      periodDays: pattern.periodDays ?? PERIOD_NOMINAL_DAYS[pattern.period],
      // Patterns carry no category of their own — detection groups purely by
      // merchant and amount. The promotion flow opens a PREFILLED form
      // (bills_service.ts's own header comment), so a generic default here is
      // a starting point the user corrects, not a wrong bill they are stuck
      // with.
      categoryId: DEFAULT_BILL_CATEGORY_ID,
      firstSeenAt: pattern.firstSeenAt ?? pattern.createdAt,
    },
    now,
  );

  await linkPatternToBill(pattern.id, bill.id);
  return bill;
}
