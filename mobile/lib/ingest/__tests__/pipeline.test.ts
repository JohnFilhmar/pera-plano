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
import * as rawNotificationsRepo from "@/lib/db/repos/raw_notifications_repo";
import * as transactionsRepo from "@/lib/db/repos/transactions_repo";
import { createLoan, outstandingBalance } from "@/lib/db/repos/loans_repo";
import { createUserRule } from "@/lib/db/repos/user_rules_repo";
import { createWallet, getBalanceDrift, getWallet } from "@/lib/db/repos/wallets_repo";
import {
  getTraitEvidence,
  recordTraitEvidence,
  setWalletOwed,
} from "@/lib/db/repos/wallet_traits_repo";
import { answerWalletKind, correctItem, mergeDuplicate } from "@/lib/review/resolve_actions";
import { onAppEvent } from "@/lib/events/app_events";
import { freshDb } from "@/test_support/db";
import {
  getRawCapture,
  isRawCaptureUnreferenced,
  storeRawCapture,
} from "@/lib/db/repos/raw_notifications_repo";
import { getTransferLink } from "@/lib/db/repos/transfer_links_repo";
import { insertTransaction, listTransactions, sumSpend } from "@/lib/db/repos/transactions_repo";
import { listOpen } from "@/lib/db/repos/review_queue_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { seedParserRules } from "@/lib/ingest/seed_rules";
import { setSetting } from "@/lib/db/repos/app_settings_repo";
import { attachCounterpartLeg } from "@/lib/transfers/transfer_service";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { __awaitIngestIdle, __resetIngestFailures, processCapture, startIngest } from "../pipeline";
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
    // Explicitly null rather than omitted, so a fixture compares equal to the
    // same capture read back out of the database — `rowToRawCapture` always
    // produces the field, and most notifications in these tests are not about
    // redelivery at all (migration 018).
    notificationKey: null,
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

/** `addMatcher`, named by provider rather than by raw package for the one-sided-transfer tests. */
const PACKAGE_BY_PROVIDER: Record<string, string> = { gcash: GCASH };

async function seedWalletMatcher(provider: keyof typeof PACKAGE_BY_PROVIDER, walletId: string): Promise<void> {
  await addMatcher(walletId, PACKAGE_BY_PROVIDER[provider]);
}

let captureSeq = 0;

/** A GCash capture with a fresh id, for tests that only care about the text. */
function gcashCapture(overrides: Partial<RawCapture> = {}): RawCapture {
  captureSeq += 1;
  return capture({ id: `cap-one-sided-${captureSeq}`, ...overrides });
}

async function ledger(): Promise<Transaction[]> {
  return listTransactions({});
}

/** `listOpen`, named to match the review-queue-reading tests below. */
async function listOpenReviewItems() {
  return listOpen();
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
  // The pipeline's poison-pill counter lives in the module, not the database,
  // so a fresh schema does not clear it and one test's failures would count
  // toward the next test's ceiling.
  __resetIngestFailures();

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
  const wallet = await createWallet({ name: "GCash", openingBalance: 175000 });
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
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
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
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
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
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
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
  const wallet = await createWallet({ name: "GCash" });
  await addMatcher(wallet.id, GCASH);
  const raw = gcashSend("cap-ref");

  await processCapture(raw);

  const [row] = await ledger();
  expect(row.rawNotificationId).toBe("cap-ref");
  // "Why was this recorded?" has to be answerable from the committed row alone.
  expect(await getRawCapture(row.rawNotificationId as string)).toEqual(raw);
});

test("a successful commit announces itself on ledger:committed", async () => {
  const wallet = await createWallet({ name: "GCash" });
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

test("A COMMITTED CAPTURE IS SCORED AGAINST OPEN LOANS", async () => {
  // docs/04-features/06-loans.md §"Flow: automatic payment matching from the
  // ledger" step 1: "After a Transaction commits to the ledger, the matcher
  // scores it against open loans." This is the WIRING — the matcher's own rules
  // are covered in lib/loans/__tests__/loan_match_queue.test.ts; what only an
  // integration test can catch is that a real capture, through all nine stages,
  // actually reaches it.
  //
  // `gcashSend` is ₱500.00 out to "Juan Dela Cruz", so the loan below agrees
  // with it on the counterparty (rule 8c) and on the amount against its
  // outstanding balance (rule 8d) — the two signals a free-form utang has.
  const wallet = await createWallet({ name: "GCash" });
  await addMatcher(wallet.id, GCASH);
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Juan Dela Cruz",
    principal: 50000,
  });

  await processCapture(gcashSend("cap-loan-match"));

  const [row] = await ledger();
  const items = (await listOpen()).filter((item) => item.kind === "loan-match");
  expect(items).toHaveLength(1);
  expect(items[0].payload.transactionId).toBe(row.id);
  // A SUGGESTION, NOT A MATCH (spec rule 9): only an explicit provider loan
  // event may auto-match, and none is modelled. The balance must not have moved.
  expect(await outstandingBalance(loan.id)).toBe(50000);
});

test("a matcher failure never costs the commit", async () => {
  // The money moved; the row is already durable by the time the matcher runs.
  // `runStages` sits under two silent catches (`processStored`, `runGuarded`),
  // so an escaping error here would look exactly like the capture failing to
  // process — and the capture would be treated as a replay forever after.
  const wallet = await createWallet({ name: "GCash" });
  await addMatcher(wallet.id, GCASH);
  await createLoan({ direction: "i-owe", counterparty: "Juan Dela Cruz", principal: 50000 });
  await db.execAsync("DROP TABLE review_queue_items;");
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  const outcome = await processCapture(gcashSend("cap-loan-broken"));
  warn.mockRestore();

  const [row] = await ledger();
  expect(outcome).toEqual({ kind: "committed", transactionId: row.id });
});

test("a queued capture announces nothing — the ledger did not change", async () => {
  await createWallet({ name: "GCash" });
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
  const wallet = await createWallet({ name: "BPI" });
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

test("malformed text from a known provider is ignored as unreadable, never thrown", async () => {
  // UPDATED 2026-08-20 (review-floor amendment): this used to assert the card
  // was queued. A matched provider with nothing readable in the text scores
  // 0 with no parsed amount, which is now at-or-below `reviewFloorThreshold`
  // (0.5) with `hasAmount: false` — the exact "discard" case, not a review
  // case. See "a capture from a known provider that parses to nothing is
  // ignored rather than queued" below for the same behaviour asserted from
  // scratch, and its neighbour for proof the raw capture still survives.
  //
  // THIS TEST'S OWN VALUE, DISTINCT FROM THOSE TWO: pinning that a garbled
  // provider match resolves rather than rejects — never throws out of a
  // background notification handler — the same "never thrown" guarantee the
  // test's original name made before this task's rename.
  // `.resolves.toEqual` states that directly, matching the guarantee's own
  // wording, rather than leaving it implicit in a bare `await` the way the
  // two tests below (which are about the ROUTE, not the throw) do.
  const wallet = await createWallet({ name: "GCash" });
  await addMatcher(wallet.id, GCASH);

  await expect(
    processCapture(
      capture({
        id: "cap-garbled",
        text: "Your GCash transaction of ₱500.00 could not be completed at this time.",
      }),
    ),
  ).resolves.toEqual({ kind: "ignored", reason: "unreadable" });
  expect(await ledger()).toHaveLength(0);
  expect(await listOpen()).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// The review floor (§9.2 amendment, 2026-08-20) — an unreadable capture from
// a recognized provider must not fill the Review Queue with cards carrying
// nothing to act on, but the raw capture must still be recoverable.
// ---------------------------------------------------------------------------

test("a capture from a known provider that parses to nothing is ignored rather than queued", async () => {
  const wallet = await createWallet({ name: "GCash" });
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
  //
  // THE OUTCOME IS ASSERTED HERE TOO, not only `getRawCapture` below. Without
  // it this test would pass identically whether the capture was discarded OR
  // queued — a `low-confidence` card also leaves the raw row intact — so it
  // would never go red if the discard path regressed back to queuing. Pinning
  // `{ kind: "ignored", reason: "unreadable" }` first is what ties this
  // retention property to the DISCARD path specifically.
  await createWallet({ name: "GCash" });
  const raw = capture({
    id: "cap-unreadable-raw",
    text: "Your GCash transaction of ₱500.00 could not be completed at this time.",
  });

  const outcome = await processCapture(raw);

  expect(outcome).toEqual({ kind: "ignored", reason: "unreadable" });
  expect(await getRawCapture("cap-unreadable-raw")).toEqual(raw);
});

test("a genuine ₱0.00 capture below the floor is queued, never discarded", async () => {
  // WHAT THIS PINS: that a genuine ₱0.00 notification survives ingest as a
  // real card carrying `amount: 0`, which is the input the Review Queue's own
  // zero-amount guard is written against. Nothing in this suite exercised a
  // ₱0.00 notification before, so the two halves of that story — the parser
  // treating `0` as a legitimate amount, and the review floor refusing to
  // throw it away — were only ever reasoned about, never driven end to end.
  //
  // The template vouches for itself at exactly the shipped
  // `reviewFloorThreshold` (0.5), so the score (0.45 after the merchant-missing
  // penalty) genuinely lands in the DISCARD band rather than merely being
  // assumed to; the wallet is mapped, so no hard route rescues the capture
  // either. It reaches the queue on the strength of having parsed an amount.
  //
  // WHAT THIS DOES NOT PIN, stated so nobody reads more into it: NOT
  // `pipeline.ts`'s literal `hasAmount: true`. Verified by mutation — writing
  // that field as `event.amount > 0` leaves this test green, because the
  // parsed path queues on `decision.route !== "auto_commit"` and so cannot act
  // on a `discard` verdict at all; both spellings produce a byte-identical
  // payload, `GATE_REASONS.unreadable` reason included. That literal is a
  // truthfulness fix, not a data-safety one, exactly as its own comment says.
  // What DOES turn this red is `amount.ts` ceasing to treat `0` as a real
  // amount: the parse then fails and the capture is discarded as unreadable
  // (confirmed by mutation before this test was committed).
  await upsertRuleset(ZERO_FLOOR_BUNDLE);
  const wallet = await createWallet({ name: "GCash" });
  await addMatcher(wallet.id, GCASH);

  const outcome = await processCapture(
    capture({ id: "cap-zero-peso", text: "You sent ₱0.00 to Juan Dela Cruz." }),
  );

  expect(outcome).toEqual({ kind: "queued", reviewItemId: expect.any(String) });
  const open = await listOpen();
  expect(open).toHaveLength(1);
  expect(open[0].kind).toBe("low-confidence");
  // `amount: 0` verbatim in the payload — this is what `review_card.tsx`
  // renders as ₱0.00 and what its `missingLedgerField` guard then refuses to
  // let the primary commit, because the ledger's own `CHECK (amount > 0)`
  // would reject the row.
  expect(open[0].payload).toMatchObject({ amount: 0, direction: "out" });
  expect(await ledger()).toHaveLength(0);
});

test("the raw capture is stored even when the parse fails", async () => {
  await createWallet({ name: "GCash" });
  const raw = capture({ id: "cap-unparsed", text: "GCash: ₱500.00 something went wrong." });

  await processCapture(raw);

  // Plan rule 2 — the transparency view has to have something to show.
  expect(await getRawCapture("cap-unparsed")).toEqual(raw);
});

test("an unknown provider with a money signal is queued", async () => {
  await createWallet({ name: "GCash" });

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
  await createWallet({ name: "GCash" });

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
  await createWallet({ name: "GCash" });
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
  await createWallet({ name: "GCash" });
  await setSetting("capture_enabled", false);

  const outcome = await processCapture(gcashSend("cap-paused"));

  expect(outcome).toEqual({ kind: "ignored", reason: "paused" });
  expect(await getRawCapture("cap-paused")).toBeNull();
  expect(await ledger()).toHaveLength(0);
  expect(await listOpen()).toHaveLength(0);
});

test("an unmapped wallet is a hard route to the queue however clean the parse", async () => {
  // Two open wallets and no matcher: the Normalizer refuses to guess (§5).
  await createWallet({ name: "GCash" });
  await createWallet({ name: "Maya" });

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
  const wallet = await createWallet({ name: "GCash" });
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
  const wallet = await createWallet({ name: "BPI" });
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
  const wallet = await createWallet({ name: "GCash" });
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

// The owner's 2026-09-01 device report: one ₱1,000.00 withdrawal, several
// identical cards. Android redelivers a notification every time its app edits
// it, and `extractCapture` stamps each redelivery with a fresh UUID, so the
// id-keyed guard above could not see them.
test("a notification redelivered under a new id after an edit raises no second card", async () => {
  const wallet = await createWallet({ name: "GCash" });
  await addMatcher(wallet.id, GCASH);
  const slot = `${GCASH}|0|null|0`;

  // Same slot, same text, a new delivery id and a fresh postTime — exactly what
  // the platform hands over when an app re-posts a notification it already
  // posted.
  const first = await processCapture(
    gcashSend("cap-edit-1", { notificationKey: slot, postedAt: NOW - MINUTE }),
  );
  const second = await processCapture(
    gcashSend("cap-edit-2", { notificationKey: slot, postedAt: NOW - MINUTE + 1_200 }),
  );

  expect(first.kind).toBe("committed");
  expect(second).toEqual({ kind: "ignored", reason: "duplicate" });
  expect(await ledger()).toHaveLength(1);
  expect(await listOpen()).toHaveLength(0);
});

test("a slot re-used for genuinely new text is a new capture, not a replay", async () => {
  const wallet = await createWallet({ name: "GCash" });
  await addMatcher(wallet.id, GCASH);
  const slot = `${GCASH}|7|null|0`;

  // One tile that says "Processing" and then, seconds later, says what actually
  // happened. Same slot, different facts — only the second is a transaction,
  // and suppressing it would lose the money it describes.
  await processCapture(
    capture({ id: "cap-slot-1", text: "Processing your request...", notificationKey: slot }),
  );
  const second = await processCapture(
    capture({
      id: "cap-slot-2",
      text: "You sent ₱500.00 to Juan Dela Cruz. Ref No. ABC123456.",
      notificationKey: slot,
      postedAt: NOW - MINUTE + 2_000,
    }),
  );

  expect(second.kind).toBe("committed");
  expect(await ledger()).toHaveLength(1);
});

// The keyless case — every capture buffered by a build older than migration
// 018 — is covered by the test directly below: its two captures carry no
// `notificationKey`, and it still requires the second to be QUEUED rather than
// suppressed. `findReplayCapture`'s own null-key contract is pinned in
// raw_notifications_repo.test.ts.
test("two distinct captures with identical amount, channel and timing still reach the DedupeGate", async () => {
  const wallet = await createWallet({ name: "GCash" });
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
  const wallet = await createWallet({ name: "BPI" });
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

// ---------------------------------------------------------------------------
// The twin whose FIRST leg never committed (GAP-012).
//
// `checkDuplicate` compares an event against COMMITTED TRANSACTIONS, so a
// telling that hard-routed — unmapped wallet, a score under the floor — is
// invisible to it. Its relay on the other channel therefore reads as unique and
// is queued too: two cards for one movement, and "Looks right" on each puts the
// payment in the ledger twice, because the second confirm has nothing to compare
// against either.
// ---------------------------------------------------------------------------

/** The queued-twin fixture: one movement, two channels, neither auto-committable. */
async function queuedTwinSetup(): Promise<string> {
  const wallet = await createWallet({ name: "BPI", openingBalance: 900000 });
  await upsertRuleset(TWIN_BUNDLE);
  // NO wallet matcher for either package, deliberately: both tellings hard-route
  // on an unresolved wallet, so neither is ever committed and the committed-row
  // DedupeGate has nothing at all to look at.
  return wallet.id;
}

function bpiPush(id: string, postedAt: number): RawCapture {
  return capture({
    id,
    packageName: BPI,
    text: "Your account was debited ₱750.00. Ref No. BPI556677.",
    postedAt,
  });
}

function bpiSms(id: string, postedAt: number): RawCapture {
  return capture({
    id,
    packageName: MESSAGES,
    title: "BPI",
    text: "BPI: Your account was debited ₱750.00. Ref No. BPI556677.",
    postedAt,
  });
}

test("a queued push and its SMS twin raise ONE card, and confirming it commits once", async () => {
  const walletId = await queuedTwinSetup();

  const push = await processCapture(bpiPush("cap-queued-push", NOW - MINUTE));
  const sms = await processCapture(bpiSms("cap-queued-sms", NOW - MINUTE + 30_000));

  expect(push.kind).toBe("queued");
  // Not `duplicate`: nothing is in the ledger yet, and a caller reading this
  // outcome needs to be able to tell "already recorded" from "still waiting to
  // be answered".
  expect(sms).toEqual({ kind: "ignored", reason: "queued-twin" });

  const open = await listOpen();
  expect(open).toHaveLength(1);
  expect(open[0].rawNotificationId).toBe("cap-queued-push");

  // One card, one answer, one row. The wallet has to be supplied because the
  // parse could not resolve it — that hard route is what put the card here.
  await correctItem(open[0].id, { walletId });

  const rows = await ledger();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    amount: 75000,
    direction: "out",
    // Carried through the card, which used to drop it. Without it, §6 rule 1
    // can never match this row to a later telling of the same movement.
    referenceNo: "BPI556677",
  });
  expect(await listOpen()).toHaveLength(0);
});

test("the suppressed twin's capture is never handed back to the recovery sweep", async () => {
  await queuedTwinSetup();

  await processCapture(bpiPush("cap-sweep-push", NOW - MINUTE));
  await processCapture(bpiSms("cap-sweep-sms", NOW - MINUTE + 30_000));

  // `listUnprocessedRawCaptures` calls a capture that points at neither a
  // Transaction nor a queue card unprocessed work. The suppression produces
  // neither, so it leaves the same already-resolved marker `mergeDuplicate`
  // leaves — and the marker is invisible, so the queue still holds one card.
  expect(await isRawCaptureUnreferenced("cap-sweep-sms")).toBe(false);
  expect(await listOpen()).toHaveLength(1);

  mockDrain.mockResolvedValue([]);
  const stop = await startIngest();
  await __awaitIngestIdle();
  stop();

  // A relaunch changes nothing. Without the marker the sweep would re-run the
  // SMS capture on every launch for its whole 30-day life, and the moment the
  // user dismissed the push card it would raise a fresh one for a notification
  // they had already answered.
  expect(await listOpen()).toHaveLength(1);
  expect(await ledger()).toHaveLength(0);
});

test("a card whose twin auto-committed on the other channel commits nothing when confirmed", async () => {
  const walletId = await queuedTwinSetup();
  // The relay's package IS mapped and the push's is not, which is the everyday
  // asymmetry: one telling resolves a wallet and sails through, the other
  // hard-routes. The queue-side guard deliberately does not run on the
  // auto-commit path, so this pair really does produce a row AND a card.
  await addMatcher(walletId, MESSAGES);

  const push = await processCapture(bpiPush("cap-mirror-push", NOW - MINUTE));
  const sms = await processCapture(bpiSms("cap-mirror-sms", NOW - MINUTE + 30_000));

  expect(push.kind).toBe("queued");
  expect(sms.kind).toBe("committed");
  expect(await ledger()).toHaveLength(1);

  const [card] = await listOpen();
  await correctItem(card.id, { walletId });

  // Still one row. The confirm runs the same `checkDuplicate` the pipeline does,
  // so the card resolves onto the row that already holds the movement instead of
  // writing a second one nothing on screen would explain.
  expect(await ledger()).toHaveLength(1);
  expect(await listOpen()).toHaveLength(0);
});

test("a card confirmed at T is not committed again by its SMS relay two hours later", async () => {
  const walletId = await queuedTwinSetup();

  const push = await processCapture(bpiPush("cap-slow-push", NOW - 3 * 60 * MINUTE));
  expect(push.kind).toBe("queued");

  const [card] = await listOpen();
  await correctItem(card.id, { walletId });
  expect(await ledger()).toHaveLength(1);

  // Two hours later: far outside the 180 s twin window, well inside the 48 h
  // strong key. The reference number the card now carries is the ONLY thing
  // that can still match this relay to the row the user confirmed.
  const sms = await processCapture(bpiSms("cap-slow-sms", NOW - 60 * MINUTE));

  expect(sms).toEqual({ kind: "ignored", reason: "duplicate" });
  expect(await ledger()).toHaveLength(1);
  expect(await listOpen()).toHaveLength(0);
});

test("a hand-typed entry never suppresses a real notification of the same amount", async () => {
  const wallet = await createWallet({ name: "GCash", openingBalance: 200000 });
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
  const bank = await createWallet({ name: "BPI", openingBalance: 500000 });
  const ewallet = await createWallet({ name: "GCash" });
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
  const bank = await createWallet({ name: "BPI", openingBalance: 500000 });
  const ewallet = await createWallet({ name: "GCash" });
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
  const bank = await createWallet({ name: "BPI", openingBalance: 500000 });
  const ewallet = await createWallet({ name: "GCash" });
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

test("a one-sided transfer queues an item and commits nothing", async () => {
  // Only one leg was ever captured — a bank-funded cash-in with no matching
  // out-leg anywhere in the ledger. `detectTransfer` reads this as `one_sided`
  // off the "Cash In" transfer-intent keyword, and the gate must hard-route it
  // at ANY confidence: the counterpart wallet is a guess until the user
  // confirms, so nothing may commit.
  const gcashWallet = await createWallet({ name: "GCash" });
  await seedWalletMatcher("gcash", gcashWallet.id);

  await processCapture(
    gcashCapture({ text: "Cash In of PHP 1,000.00 was successful. Ref No. ONESIDE1." }),
  );

  expect(await listTransactions({})).toHaveLength(0);

  const [item] = await listOpenReviewItems();
  expect(item?.kind).toBe("one-sided-transfer");
  expect(item?.payload).toMatchObject({
    amount: 100_000,
    direction: "in",
    walletId: gcashWallet.id,
    counterpartWalletId: null,
    signal: "text",
  });
});

test("the bank's late notification replaces the minted leg rather than duplicating it", async () => {
  // The user already confirmed a one-sided transfer (via `attachCounterpartLeg`,
  // the same write `confirmOneSidedTransfer` makes from a Review Queue card), so
  // a minted BPI leg — `source: "manual"`, linked, no `rawNotificationId` —
  // already sits in the ledger opposite the captured GCash cash-in.
  const gcashWallet = await createWallet({ name: "GCash" });
  const bpiWallet = await createWallet({ name: "BPI" });
  await addMatcher(gcashWallet.id, GCASH);
  await addMatcher(bpiWallet.id, BPI);

  const minted = await attachCounterpartLeg(
    {
      captured: {
        proposal: {
          walletId: gcashWallet.id,
          categoryId: UNCATEGORIZED_ID,
          amount: 100_000,
          direction: "in",
          occurredAt: NOW,
          source: "notification",
          confidence: 0.95,
        },
      },
      counterpartWalletId: bpiWallet.id,
      feeAmount: 0,
    },
    NOW,
  );

  // The minted leg is the "out" side (BPI, opposite the "in" GCash cash-in).
  // `bpi_debit_v1` (seed.json) needs the amount right after "debited" and a
  // continuous alnum reference — hyphens are outside its `[A-Za-z0-9]{6,}`
  // class — so the reference below is spelled to actually bind.
  await processCapture(
    capture({
      id: "cap-bpi-late",
      packageName: BPI,
      text: "Your account was debited ₱1,000.00. Ref No. BPI000077.",
      postedAt: NOW - MINUTE,
    }),
  );

  const rows = await listTransactions({});
  // Not three: the late notification takes over the minted row instead of
  // adding a second BPI leg alongside it.
  expect(rows).toHaveLength(2);

  const superseded = rows.find((row) => row.id === minted.outLegId);
  expect(superseded?.source).toBe("notification");
  expect(superseded?.referenceNo).toBe("BPI000077");
  expect(superseded?.transferLinkId).toBe(minted.transferLinkId);
});

// ---------------------------------------------------------------------------
// The confidence arithmetic the orchestrator itself owns.
// ---------------------------------------------------------------------------

test("0.95 minus a 0.05 learned penalty still auto-commits", async () => {
  const wallet = await createWallet({ name: "BPI", openingBalance: 500000 });
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
  const wallet = await createWallet({ name: "GCash" });
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
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
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
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
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

// ---------------------------------------------------------------------------
// The batch store is ONE transaction. The native ack has already happened by
// the time the first row is written, so the table is the only copy of the
// drain — and a pass of autocommit inserts stopping half way leaves a state
// nothing downstream can even detect, because a short `raw_notifications` and
// a complete one look exactly alike (GAP-040).
// ---------------------------------------------------------------------------

test("a kill part-way through the batch store leaves no half-written batch", async () => {
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);
  const batch = [
    gcashSend("buf-1", { text: sendText("100.00", "REF0001"), postedAt: NOW - 5 * MINUTE }),
    gcashSend("buf-2", { text: sendText("200.00", "REF0002"), postedAt: NOW - 4 * MINUTE }),
    gcashSend("buf-3", { text: sendText("300.00", "REF0003"), postedAt: NOW - 3 * MINUTE }),
  ];
  mockDrain.mockResolvedValue(batch);

  // The cut lands on the THIRD write, with two already in hand. An OEM freeze
  // cannot be scripted, but the durability question it asks is exactly this
  // one: what does the table hold when the batch stops part way through?
  const realStore = rawNotificationsRepo.storeRawCapture;
  const store = jest
    .spyOn(rawNotificationsRepo, "storeRawCapture")
    .mockImplementation(async (raw, at) => {
      if (raw.id === "buf-3") throw new Error("killed mid-batch");
      return realStore(raw, at);
    });

  const stop = await startIngest();
  // RESOLVES, and that is deliberate: the batch's failure is swallowed at the
  // head of the chain so a rejected head cannot silence every live capture
  // appended after it. Idle means "the queue drained", not "the batch
  // succeeded" -- the rollback assertions below are what say it failed.
  await __awaitIngestIdle();
  stop();

  // Not one row of it. Two durable captures beside a third that vanished is the
  // undetectable state: `listUnprocessedRawCaptures` would hand the survivors
  // back on the next launch looking like ordinary stranded work, and nothing
  // anywhere would say the rest of the drain is gone.
  for (const raw of batch) {
    expect(await getRawCapture(raw.id)).toBeNull();
  }
  expect(await ledger()).toHaveLength(0);
  expect(store).toHaveBeenCalledTimes(3);

  // And "none of it" is what makes the loss recoverable at all: the batch the
  // kill cost is the batch the next drain hands back (M1a Task 3 chose
  // at-least-once deliberately), and it commits whole, once each, because the
  // rollback left nothing for the replay guard to trip over.
  store.mockRestore();
  mockDrain.mockResolvedValue(batch);
  const second = await startIngest();
  await __awaitIngestIdle();
  second();

  expect((await commitOrder()).map((row) => row.amount)).toEqual([10000, 20000, 30000]);
});

test("a failed batch does not silence every live capture for the rest of the process", async () => {
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);
  mockDrain.mockResolvedValue([
    gcashSend("buf-1", { text: sendText("100.00", "REF0001"), postedAt: NOW - 5 * MINUTE }),
  ]);

  const realStore = rawNotificationsRepo.storeRawCapture;
  jest.spyOn(rawNotificationsRepo, "storeRawCapture").mockImplementation(async (raw, at) => {
    if (raw.id.startsWith("buf-")) throw new Error("killed mid-batch");
    return realStore(raw, at);
  });

  const stop = await startIngest();
  await __awaitIngestIdle();

  // THE REGRESSION, and it is a quiet one. The head of the chain has now
  // rejected. Live captures are appended with `chain.then(onFulfilled)`, and
  // `.then` on a REJECTED promise skips its callback and passes the rejection
  // on -- so every notification arriving from here to the end of the process
  // was dropped without a trace, which is the exact outcome the chain was
  // built to prevent. The user sees tracking simply stop working until they
  // restart the app.
  liveListener?.(
    gcashSend("live-1", { text: sendText("500.00", "REF9999"), postedAt: NOW - MINUTE }),
  );
  await __awaitIngestIdle();
  stop();

  expect((await ledger()).map((row) => row.amount)).toEqual([50000]);
});

test("a stage throwing leaves the capture readable and reprocessable", async () => {
  const wallet = await createWallet({ name: "GCash" });
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
  const wallet = await createWallet({ name: "GCash" });
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
  await createWallet({ name: "GCash" });
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
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
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
  const wallet = await createWallet({ name: "GCash" });
  await addMatcher(wallet.id, GCASH);
  const raw = gcashSend("buf-known");
  await storeRawCapture(raw, NOW);
  // The row its first run committed, spelled out rather than implied. A stored
  // capture with NOTHING behind it is no longer "already handled" — that is
  // precisely the stranded state the recovery sweep exists to finish — so a
  // capture that really did finish has to look finished.
  await insertTransaction({
    walletId: wallet.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 50000,
    direction: "out",
    occurredAt: NOW - MINUTE,
    source: "notification",
    confidence: 0.95,
    rawNotificationId: raw.id,
  });
  mockDrain.mockResolvedValue([raw]);

  const stop = await startIngest();
  await __awaitIngestIdle();

  // Still the one row: neither the drain nor the sweep ran the stages again.
  expect(await ledger()).toHaveLength(1);
  stop();
});

// ---------------------------------------------------------------------------
// The recovery sweep — rule 2 stores the raw capture BEFORE the stages, so a
// stage that throws leaves a durable row that produced nothing, and rule 11
// then calls every later delivery of that notification a replay. Without a
// pass that comes back for those rows, a real transaction is gone with no
// ledger row, no card and no error.
// ---------------------------------------------------------------------------

test("a capture whose stages threw is committed by the next startIngest", async () => {
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);
  mockDrain.mockResolvedValue([gcashSend("buf-transient")]);
  // One transient write failure, after the raw row is already durable — a busy
  // database is the everyday version of this, and it is not the capture's fault.
  const insert = jest
    .spyOn(transactionsRepo, "insertTransaction")
    .mockRejectedValueOnce(new Error("database is locked"));

  const first = await startIngest();
  await __awaitIngestIdle();
  first();

  expect(await ledger()).toHaveLength(0);
  expect(await getRawCapture("buf-transient")).not.toBeNull();
  expect(insert).toHaveBeenCalledTimes(1);

  // The drain already emptied the native buffer, so nothing redelivers this
  // capture: the stored row is the only copy, and the sweep is the only thing
  // that can still reach it.
  mockDrain.mockResolvedValue([]);
  const second = await startIngest();
  await __awaitIngestIdle();
  second();

  const rows = await ledger();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    amount: 50000,
    direction: "out",
    rawNotificationId: "buf-transient",
  });
});

test("a capture that throws on every attempt becomes a card instead of a silent loop", async () => {
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);
  mockDrain.mockResolvedValue([gcashSend("buf-poison")]);
  // Permanently unwritable, not transient: the sweep would otherwise re-run
  // this row on every launch for its whole 30-day life and never tell anyone.
  jest
    .spyOn(transactionsRepo, "insertTransaction")
    .mockRejectedValue(new Error("database is locked"));

  const first = await startIngest();
  await __awaitIngestIdle();
  first();
  const second = await startIngest();
  await __awaitIngestIdle();
  second();

  // Two failures are not enough. A device that fails twice on a busy database
  // and succeeds on the third try must not be handed a card about it.
  expect(await listOpenReviewItems()).toHaveLength(0);

  const third = await startIngest();
  await __awaitIngestIdle();
  third();

  const open = await listOpenReviewItems();
  expect(open).toHaveLength(1);
  expect(open[0].kind).toBe("unknown-provider");
  expect(open[0].rawNotificationId).toBe("buf-poison");
  expect(await ledger()).toHaveLength(0);

  // And the card is now what the sweep sees, so a fourth pass does nothing.
  const fourth = await startIngest();
  await __awaitIngestIdle();
  fourth();
  expect(await listOpenReviewItems()).toHaveLength(1);
});

test("a transaction the user merged away is not re-committed by the next sweep", async () => {
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);

  // The row the user keeps: typed in before the notification landed, which is
  // exactly why the DedupeGate let the pair through. `describesSameMovement`
  // refuses a row with no provider outright (dedupe_gate.ts's `providerKey:
  // null` note), so a hand-entered twin is never suppressed automatically and
  // the merge is the only thing that can settle it.
  const kept = await insertTransaction({
    walletId: wallet.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 50000,
    direction: "out",
    occurredAt: NOW - MINUTE,
    source: "manual",
    confidence: 1,
  });

  expect((await processCapture(gcashSend("cap-merged"))).kind).toBe("committed");
  const committed = (await ledger()).find((row) => row.rawNotificationId === "cap-merged");
  expect(committed).toBeDefined();

  // The ledger-side merge `mergeDuplicate`'s own docblock describes: a capture
  // that auto-committed never raised a card, so there is no queue item to pass
  // and nothing here resolves one.
  await mergeDuplicate("no-card-was-ever-raised", kept.id, (committed as Transaction).id);
  expect(await ledger()).toHaveLength(1);

  mockDrain.mockResolvedValue([]);
  const stop = await startIngest();
  await __awaitIngestIdle();
  stop();

  // The user's answer has to survive a relaunch. Re-running the stages reaches
  // the same verdict it reached the first time — the surviving twin is manual,
  // so the gate still calls the capture unique — and committing again would put
  // back the exact row they merged away, with a new id they cannot recognise.
  expect(await ledger()).toHaveLength(1);
  expect((await ledger())[0].id).toBe(kept.id);
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

// ---------------------------------------------------------------------------
// Held or owed — the verdict that replaced the onboarding wallet-type question.
//
// END TO END, NOT AGAINST THE SCORER. lib/wallets/__tests__/classification.test.ts
// already pins the rules; what these assert is that the ORCHESTRATOR feeds them
// the right numbers. Specifically that the previous balance is reconstructed
// from `computed_balance` rather than re-read after the snap — read it back
// afterwards and every capture looks ordinary, which would leave this whole
// feature silently inert with a green unit suite.
// ---------------------------------------------------------------------------

test("a spend that LOWERS the reported balance scores the wallet as holding money", async () => {
  // Opened at ₱9,000; the capture reports ₱1,250 after a ₱500 spend. The
  // balance fell, which is what an ordinary account does.
  const wallet = await createWallet({ name: "GCash", openingBalance: 900000 });
  await addMatcher(wallet.id, GCASH);

  await processCapture(gcashSend("cap-trait-held"));

  expect(await getTraitEvidence(wallet.id)).toEqual({
    owedScore: 0,
    heldScore: 200,
    sampleCount: 1,
  });
  expect((await getWallet(wallet.id))?.owedBalance).toBe(false);
});

test("a spend that RAISES the reported balance is credit-shaped", async () => {
  // Same capture, different opening balance: ₱1,000 before, ₱1,250 after a
  // ₱500 spend. Spending more and OWING more is what a card does.
  const wallet = await createWallet({ name: "GCash", openingBalance: 100000 });
  await addMatcher(wallet.id, GCASH);

  await processCapture(gcashSend("cap-trait-owed"));

  expect(await getTraitEvidence(wallet.id)).toEqual({
    owedScore: 200,
    heldScore: 0,
    sampleCount: 1,
  });
});

test("one credit-shaped capture is not enough to move the headline number", async () => {
  const wallet = await createWallet({ name: "GCash", openingBalance: 100000 });
  await addMatcher(wallet.id, GCASH);

  await processCapture(gcashSend("cap-trait-single"));

  // The sample floor is three. A single odd notification must not be able to
  // pull a wallet's balance out of the user's total.
  expect((await getWallet(wallet.id))?.owedBalance).toBe(false);
});

test("three credit-shaped captures flip the wallet to owed", async () => {
  const wallet = await createWallet({ name: "GCash", openingBalance: 100000 });
  await addMatcher(wallet.id, GCASH);

  // Distinct amounts and references so the dedupe gate treats these as three
  // events; each reported balance is higher than the one before, because the
  // wallet snaps to the last one it was told.
  await processCapture(
    gcashSend("cap-trait-1", {
      text: "You sent ₱500.00 to Juan Dela Cruz. Ref No. AAA111. Your new balance is ₱1,250.00.",
    }),
  );
  await processCapture(
    gcashSend("cap-trait-2", {
      text: "You sent ₱300.00 to Maria Santos. Ref No. BBB222. Your new balance is ₱1,500.00.",
    }),
  );
  await processCapture(
    gcashSend("cap-trait-3", {
      text: "You sent ₱200.00 to Pedro Reyes. Ref No. CCC333. Your new balance is ₱1,750.00.",
    }),
  );

  expect(await getTraitEvidence(wallet.id)).toMatchObject({ owedScore: 600, sampleCount: 3 });

  const reloaded = await getWallet(wallet.id);
  expect(reloaded?.owedBalance).toBe(true);
  // INFERRED, NOT ANSWERED. The user can still be asked, and still overrule it.
  expect(reloaded?.owedPinned).toBe(false);
});

test("a wallet the app cannot read is asked about once, and only once", async () => {
  // Two owed signals and one held one: three samples, so we have LOOKED, but a
  // margin of 200 against a threshold of 300, so we still cannot tell.
  const wallet = await createWallet({ name: "BPI", openingBalance: 500_000 });
  await addMatcher(wallet.id, GCASH);
  await recordTraitEvidence(wallet.id, { owed: 200, held: 0 });
  await recordTraitEvidence(wallet.id, { owed: 200, held: 0 });

  // This capture's own movement scores held (the balance falls), landing the
  // wallet on owed 400 / held 200 across three samples.
  await processCapture(
    gcashSend("cap-ask-1", {
      text: "You sent ₱500.00 to Juan Dela Cruz. Ref No. GGG111. Your new balance is ₱1,250.00.",
    }),
  );

  const asked = (await listOpen()).filter((entry) => entry.kind === "wallet-kind-unclear");
  expect(asked).toHaveLength(1);
  expect(asked[0].payload).toMatchObject({ walletId: wallet.id, walletName: "BPI" });

  // A second inconclusive capture must not raise a second card.
  await processCapture(
    gcashSend("cap-ask-2", {
      text: "You sent ₱300.00 to Maria Santos. Ref No. HHH222. Your new balance is ₱1,000.00.",
    }),
  );
  expect((await listOpen()).filter((entry) => entry.kind === "wallet-kind-unclear")).toHaveLength(1);
});

test("a wallet too small to matter is never asked about", async () => {
  // ₱2.00, against a ₱1,000 floor and a 5%-of-total bar it also fails.
  const wallet = await createWallet({ name: "Loose change", openingBalance: 200 });
  await addMatcher(wallet.id, GCASH);
  await recordTraitEvidence(wallet.id, { owed: 200, held: 0 });
  await recordTraitEvidence(wallet.id, { owed: 200, held: 0 });
  await recordTraitEvidence(wallet.id, { owed: 0, held: 200 });

  await processCapture(
    gcashSend("cap-small", {
      text: "You sent ₱1.00 to Juan Dela Cruz. Ref No. JJJ111. Your new balance is ₱1.00.",
    }),
  );

  expect((await listOpen()).filter((entry) => entry.kind === "wallet-kind-unclear")).toHaveLength(0);
});

test("answering the question pins the wallet and closes the card", async () => {
  const wallet = await createWallet({ name: "BPI", openingBalance: 500_000 });
  await addMatcher(wallet.id, GCASH);
  await recordTraitEvidence(wallet.id, { owed: 200, held: 0 });
  await recordTraitEvidence(wallet.id, { owed: 200, held: 0 });
  await processCapture(
    gcashSend("cap-answer", {
      text: "You sent ₱500.00 to Juan Dela Cruz. Ref No. KKK111. Your new balance is ₱1,250.00.",
    }),
  );

  const [card] = (await listOpen()).filter((entry) => entry.kind === "wallet-kind-unclear");
  await answerWalletKind(card.id, true);

  const reloaded = await getWallet(wallet.id);
  expect(reloaded?.owedBalance).toBe(true);
  // PINNED BY EITHER ANSWER — the user settled it, and inference is done here.
  expect(reloaded?.owedPinned).toBe(true);
  expect((await listOpen()).filter((entry) => entry.kind === "wallet-kind-unclear")).toHaveLength(0);
});

test("answering 'money I have' pins too — it is not a dismissal", async () => {
  const wallet = await createWallet({ name: "BPI", openingBalance: 500_000 });
  await addMatcher(wallet.id, GCASH);
  await recordTraitEvidence(wallet.id, { owed: 200, held: 0 });
  await recordTraitEvidence(wallet.id, { owed: 200, held: 0 });
  await processCapture(
    gcashSend("cap-answer-held", {
      text: "You sent ₱500.00 to Juan Dela Cruz. Ref No. LLL111. Your new balance is ₱1,250.00.",
    }),
  );

  const [card] = (await listOpen()).filter((entry) => entry.kind === "wallet-kind-unclear");
  await answerWalletKind(card.id, false);

  const reloaded = await getWallet(wallet.id);
  expect(reloaded?.owedBalance).toBe(false);
  expect(reloaded?.owedPinned).toBe(true);
});

test("a wallet the user already settled is not re-decided by evidence", async () => {
  const wallet = await createWallet({ name: "GCash", openingBalance: 100000 });
  await addMatcher(wallet.id, GCASH);
  await setWalletOwed(wallet.id, false, { pinned: true });

  await processCapture(
    gcashSend("cap-pin-1", {
      text: "You sent ₱500.00 to Juan Dela Cruz. Ref No. DDD111. Your new balance is ₱1,250.00.",
    }),
  );
  await processCapture(
    gcashSend("cap-pin-2", {
      text: "You sent ₱300.00 to Maria Santos. Ref No. EEE222. Your new balance is ₱1,500.00.",
    }),
  );
  await processCapture(
    gcashSend("cap-pin-3", {
      text: "You sent ₱200.00 to Pedro Reyes. Ref No. FFF333. Your new balance is ₱1,750.00.",
    }),
  );

  // The evidence is still gathered — it is not wrong, and it is what a later
  // "that's not right" would be judged against — but the verdict is not applied.
  expect(await getTraitEvidence(wallet.id)).toMatchObject({ owedScore: 600, sampleCount: 3 });
  expect((await getWallet(wallet.id))?.owedBalance).toBe(false);
});

/**
 * A provider whose template vouches for itself at exactly the shipped review
 * floor (0.5), so anything it parses lands in the DISCARD band with no
 * threshold retuned. It is the only way to drive `decideRoute`'s "parsed a
 * real amount but scored at or below the floor" branch end to end from here.
 */
const ZERO_FLOOR_BUNDLE: RulesetBundleInput = {
  version: 2,
  providers: [
    {
      providerKey: "gcash",
      packageNames: [GCASH],
      version: 2,
      channel: "push",
      templates: [
        {
          id: "gcash_sent_at_floor",
          match: String.raw`\bYou sent (?<amount>(?:₱|PHP|Php)\s?[\d,]+(?:\.\d{2})?)(?!\.?\d)`,
          direction: "out",
          confidence: 0.5,
        },
      ],
    },
  ],
};
