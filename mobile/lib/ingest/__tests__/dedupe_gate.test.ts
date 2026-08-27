// lib/ingest/__tests__/dedupe_gate.test.ts — Stage 4, the twin suppressor.
//
// ILLUSTRATIVE ONLY. Every provider key, reference number and amount below is
// INVENTED for planning (docs/03-ingest-pipeline.md §11.4). Nothing here should
// be read as a confirmed provider format.
//
// WHAT THESE TESTS ARE GUARDING. This stage is the only one that can make a
// transaction NOT EXIST. A `duplicate` verdict means the orchestrator writes
// nothing to the ledger at all (plan Task 10 rule 5) — there is no merged row to
// split later and nothing on screen to notice. So every assertion here is really
// an assertion about one of two silent failures:
//
//   - Suppressing too much: real money vanishes from the ledger with no symptom.
//   - Suppressing too little: the same ₱500.00 is counted twice.
//
// Spec §6's answer to "we cannot tell" is neither — it is `possible-duplicate`,
// which the ConfidenceGate hard-routes to the Review Queue (§9.2). Several tests
// below exist purely to prove the undecidable case lands there and not on either
// side of it.
//
// THE TWO WINDOWS ARE PINNED AT THEIR BOUNDARIES, not at comfortable distances.
// A comparison written with the wrong sign, or with `<` where the spec says
// "within", passes every test taken a safe distance from the edge and fails only
// against real notification timings. So each window is asserted exactly at its
// value, one millisecond past it, and with the sign of the difference reversed.
//
// EVERY TIMESTAMP IS AN OFFSET FROM ONE PINNED CONSTANT. This stage takes no
// `now` and reads no clock: its windows are measured between the two events
// themselves. Fixtures dated years in the past still dedupe, and the last test
// in the file proves it.
import { checkDuplicate } from "@/lib/ingest/dedupe_gate";
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";

import type { RecentEvent } from "@/lib/ingest/dedupe_gate";
import type { NormalizedEvent } from "@/lib/ingest/normalizer";
import type { PipelineTunables } from "@/lib/ingest/ruleset_types";

const SECOND = 1_000;
const HOUR = 3_600_000;

/** Pinned. Nothing here is relative to the wall clock. */
const OCCURRED_AT = 1_754_100_000_000;

const TWIN_WINDOW = DEFAULT_TUNABLES.dedupeTwinWindowMs;
const STRONG_WINDOW = DEFAULT_TUNABLES.dedupeStrongWindowMs;

const PROVIDER = "test_provider";
const OTHER_PROVIDER = "other_provider";

/** ₱100.00 — spec §6 rule 4's own example of a repeatable real purchase. */
const HUNDRED_PESOS = 10_000;

/**
 * The incoming event: a push, ₱100.00 out, no reference number. Tests override
 * exactly the field they are about, so anything left at the default is a field
 * that rule does not discriminate on.
 */
function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    providerKey: PROVIDER,
    amount: HUNDRED_PESOS,
    direction: "out",
    occurredAt: OCCURRED_AT,
    confidence: 1,
    walletId: "wallet_main",
    channel: "push",
    ...overrides,
  };
}

/**
 * One already-committed row as the orchestrator will assemble it (Task 10 joins
 * `transactions.rawNotificationId` → `raw_notifications.package_name` → the
 * provider, and reads `channel` off the ruleset).
 *
 * Defaults to the SMS half of a twin pair 60 s earlier, because that is the
 * exact shape §6 exists for.
 */
function makeRecent(overrides: Partial<RecentEvent> = {}): RecentEvent {
  return {
    transactionId: "tx_recent",
    providerKey: PROVIDER,
    channel: "sms",
    amount: HUNDRED_PESOS,
    direction: "out",
    referenceNo: null,
    occurredAt: OCCURRED_AT - 60 * SECOND,
    // Every fixture in this file is an ordinary notification-backed row unless
    // a test opts into `makeMintedLeg`, which is the one place this flips.
    mintedTransferLeg: false,
    ...overrides,
  };
}

/** A hand-typed ledger row: no notification behind it, so no provider and no channel. */
function makeManual(overrides: Partial<RecentEvent> = {}): RecentEvent {
  return makeRecent({
    transactionId: "tx_manual",
    providerKey: null,
    channel: null,
    ...overrides,
  });
}

/** `DEFAULT_TUNABLES` with one window moved, to prove the value is read and not inlined. */
function retuned(overrides: Partial<PipelineTunables>): PipelineTunables {
  return { ...DEFAULT_TUNABLES, ...overrides };
}

// ---------------------------------------------------------------------------
// Rule 1 — the strong key (spec §6 rule 1): same provider, same reference
// number, same amount, within 48 h, REGARDLESS OF CHANNEL. This is the main
// push/SMS twin catcher, and the only rule that reaches past 180 seconds.
// ---------------------------------------------------------------------------

test("a matching reference number within 48 h is a duplicate across different channels", () => {
  const event = makeEvent({ channel: "push", referenceNo: "ABC123" });
  // 47 h is far outside the twin window, so ONLY the strong key can produce a
  // verdict here — and the channels differ, which rule 1 must not care about.
  const recent = makeRecent({
    transactionId: "tx_sms_twin",
    channel: "sms",
    referenceNo: "ABC123",
    occurredAt: OCCURRED_AT - 47 * HOUR,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_sms_twin",
  });
});

test("a matching reference number at 49 h is unique", () => {
  const event = makeEvent({ referenceNo: "ABC123" });
  const recent = makeRecent({
    channel: "sms",
    referenceNo: "ABC123",
    occurredAt: OCCURRED_AT - 49 * HOUR,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a matching reference number exactly at the strong window is a duplicate", () => {
  const event = makeEvent({ referenceNo: "ABC123" });
  const recent = makeRecent({
    transactionId: "tx_edge",
    channel: "sms",
    referenceNo: "ABC123",
    occurredAt: OCCURRED_AT - STRONG_WINDOW,
  });

  // Spec §6 rule 1 says "within a 48-hour window" — the boundary is inclusive.
  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_edge",
  });
});

test("a matching reference number one millisecond past the strong window is unique", () => {
  const event = makeEvent({ referenceNo: "ABC123" });
  const recent = makeRecent({
    channel: "sms",
    referenceNo: "ABC123",
    occurredAt: OCCURRED_AT - STRONG_WINDOW - 1,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a same-channel repost carrying the same reference number is a duplicate", () => {
  // Spec §6 rule 3's re-post case, in the only form this stage can decide: the
  // shared reference settles it. Rule 1 is channel-agnostic, so a push repeated
  // as a push is caught exactly like a push repeated as an SMS.
  const event = makeEvent({ channel: "push", referenceNo: "ABC123" });
  const recent = makeRecent({
    transactionId: "tx_original_post",
    channel: "push",
    referenceNo: "ABC123",
    occurredAt: OCCURRED_AT - 30 * SECOND,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_original_post",
  });
});

test("a blank reference number is never a strong key", () => {
  // A capture group that matched nothing writes `""`, and a settings-shaped
  // round trip writes whitespace. Treating either as a reference would make
  // EVERY reference-less event from a provider a duplicate of every other one
  // within 48 hours — the single largest way this gate could eat real money.
  const event = makeEvent({ referenceNo: "" });
  const blank = makeRecent({
    channel: "sms",
    referenceNo: "",
    occurredAt: OCCURRED_AT - 47 * HOUR,
  });
  const whitespace = makeRecent({
    transactionId: "tx_whitespace",
    channel: "sms",
    referenceNo: "   ",
    occurredAt: OCCURRED_AT - 47 * HOUR,
  });

  expect(checkDuplicate(event, [blank], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
  expect(checkDuplicate(makeEvent({ referenceNo: " " }), [whitespace], DEFAULT_TUNABLES)).toEqual({
    kind: "unique",
  });
});

test("reference numbers match across case and surrounding whitespace", () => {
  // The push and the SMS are two different templates written by two different
  // teams; one shouts and one does not. The reference is the same string.
  const event = makeEvent({ channel: "push", referenceNo: " abc-123 " });
  const recent = makeRecent({
    transactionId: "tx_shouted",
    channel: "sms",
    referenceNo: "ABC-123",
    occurredAt: OCCURRED_AT - 47 * HOUR,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_shouted",
  });
});

test("two different reference numbers from one provider are never duplicates", () => {
  // Positive disconfirmation, and the reason the twin window must not fire
  // here: one provider issuing two reference numbers issued two transactions.
  // Sixty seconds and matching amounts do not outrank that.
  const event = makeEvent({ channel: "push", referenceNo: "ABC123" });
  const recent = makeRecent({
    channel: "sms",
    referenceNo: "XYZ789",
    occurredAt: OCCURRED_AT - 60 * SECOND,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a reversal carrying the original's reference number is never a duplicate", () => {
  // A refund or a failed-transfer reversal quotes the reference of the
  // transaction it undoes, at the same amount, minutes later. It is the second
  // real movement of that money, not a second telling of the first — and it is
  // the case that makes the strong key require a matching DIRECTION. Suppressed
  // here, the ledger would keep a spend the user was refunded, permanently.
  const event = makeEvent({ direction: "in", referenceNo: "ABC123" });
  const recent = makeRecent({
    direction: "out",
    channel: "push",
    referenceNo: "ABC123",
    occurredAt: OCCURRED_AT - 60 * SECOND,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

// ---------------------------------------------------------------------------
// Rule 2 — the twin window (spec §6 rule 2): no shared reference, same
// provider, same amount, same direction, DIFFERENT channels, within 180 s.
// ---------------------------------------------------------------------------

test("a push and its SMS twin 60 s apart with no reference number is a duplicate", () => {
  const event = makeEvent({ channel: "push" });
  const recent = makeRecent({ transactionId: "tx_sms_leg", channel: "sms" });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_sms_leg",
  });
});

test("the same cross-channel pair 200 s apart is unique", () => {
  const event = makeEvent({ channel: "push" });
  const recent = makeRecent({ channel: "sms", occurredAt: OCCURRED_AT - 200 * SECOND });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a cross-channel pair exactly at the twin window is a duplicate", () => {
  const event = makeEvent({ channel: "push" });
  const recent = makeRecent({
    transactionId: "tx_edge_twin",
    channel: "sms",
    occurredAt: OCCURRED_AT - TWIN_WINDOW,
  });

  // "within 180 seconds" — inclusive.
  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_edge_twin",
  });
});

test("a cross-channel pair one millisecond past the twin window is unique", () => {
  const event = makeEvent({ channel: "push" });
  const recent = makeRecent({ channel: "sms", occurredAt: OCCURRED_AT - TWIN_WINDOW - 1 });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a twin whose timestamp is later than the event's is still a duplicate", () => {
  // The window is a distance, not an ordering. Catch-up processing (§12.4) and
  // a delayed relay both hand this stage a committed row stamped AFTER the
  // event being checked; a subtraction that forgot its absolute value would
  // silently stop suppressing exactly those.
  const event = makeEvent({ channel: "sms" });
  const recent = makeRecent({
    transactionId: "tx_future_leg",
    channel: "push",
    occurredAt: OCCURRED_AT + 60 * SECOND,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_future_leg",
  });
});

test("a recent row with an unknown channel is never a twin-window duplicate", () => {
  // `null` is "we could not establish a channel", which is not the same claim
  // as "a different channel". An implementation testing `row.channel !==
  // event.channel` reads the first as the second and suppresses on no evidence.
  const event = makeEvent({ channel: "push" });
  const recent = makeRecent({ channel: null });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

// ---------------------------------------------------------------------------
// Rules 3 and 4 — the same-channel pair (spec §6 rule 4). Same inputs, opposite
// verdicts, SEPARATED ONLY BY THE TWIN WINDOW: inside it the pipeline cannot
// tell, so it asks; outside it, two identical amounts are two real purchases.
// ---------------------------------------------------------------------------

test("two same-channel purchases of the same amount 5 minutes apart are unique", () => {
  // Spec §6 rule 4 in its own words: two ₱100.00 load purchases minutes apart
  // are real. This is the regression that protects ordinary repeated spending.
  const event = makeEvent({ channel: "push", amount: HUNDRED_PESOS });
  const recent = makeRecent({
    channel: "push",
    amount: HUNDRED_PESOS,
    occurredAt: OCCURRED_AT - 5 * 60 * SECOND,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("two same-channel events 60 s apart with no references are a possible duplicate", () => {
  // BOTH other answers are wrong here, and both are silent: `duplicate` merges
  // two real transactions, `unique` double-counts one. §6 rule 4 routes it to
  // the Review Queue instead, where a human settles it in one tap.
  const event = makeEvent({ channel: "push" });
  const recent = makeRecent({ transactionId: "tx_ambiguous", channel: "push" });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "possible-duplicate",
    ofTransactionId: "tx_ambiguous",
  });
});

test("a same-channel pair exactly at the twin window is a possible duplicate", () => {
  const event = makeEvent({ channel: "sms" });
  const recent = makeRecent({
    transactionId: "tx_edge_ambiguous",
    channel: "sms",
    occurredAt: OCCURRED_AT - TWIN_WINDOW,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "possible-duplicate",
    ofTransactionId: "tx_edge_ambiguous",
  });
});

test("a same-channel pair one millisecond past the twin window is unique", () => {
  const event = makeEvent({ channel: "sms" });
  const recent = makeRecent({ channel: "sms", occurredAt: OCCURRED_AT - TWIN_WINDOW - 1 });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

// ---------------------------------------------------------------------------
// The disqualifiers — facts that end the comparison before any window applies.
// ---------------------------------------------------------------------------

test("a different direction is never a duplicate", () => {
  const event = makeEvent({ direction: "out", channel: "push" });
  const recent = makeRecent({ direction: "in", channel: "sms" });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a different direction on one channel is not even a possible duplicate", () => {
  // Money moving both ways is never one movement told twice, so this is not the
  // undecidable case §6 rule 4 escalates — it is two transactions, and pushing
  // it to the Review Queue would be noise the user cannot act on.
  const event = makeEvent({ direction: "out", channel: "push" });
  const recent = makeRecent({ direction: "in", channel: "push" });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a different provider is never a duplicate", () => {
  const event = makeEvent({ providerKey: PROVIDER, channel: "push", referenceNo: "ABC123" });
  const twin = makeRecent({ providerKey: OTHER_PROVIDER, channel: "sms" });
  const sharedReference = makeRecent({
    providerKey: OTHER_PROVIDER,
    channel: "sms",
    referenceNo: "ABC123",
  });

  expect(checkDuplicate(event, [twin], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
  expect(checkDuplicate(event, [sharedReference], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a different amount is never a duplicate", () => {
  const event = makeEvent({ amount: HUNDRED_PESOS, channel: "push" });
  const recent = makeRecent({ amount: HUNDRED_PESOS + 1, channel: "sms" });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a manual transaction is never a strong-key duplicate", () => {
  // The row agrees on every field rule 1 reads — provider absent, reference,
  // amount, direction and window all lined up — so ONLY the `providerKey ===
  // null` check can save it. An implementation that skips the provider
  // comparison when the stored key is null treats null as a wildcard that
  // matches every provider, and this event disappears.
  const event = makeEvent({ referenceNo: "ABC123" });
  const recent = makeManual({
    referenceNo: "ABC123",
    occurredAt: OCCURRED_AT - 47 * HOUR,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a manual transaction is never a twin-window duplicate", () => {
  // Someone typed a ₱100.00 entry and a ₱100.00 notification landed a minute
  // later. Those may well be two different things, and only one of them is
  // recoverable if this gate is wrong.
  const event = makeEvent({ channel: "push" });
  const recent = makeManual();

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("an empty history is unique", () => {
  expect(checkDuplicate(makeEvent(), [], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

// ---------------------------------------------------------------------------
// Which row is reported, and which rule wins. `ofTransactionId` is what the
// pipeline links the pair by, so naming the wrong row links the wrong records.
// ---------------------------------------------------------------------------

test("the reported id is the matched row's, not the event's and not the first row's", () => {
  const event = makeEvent({ channel: "push" });
  const decoy = makeRecent({ transactionId: "tx_decoy", providerKey: OTHER_PROVIDER });
  const match = makeRecent({ transactionId: "tx_real_twin", channel: "sms" });

  expect(checkDuplicate(event, [decoy, match], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_real_twin",
  });
});

test("a strong-key match on one row outranks a twin-window match on another", () => {
  // Both rows are duplicates by some rule, and they name different
  // transactions. A shared provider reference is the more certain evidence, so
  // it decides — even though the other row is forty hours closer in time.
  const event = makeEvent({ channel: "push", referenceNo: "ABC123" });
  const twin = makeRecent({ transactionId: "tx_twin", channel: "sms" });
  const strong = makeRecent({
    transactionId: "tx_strong",
    channel: "sms",
    referenceNo: "ABC123",
    occurredAt: OCCURRED_AT - 40 * HOUR,
  });

  expect(checkDuplicate(event, [twin, strong], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_strong",
  });
});

test("a definite duplicate outranks an undecidable same-channel pair", () => {
  const event = makeEvent({ channel: "push" });
  const ambiguous = makeRecent({ transactionId: "tx_ambiguous", channel: "push" });
  const twin = makeRecent({ transactionId: "tx_twin", channel: "sms" });

  expect(checkDuplicate(event, [ambiguous, twin], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_twin",
  });
});

test("the nearest matching row in time is the one reported", () => {
  const event = makeEvent({ channel: "push" });
  const far = makeRecent({ transactionId: "tx_far", channel: "sms", occurredAt: OCCURRED_AT - 120 * SECOND });
  const near = makeRecent({ transactionId: "tx_near", channel: "sms", occurredAt: OCCURRED_AT - 30 * SECOND });

  expect(checkDuplicate(event, [far, near], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_near",
  });
});

// ---------------------------------------------------------------------------
// Both windows ship as ruleset data (spec §6 rule 6 / §11.1) so real-world twin
// timing can be corrected from the server. A literal in the code would make the
// remote knob look connected and do nothing.
// ---------------------------------------------------------------------------

test("the twin window is read from tunables, not inlined", () => {
  const event = makeEvent({ channel: "push" });
  const recent = makeRecent({
    transactionId: "tx_slow_relay",
    channel: "sms",
    occurredAt: OCCURRED_AT - 200 * SECOND,
  });

  // Unique at the shipped 180 s, a duplicate once the server widens the window.
  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
  expect(
    checkDuplicate(event, [recent], retuned({ dedupeTwinWindowMs: 600 * SECOND })),
  ).toEqual({ kind: "duplicate", ofTransactionId: "tx_slow_relay" });
});

test("the strong window is read from tunables, not inlined", () => {
  const event = makeEvent({ referenceNo: "ABC123" });
  const recent = makeRecent({
    transactionId: "tx_old",
    channel: "sms",
    referenceNo: "ABC123",
    occurredAt: OCCURRED_AT - 47 * HOUR,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_old",
  });
  expect(checkDuplicate(event, [recent], retuned({ dedupeStrongWindowMs: HOUR }))).toEqual({
    kind: "unique",
  });
});

test("the windows are measured between the events, never against a wall clock", () => {
  // Both fixtures are dated years before this test can ever run. A stage that
  // reached for `Date.now()` would put every one of them outside every window.
  const longAgo = 1_500_000_000_000;
  const event = makeEvent({ channel: "push", occurredAt: longAgo });
  const recent = makeRecent({
    transactionId: "tx_ancient",
    channel: "sms",
    occurredAt: longAgo - 60 * SECOND,
  });

  expect(checkDuplicate(event, [recent], DEFAULT_TUNABLES)).toEqual({
    kind: "duplicate",
    ofTransactionId: "tx_ancient",
  });
});

// ---------------------------------------------------------------------------
// The minted-leg exception (plan Task 14). A minted leg is not a hand-typed
// row asserting an independent movement — it is the app's OWN placeholder for
// this very notification, written the moment the user confirmed the transfer.
// So the provider notification that later arrives does not merely match it;
// it REPLACES it, and the verdict says so with a kind neither `duplicate` nor
// `possible-duplicate` can express.
// ---------------------------------------------------------------------------

/**
 * The minted placeholder: `source: "manual"` in spirit (no notification
 * behind it yet), but flagged `mintedTransferLeg: true` so the gate can tell
 * it apart from an ordinary hand-typed row it must never touch.
 */
function makeMintedLeg(overrides: Partial<RecentEvent> = {}): RecentEvent {
  return makeRecent({
    transactionId: "tx_minted",
    providerKey: null,
    channel: null,
    referenceNo: null,
    mintedTransferLeg: true,
    ...overrides,
  });
}

test("a provider notification supersedes the minted leg it describes", () => {
  const event = makeEvent({ amount: HUNDRED_PESOS, direction: "out", occurredAt: OCCURRED_AT + 60 * SECOND });
  const minted = makeMintedLeg({ amount: HUNDRED_PESOS, direction: "out", occurredAt: OCCURRED_AT });

  expect(checkDuplicate(event, [minted], DEFAULT_TUNABLES)).toEqual({
    kind: "supersedes",
    ofTransactionId: "tx_minted",
  });
});

test("an ordinary hand-typed row is still never a twin", () => {
  const event = makeEvent({ amount: HUNDRED_PESOS, direction: "out", occurredAt: OCCURRED_AT + 60 * SECOND });
  const notMinted = makeMintedLeg({
    amount: HUNDRED_PESOS,
    direction: "out",
    occurredAt: OCCURRED_AT,
    mintedTransferLeg: false,
  });

  expect(checkDuplicate(event, [notMinted], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a different direction is a different movement", () => {
  const event = makeEvent({ amount: HUNDRED_PESOS, direction: "in", occurredAt: OCCURRED_AT + 60 * SECOND });
  const minted = makeMintedLeg({ amount: HUNDRED_PESOS, direction: "out", occurredAt: OCCURRED_AT });

  expect(checkDuplicate(event, [minted], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("an amount outside tolerance falls through to the normal path", () => {
  // A minted leg was created EQUAL to the leg the user confirmed. An unequal
  // provider figure is evidence of a DIFFERENT movement, not of drift — so
  // this is not a near-miss that should still supersede, it is a `unique`.
  const event = makeEvent({ amount: HUNDRED_PESOS * 45, direction: "out", occurredAt: OCCURRED_AT + 60 * SECOND });
  const minted = makeMintedLeg({ amount: HUNDRED_PESOS, direction: "out", occurredAt: OCCURRED_AT });

  expect(checkDuplicate(event, [minted], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});

test("a minted leg outside the twin window is not superseded", () => {
  const event = makeEvent({
    amount: HUNDRED_PESOS,
    direction: "out",
    occurredAt: OCCURRED_AT + 5 * 24 * HOUR,
  });
  const minted = makeMintedLeg({ amount: HUNDRED_PESOS, direction: "out", occurredAt: OCCURRED_AT });

  expect(checkDuplicate(event, [minted], DEFAULT_TUNABLES)).toEqual({ kind: "unique" });
});
