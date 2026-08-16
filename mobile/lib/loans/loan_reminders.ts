// lib/loans/loan_reminders.ts — due-date reminders for loans (m2b Task 7
// rule 6; docs/04-features/06-loans.md rule 15; migration 008).
//
// SPLIT OUT OF loans_service.ts DELIBERATELY. `scheduleReminder` reaches
// `expo-notifications`, which reaches the `NotificationListener` native module
// — and a screen that only wants to draw a loan list would then be unable to
// render at all under Jest, and would load the notification stack for nothing
// on device. m2 Task 8 hit exactly this with the limits notifier; this file is
// that lesson applied before the failure.
//
// A REMINDER FOR AN ALREADY-PAID INSTALLMENT IS WORSE THAN NO REMINDER (rule
// 6). Every reschedule therefore CANCELS FIRST and re-derives from the current
// balance, rather than adding to what is already queued.
//
// PER-LOAN OFFSETS, CLOSED (owner-approved 2026-08-16). Rule 15: "Offsets are
// adjustable per loan, and reminders can be turned off entirely (many 5-6
// borrowers do not want a due-date reminder for a collector who simply shows
// up)." This used to hardcode the spec's default three for every loan — now it
// reads `status.loan.reminderOffsets` (migration 008), the same way
// `scheduleBillReminders` reads `status.bill.reminderOffsets`. An EMPTY array
// schedules nothing, which is what "turned off entirely" means for this loan;
// `createLoan`/`updateLoan` (lib/db/repos/loans_repo.ts) are what keep a loan
// that "specifies none" on the spec's default three — this file has no
// fallback of its own to apply, because by the time a Loan is read back from
// the database its offsets are already resolved one way or the other.
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { loanReminderAlertCopy } from "@/lib/alerts/alert_copy";
import { cancelScheduled, scheduleReminder } from "@/lib/alerts/alerts_service";
import { CHANNEL_REMINDERS } from "@/lib/alerts/channels";
import { atLocalTime } from "@/lib/dates";

import type { LoanStatus } from "./loans_service";

/** Reminders fire in the morning rather than at midnight. */
const REMINDER_HOUR = 9;

/**
 * Schedules every open loan's reminders and forgets the ones that no longer
 * apply. Idempotent: safe to call on every launch and after every payment.
 *
 * CANCELS BEFORE SCHEDULING. Rescheduling without cancelling would leave the
 * previous run's notifications queued, so a user who paid early would still be
 * reminded — the exact failure rule 6 calls out.
 */
export async function scheduleLoanReminders(statuses: LoanStatus[], now: number): Promise<void> {
  const existing = await getSetting("loan_reminder_ids");

  // Cancel everything first, including ids for loans that have since been
  // deleted — a stale id is a no-op for the OS, and leaving it queued is not.
  for (const ids of Object.values(existing)) {
    for (const id of ids) await cancelScheduled(id);
  }

  const scheduled: Record<string, string[]> = {};

  for (const status of statuses) {
    // Nothing to remind about: settled, no date to remind against, or the
    // loan's own reminders are off. A free-form loan with no user-set
    // `nextDueDate` is the 5-6 case rule 15 describes — "reminders only if the
    // user sets a nextDueDate" — and an empty `reminderOffsets` is the OTHER
    // half of that same rule, the collector who just shows up.
    if (
      status.outstanding <= 0 ||
      status.nextDue === null ||
      status.loan.reminderOffsets.length === 0
    )
      continue;

    const ids: string[] = [];
    for (const offset of status.loan.reminderOffsets) {
      const fireAt = atLocalTime(status.nextDue.dueDate, REMINDER_HOUR, 0) + offset * 86_400_000;
      // A reminder in the past would fire immediately on some Android builds
      // and never on others; either way it is not a reminder.
      if (fireAt <= now) continue;

      const id = await scheduleReminder({
        channel: CHANNEL_REMINDERS,
        // Both copy variants, selected at post time — and note the LOCKED one
        // withholds the counterparty, because a person's name is not a name the
        // user chose the way a bill's is (docs/12 §7a).
        copy: loanReminderAlertCopy({
          direction: status.loan.direction,
          counterparty: status.loan.counterparty,
          daysUntilDue: Math.abs(offset),
          amount: status.nextDue.amount,
        }),
        fireAt,
        data: { loanId: status.loan.id },
      });

      // `null` means notification permission is denied — loans rule 15: "if it
      // is denied, due states still appear in-app". Nothing to cancel later.
      if (id !== null) ids.push(id);
    }

    if (ids.length > 0) scheduled[status.loan.id] = ids;
  }

  await setSetting("loan_reminder_ids", scheduled);
}

/**
 * Drops one loan's queued reminders — for a loan being deleted, where a
 * reschedule would have nothing to re-derive from.
 */
export async function cancelLoanReminders(loanId: string): Promise<void> {
  const existing = await getSetting("loan_reminder_ids");
  for (const id of existing[loanId] ?? []) await cancelScheduled(id);

  const { [loanId]: _removed, ...rest } = existing;
  await setSetting("loan_reminder_ids", rest);
}
