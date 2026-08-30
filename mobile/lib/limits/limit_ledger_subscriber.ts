// lib/limits/limit_ledger_subscriber.ts — the caller `recomputeLimits` never
// had (m2 Task 7's "the `ledger:committed` subscriber", named in
// limit_service.ts's own header but never written).
//
// WHAT WAS ACTUALLY BROKEN. `recomputeLimits` is the only path in the app that
// calls `setLimitAlertState`. With nothing calling it, `getLimitAlertState`
// answered `null` forever, so `resolveState`'s
// `existing !== null && existing.periodStart === previous.start` could never be
// true, so `carriesForward` was always false — and a user who switched rollover
// on silently received no carried headroom, ever. `fired` was never latched
// either, so no threshold could record itself as having fired. Both of the M2
// exit criteria in docs/01-mvp-scope.md §4 ("fire alerts at 50/80/100%",
// "respect rollover") were unreachable from the running app while every unit
// test underneath them passed.
//
// MODELLED ON lib/income/income_ledger_subscriber.ts, deliberately, down to the
// debounce window — the two answer the same question about the same event and a
// second shape would be a second thing to reason about.
//
// TRAILING-EDGE DEBOUNCED. Draining the native capture buffer after the phone
// has been offline commits a burst of transactions in a tight loop, and every
// pass re-sums the whole current period for every active limit. Debounced, that
// burst is one pass, and that pass sees all of it.
//
// SUBSCRIBED TO `ledger:committed` ONLY. That is the event
// lib/events/app_events.ts was created for ("so the M2 limit engine can
// recompute") and the only one with a producer; `ledger:changed` is declared
// but nothing in the app emits it yet, so subscribing to it would add an
// untriggerable path rather than cover an edit.
//
// NOTHING HERE MAY BREAK THE APP. Limits are derived convenience; the ledger is
// the product. A failure is logged and swallowed, exactly as `startIngest`'s own
// catch in app/_layout.tsx does, because an app that will not open cannot be
// fixed by the user at all.
import { systemClock } from "@/lib/clock";
import { onAppEvent } from "@/lib/events/app_events";
import { getMonthlyEquivalentIncome } from "@/lib/income/income_service";

import { notifyLimitAlerts } from "./limit_notifier";
import { recomputeLimits } from "./limit_service";

/**
 * Long enough to swallow a drained burst, short enough that a single manual
 * entry updates the Plan tab while the user is still looking at it. The same
 * window `income_ledger_subscriber.ts` uses, for the same reason.
 */
const DEFAULT_DEBOUNCE_MS = 750;

/**
 * One limits pass: re-evaluate every active limit against `now`, then post
 * whatever tripped.
 *
 * ONE CLOCK READ, PASSED TO BOTH HALVES. `getMonthlyEquivalentIncome` and
 * `recomputeLimits` are separate reads of the same instant; taking the time
 * twice can straddle a period boundary — midnight, or the 1st of a month — and
 * resolve the spend window against one period while resolving income against
 * the next. `useLimitStatuses` reads it once for exactly this reason.
 *
 * RECOMPUTE FIRST, POST SECOND, AND NEVER THE OTHER WAY. Recompute is what
 * persists the period roll and latches `fired`; the notifier is a consumer of
 * its return value and holds no state of its own.
 *
 * Exported so the pass can be tested — and driven — without waiting on a timer.
 */
export async function runLimitPass(now: number): Promise<void> {
  try {
    const monthlyIncome = await getMonthlyEquivalentIncome(now);
    const alerts = await recomputeLimits({ now, monthlyIncome });
    // Guarded rather than left to `notifyLimitAlerts`'s own empty-list
    // shortcut: firing nothing is the normal outcome of most commits, and
    // reaching the notifier at all pulls in the alerts service for no reason.
    if (alerts.length > 0) await notifyLimitAlerts(alerts);
  } catch (error) {
    console.warn("limit recompute failed; the app runs without it", error);
  }
}

/**
 * Subscribes to `ledger:committed` and runs a debounced limits pass.
 * Returns the teardown, which also cancels a pass still waiting to fire.
 */
export function startLimitLedgerSubscriber(options: { debounceMs?: number } = {}): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let pending: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = onAppEvent("ledger:committed", () => {
    // Restarting the timer rather than letting the first one stand is what
    // makes this trailing-edge: a burst of fifty commits schedules one pass,
    // and that pass sees all fifty.
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      void runLimitPass(systemClock.now());
    }, debounceMs);
  });

  return () => {
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    unsubscribe();
  };
}
