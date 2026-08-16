// lib/db/repos/recurring_patterns_repo.ts — the only SQL surface for the
// RecurringPattern aggregate (M3 Part 2 Task 6). Same house shape as
// bills_repo.ts / loans_repo.ts.
//
// ---------------------------------------------------------------------------
// THE IDENTITY KEY IS NORMALIZED MERCHANT + PERIOD BUCKET + AMOUNT TOLERANCE —
// NOT periodDays, and NOT the literal merchant string. (Fix round 1, reviewer
// ruling — overrides the plan's original "keyed on merchant + periodDays".)
// ---------------------------------------------------------------------------
// Two reasons, one per component that ISN'T in the key:
//
//   NOT THE LITERAL MERCHANT STRING. `DetectedPattern.merchant`
//   (lib/recurring/pattern_detector.ts) is the label seen MOST OFTEN in the
//   current evidence, per that file's own `mostCommonMerchant` — which can
//   shift between refresh passes as more transactions land ("Netflix.com" is
//   most-common today, "Netflix" once a few more instances arrive). Every
//   lookup here goes through the detector's own `normalizeMerchant` instead.
//
//   NOT periodDays. It is `Math.round(meanGap)` over a SLIDING WINDOW,
//   recomputed fresh on every `refreshPatterns` pass — so it legitimately
//   wobbles for one real, unchanged subscription (gaps [31, 31] round to 31;
//   a fourth occurrence arrives and the same subscription's gaps round to
//   30). It is least stable right at `MIN_OCCURRENCES`, which is exactly when
//   a pattern first gets a row. Keying on it meant a dismissed pattern could
//   silently un-key itself and resurface as a "new" suggestion with zero
//   material change — Reports rule 18's "never re-surfaced" has no exception
//   for an integer that wobbled, so an exact-periodDays key cannot deliver it.
//
// What IS in the key instead: the stable `period` BUCKET (weekly / monthly /
// annual — the same enum Reports rule 17 already normalizes from, so it is
// the project's own unit of cadence, not a bespoke tolerance) and the
// candidate's amount within `AMOUNT_TOLERANCE_PCT` of the existing row's
// current amount, reusing pattern_detector.ts's own clustering constant so
// this identity check cannot disagree with the clustering that produced the
// candidate in the first place. `period_days` is still WRITTEN to the row —
// `promotePatternToBill` needs the exact cadence — it has simply stopped
// being part of who the row IS.
//
// ---------------------------------------------------------------------------
// A DISMISSED ROW IS NEVER TOUCHED BY THE ORDINARY UPDATE PATH
// ---------------------------------------------------------------------------
// `upsertPattern` merges only the fields a fresh detection pass actually
// knows about (merchant label, amount, cadence, confidence, first/last seen).
// `acknowledged`, `bill_id` and `dismissed_at` are USER (or promotion) state,
// and a re-detection pass merging them back to their old values would silently
// undo an acknowledge, a promotion, or a dismissal the moment the ledger next
// changes. `lib/recurring/recurring_service.ts` owns the judgment call about
// WHEN a dismissal should be lifted; this file only provides the primitive.
import { getDatabase } from "@/lib/db/database";
import { newId } from "@/lib/ids";
import {
  AMOUNT_TOLERANCE_PCT,
  normalizeMerchant,
  type DetectedPattern,
} from "@/lib/recurring/pattern_detector";
import type { RecurringPattern, RecurringPeriod } from "@/types/domain";

const DAY_MS = 86_400_000;

/**
 * Geometric midpoints between the three nominal period lengths (7, 30.44 and
 * 365.25 days) — the point equidistant in RATIO terms from its neighbours, so
 * a 15-day pattern reads as "closer to monthly" than to weekly, and a 100-day
 * one still reads as closer to monthly than to annual. `period` is a
 * three-bucket enum (contract-pinned) and every exact cadence has to land in
 * one of the three; nearest-in-ratio is the least arbitrary way to pick.
 */
const WEEKLY_MONTHLY_BOUNDARY_DAYS = Math.sqrt(7 * 30.44);
const MONTHLY_ANNUAL_BOUNDARY_DAYS = Math.sqrt(30.44 * 365.25);

/** Buckets an exact cadence into the contract's `period` enum. Exported so the
 * service can compare "did the bucket change" without re-deriving this. */
export function periodFor(periodDays: number): RecurringPeriod {
  if (periodDays <= WEEKLY_MONTHLY_BOUNDARY_DAYS) return "weekly";
  if (periodDays <= MONTHLY_ANNUAL_BOUNDARY_DAYS) return "monthly";
  return "annual";
}

/**
 * Whether two amounts are close enough to be the same subscription, per
 * pattern_detector.ts's own `AMOUNT_TOLERANCE_PCT`. The SMALLER of the two is
 * the reference, mirroring `clusterByAmount`'s own ascending-sorted
 * comparison (there the earlier, smaller amount in the cluster is always the
 * reference); here either side could be the smaller one, so `Math.min` picks
 * it explicitly rather than assuming an order.
 */
function amountsMatch(a: number, b: number): boolean {
  const reference = Math.min(a, b);
  if (reference <= 0) return a === b;
  return Math.abs(a - b) <= (reference * AMOUNT_TOLERANCE_PCT) / 100;
}

type RecurringPatternRow = {
  id: string;
  merchant: string;
  amount: number;
  period: string;
  period_days: number | null;
  confidence: number;
  acknowledged: number;
  bill_id: string | null;
  first_seen_at: number | null;
  last_seen_at: number | null;
  dismissed_at: number | null;
  created_at: number;
  updated_at: number;
};

export class RecurringPatternNotFoundError extends Error {
  constructor(public readonly patternId: string) {
    super(`recurring pattern not found: ${patternId}`);
    this.name = "RecurringPatternNotFoundError";
  }
}

function rowToPattern(row: RecurringPatternRow): RecurringPattern {
  return {
    id: row.id,
    merchant: row.merchant,
    amount: row.amount,
    period: row.period as RecurringPeriod,
    periodDays: row.period_days,
    confidence: row.confidence,
    acknowledged: row.acknowledged === 1,
    billId: row.bill_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    dismissedAt: row.dismissed_at,
    // Derived, never stored — see types/domain.ts's own comment on this field.
    nextExpectedAt:
      row.last_seen_at !== null && row.period_days !== null
        ? row.last_seen_at + row.period_days * DAY_MS
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getPattern(id: string): Promise<RecurringPattern | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<RecurringPatternRow>(
    "SELECT * FROM recurring_patterns WHERE id = ?",
    [id],
  );
  return row ? rowToPattern(row) : null;
}

/**
 * The row `upsertPattern` would merge into for this candidate, regardless of
 * its acknowledged or dismissed state — callers that need to see PAST that
 * state (the service's "is this dismissed row still the same commitment"
 * check) go through this rather than `listPatterns`, which hides dismissed
 * rows on purpose.
 *
 * Matches on normalized merchant + `period` BUCKET + amount within tolerance
 * (see file header for why periodDays itself is not part of this). Filtered
 * in SQL by the cheap, stable bucket column first; merchant normalization and
 * the amount comparison run in JS over that narrowed set, the same
 * find-then-filter shape `getPatternByMerchantAndPeriod`'s predecessor used.
 */
export async function findMatchingPattern(
  merchant: string,
  periodDays: number,
  amount: number,
): Promise<RecurringPattern | null> {
  const db = await getDatabase();
  const bucket = periodFor(periodDays);
  const rows = await db.getAllAsync<RecurringPatternRow>(
    "SELECT * FROM recurring_patterns WHERE period = ?",
    [bucket],
  );
  const match = rows.find(
    (row) =>
      normalizeMerchant(row.merchant) === normalizeMerchant(merchant) && amountsMatch(row.amount, amount),
  );
  return match ? rowToPattern(match) : null;
}

/**
 * Inserts a freshly detected pattern, or merges it into the existing row for
 * the same identity (see file header). Never touches `acknowledged`,
 * `bill_id` or `dismissed_at` — those are state this function has no opinion
 * about.
 */
export async function upsertPattern(p: DetectedPattern): Promise<RecurringPattern> {
  const db = await getDatabase();
  const now = Date.now();
  const existing = await findMatchingPattern(p.merchant, p.periodDays, p.amount);
  const period = periodFor(p.periodDays);

  if (existing !== null) {
    await db.runAsync(
      `UPDATE recurring_patterns
          SET merchant = ?, amount = ?, period = ?, period_days = ?, confidence = ?,
              first_seen_at = ?, last_seen_at = ?, updated_at = ?
        WHERE id = ?`,
      [p.merchant, p.amount, period, p.periodDays, p.confidence, p.firstSeenAt, p.lastSeenAt, now, existing.id],
    );
    const updated = await getPattern(existing.id);
    if (updated === null) throw new RecurringPatternNotFoundError(existing.id);
    return updated;
  }

  const id = newId();
  await db.runAsync(
    `INSERT INTO recurring_patterns
       (id, merchant, amount, period, period_days, confidence, acknowledged, bill_id,
        first_seen_at, last_seen_at, dismissed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, NULL, ?, ?)`,
    [id, p.merchant, p.amount, period, p.periodDays, p.confidence, p.firstSeenAt, p.lastSeenAt, now, now],
  );
  const created = await getPattern(id);
  if (created === null) throw new RecurringPatternNotFoundError(id);
  return created;
}

/**
 * Live patterns, cheapest-to-check first excluded: DISMISSED rows are always
 * excluded (rule 3 — a dismissed pattern is not re-proposed), regardless of
 * `includeAcknowledged`. `includeAcknowledged` defaults to `false`, mirroring
 * `listBills({ includeArchived })` — the common case is "what still needs a
 * decision", and a caller that wants the full locked-in picture (the
 * Subscriptions screen's header total) asks for it explicitly.
 *
 * ORDERED BY MONTHLY-EQUIVALENT COST, DESCENDING — the same "most expensive
 * first" philosophy `detectPatterns` states for its own output (plan rule 8):
 * the list exists to answer "what is this costing me", not to flatter
 * whichever row happened to update most recently. Ties break on merchant name
 * so the order is stable across renders rather than reshuffling on equal cost.
 */
export async function listPatterns(opts?: {
  includeAcknowledged?: boolean;
}): Promise<RecurringPattern[]> {
  const db = await getDatabase();
  const clauses = ["dismissed_at IS NULL"];
  if (opts?.includeAcknowledged !== true) clauses.push("acknowledged = 0");

  const rows = await db.getAllAsync<RecurringPatternRow>(
    `SELECT * FROM recurring_patterns WHERE ${clauses.join(" AND ")}
      ORDER BY
        CASE period
          WHEN 'weekly' THEN amount * 52.0 / 12
          WHEN 'monthly' THEN amount * 1.0
          WHEN 'annual' THEN amount / 12.0
          ELSE amount
        END DESC,
        merchant ASC`,
  );
  return rows.map(rowToPattern);
}

/** Reports rule 17-18's "confirms it as a real recurring commitment". */
export async function acknowledgePattern(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("UPDATE recurring_patterns SET acknowledged = 1, updated_at = ? WHERE id = ?", [
    Date.now(),
    id,
  ]);
}

/** Plan rule 3: suppressed until a materially different candidate re-arms it. */
export async function dismissPattern(id: string): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.runAsync(
    "UPDATE recurring_patterns SET dismissed_at = ?, updated_at = ? WHERE id = ?",
    [now, now, id],
  );
}

/**
 * Un-suppresses a dismissed pattern. Not currently called by
 * `refreshPatterns` — a candidate materially different from a dismissed row
 * simply fails `findMatchingPattern`'s tolerance check and is upserted as a
 * NEW row instead (see recurring_service.ts), which is what naturally
 * re-proposes it without needing this to run. Kept as a repository primitive
 * (symmetric to `dismissPattern`) for a future explicit "undo dismiss"
 * action. Idempotent: clearing an already-clear `dismissed_at` is a no-op in
 * effect.
 */
export async function clearDismissal(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE recurring_patterns SET dismissed_at = NULL, updated_at = ? WHERE id = ?",
    [Date.now(), id],
  );
}

/**
 * Bills rules 28-29's other half: promotion "sets the pattern's acknowledged:
 * true and links pattern -> bill". Both writes happen together because a
 * pattern linked to a Bill but not yet acknowledged (or the reverse) is a
 * state the product never intends to show — Reports rule 17 excludes
 * bill-linked patterns from the locked-in total precisely because promotion
 * IS the acknowledgement.
 *
 * Also clears `dismissed_at`: a pattern the user just turned into a tracked
 * Bill is by definition no longer a suggestion being suppressed.
 */
export async function linkPatternToBill(id: string, billId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE recurring_patterns
        SET bill_id = ?, acknowledged = 1, dismissed_at = NULL, updated_at = ?
      WHERE id = ?`,
    [billId, Date.now(), id],
  );
}
