// lib/bills/bill_reminders.ts — bill reminders and overdue escalation
// (m2c Task 4 rule 3; docs/04-features/07-bills.md rules 10-12 and 21-23).
//
// SPLIT OUT OF bills_service.ts DELIBERATELY, though the m2c plan puts
// `scheduleBillReminders` there. `scheduleReminder` reaches `expo-notifications`
// and the `NotificationListener` native module, which cannot be required under
// Jest at all — a screen that only wants to draw a bill list would then be
// unable to render. m2 Task 8 hit exactly that with the limits notifier; m2b
// Task 7 split loans before the failure, and this is the same call.
//
// REMINDER IDS ARE KEYED PER CYCLE, not per bill. Rule 11 cancels "that cycle's
// remaining reminders" the moment it is paid, and rule 25 has two cycles of one
// bill open at once — a per-bill key could not cancel one without silencing the
// other.
import { billDueAlertCopy, billOverdueAlertCopy } from "@/lib/alerts/alert_copy";
import { cancelScheduled, postAlert, scheduleReminder } from "@/lib/alerts/alerts_service";
import { CHANNEL_REMINDERS } from "@/lib/alerts/channels";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { recordOverdueNotice } from "@/lib/db/repos/bills_repo";
import { addDaysIso, atLocalTime } from "@/lib/dates";
import type { IsoDate } from "@/types/domain";

import type { BillStatus } from "./bills_service";

/** Spec's reminder delivery: "Default delivery time 9:00 AM local." */
const REMINDER_HOUR = 9;

/** Rule 22: at most three overdue notifications per cycle. */
export const MAX_OVERDUE_NOTICES = 3;

/** Rule 22's cadence: one on day +1, then one every 3 days. */
const OVERDUE_FIRST_DAY = 1;
const OVERDUE_INTERVAL_DAYS = 3;

/** `billId|dueDate` — see the header on why this is per cycle. */
function cycleKey(billId: string, dueDate: IsoDate): string {
  return `${billId}|${dueDate}`;
}

/**
 * Queues every unresolved cycle's reminders and forgets the ones that no longer
 * apply. Idempotent — safe on every launch and after every payment.
 *
 * CANCELS BEFORE SCHEDULING. Rescheduling without cancelling leaves the
 * previous run queued, so a user who already paid is reminded anyway — which
 * rule 11 exists to prevent, and which is worse than no reminder at all.
 *
 * A RESOLVED CYCLE GETS NOTHING. Paid, skipped and paid-outside-my-wallets all
 * mean the same thing to a reminder: there is nothing left to do.
 */
export async function scheduleBillReminders(statuses: BillStatus[], now: number): Promise<void> {
  const existing = await getSetting("bill_reminder_ids");

  // Everything first, including cycles that have since been resolved or bills
  // that were archived — a stale id is a no-op for the OS, and leaving it
  // queued is not.
  for (const ids of Object.values(existing)) {
    for (const id of ids) await cancelScheduled(id);
  }

  const scheduled: Record<string, string[]> = {};

  for (const status of statuses) {
    if (status.state !== "upcoming" && status.state !== "due_today") continue;

    const ids: string[] = [];
    for (const offset of status.bill.reminderOffsets) {
      // Offsets are negative-is-before (types/domain.ts), so the fire date is
      // the due date PLUS the offset.
      const fireAt = atLocalTime(addDaysIso(status.dueDate, offset), REMINDER_HOUR, 0);

      // A reminder in the past fires immediately on some Android builds and
      // never on others; either way it is not a reminder.
      if (fireAt <= now) continue;

      const id = await scheduleReminder({
        channel: CHANNEL_REMINDERS,
        copy: billDueAlertCopy({
          billName: status.bill.name,
          daysUntilDue: Math.abs(offset),
          // The CURRENT estimate, not the seed — rule 9, and the reminder is
          // the moment the figure matters most.
          amount: status.estimate.amount,
        }),
        fireAt,
        data: { billId: status.bill.id, dueDate: status.dueDate },
      });

      // `null` means notification permission is denied. Rule 12: nothing is
      // lost silently — the in-app card still renders — and there is no id to
      // cancel later.
      if (id !== null) ids.push(id);
    }

    if (ids.length > 0) scheduled[cycleKey(status.bill.id, status.dueDate)] = ids;
  }

  await setSetting("bill_reminder_ids", scheduled);
}

/**
 * Drops one cycle's queued reminders. Rule 11: "a cycle that is marked paid
 * (matched or manual) cancels that cycle's remaining reminders IMMEDIATELY" —
 * immediately, rather than at the next reschedule, because the next reschedule
 * might be tomorrow and the reminder might be tonight.
 */
export async function cancelCycleReminders(billId: string, dueDate: IsoDate): Promise<void> {
  const existing = await getSetting("bill_reminder_ids");
  const key = cycleKey(billId, dueDate);
  for (const id of existing[key] ?? []) await cancelScheduled(id);

  const { [key]: _removed, ...rest } = existing;
  await setSetting("bill_reminder_ids", rest);
}

/**
 * Posts the overdue escalation due today, if any, and returns the cycles
 * notified.
 *
 * Rule 22: "one notification on day +1, then one every 3 days, maximum THREE
 * overdue notifications per cycle; after that, in-app surfaces only. Nagging
 * forever erodes trust." The count lives in `bill_cycles.overdue_notices_sent`
 * (migration 006) rather than being derived from queued notification ids,
 * because the OS forgets those across a reinstall and the user must not collect
 * three fresh naggings every time they reinstall.
 *
 * POSTS RATHER THAN SCHEDULES. An overdue notice is about a state that is true
 * NOW; scheduling one for the future would announce a debt that may since have
 * been paid.
 *
 * Takes no `now`: each status already carries the `daysUntil` computed from the
 * clock its list was built with, and reading the clock a second time here could
 * disagree with it across midnight.
 */
export async function postOverdueNotices(statuses: BillStatus[]): Promise<string[]> {
  const notified: string[] = [];

  for (const status of statuses) {
    if (status.state !== "overdue") continue;

    const daysOverdue = -status.daysUntil;
    if (daysOverdue < OVERDUE_FIRST_DAY) continue;
    // Day 1, 4, 7 — the "+1 then every 3 days" cadence.
    if ((daysOverdue - OVERDUE_FIRST_DAY) % OVERDUE_INTERVAL_DAYS !== 0) continue;

    const alreadySent = status.cycle?.overdueNoticesSent ?? 0;
    if (alreadySent >= MAX_OVERDUE_NOTICES) continue;
    // The count is what the cadence has already produced: a device that was off
    // for a week must not fire the backlog all at once.
    if (alreadySent >= (daysOverdue - OVERDUE_FIRST_DAY) / OVERDUE_INTERVAL_DAYS + 1) continue;

    await postAlert({
      channel: CHANNEL_REMINDERS,
      copy: billOverdueAlertCopy({
        billName: status.bill.name,
        daysOverdue,
        amount: status.estimate.amount,
      }),
      data: { billId: status.bill.id, dueDate: status.dueDate },
    });
    await recordOverdueNotice(status.bill.id, status.dueDate);
    notified.push(cycleKey(status.bill.id, status.dueDate));
  }

  return notified;
}
