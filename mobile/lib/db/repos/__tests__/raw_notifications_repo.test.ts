// lib/db/repos/__tests__/raw_notifications_repo.test.ts — plan Task 10 Step 1.
//
// The three named tests (round-trip, the 30-day expiry, the purge count) plus
// the four the pipeline actually leans on: the unknown-id read, the replay-safe
// re-store rule 11 needs, the `hasRawCapture` probe it asks with, and the
// foreign-key case a purge hits the moment a committed Transaction points at
// the row being deleted.
import { closeDatabase } from "@/lib/db/database";
import { createWallet } from "../wallets_repo";
import { enqueue } from "../review_queue_repo";
import {
  discardRawCaptureBody,
  findReplayCapture,
  getRawCapture,
  getRawCaptureExpiry,
  hasRawCapture,
  isRawCaptureUnreferenced,
  listRawCaptures,
  listUnprocessedRawCaptures,
  purgeExpiredRawCaptures,
  RAW_CAPTURE_TTL_MS,
  storeDiscardedCapture,
  storeRawCapture,
} from "../raw_notifications_repo";
import { freshDb } from "@/test_support/db";
import { insertTransaction } from "../transactions_repo";
import type { RawCapture } from "@/types/domain";
import type { SQLiteDatabase } from "@/lib/db/database";

const NOW = 1_786_000_000_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const CATEGORY_ID = "cat_food";

let db: SQLiteDatabase;

function capture(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    id: "cap-1",
    packageName: "com.globe.gcash.android",
    title: "GCash",
    text: "You sent ₱500.00 to Juan Dela Cruz.",
    subText: "Main wallet",
    bigText: "You sent ₱500.00 to Juan Dela Cruz. Ref No. ABC123456.",
    postedAt: NOW - 1_000,
    capturedAt: NOW,
    // Present-and-null by default, for the same reason `title` is: a capture
    // read back out of the database always carries the field (migration 018),
    // so a fixture that omitted it would never compare equal to its round trip.
    notificationKey: null,
    ...overrides,
  };
}

beforeEach(async () => {
  db = await freshDb();
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, 'Food & Dining', NULL, 'circle-help', 1, 0, 0, 0)`,
    [CATEGORY_ID],
  );
});

afterEach(async () => {
  await closeDatabase();
});

test("storeRawCapture round-trips every field through getRawCapture", async () => {
  const original = capture();

  const id = await storeRawCapture(original, NOW);

  // The row id IS the capture id, and nothing else would do: pipeline rule 11
  // asks "have I seen this capture before?" by looking this id up.
  expect(id).toBe(original.id);
  expect(await getRawCapture(id)).toEqual(original);
});

test("an absent text field round-trips as null, never undefined or empty", async () => {
  const sparse = capture({ id: "cap-sparse", title: null, subText: null, bigText: null });

  await storeRawCapture(sparse, NOW);

  const read = await getRawCapture("cap-sparse");
  expect(read).toEqual(sparse);
  // Explicitly present-and-null: `routeCapture` and `parseCapture` both branch
  // on `field !== null`, and an undefined key would read as a missing property.
  expect(read).toHaveProperty("title", null);
  expect(read).toHaveProperty("bigText", null);
});

test("expires_at is exactly now + 30 days", async () => {
  await storeRawCapture(capture(), NOW);

  const row = await db.getFirstAsync<{ expires_at: number }>(
    "SELECT expires_at FROM raw_notifications WHERE id = 'cap-1'",
  );
  expect(row?.expires_at).toBe(NOW + THIRTY_DAYS_MS);
  expect(RAW_CAPTURE_TTL_MS).toBe(THIRTY_DAYS_MS);
});

test("getRawCapture returns null for an id that was never stored", async () => {
  expect(await getRawCapture("never-seen")).toBeNull();
});

// ---------------------------------------------------------------------------
// getRawCaptureExpiry — the number the "Why was this recorded?" countdown reads
// (m1c Task 7 rule 2).
//
// A SEPARATE ACCESSOR, DELIBERATELY. `RawCapture` is interface-contract §4 —
// the shape the Kotlin listener hands across the native bridge — and it carries
// no `expires_at`. Widening it to carry one would change the native contract for
// the benefit of one screen. The column exists on the ROW, so the row is where
// the screen reads it from.
// ---------------------------------------------------------------------------

test("getRawCaptureExpiry reads the STORED expiry, not capturedAt + the TTL", async () => {
  // A capture taken five days before it was stored: a replayed batch, or a
  // drain that only ran when the user next unlocked the app. The two candidate
  // answers are five days apart, and only one of them is when the row will
  // actually be deleted.
  const capturedAt = NOW - 5 * 24 * 60 * 60 * 1000;
  await storeRawCapture(capture({ id: "cap-late", capturedAt }), NOW);

  expect(await getRawCaptureExpiry("cap-late")).toBe(NOW + RAW_CAPTURE_TTL_MS);
  // The derivation the panel must never use. `purgeExpiredRawCaptures` deletes
  // on `expires_at`, so a countdown computed from `capturedAt` would promise a
  // deletion five days before it happens — the panel's one job, done wrong.
  expect(await getRawCaptureExpiry("cap-late")).not.toBe(capturedAt + RAW_CAPTURE_TTL_MS);
});

test("getRawCaptureExpiry is null for an id that was never stored or has been purged", async () => {
  // Not a throw: a Transaction older than 30 days reaches the panel exactly
  // this way, and "already deleted" is a normal answer there.
  expect(await getRawCaptureExpiry("never-seen")).toBeNull();

  await storeRawCapture(capture({ id: "cap-old" }), NOW - THIRTY_DAYS_MS - 1);
  expect(await purgeExpiredRawCaptures(NOW)).toBe(1);
  expect(await getRawCaptureExpiry("cap-old")).toBeNull();
});

test("a replayed store does not push the expiry the panel is showing", async () => {
  await storeRawCapture(capture(), NOW);
  await storeRawCapture(capture(), NOW + 60_000);

  // `INSERT OR IGNORE` keeps the first row, so the countdown the user was shown
  // yesterday still names the same instant today. An upsert here would extend
  // retention past the 30 days they were promised, silently.
  expect(await getRawCaptureExpiry("cap-1")).toBe(NOW + THIRTY_DAYS_MS);
});

test("hasRawCapture distinguishes a stored capture from an unseen one", async () => {
  await storeRawCapture(capture({ id: "cap-seen" }), NOW);

  expect(await hasRawCapture("cap-seen")).toBe(true);
  expect(await hasRawCapture("cap-unseen")).toBe(false);
});

test("re-storing a replayed capture keeps the original row and never throws", async () => {
  await storeRawCapture(capture(), NOW);

  // The native drain is at-least-once (pipeline rule 11): the identical batch
  // can come back after a crash, and a bare INSERT would die on the primary key
  // mid-batch — taking every capture behind it down with it.
  await expect(storeRawCapture(capture({ text: "tampered" }), NOW + 60_000)).resolves.toBe("cap-1");

  const rows = await db.getAllAsync<{ text: string; expires_at: number }>(
    "SELECT text, expires_at FROM raw_notifications WHERE id = 'cap-1'",
  );
  expect(rows).toHaveLength(1);
  // First write wins: the retention clock runs from the first sighting, and the
  // stored text is the one the ledger row was actually derived from.
  expect(rows[0].text).toBe("You sent ₱500.00 to Juan Dela Cruz.");
  expect(rows[0].expires_at).toBe(NOW + THIRTY_DAYS_MS);
});

test("purgeExpiredRawCaptures removes only rows at or past expiry and returns the count", async () => {
  await storeRawCapture(capture({ id: "expired" }), NOW - THIRTY_DAYS_MS - 1);
  await storeRawCapture(capture({ id: "exactly-due" }), NOW - THIRTY_DAYS_MS);
  await storeRawCapture(capture({ id: "fresh" }), NOW);

  expect(await purgeExpiredRawCaptures(NOW)).toBe(2);

  expect(await getRawCapture("expired")).toBeNull();
  expect(await getRawCapture("exactly-due")).toBeNull();
  expect(await getRawCapture("fresh")).not.toBeNull();

  // Nothing left to remove — the count is 0, not a repeat of the first answer.
  expect(await purgeExpiredRawCaptures(NOW)).toBe(0);
});

test("purging a capture a committed transaction points at clears the ref instead of failing", async () => {
  const wallet = await createWallet({ name: "GCash" });
  await storeRawCapture(capture({ id: "cap-old" }), NOW - THIRTY_DAYS_MS - 1);
  const tx = await insertTransaction({
    walletId: wallet.id,
    categoryId: CATEGORY_ID,
    amount: 50000,
    direction: "out",
    occurredAt: NOW - THIRTY_DAYS_MS,
    source: "notification",
    confidence: 0.95,
    rawNotificationId: "cap-old",
  });
  const item = await enqueue({
    kind: "low-confidence",
    payload: {},
    rawNotificationId: "cap-old",
  });

  // `transactions.raw_notification_id REFERENCES raw_notifications(id)` with
  // `PRAGMA foreign_keys = ON`, and no ON DELETE clause — a naive DELETE throws
  // here, which would strand every device 30 days after its first capture.
  expect(await purgeExpiredRawCaptures(NOW)).toBe(1);

  const after = await db.getFirstAsync<{ raw_notification_id: string | null; updated_at: number }>(
    "SELECT raw_notification_id, updated_at FROM transactions WHERE id = ?",
    [tx.id],
  );
  // Spec §9.3 rule 1: the Transaction survives the purge with every parsed
  // field intact and only loses the pointer to the expired text.
  expect(after?.raw_notification_id).toBeNull();
  expect(after?.updated_at).toBe(tx.updatedAt);

  const queued = await db.getFirstAsync<{ raw_notification_id: string | null }>(
    "SELECT raw_notification_id FROM review_queue_items WHERE id = ?",
    [item.id],
  );
  expect(queued?.raw_notification_id).toBeNull();
});

// ---------------------------------------------------------------------------
// listRawCaptures — the Privacy centre's "What PeraPlano captured" list
// (m3b Task 6 rule 3).
// ---------------------------------------------------------------------------

test("listRawCaptures returns unexpired rows newest-captured first", async () => {
  await storeRawCapture(capture({ id: "older", capturedAt: NOW - 1_000 }), NOW - 1_000);
  await storeRawCapture(capture({ id: "newer", capturedAt: NOW }), NOW);

  const rows = await listRawCaptures(NOW);

  expect(rows.map((row) => row.id)).toEqual(["newer", "older"]);
});

test("listRawCaptures excludes a capture at or past its expiry", async () => {
  await storeRawCapture(capture({ id: "expired" }), NOW - THIRTY_DAYS_MS);
  await storeRawCapture(capture({ id: "fresh" }), NOW);

  const rows = await listRawCaptures(NOW);

  // This is the proof behind the 30-day promise — a row the promise says is
  // already gone must never appear here, whether or not the bootstrap purge
  // has swept it yet.
  expect(rows.map((row) => row.id)).toEqual(["fresh"]);
});

test("listRawCaptures carries the STORED expiry, not a derived one", async () => {
  await storeRawCapture(capture({ id: "cap-1" }), NOW);

  const [row] = await listRawCaptures(NOW);

  expect(row.expiresAt).toBe(NOW + RAW_CAPTURE_TTL_MS);
});

test("listRawCaptures is empty when nothing has been captured", async () => {
  expect(await listRawCaptures(NOW)).toEqual([]);
});

// ---------------------------------------------------------------------------
// listUnprocessedRawCaptures — the pipeline's recovery sweep. A capture is
// stored BEFORE the stages run, so a stage that throws leaves a durable row
// that produced nothing and that `hasRawCapture` then treats as already seen
// forever. This query is how those rows are found again.
// ---------------------------------------------------------------------------

test("listUnprocessedRawCaptures returns a stored capture nothing points at", async () => {
  const stranded = capture({ id: "cap-stranded" });
  await storeRawCapture(stranded, NOW);

  // The whole capture, not just its id: the pipeline re-runs the stages over
  // it, and the stages read every text field.
  expect(await listUnprocessedRawCaptures(NOW, 10)).toEqual([stranded]);
});

test("listUnprocessedRawCaptures skips a capture a committed transaction points at", async () => {
  const wallet = await createWallet({ name: "GCash" });
  await storeRawCapture(capture({ id: "cap-committed" }), NOW);
  await insertTransaction({
    walletId: wallet.id,
    categoryId: CATEGORY_ID,
    amount: 50000,
    direction: "out",
    occurredAt: NOW,
    source: "notification",
    confidence: 0.95,
    rawNotificationId: "cap-committed",
  });

  expect(await listUnprocessedRawCaptures(NOW, 10)).toEqual([]);
});

test("listUnprocessedRawCaptures skips a queued capture, resolved card or not", async () => {
  await storeRawCapture(capture({ id: "cap-queued" }), NOW);
  const item = await enqueue({ kind: "low-confidence", payload: {}, rawNotificationId: "cap-queued" });

  expect(await listUnprocessedRawCaptures(NOW, 10)).toEqual([]);

  // Resolving the card does not strand the capture again: `resolve` sets
  // `resolved_at` and leaves the row, so the reference the sweep reads is
  // still there. Answering a card must not make the pipeline re-run it.
  await db.runAsync("UPDATE review_queue_items SET resolved_at = ? WHERE id = ?", [NOW, item.id]);
  expect(await listUnprocessedRawCaptures(NOW, 10)).toEqual([]);
});

test("listUnprocessedRawCaptures never offers a capture past its expiry", async () => {
  await storeRawCapture(capture({ id: "expired" }), NOW - THIRTY_DAYS_MS);
  await storeRawCapture(capture({ id: "fresh" }), NOW);

  // Same rule `listRawCaptures` follows and for a stronger reason: this list is
  // acted ON, so reprocessing an expired row would be the app parsing text it
  // told the user was already destroyed.
  const rows = await listUnprocessedRawCaptures(NOW, 10);
  expect(rows.map((row) => row.id)).toEqual(["fresh"]);
});

test("listUnprocessedRawCaptures is oldest-captured first and stops at the limit", async () => {
  await storeRawCapture(capture({ id: "cap-old", capturedAt: NOW - 3_000 }), NOW);
  await storeRawCapture(capture({ id: "cap-mid", capturedAt: NOW - 2_000 }), NOW);
  await storeRawCapture(capture({ id: "cap-new", capturedAt: NOW - 1_000 }), NOW);

  // Oldest first, the opposite of `listRawCaptures`: pipeline rule 8 says an
  // older capture may never be committed after a newer one.
  const all = await listUnprocessedRawCaptures(NOW, 10);
  expect(all.map((row) => row.id)).toEqual(["cap-old", "cap-mid", "cap-new"]);

  const capped = await listUnprocessedRawCaptures(NOW, 2);
  expect(capped.map((row) => row.id)).toEqual(["cap-old", "cap-mid"]);
});

test("listUnprocessedRawCaptures is empty when nothing has been captured", async () => {
  expect(await listUnprocessedRawCaptures(NOW, 10)).toEqual([]);
});

// ---------------------------------------------------------------------------
// isRawCaptureUnreferenced — the sweep's own predicate, asked about one id.
// `mergeDuplicate` uses it to decide whether deleting a transaction is about to
// strand the capture behind it, so the two must agree exactly.
// ---------------------------------------------------------------------------

test("isRawCaptureUnreferenced agrees with the sweep about a stored capture", async () => {
  const wallet = await createWallet({ name: "GCash" });
  await storeRawCapture(capture({ id: "cap-alone" }), NOW);
  await storeRawCapture(capture({ id: "cap-in-ledger" }), NOW);
  await storeRawCapture(capture({ id: "cap-on-card" }), NOW);

  await insertTransaction({
    walletId: wallet.id,
    categoryId: CATEGORY_ID,
    amount: 50000,
    direction: "out",
    occurredAt: NOW,
    source: "notification",
    confidence: 0.95,
    rawNotificationId: "cap-in-ledger",
  });
  const item = await enqueue({
    kind: "low-confidence",
    payload: {},
    rawNotificationId: "cap-on-card",
  });

  expect(await isRawCaptureUnreferenced("cap-alone")).toBe(true);
  expect(await isRawCaptureUnreferenced("cap-in-ledger")).toBe(false);
  expect(await isRawCaptureUnreferenced("cap-on-card")).toBe(false);

  // A resolved card is still a reference — the same rule the sweep follows, and
  // the whole reason a merge can leave one behind as a marker.
  await db.runAsync("UPDATE review_queue_items SET resolved_at = ? WHERE id = ?", [NOW, item.id]);
  expect(await isRawCaptureUnreferenced("cap-on-card")).toBe(false);

  const stranded = await listUnprocessedRawCaptures(NOW, 10);
  expect(stranded.map((row) => row.id)).toEqual(["cap-alone"]);
});

test("isRawCaptureUnreferenced is true for an id no capture was ever stored under", async () => {
  expect(await isRawCaptureUnreferenced("never-stored")).toBe(true);
});

// ---------------------------------------------------------------------------
// findReplayCapture — migration 018, the owner's 2026-09-01 duplicate-cards
// report. `hasRawCapture` cannot see a redelivery, because every delivery is
// stamped with a fresh UUID; the notification SLOT can.
// ---------------------------------------------------------------------------

const WINDOW_MS = 180_000;
const SLOT = "com.globe.gcash.android|0|null|0";

test("findReplayCapture finds the same slot and text posted again seconds later", async () => {
  await storeRawCapture(capture({ id: "cap-a", notificationKey: SLOT, postedAt: NOW - 1_000 }), NOW);

  // What Android hands over when the posting app edits its own notification:
  // new delivery id, new postTime, same slot, same text.
  const redelivered = capture({ id: "cap-b", notificationKey: SLOT, postedAt: NOW + 2_000 });

  expect(await findReplayCapture(redelivered, WINDOW_MS)).toBe("cap-a");
});

test("findReplayCapture ignores a capture with no slot key", async () => {
  // Every row stored before migration 018, and every record still in the native
  // buffer from a build that predates it. "Cannot tell" must suppress nothing —
  // the DedupeGate judges those on their parsed fields instead.
  await storeRawCapture(capture({ id: "cap-a", notificationKey: null }), NOW);

  const other = capture({ id: "cap-b", notificationKey: null });
  expect(await findReplayCapture(other, WINDOW_MS)).toBe(null);
});

test("findReplayCapture treats a blank slot key as no key at all", async () => {
  // A slot key is `package|id|tag|user` and is never empty, so a blank one says
  // exactly what a missing one says: this capture cannot name the slot it came
  // from. Read as a real slot identity it is worse than useless — every keyless
  // capture shares the ONE empty bucket, so two byte-identical captures look
  // like "the same slot, same text" and the second is suppressed. That is
  // dedupe-on-text-alone, which migration 018 rejected by name, reached by
  // accident through a blank string.
  await storeRawCapture(capture({ id: "cap-a", notificationKey: "" }), NOW);

  const other = capture({ id: "cap-b", notificationKey: "" });
  expect(await findReplayCapture(other, WINDOW_MS)).toBe(null);
});

test("findReplayCapture ignores identical text posted into a different slot", async () => {
  // Two separately-posted notifications. They may read identically — the same
  // ₱500.00 sent to the same person twice — and suppressing the second would
  // delete a real transaction from the ledger.
  await storeRawCapture(capture({ id: "cap-a", notificationKey: SLOT }), NOW);

  const other = capture({ id: "cap-b", notificationKey: "com.globe.gcash.android|9|null|0" });
  expect(await findReplayCapture(other, WINDOW_MS)).toBe(null);
});

test("findReplayCapture ignores the same slot carrying different text", async () => {
  // One tile that says "Processing" and then says what actually happened. Same
  // slot, two different facts, and only the second is the transaction.
  await storeRawCapture(
    capture({ id: "cap-a", notificationKey: SLOT, text: "Processing your request..." }),
    NOW,
  );

  const settled = capture({ id: "cap-b", notificationKey: SLOT });
  expect(await findReplayCapture(settled, WINDOW_MS)).toBe(null);
});

test("findReplayCapture ignores a repost that arrives past the window", async () => {
  await storeRawCapture(capture({ id: "cap-a", notificationKey: SLOT, postedAt: NOW }), NOW);

  const late = capture({ id: "cap-b", notificationKey: SLOT, postedAt: NOW + WINDOW_MS + 1 });
  expect(await findReplayCapture(late, WINDOW_MS)).toBe(null);
});

test("findReplayCapture never matches a capture against itself", async () => {
  // `storeRawCapture` is idempotent, so a caller may legitimately ask about a
  // capture that is already stored. Matching itself would report every stored
  // capture as its own replay.
  const stored = capture({ id: "cap-a", notificationKey: SLOT });
  await storeRawCapture(stored, NOW);

  expect(await findReplayCapture(stored, WINDOW_MS)).toBe(null);
});

// ---------------------------------------------------------------------------
// The minimal record (GAP-107, owner decision 2026-09-09). A capture the router
// judges not money-related keeps its app and its times and none of its text.
// It is settled rather than stranded: nothing is left that any stage could
// read, so the recovery sweep has nothing to come back for.
// ---------------------------------------------------------------------------

const CHAT_SLOT = "com.friend.chat|7|thread-ana|0";

function chat(overrides: Partial<RawCapture> = {}): RawCapture {
  return capture({
    id: "cap-chat",
    packageName: "com.friend.chat",
    title: "Ana",
    text: "Kain tayo mamaya!",
    subText: null,
    bigText: null,
    notificationKey: CHAT_SLOT,
    ...overrides,
  });
}

test("storeDiscardedCapture keeps the app and the times and none of the text", async () => {
  const original = chat();

  expect(await storeDiscardedCapture(original, NOW)).toBe("cap-chat");

  expect(await getRawCapture("cap-chat")).toEqual({
    ...original,
    title: null,
    text: null,
    subText: null,
    bigText: null,
    // The slot key goes with the text. Its tag is the posting app's own label
    // for the notification, and a chat app puts the conversation there.
    notificationKey: null,
  });
  // The same thirty days as every other row, counted from the store.
  expect(await getRawCaptureExpiry("cap-chat")).toBe(NOW + THIRTY_DAYS_MS);
});

test("a discarded capture is settled: the recovery sweep never offers it", async () => {
  await storeDiscardedCapture(chat(), NOW);
  await storeRawCapture(capture({ id: "cap-stranded" }), NOW);

  // Nothing points at either row. Only the one with text is work; re-running
  // the other on every launch for thirty days is the churn GAP-048 removed for
  // muted packages, and it would crowd real stranded captures out of the limit.
  const rows = await listUnprocessedRawCaptures(NOW, 10);
  expect(rows.map((row) => row.id)).toEqual(["cap-stranded"]);
});

test("listRawCaptures says which rows kept their text", async () => {
  await storeRawCapture(capture({ id: "kept", capturedAt: NOW - 1_000 }), NOW);
  await storeDiscardedCapture(chat({ id: "trimmed", capturedAt: NOW }), NOW);

  const rows = await listRawCaptures(NOW);

  expect(rows.map((row) => [row.id, row.bodyDiscarded])).toEqual([
    ["trimmed", true],
    ["kept", false],
  ]);
});

test("discardRawCaptureBody strips a stored capture nothing points at, and settles it", async () => {
  // A row an earlier build's drain stored whole before routing it.
  await storeRawCapture(chat({ id: "cap-legacy" }), NOW - 1_000);

  await discardRawCaptureBody("cap-legacy", NOW);

  expect(await getRawCapture("cap-legacy")).toEqual({
    ...chat({ id: "cap-legacy" }),
    title: null,
    text: null,
    subText: null,
    bigText: null,
    notificationKey: null,
  });
  expect(await listUnprocessedRawCaptures(NOW, 10)).toEqual([]);
  // Discarding is not a store: the deletion date the Privacy centre shows for
  // this row does not move.
  expect(await getRawCaptureExpiry("cap-legacy")).toBe(NOW - 1_000 + THIRTY_DAYS_MS);
});

test("discardRawCaptureBody leaves a capture a committed transaction points at untouched", async () => {
  const wallet = await createWallet({ name: "GCash" });
  await storeRawCapture(capture({ id: "cap-committed" }), NOW);
  await insertTransaction({
    walletId: wallet.id,
    categoryId: CATEGORY_ID,
    amount: 50000,
    direction: "out",
    occurredAt: NOW,
    source: "notification",
    confidence: 0.95,
    rawNotificationId: "cap-committed",
  });

  await discardRawCaptureBody("cap-committed", NOW);

  // "Why was this recorded?" shows this text for that transaction.
  expect(await getRawCapture("cap-committed")).toEqual(capture({ id: "cap-committed" }));
});

test("the database refuses text on a row whose body was discarded", async () => {
  await storeDiscardedCapture(chat(), NOW);

  // The promise is held by the schema, not by every later writer remembering it.
  await expect(
    db.runAsync("UPDATE raw_notifications SET text = 'Kain tayo mamaya!' WHERE id = 'cap-chat'"),
  ).rejects.toThrow(/CHECK/i);
});
