import { REVIEW_KINDS } from "@/constants/review_kinds";
import { closeDatabase } from "@/lib/db/database";
import {
  countOpen,
  countOpenByKind,
  enqueue,
  findOpenForRawNotification,
  findOpenTwin,
  listOpen,
  listOpenPage,
  purgeExpired,
  resolve,
} from "../review_queue_repo";
import { storeRawCapture } from "../raw_notifications_repo";
import { freshDb } from "@/test_support/db";
import type { ReviewItemPayload, ReviewKind, ReviewQueueItem } from "@/types/domain";
import type { SQLiteDatabase } from "@/lib/db/database";

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// All FIVE kinds, spelled the way the SHIPPED types/domain.ts and the
// review_queue_items CHECK constraint spell them (hyphenated). The Task 13
// plan text sketched underscored names ("low_confidence", ...) plus a
// "possible_transfer" kind that doesn't exist anywhere in the shipped schema
// — that sketch was drafted from the ingest pipeline's vocabulary without
// reconciling it against what Tasks 7-8 actually shipped. Coordinator ruling:
// implement and test against the shipped vocabulary; see task-13-report.md
// "Escalation" for the full history.
//
// `loan-match` is the fifth, added by 011_loan_match_review_kind.sql — the
// post-commit loan matcher's card (docs/04-features/06-loans.md rules 8-10).
// It belongs in this list rather than only in its own suite because the
// round-trip test below reads the RAW `kind` column back: that is the one
// assertion in the codebase that fails if the CHECK constraint was never
// widened, which is exactly the failure a rebuilt table can regress to.
const ALL_KINDS: ReviewKind[] = [
  "low-confidence",
  "unknown-provider",
  "ambiguous-transfer",
  "possible-duplicate",
  "loan-match",
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

// ---------------------------------------------------------------------------
// listOpenPage / countOpenByKind — the Review Queue's paged, filterable read.
//
// The screen used to render every open item into one ScrollView. These cover
// the two properties that replacement has to hold: a page boundary that cannot
// SKIP a row when the rows in front of it are triaged away (the whole reason
// the cursor is a keyset and not an offset), and a kind filter applied in SQL
// rather than to an already-cut page.
// ---------------------------------------------------------------------------

/**
 * An expiry the REAL clock is still short of.
 *
 * The seeds below move `Date.now()` back to 1, 2, 3... so the page order is
 * readable straight off the payload — and `enqueue`'s default expiry is
 * `createdAt + 30 days`, which for `createdAt: 1` lands in January 1970. Every
 * such row is already expired by the time `listOpenPage` reads the real clock,
 * so the seed has to state its own expiry rather than take the default.
 */
const FAR_FUTURE = Date.now() + THIRTY_DAYS_MS;

/**
 * Seeds `count` open items whose `created_at` values are 1, 2, 3, ... so the
 * expected page order is readable straight off the payload.
 */
async function seedQueue(
  count: number,
  kind: ReviewKind = "low-confidence",
): Promise<ReviewQueueItem[]> {
  const dateSpy = jest.spyOn(Date, "now");
  const items: ReviewQueueItem[] = [];
  for (let n = 1; n <= count; n += 1) {
    dateSpy.mockReturnValue(n);
    items.push(await enqueue({ kind, payload: { n }, expiresAt: FAR_FUTURE }));
  }
  dateSpy.mockRestore();
  return items;
}

describe("listOpenPage", () => {
  test("returns at most `limit` rows, oldest first, and a cursor when more remain", async () => {
    await seedQueue(5);

    const first = await listOpenPage({ limit: 2 });
    expect(first.items.map((item) => item.payload.n)).toEqual([1, 2]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listOpenPage({ limit: 2, after: first.nextCursor });
    expect(second.items.map((item) => item.payload.n)).toEqual([3, 4]);

    const third = await listOpenPage({ limit: 2, after: second.nextCursor });
    expect(third.items.map((item) => item.payload.n)).toEqual([5]);
    // The LAST page says so itself — the caller never has to count to find out,
    // and a "Show more" button that fetched an empty page forever is exactly
    // what a cursor returned unconditionally would produce.
    expect(third.nextCursor).toBeNull();
  });

  test("a full final page still reports no next page", async () => {
    await seedQueue(4);
    const first = await listOpenPage({ limit: 2 });
    const second = await listOpenPage({ limit: 2, after: first.nextCursor });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  test("NO ROW IS SKIPPED when page-one items are resolved before page two loads", async () => {
    // The reason the cursor is a keyset. Under LIMIT/OFFSET, resolving the two
    // rows already shown shortens the list under the offset and item 3 — never
    // rendered, never triaged — is silently stepped over.
    const items = await seedQueue(5);
    const first = await listOpenPage({ limit: 2 });
    expect(first.items.map((item) => item.payload.n)).toEqual([1, 2]);

    await resolve(items[0].id, "confirmed");
    await resolve(items[1].id, "dismissed");

    const second = await listOpenPage({ limit: 2, after: first.nextCursor });
    expect(second.items.map((item) => item.payload.n)).toEqual([3, 4]);
  });

  test("items sharing a millisecond are paged through exactly once each", async () => {
    // `startIngest` drains up to 500 buffered captures in one pass, so ties on
    // `created_at` are ordinary, not exotic. The id tiebreak is what stops a
    // cursor built from one of them re-showing or skipping the rest.
    const dateSpy = jest.spyOn(Date, "now").mockReturnValue(7_000);
    for (let n = 0; n < 6; n += 1) {
      await enqueue({ kind: "low-confidence", payload: { n }, expiresAt: FAR_FUTURE });
    }
    dateSpy.mockRestore();

    const seen: string[] = [];
    let cursor = null as Awaited<ReturnType<typeof listOpenPage>>["nextCursor"];
    do {
      const page = await listOpenPage({ limit: 2, after: cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  test("filters by kind IN SQL, so a page of one kind is a full page of that kind", async () => {
    // Interleaved on purpose: the three unknown-provider rows are 2nd, 4th and
    // 6th oldest, so a filter applied to an already-cut page of 2 would return
    // ONE row and claim that was all of them.
    const dateSpy = jest.spyOn(Date, "now");
    for (let n = 1; n <= 6; n += 1) {
      dateSpy.mockReturnValue(n);
      await enqueue({
        kind: n % 2 === 0 ? "unknown-provider" : "low-confidence",
        payload: { n },
        expiresAt: FAR_FUTURE,
      });
    }
    dateSpy.mockRestore();

    const page = await listOpenPage({ kinds: ["unknown-provider"], limit: 2 });
    expect(page.items.map((item) => item.payload.n)).toEqual([2, 4]);
    expect(page.items.every((item) => item.kind === "unknown-provider")).toBe(true);
    expect(page.nextCursor).not.toBeNull();
  });

  test("an empty kinds array means every kind, never nothing", async () => {
    await seedQueue(3);
    expect((await listOpenPage({ kinds: [], limit: 10 })).items).toHaveLength(3);
  });

  test("honours the same open predicate as listOpen — resolved and expired rows never appear", async () => {
    const dateSpy = jest.spyOn(Date, "now");
    dateSpy.mockReturnValue(1_000);
    const expired = await enqueue({ kind: "low-confidence", payload: { n: "expired" }, expiresAt: 2_000 });
    const resolved = await enqueue({ kind: "low-confidence", payload: { n: "resolved" } });
    const open = await enqueue({ kind: "low-confidence", payload: { n: "open" } });
    await resolve(resolved.id, "confirmed");
    dateSpy.mockReturnValue(10_000);
    const page = await listOpenPage({ limit: 10 });
    dateSpy.mockRestore();

    const ids = page.items.map((item) => item.id);
    expect(ids).toEqual([open.id]);
    expect(ids).not.toContain(expired.id);
    expect(ids).not.toContain(resolved.id);
  });
});

describe("countOpenByKind", () => {
  test("counts each kind and reports zero for the kinds with nothing waiting", async () => {
    await enqueue({ kind: "low-confidence", payload: {} });
    await enqueue({ kind: "low-confidence", payload: {} });
    await enqueue({ kind: "unknown-provider", payload: {} });

    const counts = await countOpenByKind();
    expect(counts["low-confidence"]).toBe(2);
    expect(counts["unknown-provider"]).toBe(1);
    // Present-and-zero, not absent. A chip that had to tell "no key" from "0"
    // gets it wrong at the moment it matters — the last item of a kind being
    // triaged away while that kind is the selected filter.
    expect(counts["possible-duplicate"]).toBe(0);
    for (const kind of REVIEW_KINDS) expect(typeof counts[kind]).toBe("number");
  });

  test("its total agrees with countOpen, and both ignore resolved and expired rows", async () => {
    const dateSpy = jest.spyOn(Date, "now");
    dateSpy.mockReturnValue(1_000);
    await enqueue({ kind: "low-confidence", payload: {}, expiresAt: 2_000 });
    const resolved = await enqueue({ kind: "ambiguous-transfer", payload: {} });
    await enqueue({ kind: "unknown-provider", payload: {} });
    await resolve(resolved.id, "dismissed");
    dateSpy.mockReturnValue(10_000);
    const counts = await countOpenByKind();
    const total = await countOpen();
    dateSpy.mockRestore();

    expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(total);
    expect(total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// findOpenForRawNotification — one raw notification may raise one open card.
// Before this the queue had no duplicate defence of any kind: `checkDuplicate`
// compares against COMMITTED transactions, so two cards for one capture could
// both be confirmed and commit the same money twice (2026-09-01).
// ---------------------------------------------------------------------------

describe("findOpenForRawNotification", () => {
  /**
   * `review_queue_items.raw_notification_id` is a foreign key, so a card can
   * only ever point at a capture that really was stored — these tests store one
   * for the same reason the pipeline does before it queues anything.
   */
  async function storeCapture(id: string): Promise<void> {
    await storeRawCapture(
      {
        id,
        packageName: "com.globe.gcash.android",
        title: "GCash",
        text: "You sent ₱1,000.00 to Juan Dela Cruz.",
        subText: null,
        bigText: null,
        postedAt: 1_000,
        capturedAt: 1_000,
        notificationKey: null,
      },
      1_000,
    );
  }

  test("finds the open card already raised for a capture", async () => {
    await storeCapture("cap-1");
    const item = await enqueue({
      kind: "low-confidence",
      payload: { amount: 100_000 },
      rawNotificationId: "cap-1",
    });

    expect((await findOpenForRawNotification("cap-1"))?.id).toBe(item.id);
  });

  test("is null for a capture that has raised no card", async () => {
    await storeCapture("cap-1");
    await enqueue({ kind: "low-confidence", payload: {}, rawNotificationId: "cap-1" });

    expect(await findOpenForRawNotification("cap-2")).toBe(null);
  });

  test("ignores a card the user has already triaged", async () => {
    // A resolved card is not an open question, so the same capture reaching the
    // stages again must be free to ask a new one rather than silently reusing a
    // card the user has finished with.
    await storeCapture("cap-1");
    const item = await enqueue({
      kind: "low-confidence",
      payload: {},
      rawNotificationId: "cap-1",
    });
    await resolve(item.id, "confirmed");

    expect(await findOpenForRawNotification("cap-1")).toBe(null);
  });

  test("ignores an expired card", async () => {
    // Same predicate as `listOpen`: an item past its 30-day TTL is no longer
    // open, and treating it as one would suppress a card the user can never see.
    await storeCapture("cap-1");
    const dateSpy = jest.spyOn(Date, "now");
    dateSpy.mockReturnValue(1_000);
    await enqueue({
      kind: "low-confidence",
      payload: {},
      rawNotificationId: "cap-1",
      expiresAt: 2_000,
    });
    dateSpy.mockRestore();

    expect(await findOpenForRawNotification("cap-1", 10_000)).toBe(null);
  });

  test("never matches a card that came from a different capture", async () => {
    // Two distinct captures are two distinct questions, however alike their
    // payloads read — suppressing the second would drop a real transaction.
    await storeCapture("cap-1");
    await enqueue({
      kind: "low-confidence",
      payload: { amount: 100_000, direction: "out", merchant: "Aling Nena" },
      rawNotificationId: "cap-1",
    });

    expect(await findOpenForRawNotification("cap-2")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// findOpenTwin — docs/03 §6 rule 2, asked of the QUEUE instead of the ledger.
// `checkDuplicate` only ever compares against committed rows, so a push that
// hard-routed (unmapped wallet, a score under the floor) is invisible to it and
// its SMS relay thirty seconds later raises a second card for one movement.
// Confirming both writes the payment twice, because neither confirm has a
// committed row to compare against either (GAP-012).
// ---------------------------------------------------------------------------

describe("findOpenTwin", () => {
  const TWIN_WINDOW_MS = 180_000;
  const OCCURRED_AT = 1_700_000_000_000;

  async function storeCapture(id: string): Promise<void> {
    await storeRawCapture(
      {
        id,
        packageName: "com.bpi.ng.app",
        title: "BPI",
        text: "Your account was debited ₱750.00.",
        subText: null,
        bigText: null,
        postedAt: OCCURRED_AT,
        capturedAt: OCCURRED_AT,
        notificationKey: null,
      },
      OCCURRED_AT,
    );
  }

  /** The push card the pipeline raises for a capture it could not auto-commit. */
  async function queuePush(
    captureId: string,
    payload: ReviewItemPayload = {},
    expiresAt?: number,
  ): Promise<ReviewQueueItem> {
    await storeCapture(captureId);
    return enqueue({
      kind: "low-confidence",
      rawNotificationId: captureId,
      expiresAt,
      payload: {
        providerKey: "bpi",
        channel: "push",
        amount: 75_000,
        direction: "out",
        occurredAt: OCCURRED_AT,
        walletId: null,
        ...payload,
      },
    });
  }

  /** The SMS relay of that same movement, as the pipeline asks about it. */
  function smsTwin(overrides: Partial<Parameters<typeof findOpenTwin>[0]> = {}) {
    return {
      providerKey: "bpi",
      amount: 75_000,
      direction: "out" as const,
      channel: "sms" as const,
      occurredAt: OCCURRED_AT + 30_000,
      windowMs: TWIN_WINDOW_MS,
      ...overrides,
    };
  }

  test("finds the open push card its SMS relay is a second telling of", async () => {
    const card = await queuePush("cap-push");

    expect((await findOpenTwin(smsTwin()))?.id).toBe(card.id);
  });

  test("never folds two tellings on the SAME channel", async () => {
    // §6 rule 4's undecidable pair. Two genuine ₱750.00 purchases minutes apart
    // agree on provider, amount, direction and the window — the queue exists to
    // ASK about that, and collapsing them here would delete a real transaction
    // exactly as a payload-matching `findOpenForRawNotification` would.
    await queuePush("cap-push");

    expect(await findOpenTwin(smsTwin({ channel: "push" }))).toBe(null);
  });

  test("a card whose channel was never recorded matches nothing", async () => {
    // Absent is not "the other one". Every card raised before the payload
    // carried a channel reads this way, and reading `undefined` as a difference
    // would suppress them on no evidence at all.
    await queuePush("cap-push", { channel: undefined });

    expect(await findOpenTwin(smsTwin())).toBe(null);
  });

  test("references that disagree are two transactions, however close together", async () => {
    // The provider's own statement that these are not the same thing, and it
    // outranks the timing — `matchesTwinWindow` makes the same exclusion.
    await queuePush("cap-push", { referenceNo: "BPI556677" });

    expect(await findOpenTwin(smsTwin({ referenceNo: "BPI998877" }))).toBe(null);
    expect((await findOpenTwin(smsTwin({ referenceNo: "bpi556677" }))) !== null).toBe(true);
    // A blank reference is an ABSENT one, never a mismatch: most notifications
    // carry none, and failing closed there would disable the whole rule.
    expect((await findOpenTwin(smsTwin({ referenceNo: "  " }))) !== null).toBe(true);
  });

  test("stops at the twin window, inclusive of the boundary", async () => {
    await queuePush("cap-push");

    expect(await findOpenTwin(smsTwin({ occurredAt: OCCURRED_AT + TWIN_WINDOW_MS }))).not.toBe(null);
    expect(await findOpenTwin(smsTwin({ occurredAt: OCCURRED_AT + TWIN_WINDOW_MS + 1 }))).toBe(null);
    // Absolute, like `dedupe_gate.isWithin`: a delayed relay can be stamped
    // either side of the card it belongs to.
    expect(await findOpenTwin(smsTwin({ occurredAt: OCCURRED_AT - TWIN_WINDOW_MS }))).not.toBe(null);
  });

  test("a different provider, amount or direction is a different movement", async () => {
    await queuePush("cap-push");

    expect(await findOpenTwin(smsTwin({ providerKey: "gcash" }))).toBe(null);
    expect(await findOpenTwin(smsTwin({ amount: 75_001 }))).toBe(null);
    expect(await findOpenTwin(smsTwin({ direction: "in" }))).toBe(null);
  });

  test("a triaged or expired card is not an open question", async () => {
    const resolved = await queuePush("cap-resolved");
    await resolve(resolved.id, "confirmed");
    expect(await findOpenTwin(smsTwin())).toBe(null);

    await queuePush("cap-expired", {}, OCCURRED_AT + 1);

    expect(await findOpenTwin(smsTwin(), OCCURRED_AT + 10_000)).toBe(null);
  });

  test("the nearest card in time wins when several could match", async () => {
    const far = await queuePush("cap-far", { occurredAt: OCCURRED_AT - 120_000 });
    const near = await queuePush("cap-near", { occurredAt: OCCURRED_AT + 25_000 });

    expect(far.id).not.toBe(near.id);
    expect((await findOpenTwin(smsTwin()))?.id).toBe(near.id);
  });
});
