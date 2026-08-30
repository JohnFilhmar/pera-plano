// lib/income/payday_notification_subscriber.ts — the caller
// `notifyPaydaySummary` never had (docs/06-information-architecture.md §6.1's
// "Payday summary" row).
//
// The in-app half already worked: `maybeEmitPayday` fires `income:payday`, and
// `usePaydayAllocations` turns that into the sheet mounted in app/_layout.tsx.
// What was missing is the half that reaches a user whose app is closed — which
// is most users, most paydays.
//
// THE DEDUPE IS INHERITED, NOT REINVENTED. `maybeEmitPayday`
// (income_service.ts) emits `income:payday` AT MOST ONCE PER PAYDAY, keyed on
// the transaction id and persisted in `IncomeDetectionState` so it survives the
// app being killed between the credit landing and the user opening the app.
// Subscribing to that event is what makes the push obey the same invariant. A
// counter of its own here would be a second, competing source of truth that
// could disagree with the sheet about whether a payday had already been
// announced — and the failure would be a duplicate push about money.
//
// ITS OWN FILE, NOT A LINE IN income_ledger_subscriber.ts. That module is
// imported by lib/bootstrap.ts, whose test (lib/__tests__/bootstrap.test.ts)
// mocks nothing on purpose; a static import of `payday_notifier` — and so of
// `alerts_service` -> `expo-notifications` -> the NotificationListener native
// module — would break it. `payday_notifier.ts`'s own header records this as
// the reason it shipped unwired. Kept as a separate subscriber started from
// app/_layout.tsx, the file every other process-wide subscriber starts from.
import { onAppEvent } from "@/lib/events/app_events";

import { notifyPaydaySummary } from "./payday_notifier";

/**
 * Subscribes to `income:payday` and posts the summary notification for it.
 * Returns the teardown.
 *
 * The opt-in check, the copy variants and the channel are all
 * `notifyPaydaySummary`'s own: this module decides WHEN, never WHAT.
 *
 * SWALLOWS ITS OWN FAILURE rather than leaving it to `emitAppEvent`'s catch.
 * The event is emitted from inside `maybeEmitPayday`, which runs on the ledger
 * commit path — a denied notification permission must not read like a failed
 * capture, and must not depend on the bus continuing to be the thing that
 * catches it.
 */
export function startPaydayNotificationSubscriber(): () => void {
  return onAppEvent("income:payday", async (payday) => {
    try {
      await notifyPaydaySummary({ amount: payday.amount });
    } catch (error) {
      console.warn("the payday summary could not be posted", error);
    }
  });
}
