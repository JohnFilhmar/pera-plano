// types/support.ts — camelCase mirrors of migration 015's `support_reports`
// and `support_report_attachments` tables, plus the topic vocabulary the
// report form and the developer's ticketing system share.
//
// WHY THIS IS NOT IN types/domain.ts. `domain.ts` mirrors 001_core.sql — the
// user's own money data, the thing the encrypted store exists to protect. A
// problem report is the opposite kind of record: it is written to be SENT,
// deliberately, by a user who pressed a button that says so. Keeping the two
// vocabularies apart makes that difference visible at the import line, the
// same split `types/control.ts` already makes for the control plane.

import type { EpochMs } from "./domain";

/**
 * The topic list the user picks from, and the exact strings that travel to
 * the ticketing system as the ticket's category.
 *
 * SHORT, AND GROUNDED IN THIS APP'S FAILURE MODES, not a generic
 * bug/feature/other triad. A report that says only "bug" costs a round trip
 * to triage; one that says `notifications_not_captured` already names the
 * subsystem (the listener), the docs page, and the person who owns it. The
 * three that map to a subsystem come first, because they are the ones a user
 * with a broken app is most likely reaching for.
 *
 * ADDING A TOPIC IS A TWO-END CHANGE: the server's ticket router has to know
 * the string too, or the ticket lands uncategorised. Hence the frozen tuple —
 * `SUPPORT_TOPICS` is both the type's source (`SupportTopic` is derived from
 * it, never hand-written in parallel) and the runtime list the picker renders
 * and the repository validates against.
 */
export const SUPPORT_TOPICS = [
  "notifications_not_captured",
  "wrong_amount_or_wallet",
  "app_crash_or_freeze",
  "lock_or_recovery",
  "plus_or_billing",
  "suggestion",
  "other",
] as const;

export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

/** Human labels for the picker. Kept beside the tuple so a new topic cannot ship unlabelled. */
export const SUPPORT_TOPIC_LABELS: Readonly<Record<SupportTopic, string>> = {
  notifications_not_captured: "Transactions not showing up",
  wrong_amount_or_wallet: "Something was recorded wrong",
  app_crash_or_freeze: "App crashed or froze",
  lock_or_recovery: "App lock or recovery phrase",
  plus_or_billing: "Plus or billing",
  suggestion: "Idea or suggestion",
  other: "Something else",
};

/**
 * Where a queued report is in its life.
 *
 * ONLY TWO VALUES, AND DELIBERATELY NO `sending`. A persisted in-flight state
 * is a state the app can be killed in — an OS-initiated kill mid-request
 * would leave a row stuck in `sending` forever with nothing to move it out,
 * and the recovery for that (a startup sweep that rewrites stale `sending`
 * rows back to `queued`) is more machinery than the problem deserves. The
 * in-flight set lives in memory instead (`lib/support/outbox_runner.ts`),
 * where a process death disposes of it correctly and for free.
 *
 * `rejected` IS THE ONE ESCAPE FROM THE ENDLESS RETRY CYCLE. The schedule in
 * `lib/support/retry_schedule.ts` never gives up — it wraps back to one
 * minute rather than stretching out — which is right for the failure this
 * feature exists for (no signal) and wrong for a report the server will
 * refuse identically forever (a 400 from a client bug, a payload over the
 * size limit). A definitive refusal parks the report here instead, where the
 * user can see it, retry it by hand, or throw it away, rather than having it
 * spin quietly until they uninstall.
 */
export type SupportReportStatus = "queued" | "sent" | "rejected";

/** One media file the user attached, already copied into app-private storage. */
export type SupportReportAttachment = {
  id: string;
  reportId: string;
  /** `file://` inside the app's document directory — never the picker's original URI. */
  fileUri: string;
  mimeType: string;
  byteSize: number;
  createdAt: EpochMs;
};

/** A problem report as it sits in the local outbox. */
export type SupportReport = {
  id: string;
  title: string;
  description: string;
  topic: SupportTopic;
  status: SupportReportStatus;
  /** Failed sends so far. Drives the retry schedule; never decreases. */
  attemptCount: number;
  /** Epoch ms the next send may be tried. Due when `<= now`. */
  nextAttemptAt: EpochMs;
  /**
   * Why the last attempt failed, in a handful of words fit for the user's own
   * screen ("No connection", "Server error 503"). NEVER a stack trace, a URL,
   * or a response body — this string is rendered, and a raw error can carry
   * whatever the server chose to put in it.
   */
  lastError: string | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  sentAt: EpochMs | null;
  /** The ticketing system's id once the server accepts the report. */
  ticketRef: string | null;
  attachments: SupportReportAttachment[];
};

/** What the form hands the repository. Ids, timestamps and schedule are the repository's job. */
export type NewSupportReport = {
  title: string;
  description: string;
  topic: SupportTopic;
  attachments: NewSupportReportAttachment[];
};

export type NewSupportReportAttachment = {
  fileUri: string;
  mimeType: string;
  byteSize: number;
};
