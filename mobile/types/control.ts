// types/control.ts — types owned by the control plane (Limits, Income, Goals,
// Loans, Bills), as opposed to types/domain.ts, which the foundation owns and
// the interface contract §3 pins.
//
// THE SPLIT IS ABOUT OWNERSHIP, NOT SUBJECT. `LimitScope`, `LimitBasis`,
// `LimitThreshold` and `Limit` itself all live in domain.ts and are imported
// from there — they are contract surface, and redefining them here would create
// two spellings of the same union that drift the moment one is edited. What
// belongs in this file is state no aggregate exposes: the engine's own working
// memory, and the input shapes its repositories accept.
import type {
  Centavos,
  EpochMs,
  IncomeCadence,
  LimitBasis,
  LimitScope,
  LimitThreshold,
} from "./domain";

/**
 * Everything the limit engine must remember between two ledger commits.
 *
 * Persisted across TWO columns of the `limits` row, and assembled back into one
 * object here because the engine has no use for the distinction:
 *   - `fired` ↔ `thresholds_fired_json` (also `Limit.thresholdsFired`)
 *   - the rest ↔ `limit_alert_state_json` (migration 004)
 * `setLimitAlertState` writes both in a single UPDATE — see 004's header for
 * why they cannot be allowed to half-apply.
 *
 * `null` from `getLimitAlertState` means the engine has never evaluated this
 * limit, which is NOT the same as a period in which nothing has fired yet.
 */
export type LimitAlertState = {
  /** Local start of the period this state describes. Detects a boundary crossing. */
  periodStart: EpochMs;
  /**
   * The peso base snapshotted when the period opened (limits rule 11).
   * Persisted rather than recomputed because a percent-of-income limit's base
   * moves with the income profile, and a period must be judged against the
   * figure that was true when it started.
   */
  base: Centavos;
  /** Rollover carried in from the previous period (limits rule 14). */
  carryover: Centavos;
  /**
   * Thresholds already alerted this period. Never re-arms within a period
   * (limits rule 20); reset at each boundary.
   */
  fired: LimitThreshold[];
  /** "Mute for this period" (limits rule 25). */
  muted: boolean;
  /**
   * Spend at the previous evaluation. The engine needs the PREVIOUS figure to
   * detect a crossing — a threshold fires when spend moves from below it to
   * at-or-above it, which a single current total cannot express.
   */
  lastSpend: Centavos;
};

/**
 * Input to `createLimit`, and (as a `Partial`) to `updateLimit`.
 *
 * `value` follows `Limit.value` exactly: centavos for `fixed`, and percent × 100
 * as an integer for `percent-of-income` (12.5% → 1250). The m2 plan's own
 * comment says "whole percent 0–100" for the percent case and is wrong —
 * types/domain.ts is the contract surface and it says otherwise.
 *
 * The two filters are `?: string[] | null` rather than `?: string[]` so a patch
 * can distinguish "leave it alone" (`undefined`) from "remove it" (`null`).
 * Without that a user could narrow a limit to a category and never widen it back.
 */
export type NewLimit = {
  scope: LimitScope;
  basis: LimitBasis;
  value: number;
  categoryFilter?: string[] | null;
  walletFilter?: string[] | null;
  rollover?: boolean;
  isActive?: boolean;
};

/**
 * The limits spec's UX states table, as a union — one member per row.
 *
 * DECIDED ONCE, BY `getLimitStatuses`. A card that recomputed the 50/80/100
 * boundaries from `spend` and `effectiveLimit` would be a second opinion about
 * whether the user is over their limit, and the two would drift the first time
 * a boundary moved. The service decides; the card renders.
 *
 * `paused` is rule 12 (percent-of-income with no usable income). `inactive` is
 * the table's "Inactive (gated)" row — a limit the free tier is not enforcing,
 * whose card is kept and dimmed rather than hidden.
 */
export type LimitUiState = "on_track" | "caution" | "warning" | "over" | "paused" | "inactive";

/**
 * One limit that just tripped a threshold, ready to be ordered and turned into
 * copy (limits rules 21–22).
 *
 * Lives here rather than in `limit_engine.ts` (where the m2 plan puts it)
 * because BOTH sides need it and neither should import the other:
 * `lib/limits/limit_engine.ts` produces and orders these, and
 * `lib/alerts/alert_copy.ts` renders them. A shape in the engine would make the
 * copy catalogue depend on the engine for a record type.
 *
 * `scope` is here, and the plan omits it, because the single-alert copy is
 * phrased around it — docs/12 §7a's canonical example is "You've reached 80% of
 * your **monthly** limit." `limitName` is the human label for the multi-limit
 * list ("Food & Dining", "GCash daily"); the `limits` table has no name column,
 * so whoever builds a `LimitAlert` derives it from the scope and filters.
 */
export type LimitAlert = {
  limitId: string;
  limitName: string;
  scope: LimitScope;
  threshold: LimitThreshold;
  spend: Centavos;
  /** base + carryover, the figure every threshold is measured against (rule 15). */
  effectiveLimit: Centavos;
  daysLeft: number;
};

// ===========================================================================
// Income (m2 Task 9) — docs/04-features/04-income.md
// ===========================================================================

/**
 * How far detection has got, and what it currently believes.
 *
 * SEPARATE FROM THE `IncomeProfile` ROW, and the split is the point. The
 * profile is what the app ACTS on — the figure a percent-of-income limit is
 * measured against (limits rule 12). This is detection's working notes: what it
 * has matched, what it has been told to stop suggesting, how many expected
 * paydays have gone by with nothing. Writing the notes into the profile would
 * mean every provisional guess immediately changed the user's limits.
 *
 * Persisted as ONE JSON value in `app_settings` under `income_detection_state`,
 * which is what m2 Global Constraint 9 prescribes for auxiliary state with no
 * dedicated column — and it fits here in a way it did not for the limit alert
 * state, because there is exactly ONE income profile (invariant I9). No
 * per-entity map, no orphan on delete.
 *
 * NOTE: the m2 plan also asks for a `Cadence` alias here. `types/domain.ts`
 * already exports `IncomeCadence` with the same four members, and two spellings
 * of one union drift the moment either is edited. `IncomeCadence` is used.
 */
export type IncomeDetectionState = {
  /**
   * `unknown` → nothing detected yet · `provisional` → a stream is forming but
   * the user has not confirmed it · `confirmed` → usable, which is what limits
   * rule 12 requires · `lapsed` → was confirmed, then the expected windows
   * stopped arriving (rule 13).
   */
  status: "unknown" | "provisional" | "confirmed" | "lapsed";
  cadence: IncomeCadence | null;
  averageAmount: Centavos | null;
  sourceWalletIds: string[];
  /** The ledger rows the current belief is built from. */
  matchedTransactionIds: string[];
  /**
   * Signature of the last suggestion the user dismissed (income flow 2), so the
   * same one is not offered again. A signature rather than a boolean: a
   * genuinely different stream should still be allowed to ask.
   */
  suggestionDismissedSignature: string | null;
  /** Consecutive expected windows with no match (rule 13's lapse counter). */
  missedWindows: number;
  /**
   * Transactions a payday event has ALREADY been emitted for (m2-part2 Task 12,
   * rule 4: "at most once per expected payday window, deduplicated by the
   * matched transaction id").
   *
   * ITS OWN FIELD, NOT `matchedTransactionIds`. Those two look
   * interchangeable and are not: `matchedTransactionIds` is detection evidence
   * and gets overwritten wholesale on every refresh, so deduplicating against
   * it would either forget an emission the moment the window slid or suppress
   * the very first payday of a stream. A subscriber to this event moves real
   * money into a Goal, so a double-fire is a double allocation.
   *
   * Bounded — only the most recent ids are kept. A payday that aged out cannot
   * re-fire anyway, because it also aged out of the detection window.
   */
  emittedPaydayTransactionIds: string[];
};

/** The state of a device where detection has never run. */
export const UNKNOWN_INCOME_DETECTION: IncomeDetectionState = {
  status: "unknown",
  cadence: null,
  averageAmount: null,
  sourceWalletIds: [],
  matchedTransactionIds: [],
  suggestionDismissedSignature: null,
  missedWindows: 0,
  emittedPaydayTransactionIds: [],
};
