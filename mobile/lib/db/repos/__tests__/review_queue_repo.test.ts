import { closeDatabase } from "@/lib/db/database";
import { countOpen, enqueue, listOpen, purgeExpired, resolve } from "../review_queue_repo";
import { freshDb } from "@/test_support/db";
import type { ReviewItemPayload, ReviewKind } from "@/types/domain";
import type { SQLiteDatabase } from "expo-sqlite";

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// All four kinds, spelled the way the SHIPPED types/domain.ts and the
// review_queue_items CHECK constraint spell them (hyphenated). The Task 13
// plan text sketched underscored names ("low_confidence", ...) plus a
// "possible_transfer" kind that doesn't exist anywhere in the shipped schema
// — that sketch was drafted from the ingest pipeline's vocabulary without
// reconciling it against what Tasks 7-8 actually shipped. Coordinator ruling:
// implement and test against the shipped vocabulary; see task-13-report.md
// "Escalation" for the full history.
const ALL_KINDS: ReviewKind[] = [
  "low-confidence",
  "unknown-provider",
  "ambiguous-transfer",
  "possible-duplicate",
];

// ---------------------------------------------------------------------------
// Verbatim from task-13-brief.md Step 1 — the six named tests.
// ---------------------------------------------------------------------------

test("enqueue round-trips payload_json through listOpen", async () => {
  const payload: ReviewItemPayload = {
    amount: 15000,
    merchant: "Jollibee",
    tags: ["food", "lunch"],
    note: null,
    candidate: { provider: "GCash", confidence: 0.62 },
  };
  await enqueue({ kind: "low-confidence", payload });

  const open = await listOpen();
  expect(open).toHaveLength(1);
  // Deep-equal a nested object + array + number + null together, not a
  // stringified blob and not a shallow copy that happens to look equal.
  expect(open[0].payload).toEqual(payload);
  expect(open[0].payload).not.toBe(payload);
  expect(open[0].rawNotificationId).toBeNull();
});

test("listOpen returns oldest first and excludes resolved rows", async () => {
  const dateSpy = jest.spyOn(Date, "now");
  dateSpy.mockReturnValue(3_000);
  const itemC = await enqueue({ kind: "low-confidence", payload: { n: 3 } });
  dateSpy.mockReturnValue(1_000);
  const itemA = await enqueue({ kind: "unknown-provider", payload: { n: 1 } });
  dateSpy.mockReturnValue(2_000);
  const itemB = await enqueue({ kind: "ambiguous-transfer", payload: { n: 2 } });

  // Stay under the mocked clock for resolve()/listOpen() too — restoring here
  // would hand both calls the REAL wall-clock time, which is far past these
  // items' default 30-day expiry computed from the tiny mocked `createdAt`
  // values above, making every item look expired for the wrong reason.
  dateSpy.mockReturnValue(4_000);
  await resolve(itemC.id, "dismissed");
  const open = await listOpen();
  dateSpy.mockRestore();

  expect(open.map((i) => i.id)).toEqual([itemA.id, itemB.id]);
});

test("resolve is idempotent", async () => {
  const item = await enqueue({ kind: "possible-duplicate", payload: { n: 1 } });
  await expect(resolve(item.id, "confirmed")).resolves.toBeUndefined();
  await expect(resolve(item.id, "confirmed")).resolves.toBeUndefined();

  const open = await listOpen();
  expect(open).toHaveLength(0);
  const resolvedRows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM review_queue_items WHERE resolved_at IS NOT NULL",
  );
  expect(resolvedRows).toHaveLength(1);
});

test("countOpen matches listOpen length", async () => {
  await enqueue({ kind: "low-confidence", payload: {} });
  await enqueue({ kind: "unknown-provider", payload: {} });
  const resolved = await enqueue({ kind: "ambiguous-transfer", payload: {} });
  await resolve(resolved.id, "dismissed");

  expect(await countOpen()).toBe((await listOpen()).length);
  expect(await countOpen()).toBe(2);
});

test("expired unresolved items are excluded from listOpen and removed by purgeExpired", async () => {
  const dateSpy = jest.spyOn(Date, "now");
  dateSpy.mockReturnValue(1_000);
  const expired = await enqueue({ kind: "low-confidence", payload: {}, expiresAt: 5_000 });
  const stillOpen = await enqueue({ kind: "unknown-provider", payload: {}, expiresAt: 50_000 });

  dateSpy.mockReturnValue(10_000); // now: past `expired`'s expiry, before `stillOpen`'s
  const open = await listOpen();
  expect(open.map((i) => i.id)).toEqual([stillOpen.id]);

  const removed = await purgeExpired(10_000);
  dateSpy.mockRestore();
  expect(removed).toBe(1);

  const remainingIds = (await db.getAllAsync<{ id: string }>("SELECT id FROM review_queue_items")).map(
    (r) => r.id,
  );
  expect(remainingIds).toEqual([stillOpen.id]);
  void expired;
});

test.each(ALL_KINDS)("ReviewKind %s round-trips through enqueue, listOpen, and the row itself", async (kind) => {
  const item = await enqueue({ kind, payload: { kind } });
  expect(item.kind).toBe(kind);

  const open = await listOpen();
  expect(open[0].kind).toBe(kind);

  // Also read the raw column: a kind spelled outside the CHECK constraint's
  // set would have thrown on INSERT, never getting this far.
  const row = await db.getFirstAsync<{ kind: string }>(
    "SELECT kind FROM review_queue_items WHERE id = ?",
    [item.id],
  );
  expect(row?.kind).toBe(kind);
});

// ---------------------------------------------------------------------------
// Discriminating suite below, built so a plausible-but-broken implementation
// fails for a specific, identifiable reason.
// ---------------------------------------------------------------------------

describe("listOpen's three filter conditions are each independently correct", () => {
  test("resolved-only, expired-only, and resolved+expired items are excluded; three open items list FIFO despite scrambled insertion", async () => {
    const dateSpy = jest.spyOn(Date, "now");

    dateSpy.mockReturnValue(100);
    const resolvedAndExpired = await enqueue({
      kind: "possible-duplicate",
      payload: { case: "resolved+expired" },
      expiresAt: 200,
    });
    await resolve(resolvedAndExpired.id, "dismissed");

    dateSpy.mockReturnValue(500);
    const expiredNotResolved = await enqueue({
      kind: "unknown-provider",
      payload: { case: "expired-only" },
      expiresAt: 900,
    });

    dateSpy.mockReturnValue(1_500);
    const resolvedNotExpired = await enqueue({
      kind: "ambiguous-transfer",
      payload: { case: "resolved-only" },
      expiresAt: 100_000,
    });
    await resolve(resolvedNotExpired.id, "confirmed");

    // Three genuinely-open items, inserted out of created_at order (C, A, B)
    // so a correct FIFO sort cannot pass "by accident" of insertion order.
    dateSpy.mockReturnValue(3_000);
    const itemC = await enqueue({
      kind: "low-confidence",
      payload: { case: "C" },
      expiresAt: 100_000,
    });
    dateSpy.mockReturnValue(1_000);
    const itemA = await enqueue({
      kind: "low-confidence",
      payload: { case: "A" },
      expiresAt: 100_000,
    });
    dateSpy.mockReturnValue(2_000);
    const itemB = await enqueue({
      kind: "low-confidence",
      payload: { case: "B" },
      expiresAt: 100_000,
    });

    dateSpy.mockReturnValue(10_000); // "now" for the listOpen() call itself
    const open = await listOpen();
    dateSpy.mockRestore();

    const openIds = open.map((i) => i.id);
    expect(openIds).toEqual([itemA.id, itemB.id, itemC.id]);
    expect(openIds).not.toContain(resolvedAndExpired.id);
    expect(openIds).not.toContain(expiredNotResolved.id);
    expect(openIds).not.toContain(resolvedNotExpired.id);
  });
});

describe("resolve's idempotency preserves the original resolved_at, not a second write", () => {
  test("a second resolve call at a later time with a different resolution does not move resolved_at forward", async () => {
    const dateSpy = jest.spyOn(Date, "now");
    dateSpy.mockReturnValue(5_000);
    const item = await enqueue({ kind: "low-confidence", payload: {} });

    dateSpy.mockReturnValue(6_000);
    await resolve(item.id, "confirmed");

    const afterFirst = await db.getFirstAsync<{ resolved_at: number }>(
      "SELECT resolved_at FROM review_queue_items WHERE id = ?",
      [item.id],
    );
    expect(afterFirst?.resolved_at).toBe(6_000);

    dateSpy.mockReturnValue(9_000);
    await expect(resolve(item.id, "dismissed")).resolves.toBeUndefined();
    dateSpy.mockRestore();

    const afterSecond = await db.getFirstAsync<{ resolved_at: number }>(
      "SELECT resolved_at FROM review_queue_items WHERE id = ?",
      [item.id],
    );
    // A naive "always UPDATE" implementation would overwrite resolved_at to
    // 9_000 here — proving the second call is a true no-op, not merely
    // "did not throw."
    expect(afterSecond?.resolved_at).toBe(6_000);
  });

  test("resolving an id that was never enqueued does not throw", async () => {
    await expect(resolve("does-not-exist", "confirmed")).resolves.toBeUndefined();
  });
});

describe("purgeExpired retains resolved history and only removes unresolved rows past expiry", () => {
  test("a resolved-and-expired item survives; only the unresolved-and-expired item is deleted and counted", async () => {
    const dateSpy = jest.spyOn(Date, "now");

    dateSpy.mockReturnValue(1_000);
    const resolvedExpired = await enqueue({
      kind: "possible-duplicate",
      payload: {},
      expiresAt: 2_000,
    });
    await resolve(resolvedExpired.id, "confirmed");

    const unresolvedExpired = await enqueue({
      kind: "low-confidence",
      payload: {},
      expiresAt: 2_000,
    });
    const unresolvedNotYetExpired = await enqueue({
      kind: "unknown-provider",
      payload: {},
      expiresAt: 100_000,
    });
    dateSpy.mockRestore();

    const removed = await purgeExpired(5_000);
    expect(removed).toBe(1);

    const remainingIds = (await db.getAllAsync<{ id: string }>("SELECT id FROM review_queue_items")).map(
      (r) => r.id,
    );
    expect(remainingIds).toEqual(
      expect.arrayContaining([resolvedExpired.id, unresolvedNotYetExpired.id]),
    );
    expect(remainingIds).not.toContain(unresolvedExpired.id);
    expect(remainingIds).toHaveLength(2);
  });

  test("purgeExpired returns 0 and deletes nothing when no unresolved item is past expiry", async () => {
    await enqueue({ kind: "low-confidence", payload: {}, expiresAt: 999_999 });
    expect(await purgeExpired(0)).toBe(0);
  });
});

describe("expiresAt defaults to 30 days from creation when the caller doesn't supply one", () => {
  test("enqueue without expiresAt sets expires_at to createdAt + 30 days exactly", async () => {
    const dateSpy = jest.spyOn(Date, "now");
    dateSpy.mockReturnValue(1_000);
    const item = await enqueue({ kind: "low-confidence", payload: {} });
    dateSpy.mockRestore();

    expect(item.createdAt).toBe(1_000);
    expect(item.expiresAt).toBe(1_000 + THIRTY_DAYS_MS);
  });
});
