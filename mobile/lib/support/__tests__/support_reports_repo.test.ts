// lib/support/__tests__/support_reports_repo.test.ts — the outbox's storage
// rules, against a real (in-memory) SQLite with the full migrated schema.
//
// WHAT THESE COVER, in the testing-stance sense of "what breaks in
// production": a report losing its attachments, a report becoming due too
// early or too late, a purge taking something that was never sent, and a
// discard leaving files nothing points at.
import { closeDatabase } from "@/lib/db/database";
import type { SQLiteDatabase } from "@/lib/db/database";
import { freshDb } from "@/test_support/db";
import type { NewSupportReport } from "@/types/support";

import {
  deleteSupportReport,
  enqueueSupportReport,
  getSupportReport,
  listDueSupportReports,
  listUnsentSupportReports,
  markSupportReportRejected,
  markSupportReportSent,
  nextSupportReportDueAt,
  purgeSentSupportReports,
  recordSupportReportFailure,
  requeueSupportReport,
} from "../support_reports_repo";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date(2026, 7, 28, 10, 0).getTime();

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

function report(overrides: Partial<NewSupportReport> = {}): NewSupportReport {
  return {
    title: "Transfers show up twice",
    description: "Sent money from GCash to BPI and both legs landed as spending.",
    topic: "wrong_amount_or_wallet",
    attachments: [],
    ...overrides,
  };
}

test("a queued report is due immediately — the first send does not wait out a backoff", async () => {
  const stored = await enqueueSupportReport(report(), NOW);

  expect(stored.status).toBe("queued");
  expect(stored.attemptCount).toBe(0);
  expect(stored.nextAttemptAt).toBe(NOW);
  await expect(listDueSupportReports(NOW)).resolves.toHaveLength(1);
});

test("attachments are stored with the report and come back with it", async () => {
  const stored = await enqueueSupportReport(
    report({
      attachments: [
        { fileUri: "file:///docs/support_attachments/a.png", mimeType: "image/png", byteSize: 1024 },
        { fileUri: "file:///docs/support_attachments/b.jpg", mimeType: "image/jpeg", byteSize: 2048 },
      ],
    }),
    NOW,
  );

  const reread = await getSupportReport(stored.id);

  expect(reread?.attachments.map((item) => item.fileUri)).toEqual([
    "file:///docs/support_attachments/a.png",
    "file:///docs/support_attachments/b.jpg",
  ]);
  expect(reread?.attachments[0].byteSize).toBe(1024);
});

test("a failure advances the attempt count and pushes the next try out by the scheduled wait", async () => {
  const stored = await enqueueSupportReport(report(), NOW);

  await recordSupportReportFailure(stored.id, "No connection.", NOW);
  const afterFirst = await getSupportReport(stored.id);
  expect(afterFirst?.attemptCount).toBe(1);
  expect(afterFirst?.nextAttemptAt).toBe(NOW + 1 * MINUTE);
  expect(afterFirst?.lastError).toBe("No connection.");

  await recordSupportReportFailure(stored.id, "No connection.", NOW + 1 * MINUTE);
  const afterSecond = await getSupportReport(stored.id);
  expect(afterSecond?.attemptCount).toBe(2);
  expect(afterSecond?.nextAttemptAt).toBe(NOW + 1 * MINUTE + 2 * MINUTE);
});

test("a report that failed is not due again until its wait has actually elapsed", async () => {
  const stored = await enqueueSupportReport(report(), NOW);
  await recordSupportReportFailure(stored.id, "No connection.", NOW);

  await expect(listDueSupportReports(NOW + 30_000)).resolves.toEqual([]);
  await expect(listDueSupportReports(NOW + 1 * MINUTE)).resolves.toHaveLength(1);
});

test("due reports come back oldest first, so a sequence of events reaches the ticket in order", async () => {
  const first = await enqueueSupportReport(report({ title: "First" }), NOW);
  const second = await enqueueSupportReport(report({ title: "Second" }), NOW + 1000);

  const due = await listDueSupportReports(NOW + 5000);

  expect(due.map((item) => item.id)).toEqual([first.id, second.id]);
});

test("a sent report leaves the queue, keeps its ticket, and drops its last error", async () => {
  const stored = await enqueueSupportReport(report(), NOW);
  await recordSupportReportFailure(stored.id, "No connection.", NOW);

  await markSupportReportSent(stored.id, "PP-1042", NOW + 1 * MINUTE);

  const reread = await getSupportReport(stored.id);
  expect(reread?.status).toBe("sent");
  expect(reread?.ticketRef).toBe("PP-1042");
  expect(reread?.lastError).toBeNull();
  await expect(listDueSupportReports(NOW + DAY)).resolves.toEqual([]);
});

test("a rejected report stops retrying but stays visible to the user", async () => {
  const stored = await enqueueSupportReport(report(), NOW);

  await markSupportReportRejected(stored.id, "The server could not accept this report (400).", NOW);

  await expect(listDueSupportReports(NOW + DAY)).resolves.toEqual([]);
  const unsent = await listUnsentSupportReports();
  expect(unsent.map((item) => item.id)).toEqual([stored.id]);
  expect(unsent[0].status).toBe("rejected");
});

test("retrying a rejected report restarts the schedule at one minute, not mid-cycle", async () => {
  const stored = await enqueueSupportReport(report(), NOW);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await recordSupportReportFailure(stored.id, "No connection.", NOW);
  }
  await markSupportReportRejected(stored.id, "Refused.", NOW);

  await requeueSupportReport(stored.id, NOW + DAY);

  const reread = await getSupportReport(stored.id);
  expect(reread?.status).toBe("queued");
  expect(reread?.attemptCount).toBe(0);
  expect(reread?.nextAttemptAt).toBe(NOW + DAY);
  expect(reread?.lastError).toBeNull();
});

test("the next due instant is the earliest queued one, and null once nothing is queued", async () => {
  const first = await enqueueSupportReport(report({ title: "First" }), NOW);
  const second = await enqueueSupportReport(report({ title: "Second" }), NOW);
  await recordSupportReportFailure(first.id, "No connection.", NOW); // due NOW + 1m
  await recordSupportReportFailure(second.id, "No connection.", NOW);
  await recordSupportReportFailure(second.id, "No connection.", NOW); // due NOW + 2m

  await expect(nextSupportReportDueAt()).resolves.toBe(NOW + 1 * MINUTE);

  await markSupportReportSent(first.id, null, NOW);
  await markSupportReportSent(second.id, null, NOW);
  await expect(nextSupportReportDueAt()).resolves.toBeNull();
});

test("discarding a report returns its files and removes both halves", async () => {
  const stored = await enqueueSupportReport(
    report({
      attachments: [
        { fileUri: "file:///docs/support_attachments/a.png", mimeType: "image/png", byteSize: 10 },
      ],
    }),
    NOW,
  );

  const orphaned = await deleteSupportReport(stored.id);

  expect(orphaned).toEqual(["file:///docs/support_attachments/a.png"]);
  await expect(getSupportReport(stored.id)).resolves.toBeNull();
  const leftoverAttachments = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM support_report_attachments",
  );
  expect(leftoverAttachments).toEqual([]);
});

test("discarding a report that is already gone is a no-op, not a throw", async () => {
  await expect(deleteSupportReport("not-a-real-id")).resolves.toEqual([]);
});

test("retention drops old SENT reports and never touches a queued one, however old", async () => {
  const oldSent = await enqueueSupportReport(report({ title: "Old and sent" }), NOW);
  await markSupportReportSent(oldSent.id, "PP-1", NOW);
  const recentSent = await enqueueSupportReport(report({ title: "Recently sent" }), NOW);
  await markSupportReportSent(recentSent.id, "PP-2", NOW + 29 * DAY);
  const ancientQueued = await enqueueSupportReport(report({ title: "Never got signal" }), NOW);

  await purgeSentSupportReports(NOW + 30 * DAY - 1 * DAY);

  await expect(getSupportReport(oldSent.id)).resolves.toBeNull();
  await expect(getSupportReport(recentSent.id)).resolves.not.toBeNull();
  // The whole promise of the feature: a report written on a phone that spent a
  // month offline is still there.
  await expect(getSupportReport(ancientQueued.id)).resolves.not.toBeNull();
});

test("retention hands back the attachment files of everything it dropped", async () => {
  const stored = await enqueueSupportReport(
    report({
      attachments: [
        { fileUri: "file:///docs/support_attachments/x.png", mimeType: "image/png", byteSize: 10 },
      ],
    }),
    NOW,
  );
  await markSupportReportSent(stored.id, "PP-3", NOW);

  await expect(purgeSentSupportReports(NOW + 1)).resolves.toEqual([
    "file:///docs/support_attachments/x.png",
  ]);
});
