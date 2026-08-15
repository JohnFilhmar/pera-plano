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
import type { Centavos, EpochMs, LimitBasis, LimitScope, LimitThreshold } from "./domain";

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
