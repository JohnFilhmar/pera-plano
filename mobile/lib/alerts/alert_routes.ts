// lib/alerts/alert_routes.ts — where a tap on each app-generated
// notification should take the user (m3c Task 8 audit; docs/06 §6.1's
// "Deep links" table).
//
// WRITTEN BECAUSE NOTHING ELSE IN THE APP DOES THIS YET. The audit for m3c
// Task 8 found that every alert-posting call site already attaches routing
// `data` (limit ids, a bill's `billId`+`dueDate`, a loan id) — the payload
// contract §6.1 asks for is correct and ready — but no `Notifications.
// addNotificationResponseReceivedListener` anywhere reads it and navigates.
// That listener belongs in `app/_layout.tsx` (the one place every other
// process-wide subscriber in this app is registered — see its loan/bill
// reminder scheduling effects), which is out of this task's lane. This file
// is the pure, testable half of that missing wiring: given the exact `data`
// object a posted notification carries, decide the route. Whoever wires the
// listener has one call to make: `router.push(resolveAlertRoute(response.
// notification.request.content.data))`.
//
// `kind` IS AN EXPLICIT KEY, NOT INFERRED FROM SHAPE. Every notifier below
// already writes a `kind` field into its `data` (limit_notifier.ts,
// bill_reminders.ts, loan_reminders.ts, and the two notifiers this file's
// sibling modules add) precisely so this resolver never has to guess "a
// payload with `billId` and no `loanId` must be a bill" — a future alert kind
// that happens to reuse a field name would silently misroute under a
// shape-sniffing resolver, and would not compile against this one, because
// `AlertRouteData["kind"]` is a closed union.
import type { Href } from "expo-router";

/** The exact shape each notifier's `postAlert`/`scheduleReminder` call attaches as `data`. */
export type AlertRouteData =
  | { kind: "limitAlerts"; limitIds: string[] }
  | { kind: "billReminder"; billId: string; dueDate: string }
  | { kind: "loanReminder"; loanId: string }
  | { kind: "paydaySummary" }
  | { kind: "trackingInterrupted" };

/**
 * Home — the fallback for a payload this build does not recognise (an older
 * notification still sitting in the shade after an app downgrade, or a
 * malformed payload) AND `paydaySummary`'s own documented destination (IA
 * §6.1: "Payday summary → Home"). Never a crash, never a blank screen: a tap
 * that cannot be routed precisely still opens the app to the one screen that
 * always makes sense.
 */
const HOME_ROUTE: Href = "/";

/**
 * Resolves a tapped notification's `data` to the screen it should open,
 * per IA §6.1's deep-link table:
 * "Limit alerts → Limit breach view; Bill reminders → Bill detail; Loan
 * reminders → Loan detail; Listener health → recovery screen; Payday summary
 * → Home."
 *
 * A COALESCED LIMIT ALERT WITH MORE THAN ONE LIMIT HAS NO SINGLE "breach
 * view" TO OPEN. `limitAlertsCopy` (alert_copy.ts) already draws this same
 * line — one limit gets its own canonical copy, several get a summary — so
 * routing follows the same split: one id opens that Limit's detail, several
 * open the Limits list, which is the closest screen that actually shows all
 * of them.
 *
 * `data` is `unknown` at the boundary (it round-trips through
 * `expo-notifications`, which types it as `Record<string, unknown> |
 * undefined`) — narrowed here with runtime checks rather than a cast, so a
 * malformed or foreign payload falls through to `HOME_ROUTE` instead of
 * routing on garbage.
 */
export function resolveAlertRoute(data: unknown): Href {
  if (typeof data !== "object" || data === null || !("kind" in data)) return HOME_ROUTE;
  const kind = (data as { kind: unknown }).kind;

  switch (kind) {
    case "limitAlerts": {
      const limitIds = (data as { limitIds?: unknown }).limitIds;
      if (Array.isArray(limitIds) && limitIds.length === 1 && typeof limitIds[0] === "string") {
        return { pathname: "/plan/limits/[id]", params: { id: limitIds[0] } };
      }
      return "/plan/limits";
    }
    case "billReminder": {
      const { billId, dueDate } = data as { billId?: unknown; dueDate?: unknown };
      if (typeof billId !== "string" || typeof dueDate !== "string") return HOME_ROUTE;
      return { pathname: "/plan/bills/[id]", params: { id: billId, dueDate } };
    }
    case "loanReminder": {
      const { loanId } = data as { loanId?: unknown };
      if (typeof loanId !== "string") return HOME_ROUTE;
      return { pathname: "/plan/loans/[id]", params: { id: loanId } };
    }
    case "paydaySummary":
      return HOME_ROUTE;
    case "trackingInterrupted":
      // IA §6.1: "Listener health → recovery screen (4.8)" — the same
      // destination the Home tracking banner's own "Fix tracking" action
      // already opens (app/(tabs)/index.tsx).
      return "/more/listener_health";
    default:
      return HOME_ROUTE;
  }
}
