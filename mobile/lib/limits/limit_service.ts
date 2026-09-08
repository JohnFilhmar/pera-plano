// lib/limits/limit_service.ts — where the pure limit engine meets the database
// and the notification tray (m2 Task 7).
//
// `limit_engine.ts` decides what a period is and which threshold fired;
// `limits_repo.ts` stores; `transactions_repo.sumSpend` counts; `alerts_service`
// posts. This file owns the order those happen in and nothing else — it holds no
// math of its own, so a rule change lands in the engine where it is tested
// against fixed timestamps rather than against a database.
//
// STILL CLOCK-INJECTED. Every entry point takes `now`. The real clock enters at
// the call site (a screen, or the `ledger:committed` subscriber), which is what
// lets these tests drive a limit across a month boundary in one call.
//
// ---------------------------------------------------------------------------
// Two things worth knowing before changing anything here
// ---------------------------------------------------------------------------
// 1. `getLimitStatuses` NEVER WRITES. The m2 plan routes it through the same
//    state-rolling helper `recomputeLimits` uses, which means simply looking at
//    the Plan tab persists a period roll — resetting `fired`, zeroing
//    `lastSpend`, and deciding a boundary was crossed from inside a render. Two
//    concurrent React Query renders would both do it. Reads resolve the state
//    they would use and throw it away; only `recomputeLimits`, `muteLimitForPeriod`
//    and `refreshLimitBase` persist.
//
// 2. CARRYOVER IS ONLY EVER TAKEN FROM A PERIOD THIS LIMIT ACTUALLY RAN UNDER
//    ITS CURRENT TERMS. Limits rule 18: a limit "does not retroactively receive
//    any" headroom from before it existed. But a period is not required to have
//    been RECORDED — a quiet month writes no alert state and still carries its
//    headroom forward (rule 14). See `previousBaseOf`.
//
// POSTING LIVES IN `limit_notifier.ts`, NOT HERE. `getLimitStatuses` is what a
// screen calls to draw a progress bar, and when the notifier sat beside it,
// importing this module pulled in `alerts_service` → `expo-notifications` →
// the `NotificationListener` native module. Recompute returns alerts; something
// else decides to post them.
import { listCategoryRefs } from "@/lib/db/repos/categories_repo";
import {
  getLimit,
  getLimitAlertState,
  listLimits,
  setLimitAlertState,
} from "@/lib/db/repos/limits_repo";
import { sumSpend } from "@/lib/db/repos/transactions_repo";
import type { LimitAlert, LimitAlertState, LimitUiState } from "@/types/control";
import type { Centavos, Limit } from "@/types/domain";

import {
  baseFor,
  carryoverFor,
  coalesceAlerts,
  crossedThreshold,
  effectiveLimitFor,
  expandCategoryIds,
  periodWindowFor,
  previousPeriodWindow,
  type PeriodWindow,
} from "./limit_engine";
// Called with NO category map on purpose: this path runs on every ledger commit,
// and loading the category table to phrase a notification would be a query per
// alert. Screens pass the map and get the richer form of the same name.
import { limitDisplayName } from "./limit_label";

/**
 * One limit as a screen needs it. `uiState` mirrors the limits spec's UX states
 * table exactly, including the two the m2 plan's own union omits nothing of but
 * `inactive`, which that table calls "Inactive (gated)".
 *
 * `base` and `effectiveLimit` are `null` only when paused — there is no peso
 * figure to show, and rendering ₱0.00 would be the silent zero rule 12 forbids.
 */
export type LimitStatus = {
  limit: Limit;
  paused: boolean;
  base: Centavos | null;
  carryover: Centavos;
  effectiveLimit: Centavos | null;
  spend: Centavos;
  window: PeriodWindow;
  uiState: LimitUiState;
};

type SpendFilters = { categoryIds?: string[]; walletIds?: string[] };

/**
 * The `sumSpend` filters for one limit (limits rules 2-4).
 *
 * A null or empty filter is OMITTED rather than passed as `[]`. `sumSpend`
 * returns 0 for an empty array — correct for "match nothing", catastrophic for
 * "no filter", which is what an absent filter means. `limits_repo` already
 * normalises empty to null on the way in; this is the other end of the same
 * rule.
 */
async function filtersFor(limit: Limit): Promise<SpendFilters> {
  const filters: SpendFilters = {};
  if (limit.categoryFilter !== null && limit.categoryFilter.length > 0) {
    filters.categoryIds = expandCategoryIds(limit.categoryFilter, await listCategoryRefs());
  }
  if (limit.walletFilter !== null && limit.walletFilter.length > 0) {
    filters.walletIds = limit.walletFilter;
  }
  return filters;
}

/**
 * `base(N−1)` for rule 14, or `null` when this limit is not entitled to a
 * carryover at all — in which case the previous window is never summed.
 *
 * THE STORED SNAPSHOT FIRST, ALWAYS. When state exists for exactly the previous
 * period, `existing.base` is the figure that period was actually measured
 * against (rule 11 snapshots it at the boundary), and rule 18's last sentence
 * requires it for percent-of-income: "carryover math uses the snapshotted peso
 * bases of each period".
 *
 * A MISSING SNAPSHOT IS NOT A MISSING PERIOD, and treating it as one was the
 * bug. The alert state is only written by `recomputeLimits`, which only runs on
 * a ledger commit — so a period in which nothing was committed leaves no row.
 * A daily limit on a quiet day, or a weekly limit over a quiet week, then
 * carried nothing forward: exactly inverted, since a period with no spend is
 * the one rule 14 carries in FULL. The doc's own acceptance example ("spend
 * ₱0.00 in June → July effective limit ₱16,000.00") was unreachable, because
 * spending nothing in June is what stops June from being recorded.
 *
 * `base(N−1)` IS RECONSTRUCTED ONLY WHERE IT IS EXACT, never estimated:
 *
 * - `basis: fixed` only. Rule 9: "the base limit for every period equals
 *   `value`" — a constant this row still carries. For percent-of-income the
 *   base is a snapshot of an income that has since moved on; deriving it from
 *   TODAY's income would substitute base(N) for base(N−1), which rule 18
 *   forbids in as many words, and would also credit a period the limit spent
 *   **Paused — income unknown** (rule 12: it "stops counting"), which is
 *   indistinguishable from a quiet one once the snapshot is gone.
 * - `updatedAt` MUST PRE-DATE THE CURRENT PERIOD. `previous.end` is this
 *   period's first instant, so this asks whether the limit's terms have been
 *   edited since the previous period closed. It covers three separate rules at
 *   once, and dropping it inflates a limit rather than deflating one:
 *   · rule 18's "does not retroactively receive any" — a limit created this
 *     period, or one whose rollover toggle was switched on this period, has
 *     `updatedAt` inside it (`createdAt <= updatedAt` always, so creation is
 *     subsumed) and gets nothing;
 *   · rule 9 again — raising `value` from ₱8,000 to ₱20,000 today must not
 *     retroactively make last month's base ₱20,000;
 *   · rules 2-4 — `filtersFor` sums the previous window with TODAY's filters,
 *     so a filter edited since is a spend figure for a limit that never
 *     existed.
 *
 * ONE STEP BACK, NEVER CHAINED. Rule 14 is `clamp(base(N−1) − spend(N−1), 0,
 * base(N))` and rule 16 says carryover "expires at the end of the period it was
 * carried into", so three quiet weeks carry one week of headroom, not three.
 * `previous` is the immediately preceding window whatever the stored state
 * says, which is what makes a two-period-stale row carry N−1 and not N−2.
 */
function previousBaseOf(
  limit: Limit,
  existing: LimitAlertState | null,
  base: Centavos,
  previous: PeriodWindow,
): Centavos | null {
  if (!limit.rollover) return null;
  if (existing !== null && existing.periodStart === previous.start) return existing.base;
  if (limit.basis !== "fixed") return null;
  if (limit.updatedAt >= previous.end) return null;
  // `baseFor` on a fixed limit is `limit.value` for every period, so the base
  // already resolved for N is base(N−1) exactly — no second derivation.
  return base;
}

/**
 * The alert state this limit should be using for `window`, WITHOUT persisting
 * it. Returns the stored state untouched when it already belongs to `window`;
 * otherwise builds the state a period boundary produces.
 *
 * The previous period's spend is only queried when `previousBaseOf` says it can
 * actually be used — this runs on every ledger commit, for every active limit,
 * and the early return above it means the query costs at most one extra sum per
 * limit per period boundary rather than one per commit.
 */
async function resolveState(
  limit: Limit,
  window: PeriodWindow,
  base: Centavos,
  now: number,
): Promise<LimitAlertState> {
  const existing = await getLimitAlertState(limit.id);
  if (existing !== null && existing.periodStart === window.start) return existing;

  const previous = previousPeriodWindow(limit.scope, now);
  const prevBase = previousBaseOf(limit, existing, base, previous);

  let carryover = 0;
  if (prevBase !== null) {
    const prevSpend = await sumSpend({
      from: previous.start,
      to: previous.end,
      ...(await filtersFor(limit)),
    });
    carryover = carryoverFor({
      rollover: limit.rollover,
      prevBase,
      prevSpend,
      base,
    });
  }

  // `fired: []` and `muted: false` are the period boundary doing its job:
  // thresholds reset (rule 20) and a mute lasts only "until the next period
  // boundary" (rule 25).
  return { periodStart: window.start, base, carryover, fired: [], muted: false, lastSpend: 0 };
}

/**
 * The figure every threshold is measured against.
 *
 * READS `limit.rollover` RATHER THAN TRUSTING THE SNAPSHOT. Rule 18: "Turning
 * rollover off immediately removes the current period's carryover from the
 * effective limit." The stored carryover is what the boundary computed; the
 * toggle is what the user believes right now, and mid-period it is the toggle
 * that wins.
 */
function effectiveLimitOf(limit: Limit, state: LimitAlertState): Centavos {
  return effectiveLimitFor(state.base, limit.rollover ? state.carryover : 0);
}

/**
 * Evaluates every ACTIVE limit against `now` and returns the alerts that just
 * fired, most-severe first (limits rules 19-23).
 *
 * Persists each limit's state — this is the only path that decides a period
 * boundary was crossed. Returns alerts rather than posting them, so a caller
 * can decide whether the user is looking at the app; `notifyLimitAlerts` is the
 * notification half.
 *
 * A muted limit still RECORDS its fired threshold while contributing no alert
 * (rules 25 and 30: muting affects notifications only). Recording it is what
 * stops the threshold re-arming the moment the mute expires.
 */
export async function recomputeLimits(args: {
  now: number;
  monthlyIncome: Centavos | null;
}): Promise<LimitAlert[]> {
  const alerts: LimitAlert[] = [];

  for (const limit of await listLimits({ activeOnly: true })) {
    const base = baseFor(limit, args.monthlyIncome);
    // Paused — income unknown (rule 12): stops counting, stops alerting.
    if (base === null) continue;

    const window = periodWindowFor(limit.scope, args.now);
    const state = await resolveState(limit, window, base, args.now);
    const effectiveLimit = effectiveLimitOf(limit, state);
    const spend = await sumSpend({
      from: window.start,
      to: window.end,
      ...(await filtersFor(limit)),
    });

    const threshold = crossedThreshold({
      prevSpend: state.lastSpend,
      newSpend: spend,
      effectiveLimit,
      alreadyFired: state.fired,
    });

    if (threshold !== null) {
      state.fired = [...state.fired, threshold];
      if (!state.muted) {
        alerts.push({
          limitId: limit.id,
          limitName: limitDisplayName(limit),
          scope: limit.scope,
          threshold,
          spend,
          effectiveLimit,
          daysLeft: window.daysLeft,
        });
      }
    }

    state.lastSpend = spend;
    await setLimitAlertState(limit.id, state);
  }

  return coalesceAlerts(alerts);
}

/** The spec's UX states table, as a function. */
function uiStateFor(spend: Centavos, effectiveLimit: Centavos): LimitUiState {
  // A zero effective limit is reachable — `floorToPeso` can round a tiny
  // percentage of a small income down to nothing. `spend / 0` is Infinity, and
  // `0 / 0` is NaN, which fails every comparison and would silently report
  // "on_track" for a limit no spend can stay inside.
  if (effectiveLimit <= 0) return spend > 0 ? "over" : "on_track";

  const ratio = spend / effectiveLimit;
  if (ratio >= 1) return "over";
  if (ratio >= 0.8) return "warning";
  if (ratio >= 0.5) return "caution";
  return "on_track";
}

/**
 * Every limit, active or not, as the Plan tab renders it. A PURE READ — see
 * this file's header.
 *
 * Inactive limits are reported without being measured. The spec's UX states
 * table keeps their card ("shown dimmed with an 'inactive' tag and an
 * activate/swap action"), and counting spend against a limit that is not
 * enforcing anything would put a live-looking progress bar on it.
 */
export async function getLimitStatuses(args: {
  now: number;
  monthlyIncome: Centavos | null;
}): Promise<LimitStatus[]> {
  const statuses: LimitStatus[] = [];

  for (const limit of await listLimits()) {
    const window = periodWindowFor(limit.scope, args.now);
    const base = baseFor(limit, args.monthlyIncome);

    if (!limit.isActive || base === null) {
      statuses.push({
        limit,
        paused: base === null,
        base: null,
        carryover: 0,
        effectiveLimit: null,
        spend: 0,
        window,
        uiState: limit.isActive ? "paused" : "inactive",
      });
      continue;
    }

    const state = await resolveState(limit, window, base, args.now);
    const effectiveLimit = effectiveLimitOf(limit, state);
    const spend = await sumSpend({
      from: window.start,
      to: window.end,
      ...(await filtersFor(limit)),
    });

    statuses.push({
      limit,
      paused: false,
      base: state.base,
      carryover: limit.rollover ? state.carryover : 0,
      effectiveLimit,
      spend,
      window,
      uiState: uiStateFor(spend, effectiveLimit),
    });
  }

  return statuses;
}

/**
 * "Mute for this period" (limits rule 25). Silences notifications only — the
 * visual states stay live and thresholds keep being recorded.
 *
 * TAKES `monthlyIncome`, WHICH THE m2 PLAN'S SIGNATURE DOES NOT, because it may
 * have to create the state and a percent-of-income limit's base cannot be
 * derived without it. The plan fabricates `base: limit.value` instead — and for
 * `percent-of-income`, `value` is percent × 100, so muting a 20% limit before
 * its first recompute writes a base of ₱20.00. That state carries the current
 * `periodStart`, so the next recompute accepts it as this period's snapshot and
 * the limit stays ₱20.00 for the rest of the month, silently.
 *
 * A PAUSED limit is a no-op: it does not alert, so there is nothing to mute,
 * and inventing a base for it is the bug above by another route.
 */
export async function muteLimitForPeriod(
  limitId: string,
  now: number,
  monthlyIncome: Centavos | null,
): Promise<void> {
  const limit = await getLimit(limitId);
  if (limit === null) return;

  const base = baseFor(limit, monthlyIncome);
  if (base === null) return;

  const window = periodWindowFor(limit.scope, now);
  const state = await resolveState(limit, window, base, now);
  await setLimitAlertState(limitId, { ...state, muted: true });
}

/**
 * Re-snapshots the base immediately — limits rule 11's one exception to "the
 * base is fixed for the period". Call after a manual edit to the limit or to
 * the IncomeProfile. Automatic income drift must NOT come through here; rule 11
 * applies it only from the next period start, so alerts never flap mid-period.
 *
 * `fired` SURVIVES within the same period. Rule 20: raising the effective limit
 * updates the visual state, "but a later crossing in the same period does not
 * re-notify". Wiping it would re-arm every threshold the user has already been
 * alerted for, and a single edit would replay the whole ladder.
 *
 * When the stored state belongs to an OLDER period, this rolls it properly
 * rather than relabelling it. The m2 plan overwrites `periodStart` while
 * spreading the rest, so a stale July state becomes August's — carrying July's
 * `fired`, `carryover` and `lastSpend` into a period that earned none of them.
 */
export async function refreshLimitBase(
  limitId: string,
  now: number,
  monthlyIncome: Centavos | null,
): Promise<void> {
  const limit = await getLimit(limitId);
  if (limit === null) return;

  const base = baseFor(limit, monthlyIncome);
  if (base === null) return;

  const window = periodWindowFor(limit.scope, now);
  const state = await resolveState(limit, window, base, now);
  await setLimitAlertState(limitId, { ...state, base });
}
