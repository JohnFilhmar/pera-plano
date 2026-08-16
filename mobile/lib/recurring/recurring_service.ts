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
import { getBill } from "@/lib/db/repos/bills_repo";
import {
  clearDismissal,
  getPattern,
  getPatternByMerchantAndPeriod,
  linkPatternToBill,
  listPatterns,
  periodFor,
  upsertPattern,
} from "@/lib/db/repos/recurring_patterns_repo";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import { detectPatterns, type DetectedPattern } from "@/lib/recurring/pattern_detector";
import type { Bill, Centavos, RecurringPattern, RecurringPeriod } from "@/types/domain";

const DAY_MS = 86_400_000;

/**
 * How far back `refreshPatterns` reads the ledger. The detector's own floor
 * is `MIN_OCCURRENCES = 3` (pattern_detector.ts), so an ANNUAL pattern needs
 * roughly two full years of history before three instances even exist — three
 * charges a year apart span about 730 days. Rounded up with slack for a
 * charge that lands a few weeks early or late; `historyFloor()` inside
 * `listTransactions` still clamps this to whatever the current tier's
 * visibility window allows (entitlements.ts), so a Free device simply sees
 * less of it, per domain §3.10's tier note.
 */
const LEDGER_WINDOW_DAYS = 800;

/**
 * Nominal length of each `period` bucket, for the rare row that predates
 * migration 007 and so has no `periodDays` of its own to promote from.
 */
const PERIOD_NOMINAL_DAYS: Record<RecurringPeriod, number> = {
  weekly: 7,
  monthly: 30,
  annual: 365,
};

/** Reports rule 17, verbatim: weekly ×52÷12, monthly ×1, annual ÷12. */
const MONTHLY_FACTOR: Record<RecurringPeriod, number> = {
  weekly: 52 / 12,
  monthly: 1,
  annual: 1 / 12,
};

/**
 * How far amount may drift before a DISMISSED pattern counts as a different
 * commitment from the one the user already said no to (plan rule 3).
 *
 * Independent of the detector's own clustering tolerance (not exported by
 * pattern_detector.ts, and answering a different question — "is this the same
 * subscription" there, versus "has this dismissed one changed enough to ask
 * again" here) but chosen at the same generosity for the same reason: Netflix
 * raising ₱549 to ₱599 should not reopen a suggestion the user already
 * dismissed.
 */
const MATERIAL_AMOUNT_CHANGE_PCT = 15;

export class RecurringPatternNotFoundError extends Error {
  constructor(public readonly patternId: string) {
    super(`recurring pattern not found: ${patternId}`);
    this.name = "RecurringPatternNotFoundError";
  }
}

/**
 * Amount moved by more than the tolerance, OR the cadence bucket itself
 * changed (weekly became monthly, etc.) — a coarser signal than an exact
 * `periodDays` comparison, but `period` is the bucket the user actually reads
 * on the row they dismissed.
 */
function isMaterialChange(existing: RecurringPattern, candidate: DetectedPattern): boolean {
  const amountChanged =
    existing.amount > 0 &&
    (Math.abs(candidate.amount - existing.amount) / existing.amount) * 100 >
      MATERIAL_AMOUNT_CHANGE_PCT;
  const cadenceChanged = periodFor(candidate.periodDays) !== existing.period;
  return amountChanged || cadenceChanged;
}

/**
 * Re-runs detection over the ledger and merges the result into storage.
 * Returns every live (non-dismissed) pattern afterward, acknowledged and
 * suggested alike — the same read `listPatterns({ includeAcknowledged: true })`
 * gives a caller directly, returned here too so a caller that just triggered a
 * refresh does not have to make a second call to see its result.
 *
 * A DISMISSED-AND-UNCHANGED PATTERN IS SKIPPED ENTIRELY (rule 3) — not merely
 * hidden by `listPatterns`. Upserting its confidence and `lastSeenAt` on every
 * pass would let the stored row drift silently out of sync with what the user
 * actually saw and said no to; it stays exactly as dismissed until the
 * evidence changes enough to be a different question, at which point it is
 * upserted AND re-armed in the same pass.
 */
export async function refreshPatterns(now: number): Promise<RecurringPattern[]> {
  const from = now - LEDGER_WINDOW_DAYS * DAY_MS;
  const transactions = await listTransactions({ from, to: now + 1 });
  const detected = detectPatterns(transactions, now);

  for (const candidate of detected) {
    const existing = await getPatternByMerchantAndPeriod(candidate.merchant, candidate.periodDays);
    const wasDismissed = existing !== null && existing.dismissedAt !== null;

    if (wasDismissed && existing !== null && !isMaterialChange(existing, candidate)) {
      continue;
    }

    const saved = await upsertPattern(candidate);
    if (wasDismissed) await clearDismissal(saved.id);
  }

  return listPatterns({ includeAcknowledged: true });
}

/**
 * Reports rule 17's headline figure, exactly: acknowledged patterns not
 * linked to a Bill, normalized to a monthly equivalent BY `period` — the
 * spec's own formula names the three-bucket enum, not the exact day count —
 * and summed. Rounded once at the end, not per pattern, so several fractional
 * weekly conversions do not each shave off a centavo before they are added.
 */
export function monthlyLockedIn(patterns: RecurringPattern[]): Centavos {
  const total = patterns
    .filter((pattern) => pattern.acknowledged && pattern.billId === null)
    .reduce((sum, pattern) => sum + pattern.amount * MONTHLY_FACTOR[pattern.period], 0);
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
