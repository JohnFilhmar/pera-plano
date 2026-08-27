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
  getRawCapture,
  getRawCaptureExpiry,
  hasRawCapture,
  listRawCaptures,
  purgeExpiredRawCaptures,
  RAW_CAPTURE_TTL_MS,
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
