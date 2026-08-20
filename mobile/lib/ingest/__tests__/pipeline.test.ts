// lib/ingest/__tests__/pipeline.test.ts — plan Task 10 Steps 3-4.
//
// Integration tests, deliberately: every one of them drives a real `freshDb()`
// from a `RawCapture` all the way to the ledger through the actual nine stages,
// with only the native notification bridge mocked. The stages each have their
// own unit suite; what is untested until here is the WIRING — the stage order,
// the two joins the pure stages cannot do for themselves, the arithmetic
// between them, and what happens to a capture when something goes wrong.
//
// The native module is the one mock. `@/modules/notification_listener` calls
// `requireNativeModule` at import time, which throws under Jest, and its two
// pipeline-facing functions (`drainPendingCaptures`, `addCaptureListener`) are
// exactly the seam the buffered-vs-live ordering rule lives on.
jest.mock("@/modules/notification_listener", () => ({
  drainPendingCaptures: jest.fn(),
  addCaptureListener: jest.fn(),
}));

import { closeDatabase } from "@/lib/db/database";
import { addCaptureListener, drainPendingCaptures } from "@/modules/notification_listener";
import * as parseStatsRepo from "@/lib/diagnostics/parse_stats_repo";
import { createUserRule } from "@/lib/db/repos/user_rules_repo";
import { createWallet, getBalanceDrift, getWallet } from "@/lib/db/repos/wallets_repo";
import { onAppEvent } from "@/lib/events/app_events";
import { freshDb } from "@/test_support/db";
import { getRawCapture, storeRawCapture } from "@/lib/db/repos/raw_notifications_repo";
import { getTransferLink } from "@/lib/db/repos/transfer_links_repo";
import { insertTransaction, listTransactions, sumSpend } from "@/lib/db/repos/transactions_repo";
import { listOpen } from "@/lib/db/repos/review_queue_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { seedParserRules } from "@/lib/ingest/seed_rules";
import { setSetting } from "@/lib/db/repos/app_settings_repo";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { __awaitIngestIdle, processCapture, startIngest } from "../pipeline";
import type { RawCapture, Transaction } from "@/types/domain";
import type { RulesetBundleInput } from "@/lib/ingest/ruleset_types";
import type { SQLiteDatabase } from "@/lib/db/database";

const mockDrain = drainPendingCaptures as jest.Mock;
const mockAddCaptureListener = addCaptureListener as jest.Mock;

const GCASH = "com.globe.gcash.android";
const BPI = "com.bpi.ng.app";
const MESSAGES = "com.google.android.apps.messaging";
const CHAT = "com.friend.chat";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/**
 * A recent, fixed base time. Recent because `listTransactions` and `sumSpend`
 * clamp reads to the free tier's 90-day history floor, measured from `Date.now()`
 * — which is mocked below to this same base, so every window in these tests sits
 * exactly where it would on a real device.
 */
const NOW = 1_786_000_000_000;

let db: SQLiteDatabase;
let clockOffset: number;
let liveListener: ((capture: RawCapture) => void) | null;
let unsubscribeLive: jest.Mock;

/**
 * A monotonic clock, not a frozen one.
 *
 * Frozen would be simpler, and it would silently break the one test that has to
 * distinguish "committed earlier" from "committed later": `created_at` is read
 * from `Date.now()` at insert time, and with a constant clock every row ties and
 * the buffered-before-live ordering rule becomes unfalsifiable. Each call
 * advances one millisecond, which is enough to order commits and still keeps
 * every timestamp within a few hundred ms of `NOW`.
 */
function mockClock(): void {
  clockOffset = 0;
  jest.spyOn(Date, "now").mockImplementation(() => NOW + clockOffset++);
}

function capture(overrides: Partial<RawCapture> & Pick<RawCapture, "id">): RawCapture {
  return {
    packageName: GCASH,
    title: "GCash",
    text: null,
    subText: null,
    bigText: null,
    postedAt: NOW - MINUTE,
    capturedAt: NOW - MINUTE,
    ...overrides,
  };
}

/** A clean GCash send: ₱500.00 out, reference bound, no merchant → 0.95. */
function gcashSend(id: string, overrides: Partial<RawCapture> = {}): RawCapture {
  return capture({
    id,
    text: "You sent ₱500.00 to Juan Dela Cruz. Ref No. ABC123456. Your new balance is ₱1,250.00.",
    ...overrides,
  });
}

async function addMatcher(walletId: string, packageName: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO wallet_matchers (id, wallet_id, package_name, hint, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
    [`m-${packageName}-${walletId}`, walletId, packageName, NOW, NOW],
  );
}

async function ledger(): Promise<Transaction[]> {
  return listTransactions({});
}

/** Committed rows in the order they were written, which is what rule 8 is about. */
async function commitOrder(): Promise<Transaction[]> {
  const rows = await ledger();
  return [...rows].sort((a, b) => a.createdAt - b.createdAt);
}

beforeEach(async () => {
  mockClock();
  db = await freshDb();
  await seedDefaultCategories();
  await seedParserRules();

  clockOffset = 0;
  liveListener = null;
  unsubscribeLive = jest.fn();
  mockDrain.mockReset();
  mockDrain.mockResolvedValue([]);
  mockAddCaptureListener.mockReset();
  mockAddCaptureListener.mockImplementation((listener: (capture: RawCapture) => void) => {
    liveListener = listener;
    return unsubscribeLive;
  });
});

afterEach(async () => {
  await closeDatabase();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The happy path, and the ledger row it produces.
// ---------------------------------------------------------------------------

test("a clean GCash send commits a transaction with source notification", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 175000 });
  await addMatcher(wallet.id, GCASH);

  const outcome = await processCapture(gcashSend("cap-send"));

  expect(outcome).toEqual({ kind: "committed", transactionId: expect.any(String) });

  const rows = await ledger();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    walletId: wallet.id,
    amount: 50000,
    direction: "out",
    source: "notification",
    counterparty: "Juan Dela Cruz",
    referenceNo: "ABC123456",
    occurredAt: NOW - MINUTE,
    // 1.00 exact template, minus the §9.1 merchant-missing penalty. Nothing else.
    confidence: 0.95,
    transferLinkId: null,
  });
  expect(await listOpen()).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// m1c Task 3b — the reported balance-after, end to end.
//
// The parser has always extracted it and the normalizer has always carried it;
// until this task `commit()` dropped it on the floor, because the column and
// the field did not exist. These assert on the COMMITTED ROW produced by a real
// capture, not on a unit call, because "the orchestrator forgot to pass it" is
// exactly the bug that survives a green unit suite.
// ---------------------------------------------------------------------------

test("the balance the provider reported reaches the committed row", async () => {
  // gcashSend's text ends "Your new balance is ₱1,250.00" — 125000 centavos.
  // The wallet is opened at ₱9,000.00, deliberately NOT at a figure the ₱500.00
  // spend could turn into 125000: incrementing lands on 850000, so the two
  // paths can never produce the same answer.
  const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);

  const outcome = await processCapture(gcashSend("cap-balance"));
  expect(outcome.kind).toBe("committed");

  const [row] = await ledger();
  expect(row.balanceAfter).toBe(125000);
  // And the wallet SNAPPED to it rather than moving by the amount.
  const snapped = await getWallet(wallet.id);
  expect(snapped?.balance).toBe(125000);
  expect(snapped?.balance).not.toBe(900000 - 50000);
});

test("the drift the snap absorbed is recoverable from the wallet afterwards", async () => {
  // Rule 3's attention state needs both figures. computed = 900000 - 50000.
  const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);

  await processCapture(gcashSend("cap-drift"));

  // The FIGURES are this test's claim; 003 also returns the reporting and
  // dismissed transaction ids, which the repository's own suite pins exactly.
  expect(await getBalanceDrift(wallet.id)).toMatchObject({
    reported: 125000,
    computed: 850000,
    drift: -725000,
  });
});

test("a provider notification with no balance in its text commits with balanceAfter null", async () => {
  // Most notifications do not report one, and the ordinary computed path has to
  // stay exactly as it was for them. Same GCash template, balance clause absent.
  const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);

  await processCapture(
    gcashSend("cap-no-balance", {
      text: "You sent ₱500.00 to Juan Dela Cruz. Ref No. ABC123456.",
    }),
  );

  const [row] = await ledger();
  expect(row.balanceAfter).toBeNull();
  expect((await getWallet(wallet.id))?.balance).toBe(850000);
  expect(await getBalanceDrift(wallet.id)).toBeNull();
});

test("a committed transaction carries a resolvable rawNotificationRef", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);
  const raw = gcashSend("cap-ref");

  await processCapture(raw);

  const [row] = await ledger();
  expect(row.rawNotificationId).toBe("cap-ref");
  // "Why was this recorded?" has to be answerable from the committed row alone.
  expect(await getRawCapture(row.rawNotificationId as string)).toEqual(raw);
});

test("a successful commit announces itself on ledger:committed", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);
  const announced: string[] = [];
  const off = onAppEvent("ledger:committed", (payload) => {
    announced.push(payload.transactionId);
  });

  const outcome = await processCapture(gcashSend("cap-event"));
  off();

  const [row] = await ledger();
  expect(outcome).toEqual({ kind: "committed", transactionId: row.id });
  // Rule 7 — M2's limit engine recomputes off this, so it fires once, after the
  // row exists, and carries the id of the row that was actually written.
  expect(announced).toEqual([row.id]);
});

test("a queued capture announces nothing — the ledger did not change", async () => {
  await createWallet({ name: "GCash", type: "e-wallet" });
  const announced: string[] = [];
  const off = onAppEvent("ledger:committed", (payload) => {
    announced.push(payload.transactionId);
  });

  await processCapture(capture({ id: "cap-quiet", packageName: CHAT, text: "Pautang ₱200.00" }));
  off();

  expect(announced).toEqual([]);
});

// ---------------------------------------------------------------------------
// Everything that must NOT reach the ledger.
// ---------------------------------------------------------------------------

test("a low-confidence parse is queued and commits nothing", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank" });
  await addMatcher(wallet.id, MESSAGES);

  const outcome = await processCapture(
    capture({
      id: "cap-sms",
      packageName: MESSAGES,
      title: "BPI",
      text: "BPI: Your account was debited PHP500.00 at SM Store. Ref No. SMS1234567.",
    }),
  );

  // 0.70 partial template, minus the SMS-channel penalty = 0.65 → prefilled.
  expect(outcome).toEqual({ kind: "queued", reviewItemId: expect.any(String) });
  expect(await ledger()).toHaveLength(0);

  const open = await listOpen();
  expect(open).toHaveLength(1);
  expect(open[0].kind).toBe("low-confidence");
  expect(open[0].rawNotificationId).toBe("cap-sms");
  expect(open[0].payload).toMatchObject({ amount: 50000, direction: "out", confidence: 0.65 });
});

test("malformed text from a known provider is ignored as unreadable, never queued", async () => {
  // UPDATED 2026-08-20 (review-floor amendment): this used to assert the card
  // was queued. A matched provider with nothing readable in the text scores
  // 0 with no parsed amount, which is now at-or-below `reviewFloorThreshold`
  // (0.5) with `hasAmount: false` — the exact "discard" case, not a review
  // case. See "a capture from a known provider that parses to nothing is
  // ignored rather than queued" below for the same behaviour asserted from
  // scratch, and its neighbour for proof the raw capture still survives.
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);

  const outcome = await processCapture(
    capture({
      id: "cap-garbled",
      text: "Your GCash transaction of ₱500.00 could not be completed at this time.",
    }),
  );

  expect(outcome).toEqual({ kind: "ignored", reason: "unreadable" });
  expect(await ledger()).toHaveLength(0);
  expect(await listOpen()).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// The review floor (§9.2 amendment, 2026-08-20) — an unreadable capture from
// a recognized provider must not fill the Review Queue with cards carrying
// nothing to act on, but the raw capture must still be recoverable.
// ---------------------------------------------------------------------------

test("a capture from a known provider that parses to nothing is ignored rather than queued", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);

  const outcome = await processCapture(
    capture({
      id: "cap-unreadable",
      text: "Your GCash transaction of ₱500.00 could not be completed at this time.",
    }),
  );

  expect(outcome).toEqual({ kind: "ignored", reason: "unreadable" });
  expect(await ledger()).toHaveLength(0);
  expect(await listOpen()).toHaveLength(0);
});

test("the raw capture survives being ignored", async () => {
  // This is what makes the discard safe — the raw capture stays visible in
  // the Privacy Centre for its full 30-day TTL even though no card was made.
  // Pinned rather than assumed: it is the one fact that separates "ignored,
  // no card" from "the evidence was destroyed".
  await createWallet({ name: "GCash", type: "e-wallet" });
  const raw = capture({
    id: "cap-unreadable-raw",
    text: "Your GCash transaction of ₱500.00 could not be completed at this time.",
  });

  await processCapture(raw);

  expect(await getRawCapture("cap-unreadable-raw")).toEqual(raw);
});

test("the raw capture is stored even when the parse fails", async () => {
  await createWallet({ name: "GCash", type: "e-wallet" });
  const raw = capture({ id: "cap-unparsed", text: "GCash: ₱500.00 something went wrong." });

  await processCapture(raw);

  // Plan rule 2 — the transparency view has to have something to show.
  expect(await getRawCapture("cap-unparsed")).toEqual(raw);
});

test("an unknown provider with a money signal is queued", async () => {
  await createWallet({ name: "GCash", type: "e-wallet" });

  const outcome = await processCapture(
    capture({ id: "cap-unknown", packageName: CHAT, title: "Ana", text: "Pautang naman ₱200.00" }),
  );

  // Plan rule 4: queued, NOT ignored. `ignored: "unknown-provider"` is reserved
  // for a package the user has already dismissed.
  expect(outcome.kind).toBe("queued");
  const open = await listOpen();
  expect(open[0].kind).toBe("unknown-provider");
  expect(open[0].rawNotificationId).toBe("cap-unknown");
  // §3 rule 4: the unknown bin keeps the text so the user can flag it.
  expect(await getRawCapture("cap-unknown")).not.toBeNull();
});

test("an unknown provider with no money signal is ignored and nothing is stored", async () => {
  await createWallet({ name: "GCash", type: "e-wallet" });

  const outcome = await processCapture(
    capture({ id: "cap-chat", packageName: CHAT, title: "Ana", text: "Kain tayo mamaya!" }),
  );

  expect(outcome).toEqual({ kind: "ignored", reason: "not_financial" });
  // §1 principle 2 / §3 rule 3: a private message never touches the database.
  expect(await getRawCapture("cap-chat")).toBeNull();
  expect(await listOpen()).toHaveLength(0);
  expect(await ledger()).toHaveLength(0);
});

test("a money-like notification from a dismissed package is ignored, not re-queued", async () => {
  await createWallet({ name: "GCash", type: "e-wallet" });
  await createUserRule({ matcher: { providerKey: CHAT }, action: { kind: "ignore" } });

  const outcome = await processCapture(
    capture({ id: "cap-dismissed", packageName: CHAT, text: "Promo! Only ₱99.00 today" }),
  );

  // The other half of plan rule 4 — the user already said "not money".
  expect(outcome).toEqual({ kind: "ignored", reason: "unknown-provider" });
  expect(await getRawCapture("cap-dismissed")).toBeNull();
  expect(await listOpen()).toHaveLength(0);
});

test("a capture while paused is ignored before parsing", async () => {
  await createWallet({ name: "GCash", type: "e-wallet" });
  await setSetting("capture_enabled", false);

  const outcome = await processCapture(gcashSend("cap-paused"));

  expect(outcome).toEqual({ kind: "ignored", reason: "paused" });
  expect(await getRawCapture("cap-paused")).toBeNull();
  expect(await ledger()).toHaveLength(0);
  expect(await listOpen()).toHaveLength(0);
});

test("an unmapped wallet is a hard route to the queue however clean the parse", async () => {
  // Two open wallets and no matcher: the Normalizer refuses to guess (§5).
  await createWallet({ name: "GCash", type: "e-wallet" });
  await createWallet({ name: "Maya", type: "e-wallet" });

  const outcome = await processCapture(gcashSend("cap-nowallet"));

  expect(outcome.kind).toBe("queued");
  expect(await ledger()).toHaveLength(0);
  const open = await listOpen();
  expect(open[0].kind).toBe("low-confidence");
  expect(open[0].payload).toMatchObject({ walletId: null, confidence: 0.95 });
});

// ---------------------------------------------------------------------------
// Diagnostics must never cost the user a transaction.
//
// `recordParseResult` is a local, content-free counter (see
// lib/diagnostics/parse_stats_repo.ts) — a nice-to-have, never a gate. If its
// write throws (SQLite busy, disk error, anything transient) the exception
// must not propagate out of the pipeline: by the time it runs, the capture is
// already durable in `raw_notifications`, so a caller that swallowed the
// exception (`runGuarded`, `processStored`) would leave `hasRawCapture`
// treating any redelivery as a duplicate — the real transaction is lost
// forever so a counter could be incremented.
// ---------------------------------------------------------------------------

test("a recordParseResult failure never costs the user their transaction", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);
  const spy = jest
    .spyOn(parseStatsRepo, "recordParseResult")
    .mockRejectedValueOnce(new Error("disk is busy"));

  const outcome = await processCapture(gcashSend("cap-diag-fail"));

  expect(outcome).toEqual({ kind: "committed", transactionId: expect.any(String) });
  expect(await ledger()).toHaveLength(1);
  spy.mockRestore();
});

test("a recordParseResult failure still lets a low-confidence parse reach the review queue", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank" });
  await addMatcher(wallet.id, MESSAGES);
  const spy = jest
    .spyOn(parseStatsRepo, "recordParseResult")
    .mockRejectedValueOnce(new Error("disk is busy"));

  const outcome = await processCapture(
    capture({
      id: "cap-diag-fail-queue",
      packageName: MESSAGES,
      title: "BPI",
      text: "BPI: Your account was debited PHP500.00 at SM Store. Ref No. SMS1234567.",
    }),
  );

  expect(outcome).toEqual({ kind: "queued", reviewItemId: expect.any(String) });
  spy.mockRestore();
});

// ---------------------------------------------------------------------------
// Rule 11 — replay suppression by capture id, and its other half.
// ---------------------------------------------------------------------------

test("the same RawCapture processed twice commits exactly one transaction", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);
  const replayed = gcashSend("cap-replay");

  const first = await processCapture(replayed);
  const second = await processCapture(replayed);

  expect(first.kind).toBe("committed");
  // The native drain is at-least-once by design; a replay must cost nothing.
  expect(second).toEqual({ kind: "ignored", reason: "duplicate" });
  expect(await ledger()).toHaveLength(1);
  expect(await listOpen()).toHaveLength(0);
});

test("two distinct captures with identical amount, channel and timing still reach the DedupeGate", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);
  const text = "You paid ₱100.00 to Aling Nena via QR";

  const first = await processCapture(capture({ id: "cap-qr-a", text }));
  const second = await processCapture(capture({ id: "cap-qr-b", text }));

  expect(first.kind).toBe("committed");
  // The id check must NOT have swallowed this. Two different captures with no
  // reference number, on one channel, inside the twin window are §6 rule 4's
  // undecidable pair — the gate escalates them, it does not suppress them. An
  // over-applied id check would have returned `ignored: "duplicate"` here and
  // silently eaten a second, genuine ₱100.00 purchase.
  expect(second.kind).toBe("queued");
  const open = await listOpen();
  expect(open[0].kind).toBe("possible-duplicate");
  expect(open[0].payload).toMatchObject({ duplicateOfTransactionId: expect.any(String) });
  expect(await ledger()).toHaveLength(1);
});

test("a push and SMS twin commits once", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank" });
  await addMatcher(wallet.id, BPI);
  await addMatcher(wallet.id, MESSAGES);
  await upsertRuleset(TWIN_BUNDLE);

  const push = await processCapture(
    capture({
      id: "cap-push",
      packageName: BPI,
      text: "Your account was debited ₱750.00. Ref No. BPI556677.",
    }),
  );
  const sms = await processCapture(
    capture({
      id: "cap-sms-twin",
      packageName: MESSAGES,
      title: "BPI",
      text: "BPI: Your account was debited ₱750.00. Ref No. BPI556677.",
      postedAt: NOW - MINUTE + 20_000,
    }),
  );

  expect(push.kind).toBe("committed");
  // Rule 1's strong key: same provider, same reference, same amount, same
  // direction, inside 48 hours — regardless of channel. The channel is the
  // thing the RecentEvent join has to supply, and `Transaction` does not carry.
  expect(sms).toEqual({ kind: "ignored", reason: "duplicate" });
  expect(await ledger()).toHaveLength(1);
  expect(await listOpen()).toHaveLength(0);
});

test("a hand-typed entry never suppresses a real notification of the same amount", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 200000 });
  await addMatcher(wallet.id, GCASH);
  // No rawNotificationId — the RecentEvent join must report providerKey: null
  // and channel: null for this row, and the gate treats nulls as never-matching.
  await insertTransaction({
    walletId: wallet.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 50000,
    direction: "out",
    occurredAt: NOW - MINUTE,
    source: "manual",
    confidence: 1,
  });

  const outcome = await processCapture(gcashSend("cap-vs-manual"));

  expect(outcome.kind).toBe("committed");
  expect(await ledger()).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Transfers.
// ---------------------------------------------------------------------------

test("an internal transfer between two wallets auto-links both legs", async () => {
  const bank = await createWallet({ name: "BPI", type: "bank", openingBalance: 500000 });
  const ewallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(bank.id, BPI);
  await addMatcher(ewallet.id, GCASH);

  const outLeg = await processCapture(
    capture({
      id: "cap-out",
      packageName: BPI,
      text: "Your account has been debited ₱1,000.00. Ref No. TRF0001.",
    }),
  );
  const inLeg = await processCapture(
    capture({
      id: "cap-in",
      text: "Cash In of ₱1,000.00 from BPI was successful. Ref No. TRF0002.",
      postedAt: NOW - MINUTE + 60_000,
    }),
  );

  expect(outLeg.kind).toBe("committed");
  expect(inLeg.kind).toBe("committed");

  const rows = await ledger();
  expect(rows).toHaveLength(2);
  const linkIds = rows.map((row) => row.transferLinkId);
  expect(linkIds[0]).not.toBeNull();
  expect(new Set(linkIds).size).toBe(1);

  const link = await getTransferLink(linkIds[0] as string);
  expect(link).toMatchObject({ detectedBy: "auto", feeAmount: 0, status: "active" });
  expect(link?.confidence).toBe(0.95);

  // Domain invariant I2 / plan rule 6: an internal shuffle inflates nothing,
  // and the fee (zero here, because auto-link requires an exact match) is never
  // a spend of its own.
  expect(await sumSpend({ from: NOW - DAY, to: NOW + DAY })).toBe(0);
});

test("an ambiguous transfer is queued instead of linked", async () => {
  const bank = await createWallet({ name: "BPI", type: "bank", openingBalance: 500000 });
  const ewallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(bank.id, BPI);
  await addMatcher(ewallet.id, GCASH);

  await processCapture(
    capture({
      id: "cap-out-fee",
      packageName: BPI,
      text: "Your account has been debited ₱1,000.00. Ref No. TRF0003.",
    }),
  );
  // ₱10.00 short: inside the fee tolerance, so a plausible pair — but §7 rule
  // 3.2 never links a fee-tolerant candidate without asking.
  const inLeg = await processCapture(
    capture({
      id: "cap-in-fee",
      text: "Cash In of ₱990.00 from BPI was successful. Ref No. TRF0004.",
      postedAt: NOW - MINUTE + 60_000,
    }),
  );

  expect(inLeg.kind).toBe("queued");
  const open = await listOpen();
  expect(open[0].kind).toBe("ambiguous-transfer");
  expect(open[0].payload).toMatchObject({ transferCounterpartTransactionId: expect.any(String) });

  expect(await ledger()).toHaveLength(1);
  const links = await db.getAllAsync("SELECT * FROM transfer_links");
  expect(links).toHaveLength(0);
});

test("a rival moving the same way as the event still demotes an otherwise perfect pair", async () => {
  const bank = await createWallet({ name: "BPI", type: "bank", openingBalance: 500000 });
  const ewallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(bank.id, BPI);
  await addMatcher(ewallet.id, GCASH);

  // One out-leg, committed while nothing could pair with it.
  await processCapture(
    capture({
      id: "cap-rival-out",
      packageName: BPI,
      text: "Your account has been debited ₱1,000.00. Ref No. TRF0005.",
    }),
  );
  // A second ₱1,000.00 IN-leg, moving the SAME way as the event below. It is
  // not a candidate for the event (two `in` legs are not a transfer) — it is a
  // rival for the event's counterpart, which now has two possible partners.
  //
  // THIS IS THE TEST THAT CATCHES A DIRECTION PRE-FILTER on `candidates`. Drop
  // same-direction rows before calling `detectTransfer` and this row vanishes,
  // §7 rule 4's "no competing candidate for EITHER leg" quietly stops working,
  // and the pipeline silently links a coin-flip pairing — hiding a real expense
  // and a real income at once, with no row to inspect.
  await insertTransaction({
    walletId: ewallet.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 100000,
    direction: "in",
    occurredAt: NOW - MINUTE + 30_000,
    source: "notification",
    confidence: 0.95,
  });

  const inLeg = await processCapture(
    capture({
      id: "cap-rival-in",
      text: "Cash In of ₱1,000.00 from BPI was successful. Ref No. TRF0006.",
      postedAt: NOW - MINUTE + 60_000,
    }),
  );

  expect(inLeg.kind).toBe("queued");
  expect((await listOpen())[0].kind).toBe("ambiguous-transfer");
  const links = await db.getAllAsync("SELECT * FROM transfer_links");
  expect(links).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// The confidence arithmetic the orchestrator itself owns.
// ---------------------------------------------------------------------------

test("0.95 minus a 0.05 learned penalty still auto-commits", async () => {
  const wallet = await createWallet({ name: "BPI", type: "bank", openingBalance: 500000 });
  await addMatcher(wallet.id, MESSAGES);
  await upsertRuleset(LEARNED_BUNDLE);
  for (const index of [1, 2, 3]) {
    await insertTransaction({
      walletId: wallet.id,
      categoryId: "cat_groceries_palengke",
      amount: 10000 + index,
      direction: "out",
      occurredAt: NOW - 10 * DAY,
      merchant: "Aling Nena Store",
      source: "notification",
      confidence: 1,
    });
  }

  const outcome = await processCapture(
    capture({
      id: "cap-learned",
      packageName: MESSAGES,
      title: "TESTBANK",
      text: "TESTBANK: Your card was debited ₱250.00 at Aling Nena Store.",
    }),
  );

  expect(outcome.kind).toBe("committed");
  const committed = (await ledger()).find((row) => row.amount === 25000);
  // 1.00 exact template − 0.05 SMS channel = 0.95, − 0.05 learned = EXACTLY
  // 0.90. Subtract those naively and IEEE-754 answers 0.8999999999999999,
  // which is below the auto-commit threshold: a clean commit becomes a Review
  // Queue card, on rounding dust alone.
  expect(committed?.confidence).toBe(0.9);
  expect(committed?.categoryId).toBe("cat_groceries_palengke");
  expect(await listOpen()).toHaveLength(0);
});

test("a user rule outranks the merchant map and costs no confidence", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);
  await createUserRule({
    matcher: { merchantPattern: "jollibee" },
    action: { kind: "set-category", categoryId: "cat_entertainment_subscriptions" },
  });

  const outcome = await processCapture(
    capture({ id: "cap-rule", text: "You paid ₱250.00 to Jollibee via QR" }),
  );

  expect(outcome.kind).toBe("committed");
  const [row] = await ledger();
  expect(row.categoryId).toBe("cat_entertainment_subscriptions");
  expect(row.confidence).toBe(1);
});

// ---------------------------------------------------------------------------
// startIngest — rules 8 and 10, and crash isolation.
// ---------------------------------------------------------------------------

test("startIngest drains buffered captures before live ones, in postedAt order", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);
  // Handed back out of order, exactly as an unordered native buffer would.
  mockDrain.mockResolvedValue([
    gcashSend("buf-3", { text: sendText("300.00", "REF0003"), postedAt: NOW - 3 * MINUTE }),
    gcashSend("buf-1", { text: sendText("100.00", "REF0001"), postedAt: NOW - 5 * MINUTE }),
    gcashSend("buf-2", { text: sendText("200.00", "REF0002"), postedAt: NOW - 4 * MINUTE }),
  ]);

  const stop = await startIngest();
  // Older than every buffered capture, and still must commit last: rule 8 is
  // about the order they are PROCESSED, not the order they happened.
  liveListener?.(gcashSend("live-0", { text: sendText("900.00", "REF0009"), postedAt: NOW - 9 * MINUTE }));
  await __awaitIngestIdle();

  const rows = await commitOrder();
  expect(rows.map((row) => row.amount)).toEqual([10000, 20000, 30000, 90000]);

  stop();
  expect(unsubscribeLive).toHaveBeenCalledTimes(1);
});

test("a crash after drainPendingCaptures loses nothing", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);
  // A UserRule pointing at a category that no longer exists: the categorizer
  // returns it happily and `insertTransaction` dies on the foreign key. One
  // malformed row, mid-batch, exactly as a real corrupt rule would behave.
  await createUserRule({
    matcher: { merchantPattern: "ghost" },
    action: { kind: "set-category", categoryId: "cat_deleted_by_user" },
  });
  mockDrain.mockResolvedValue([
    capture({ id: "buf-bad", text: "You paid ₱111.00 to Ghost Store via QR", postedAt: NOW - 5 * MINUTE }),
    gcashSend("buf-ok-1", { text: sendText("200.00", "REF0002"), postedAt: NOW - 4 * MINUTE }),
    gcashSend("buf-ok-2", { text: sendText("300.00", "REF0003"), postedAt: NOW - 3 * MINUTE }),
  ]);

  const stop = await startIngest();
  await __awaitIngestIdle();

  // Rule 10: the drain emptied the native buffer, so this table is the ONLY
  // copy. Every capture in the batch has to be here even though processing the
  // first one blew up.
  for (const id of ["buf-bad", "buf-ok-1", "buf-ok-2"]) {
    expect(await getRawCapture(id)).not.toBeNull();
  }
  // And the failure was isolated: one bad row does not take the batch with it.
  expect((await ledger()).map((row) => row.amount).sort((a, b) => a - b)).toEqual([20000, 30000]);
  stop();
});

test("a stage throwing leaves the capture readable and reprocessable", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);
  await createUserRule({
    matcher: { merchantPattern: "ghost" },
    action: { kind: "set-category", categoryId: "cat_deleted_by_user" },
  });
  const raw = capture({ id: "cap-throw", text: "You paid ₱111.00 to Ghost Store via QR" });

  await expect(processCapture(raw)).rejects.toThrow();

  // The raw row is written before any stage runs, so the capture survives its
  // own crash — nothing is silently gone.
  expect(await getRawCapture("cap-throw")).toEqual(raw);
  expect(await ledger()).toHaveLength(0);
});

test("a failing drain still subscribes to live captures", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);
  // The bridge rejects when the app is outside the Keystore auth window; the
  // captures are still in the native buffer, so this costs nothing — but
  // dropping the live subscription would stop tracking until the next launch.
  mockDrain.mockRejectedValue(new Error("authentication is required"));

  const stop = await startIngest();
  liveListener?.(gcashSend("live-after-failed-drain"));
  await __awaitIngestIdle();

  expect(await ledger()).toHaveLength(1);
  stop();
});

test("startIngest leaves the native buffer alone while capture is paused", async () => {
  await createWallet({ name: "GCash", type: "e-wallet" });
  await setSetting("capture_enabled", false);

  const stop = await startIngest();
  await __awaitIngestIdle();

  // Draining is destructive. Doing it while paused would move the buffered
  // captures into a table the pipeline then refuses to process, and rule 11
  // would call them replays forever after.
  expect(mockDrain).not.toHaveBeenCalled();
  expect(await ledger()).toHaveLength(0);
  stop();
});

test("a replayed batch after a crash re-commits nothing", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);
  const batch = [
    gcashSend("buf-a", { text: sendText("100.00", "REF00A"), postedAt: NOW - 5 * MINUTE }),
    gcashSend("buf-b", { text: sendText("200.00", "REF00B"), postedAt: NOW - 4 * MINUTE }),
  ];
  mockDrain.mockResolvedValue(batch);

  const first = await startIngest();
  await __awaitIngestIdle();
  first();

  // The identical batch comes back: the buffer read succeeded but the delete
  // did not (M1a Task 3 chose at-least-once deliberately).
  mockDrain.mockResolvedValue(batch);
  const second = await startIngest();
  await __awaitIngestIdle();
  second();

  expect(await ledger()).toHaveLength(2);
});

test("an already-stored capture is not reprocessed from the buffer", async () => {
  const wallet = await createWallet({ name: "GCash", type: "e-wallet" });
  await addMatcher(wallet.id, GCASH);
  const raw = gcashSend("buf-known");
  await storeRawCapture(raw, NOW);
  mockDrain.mockResolvedValue([raw]);

  const stop = await startIngest();
  await __awaitIngestIdle();

  expect(await ledger()).toHaveLength(0);
  stop();
});

// ---------------------------------------------------------------------------
// Fixtures that need the types imported above.
// ---------------------------------------------------------------------------

function sendText(pesos: string, reference: string): string {
  return `You sent ₱${pesos} to Juan Dela Cruz. Ref No. ${reference}.`;
}

const DEBIT_WITH_REF = String.raw`\bdebited (?<amount>(?:₱|PHP|Php)\s?[\d,]+(?:\.\d{2})?)(?!\.?\d)(?:[\s\S]*?\bRef\b\.?\s?(?:No\.?)?\s?(?<ref>[A-Za-z0-9]{6,}))?`;

/**
 * One bank reachable on two channels — the shape §6 rule 2's twin window is
 * written for. The shipped seed cannot express this: its SMS coverage is a
 * single `sms_relay` provider standing in for every bank, so a BPI push
 * (`providerKey: "bpi"`) and its SMS relay (`providerKey: "sms_relay"`) never
 * compare as the same provider and the twin can never be suppressed. Worth
 * fixing in the seed; not fixable from the orchestrator.
 */
const TWIN_BUNDLE: RulesetBundleInput = {
  version: 2,
  providers: [
    {
      providerKey: "bpi",
      packageNames: [BPI],
      version: 2,
      channel: "push",
      templates: [{ id: "bpi_push_debit", match: DEBIT_WITH_REF, direction: "out", confidence: 1 }],
    },
    {
      providerKey: "bpi",
      packageNames: [MESSAGES],
      version: 2,
      channel: "sms",
      senderIds: ["BPI"],
      templates: [{ id: "bpi_sms_debit", match: DEBIT_WITH_REF, direction: "out", confidence: 1 }],
    },
  ],
};

/**
 * An SMS-channel provider whose template binds a merchant and matches exactly.
 * That combination is what produces a base of precisely 0.95 (1.00 − the 0.05
 * SMS penalty, with no merchant penalty to pay), which is the only score at
 * which the learned category's 0.05 lands exactly on the auto-commit threshold.
 */
const LEARNED_BUNDLE: RulesetBundleInput = {
  version: 2,
  providers: [
    {
      providerKey: "testbank",
      packageNames: [MESSAGES],
      version: 2,
      channel: "sms",
      senderIds: ["TESTBANK"],
      templates: [
        {
          id: "testbank_debit",
          match: String.raw`\bdebited (?<amount>(?:₱|PHP|Php)\s?[\d,]+(?:\.\d{2})?)(?!\.?\d) at (?<merchant>[^.,\n]{1,48}?)(?=\.|,|$)`,
          direction: "out",
          confidence: 1,
        },
      ],
    },
  ],
};
