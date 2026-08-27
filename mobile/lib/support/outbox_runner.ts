// lib/support/outbox_runner.ts — the loop that actually gets a queued problem
// report off the phone.
//
// THREE THINGS WAKE IT, AND THERE IS NO FOURTH. App launch
// (`lib/bootstrap.ts`), every foreground (`AppState` -> "active"), and an
// in-app timer that sleeps until the next report is due. This app has no
// background job of any kind — `bootstrap.ts`'s retention comment says so
// outright, and adding a headless task for this feature alone would mean a
// foreground service notification on Android for a queue that is usually
// empty. The consequence is worth stating plainly: a report queued on a phone
// that is never opened again is never sent. Everything below is about making
// the moments the app IS open count.
//
// THE TIMER IS WHY THE SCHEDULE IS SHORT. `retry_schedule.ts` wraps at
// thirty-two minutes instead of doubling forever, and this is where that pays
// off: a user who writes a report, gets a "no connection" and keeps using the
// app is inside the same session when the retry fires. An hours-long backoff
// would push every attempt past the session it was scheduled in, leaving the
// launch and foreground hooks as the only ones that ever fire — which is a
// queue that only drains when someone happens to reopen the app.
//
// ONE FLUSH AT A TIME, ENFORCED HERE. A foreground event landing while the
// launch flush is still uploading is not hypothetical — the launch flush can
// hold a three-minute upload timeout. Two flushes would read the same due row,
// both send it, and produce two tickets for one report (the server's
// idempotency key is the backstop for that, not the plan). The module-level
// promise below is the same run-once-at-a-time idiom `lib/db/database.ts`'s
// `dbPromise` and `lib/bootstrap.ts`'s `lastResult` already use.
//
// SEQUENTIAL, NOT PARALLEL, within a flush. Reports go out oldest-first
// (`listDueSupportReports`) and one at a time. Two screenshot uploads racing
// each other over the same congested mobile link finish later than the same
// two in sequence, and a partial parallel failure is much harder to reason
// about — with a sequence, a report either went or is still queued with its
// own attempt count intact.
//
// NOTHING HERE THROWS. Same disposition as `services/telemetry.ts` and
// `lib/bootstrap.ts`'s `runRetention`: a failed flush is the expected state on
// Philippine mobile data, not an exception. Failures are recorded on the row
// (where the user can see them) and logged at `warn`, never `error` — an app
// that logs an error every time a bus goes through a tunnel trains everyone to
// ignore its logs (`services/api.ts`'s header).
import { AppState, type AppStateStatus } from "react-native";

import { emitAppEvent } from "@/lib/events/app_events";
import { deleteSupportAttachmentFiles } from "@/lib/support/attachments";
import {
  listDueSupportReports,
  markSupportReportRejected,
  markSupportReportSent,
  nextSupportReportDueAt,
  purgeSentSupportReports,
  recordSupportReportFailure,
} from "@/lib/support/support_reports_repo";
import { sendSupportReport } from "@/services/support_reports";
import type { EpochMs } from "@/types/domain";

/** What one flush pass did. Counts only — the rows themselves carry the detail. */
export type SupportFlushResult = {
  sent: number;
  retried: number;
  rejected: number;
};

const EMPTY_RESULT: SupportFlushResult = { sent: 0, retried: 0, rejected: 0 };

/**
 * How long a delivered report and its attachments stay on the device before
 * retention drops them (30 days, matching the raw-capture TTL in
 * `lib/bootstrap.ts`'s `runRetention`).
 *
 * They are kept at all so the user can still see "Sent — ticket PP-1042" for a
 * report they filed last week, which is the only receipt this app gives them.
 * They do not stay forever because the attachments are the largest files this
 * app writes, and a ticket the developer already holds does not need a second
 * copy on the reporter's phone indefinitely.
 */
export const SENT_REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Floor on the timer, so a row whose `next_attempt_at` is already in the past
 * schedules a near-immediate wake-up rather than a zero-delay one that could
 * spin against a persistently failing send.
 */
const MIN_TIMER_MS = 1_000;

/**
 * Ceiling on the timer. The schedule's own worst case is thirty-two minutes,
 * so this only ever binds on a corrupt or hand-edited `next_attempt_at` — and
 * when it does, the app re-checks in half an hour instead of sleeping until a
 * date in the row.
 */
const MAX_TIMER_MS = 32 * 60_000;

/** The in-flight flush, or null. See "ONE FLUSH AT A TIME" above. */
let inFlight: Promise<SupportFlushResult> | null = null;

/** The pending wake-up, or null when the queue is empty. */
let timer: ReturnType<typeof setTimeout> | null = null;

/** Test-only reset, same purpose as `lib/bootstrap.ts`'s `__resetBootstrapForTests`. */
export function __resetSupportOutboxForTests(): void {
  inFlight = null;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Sends every queued report whose retry time has arrived.
 *
 * Never throws, never rejects. A concurrent caller gets the in-flight pass's
 * promise rather than starting a second one — so the result it reads describes
 * the flush that was ALREADY running, which is a subtlety worth knowing at the
 * two call sites that read the counts (tests, and nothing else today).
 *
 * `now` is a required parameter (`lib/clock.ts`'s house rule) and is used for
 * every row this pass writes, so a flush that takes two minutes still
 * schedules its retries from one consistent instant instead of drifting them
 * apart by however long each upload took.
 */
export function flushSupportOutbox(now: EpochMs): Promise<SupportFlushResult> {
  if (inFlight !== null) return inFlight;

  inFlight = runFlush(now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runFlush(now: EpochMs): Promise<SupportFlushResult> {
  let due;
  try {
    due = await listDueSupportReports(now);
  } catch (error: unknown) {
    // The database can legitimately be unavailable here: `getDatabase()`
    // throws while the app is locked (lib/db/database.ts), and a foreground
    // event fires before the unlock screen is answered. Nothing to do but
    // wait for the next wake-up.
    console.warn("[support] could not read the outbox — is the database locked?", error);
    return EMPTY_RESULT;
  }

  if (due.length === 0) return EMPTY_RESULT;

  const result: SupportFlushResult = { sent: 0, retried: 0, rejected: 0 };

  for (const report of due) {
    const outcome = await sendSupportReport(report);

    try {
      if (outcome.kind === "sent") {
        await markSupportReportSent(report.id, outcome.ticketRef, now);
        // The row survives (the user's receipt); only the bytes go. Deleting
        // the files here rather than at retention time is what keeps a phone
        // that reports a lot of bugs from carrying every screenshot it ever
        // sent.
        await deleteSupportAttachmentFiles(report.attachments.map((item) => item.fileUri));
        result.sent += 1;
      } else if (outcome.kind === "rejected") {
        await markSupportReportRejected(report.id, outcome.reason, now);
        result.rejected += 1;
      } else {
        await recordSupportReportFailure(report.id, outcome.reason, now);
        result.retried += 1;
      }
    } catch (error: unknown) {
      // A write failed AFTER the send. The dangerous case is a successful send
      // whose `markSent` did not land: the report stays queued and will be
      // sent again, which is exactly what `reportId`'s idempotency contract
      // (services/support_reports.ts) exists to absorb. Logged, and the pass
      // carries on with the next report rather than abandoning the queue.
      console.warn("[support] could not record the outcome of a send", error);
    }
  }

  if (result.sent + result.retried + result.rejected > 0) {
    await emitAppEvent("support:outbox_changed", {});
  }
  return result;
}

/**
 * Drops delivered reports older than `SENT_REPORT_RETENTION_MS` and unlinks
 * whatever attachment files survived their send.
 *
 * Swallows its own failures, for the reason `lib/bootstrap.ts`'s `runRetention`
 * gives: housekeeping is never worth failing a launch over.
 */
export async function purgeOldSupportReports(now: EpochMs): Promise<void> {
  try {
    const orphanedFiles = await purgeSentSupportReports(now - SENT_REPORT_RETENTION_MS);
    await deleteSupportAttachmentFiles(orphanedFiles);
  } catch (error: unknown) {
    console.warn("[support] outbox retention pass failed", error);
  }
}

/**
 * Fires a flush and then re-arms the timer for whatever is due next. The one
 * entry point every wake-up goes through, so "flush, then reschedule" cannot
 * be got wrong in one of three places.
 *
 * NOT AWAITED BY ITS CALLERS. `startSupportOutboxSubscriber` and the AppState
 * handler both call this and move on — a flush holds a three-minute upload
 * timeout, and neither app startup nor a foreground transition may wait on
 * that.
 */
function flushAndReschedule(now: EpochMs): void {
  flushSupportOutbox(now)
    .then(() => scheduleNextWakeUp())
    .catch((error: unknown) => {
      // `flushSupportOutbox` resolves on every failure it knows about, so a
      // rejection here means one of its own guards was bypassed. Logged at
      // error (unlike everything else in this file) precisely because it
      // should be impossible — and the timer is still re-armed, because a
      // broken pass must not stop the queue forever.
      console.error("[support] flush rejected — this should never happen", error);
      void scheduleNextWakeUp();
    });
}

/**
 * Arms one timer for the earliest due report, replacing any pending one.
 *
 * ONE TIMER FOR THE WHOLE QUEUE, not one per report: the earliest due row is
 * the only thing worth waking for, and the flush it triggers picks up every
 * other row that came due in the meantime.
 */
async function scheduleNextWakeUp(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }

  let dueAt: EpochMs | null;
  try {
    dueAt = await nextSupportReportDueAt();
  } catch {
    // Locked database, same as in `runFlush`. No timer; the next foreground
    // re-arms one.
    return;
  }
  if (dueAt === null) return;

  const delay = Math.min(Math.max(dueAt - Date.now(), MIN_TIMER_MS), MAX_TIMER_MS);
  timer = setTimeout(() => {
    timer = null;
    flushAndReschedule(Date.now());
  }, delay);
}

/**
 * Starts the outbox: flushes once, then keeps the queue moving on every
 * foreground and on its own timer. Returns the teardown, the same shape
 * `lib/bootstrap.ts`'s `startNetworkSyncSubscriber` returns and mounted
 * alongside it in `app/_layout.tsx`.
 *
 * `Date.now()` IS READ HERE, and this is a `lib/` module — the exception
 * `lib/clock.ts` allows for "the composition edges: a screen, a service entry
 * point, the scheduler". This is the scheduler. Every function it calls still
 * takes the instant as a parameter, which is what keeps the flush itself
 * testable at a fixed time.
 */
export function startSupportOutboxSubscriber(): () => void {
  flushAndReschedule(Date.now());

  const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state !== "active") return;
    // Unconditional, exactly like `startNetworkSyncSubscriber`'s foreground
    // handler: no interval logic lives here, because `next_attempt_at` on each
    // row already decides what is due. A second opinion in this file would
    // eventually disagree with the rows.
    flushAndReschedule(Date.now());
  });

  return () => {
    subscription.remove();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
