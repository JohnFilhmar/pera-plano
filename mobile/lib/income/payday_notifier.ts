// lib/income/payday_notifier.ts — the payday-summary push notification
// (m3c Task 8 audit fix; docs/06-information-architecture.md §6.1's
// "Payday summary" row).
//
// FOUND MISSING BY THE m3c TASK 8 AUDIT. `paydaySummaryAlertCopy`
// (lib/alerts/alert_copy.ts) has carried both copy variants since the
// encryption amendment, and `income_service.ts`'s `maybeEmitPayday` already
// fires the deduplicated `income:payday` bus event the in-app payday sheet
// (`components/income/payday_detected_sheet.tsx`) listens for — but nothing
// in the app ever turned that event into the system notification IA §6.1
// describes. This file is that missing half: a real, tested function that
// posts it correctly. It is NOT YET SUBSCRIBED TO `income:payday` anywhere —
// see this task's report for why (the natural subscriber lives beside
// `startIncomeLedgerSubscriber` in lib/income/income_ledger_subscriber.ts,
// which `lib/bootstrap.ts` also imports and calls un-mocked in its own test;
// adding a static import of this module — and therefore of
// `alerts_service.ts` → `expo-notifications` — to that file would break
// `lib/__tests__/bootstrap.test.ts`, which mocks nothing on purpose). Wiring
// the subscription is a one-line follow-up for whoever owns that file.
//
// OPT-IN, READ FRESH EVERY CALL. IA §6.1 marks this channel "Default,
// **opt-in**" — the one channel in the app that starts silent — so this
// function checks `payday_summary_enabled` itself rather than trusting a
// caller to have already gated it, the same way `postAlert` itself always
// re-checks OS notification permission rather than trusting a cached grant.
import { paydaySummaryAlertCopy } from "@/lib/alerts/alert_copy";
import { postAlert } from "@/lib/alerts/alerts_service";
import { CHANNEL_REMINDERS } from "@/lib/alerts/channels";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import type { Centavos } from "@/types/domain";

/**
 * Posts the payday-summary notification for one detected payday, unless the
 * user has not turned the channel on.
 *
 * CHANNEL_REMINDERS, NOT A NEW CHANNEL. Android notification channel ids are
 * permanent (see `channels.ts`'s own header) — inventing a third one for a
 * single call site this task adds is a bigger, more permanent decision than
 * an audit task should make unilaterally. IA §6.1 lists this channel's
 * importance as "Default", which is exactly what `CHANNEL_REMINDERS` already
 * carries (`alerts_service.ts`'s `ensureNotificationChannels`), so reusing it
 * costs nothing in behavior and avoids a channel the user would have to
 * discover and configure separately.
 *
 * Returns the OS notification id, `null` when the user has not opted in, and
 * `null` when notification permission is denied (`postAlert`'s own contract —
 * the payday sheet in-app is the surface that never depends on this).
 */
export async function notifyPaydaySummary(params: { amount: Centavos }): Promise<string | null> {
  const enabled = await getSetting("payday_summary_enabled");
  if (!enabled) return null;

  return postAlert({
    channel: CHANNEL_REMINDERS,
    copy: paydaySummaryAlertCopy({ amount: params.amount }),
    // `kind` is the tap-routing discriminant `lib/alerts/alert_routes.ts`
    // switches on — IA §6.1: "Payday summary → Home".
    data: { kind: "paydaySummary" },
  });
}
