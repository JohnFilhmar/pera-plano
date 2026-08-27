// lib/support/__tests__/outbox_runner.test.ts — the sync path, which is the
// part of an offline-first feature that actually breaks in production:
// interrupted sends, a queue replayed twice, and a report that must not be
// lost or duplicated by either.
//
// THE TRANSPORT IS MOCKED, THE DATABASE IS NOT. Every assertion below is made
// against the real migrated schema through the real repository, because what
// is being tested is what the ROWS say after a failure — the attempt count,
// the next due instant, the status — and a mocked repository would only prove
// the mock agrees with itself.
//
// `expo-file-system` cannot load under Jest, so `lib/support/attachments` is
// mocked wholesale (the same reason `lib/privacy/__tests__/data_export.test.ts`
// mocks the module it wraps). The file deletions are then assertable as calls,
// which is the only thing this file cares about them for.
jest.mock("@/lib/support/attachments", () => ({
  deleteSupportAttachmentFiles: jest.fn(async () => undefined),
}));
jest.mock("@/services/support_reports", () => ({
  sendSupportReport: jest.fn(),
}));

import { closeDatabase } from "@/lib/db/database";
import { onAppEvent } from "@/lib/events/app_events";
import { deleteSupportAttachmentFiles } from "@/lib/support/attachments";
import { sendSupportReport } from "@/services/support_reports";
import { freshDb } from "@/test_support/db";
import type { NewSupportReport } from "@/types/support";

import {
  __resetSupportOutboxForTests,
  flushSupportOutbox,
  purgeOldSupportReports,
} from "../outbox_runner";
import {
  enqueueSupportReport,
  getSupportReport,
  listDueSupportReports,
} from "../support_reports_repo";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date(2026, 7, 28, 10, 0).getTime();

const send = sendSupportReport as jest.MockedFunction<typeof sendSupportReport>;
const deleteFiles = deleteSupportAttachmentFiles as jest.MockedFunction<
  typeof deleteSupportAttachmentFiles
>;

/**
 * Spins the microtask queue until `condition` holds. Used only by the
 * overlapping-flush test, which has to open its gate at a point no promise it
 * holds resolves at.
 */
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let tick = 0; tick < 100 && !condition(); tick += 1) {
    await Promise.resolve();
  }
}

function report(overrides: Partial<NewSupportReport> = {}): NewSupportReport {
  return {
    title: "Transfers show up twice",
    description: "Sent money from GCash to BPI and both legs landed as spending.",
    topic: "wrong_amount_or_wallet",
    attachments: [],
    ...overrides,
  };
}

beforeEach(async () => {
  await freshDb();
  __resetSupportOutboxForTests();
  send.mockReset();
  deleteFiles.mockClear();
});

afterEach(async () => {
  await closeDatabase();
});

test("an empty queue makes no request at all", async () => {
  await expect(flushSupportOutbox(NOW)).resolves.toEqual({ sent: 0, retried: 0, rejected: 0 });
  expect(send).not.toHaveBeenCalled();
});

test("no connection keeps the report and schedules the first retry a minute out", async () => {
  const stored = await enqueueSupportReport(report(), NOW);
  send.mockResolvedValue({ kind: "retry", reason: "No connection." });

  await expect(flushSupportOutbox(NOW)).resolves.toEqual({ sent: 0, retried: 1, rejected: 0 });

  const reread = await getSupportReport(stored.id);
  expect(reread?.status).toBe("queued");
  expect(reread?.attemptCount).toBe(1);
  expect(reread?.nextAttemptAt).toBe(NOW + 1 * MINUTE);
  expect(reread?.lastError).toBe("No connection.");
});

test("a flush before the retry is due does not touch the network again", async () => {
  await enqueueSupportReport(report(), NOW);
  send.mockResolvedValue({ kind: "retry", reason: "No connection." });
  await flushSupportOutbox(NOW);
  send.mockClear();

  await flushSupportOutbox(NOW + 30_000);

  expect(send).not.toHaveBeenCalled();
});

test("the report goes out on the first flush after signal returns, and its files are freed", async () => {
  const stored = await enqueueSupportReport(
    report({
      attachments: [
        { fileUri: "file:///docs/support_attachments/a.png", mimeType: "image/png", byteSize: 10 },
      ],
    }),
    NOW,
  );
  send.mockResolvedValueOnce({ kind: "retry", reason: "No connection." });
  await flushSupportOutbox(NOW);

  send.mockResolvedValueOnce({ kind: "sent", ticketRef: "PP-1042" });
  await expect(flushSupportOutbox(NOW + 1 * MINUTE)).resolves.toEqual({
    sent: 1,
    retried: 0,
    rejected: 0,
  });

  const reread = await getSupportReport(stored.id);
  expect(reread?.status).toBe("sent");
  expect(reread?.ticketRef).toBe("PP-1042");
  expect(deleteFiles).toHaveBeenCalledWith(["file:///docs/support_attachments/a.png"]);
});

test("a delivered report is never sent a second time, however many flushes run", async () => {
  await enqueueSupportReport(report(), NOW);
  send.mockResolvedValue({ kind: "sent", ticketRef: "PP-1" });

  await flushSupportOutbox(NOW);
  await flushSupportOutbox(NOW + 1 * MINUTE);
  await flushSupportOutbox(NOW + 1 * DAY);

  expect(send).toHaveBeenCalledTimes(1);
});

// The overlap this guards is real: a launch flush can be holding a
// three-minute upload timeout when the user backgrounds and re-foregrounds the
// app, which fires a second flush against the same due row.
test("two overlapping flushes send each report once, not twice", async () => {
  await enqueueSupportReport(report(), NOW);
  // Held in a one-element box rather than a plain `let`: TypeScript's
  // control-flow analysis cannot see that the mock's callback assigns the
  // variable, so a bare `let` narrows to `null` and the call below is a type
  // error rather than a test.
  const gate: { release: () => void } = { release: () => undefined };
  send.mockImplementation(
    () =>
      new Promise((resolve) => {
        gate.release = () => resolve({ kind: "sent", ticketRef: "PP-1" });
      }),
  );

  const first = flushSupportOutbox(NOW);
  const second = flushSupportOutbox(NOW);
  // The mock is not reached synchronously — `runFlush` awaits the due-report
  // read first — so the gate has to be opened only once the send is actually
  // in flight. Releasing before that hangs the test rather than failing it.
  await waitUntil(() => send.mock.calls.length === 1);
  gate.release();
  await Promise.all([first, second]);

  expect(send).toHaveBeenCalledTimes(1);
});

test("reports are sent oldest first", async () => {
  await enqueueSupportReport(report({ title: "First" }), NOW);
  await enqueueSupportReport(report({ title: "Second" }), NOW + 1000);
  send.mockResolvedValue({ kind: "sent", ticketRef: null });

  await flushSupportOutbox(NOW + 5000);

  expect(send.mock.calls.map(([item]) => item.title)).toEqual(["First", "Second"]);
});

// "Interrupted sync resumes, nothing is lost on a dropped connection" — the
// case where the link dies partway through a queue.
test("a failure partway through the queue does not abandon the reports behind it", async () => {
  const first = await enqueueSupportReport(report({ title: "First" }), NOW);
  const second = await enqueueSupportReport(report({ title: "Second" }), NOW + 1000);
  const third = await enqueueSupportReport(report({ title: "Third" }), NOW + 2000);
  send
    .mockResolvedValueOnce({ kind: "sent", ticketRef: "PP-1" })
    .mockResolvedValueOnce({ kind: "retry", reason: "No connection." })
    .mockResolvedValueOnce({ kind: "sent", ticketRef: "PP-3" });

  await expect(flushSupportOutbox(NOW + 5000)).resolves.toEqual({
    sent: 2,
    retried: 1,
    rejected: 0,
  });

  await expect(getSupportReport(first.id)).resolves.toMatchObject({ status: "sent" });
  await expect(getSupportReport(second.id)).resolves.toMatchObject({
    status: "queued",
    attemptCount: 1,
  });
  await expect(getSupportReport(third.id)).resolves.toMatchObject({ status: "sent" });
});

test("a refused report is parked, not retried forever", async () => {
  const stored = await enqueueSupportReport(report(), NOW);
  send.mockResolvedValue({ kind: "rejected", reason: "The server could not accept this report (400)." });

  await expect(flushSupportOutbox(NOW)).resolves.toEqual({ sent: 0, retried: 0, rejected: 1 });

  const reread = await getSupportReport(stored.id);
  expect(reread?.status).toBe("rejected");
  await expect(listDueSupportReports(NOW + 1 * DAY)).resolves.toEqual([]);
});

test("the retry schedule walks the whole cycle and wraps, over seven consecutive failures", async () => {
  const stored = await enqueueSupportReport(report(), NOW);
  send.mockResolvedValue({ kind: "retry", reason: "No connection." });

  let at = NOW;
  const scheduledWaits: number[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await flushSupportOutbox(at);
    const reread = await getSupportReport(stored.id);
    const nextAt = reread?.nextAttemptAt ?? at;
    scheduledWaits.push((nextAt - at) / MINUTE);
    at = nextAt;
  }

  // The brief's list, then back to the start rather than growing further.
  expect(scheduledWaits).toEqual([1, 2, 4, 6, 8, 16, 32, 1]);
});

test("a flush that moved something announces it, so an open screen updates itself", async () => {
  await enqueueSupportReport(report(), NOW);
  send.mockResolvedValue({ kind: "sent", ticketRef: null });
  const heard = jest.fn();
  const unsubscribe = onAppEvent("support:outbox_changed", heard);

  await flushSupportOutbox(NOW);

  expect(heard).toHaveBeenCalledTimes(1);
  unsubscribe();
});

test("a flush that moved nothing stays silent", async () => {
  const heard = jest.fn();
  const unsubscribe = onAppEvent("support:outbox_changed", heard);

  await flushSupportOutbox(NOW);

  expect(heard).not.toHaveBeenCalled();
  unsubscribe();
});

test("retention unlinks the files of the sent reports it drops", async () => {
  const stored = await enqueueSupportReport(
    report({
      attachments: [
        { fileUri: "file:///docs/support_attachments/old.png", mimeType: "image/png", byteSize: 10 },
      ],
    }),
    NOW,
  );
  send.mockResolvedValue({ kind: "sent", ticketRef: "PP-1" });
  await flushSupportOutbox(NOW);
  deleteFiles.mockClear();

  await purgeOldSupportReports(NOW + 31 * DAY);

  await expect(getSupportReport(stored.id)).resolves.toBeNull();
  expect(deleteFiles).toHaveBeenCalledWith(["file:///docs/support_attachments/old.png"]);
});
