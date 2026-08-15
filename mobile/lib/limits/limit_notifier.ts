// lib/limits/limit_notifier.ts — posting the alerts a recompute produced
// (m2 Task 7/8; limits rule 22).
//
// SPLIT OUT OF limit_service.ts SO THAT READING A LIMIT DOES NOT LOAD THE
// NOTIFICATION STACK. `getLimitStatuses` is what the Plan tab calls to draw a
// progress bar; when it lived beside this function, importing it pulled in
// `alerts_service` → `expo-notifications` → the `NotificationListener` native
// module. In the app that is unnecessary work on a screen that never posts
// anything; under Jest it is fatal, because a native module cannot be required
// at all — which is how the coupling was noticed.
//
// The direction of the dependency is the point: the notifier knows about the
// engine and the alerts service, and neither of them knows about it.
import { limitAlertsCopy } from "@/lib/alerts/alert_copy";
import { postAlert } from "@/lib/alerts/alerts_service";
import { CHANNEL_LIMITS } from "@/lib/alerts/channels";
import type { LimitAlert } from "@/types/control";

import { coalesceAlerts } from "./limit_engine";

/**
 * Posts ONE notification for however many limits tripped (limits rule 22:
 * "the alerts coalesce into one notification summarizing each affected Limit,
 * ordered most-severe first").
 *
 * Coalesces again rather than trusting the caller's order. `recomputeLimits`
 * already returns sorted alerts and re-sorting a sorted list is free, but a
 * caller that assembled alerts some other way still gets severity order.
 *
 * Supplies an `AlertCopy`, never a title and a body: `postAlert` selects the
 * locked or unlocked variant at POST time (docs/12 §7a). The m2 plan's version
 * passes two strings, which predates its own encryption amendment.
 *
 * Silent on an empty list. A recompute that fired nothing is the normal case —
 * it happens on most ledger commits — and posting an empty notification would
 * be the loudest possible way to say nothing happened.
 */
export async function notifyLimitAlerts(alerts: LimitAlert[]): Promise<void> {
  if (alerts.length === 0) return;

  const ordered = coalesceAlerts(alerts);
  await postAlert({
    channel: CHANNEL_LIMITS,
    copy: limitAlertsCopy(ordered),
    data: { limitIds: ordered.map((alert) => alert.limitId) },
  });
}
