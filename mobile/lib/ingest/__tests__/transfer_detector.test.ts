// lib/ingest/__tests__/transfer_detector.test.ts — Stage 5, the pairing stage.
//
// ILLUSTRATIVE ONLY. Every wallet id, amount and timestamp below is INVENTED for
// planning (docs/03-ingest-pipeline.md §11.4).
//
// WHAT THESE TESTS ARE GUARDING. A false transfer link hides a real expense AND a
// real income at the same moment: both legs stop counting toward spend, income,
// Limits and reports (domain invariant I2), the balances still move, and nothing
// on screen says why the totals are short. The spec's own example is a user
// sending ₱1,000.00 to a friend while receiving a ₱1,000.00 salary advance — link
// those and both disappear.
//
// So `auto_link` is the ONLY outcome that happens without asking, and §7 rule 4
// makes its bar deliberately high: exact amount, primary window, two known and
// distinct wallets, and exactly one candidate pairing. Everything short of that
// is an `ambiguous-transfer` the user confirms with one tap. Most assertions
// below are therefore about the boundary between "link it silently" and "ask" —
// and every one of them is written so that erring toward `auto_link` fails.
//
// THE WINDOWS ARE PINNED AT THEIR EDGES, not at comfortable distances. A `<`
// where the spec says "within" passes every test taken a safe distance from the
// boundary and fails only against real transfer timings.
//
// THE FEE TOLERANCE IS PINNED AT `≤ max(₱25.00, 1%)` ON BOTH ARMS, because the
// two arms cross over at ₱2,500.00 and an implementation that applies the floor
// as a percentage (or the percentage as a floor) is right on one side of that
// crossover and wrong on the other.
//
// EVERY TIMESTAMP IS AN OFFSET FROM ONE PINNED CONSTANT. This stage takes no
// `now` and reads no clock: its windows are distances between the two legs' own
// `occurredAt` stamps. The last test in the file proves it.
import { detectTransfer } from "@/lib/ingest/transfer_detector";
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";

import type { NormalizedEvent } from "@/lib/ingest/normalizer";
import type { PipelineTunables } from "@/lib/ingest/ruleset_types";
import type { MarkTransferRule } from "@/lib/ingest/transfer_detector";
import type { Transaction } from "@/types/domain";

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** Pinned. Nothing here is relative to the wall clock. */
const OCCURRED_AT = 1_754_100_000_000;

const PRIMARY_WINDOW = DEFAULT_TUNABLES.transferPrimaryWindowMs;
const EXTENDED_WINDOW = DEFAULT_TUNABLES.transferExtendedWindowMs;
/** ₱25.00 — the floor arm of `max(₱25.00, 1%)`. */
const FEE_FLOOR = DEFAULT_TUNABLES.transferFeeFloorCentavos;

/** The sending wallet in every fixture below. */
const BANK = "wallet_bpi";
/** The receiving wallet. Different from BANK — §7 rule 1's whole premise. */
const EWALLET = "wallet_gcash";
/** A third wallet, for the cases that need a competing leg. */
const SAVINGS = "wallet_seabank";

/** ₱1,000.00 — the spec's own example amount for the coincidence failure. */
const THOUSAND_PESOS = 100_000;
/** ₱10,000.00 — large enough that the 1% arm beats the ₱25.00 floor. */
const TEN_THOUSAND_PESOS = 1_000_000;

/**
 * The incoming event: ₱1,000.00 leaving the bank wallet. Tests override exactly
 * the field they are about, so anything left at the default is a field that rule
 * does not discriminate on.
 */
function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    providerKey: "test_provider",
    amount: THOUSAND_PESOS,
    direction: "out",
    occurredAt: OCCURRED_AT,
    confidence: 1,
    walletId: BANK,
    channel: "push",
    ...overrides,
  };
}

/**
 * One already-committed transaction, as `transactions_repo` returns it.
 *
 * Defaults to the matching in-leg five minutes later — the shape §7 exists for.
 * `transferLinkId: null` is the default because a row that is already half of a
 * link is not available to become half of another (domain §3.3 invariant 3).
 */
function makeCandidate(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx_in_leg",
    walletId: EWALLET,
    categoryId: "cat_uncategorized",
    amount: THOUSAND_PESOS,
    direction: "in",
    occurredAt: OCCURRED_AT + 5 * MINUTE,
    merchant: null,
    counterparty: null,
    referenceNo: null,
    source: "notification",
    confidence: 1,
    rawNotificationId: null,
    transferLinkId: null,
    note: null,
    balanceAfter: null,
    computedBalance: null,
    isAdjustment: false,
    createdAt: OCCURRED_AT,
    updatedAt: OCCURRED_AT,
    ...overrides,
  };
}

/** `DEFAULT_TUNABLES` with one knob moved, to prove the value is read and not inlined. */
function retuned(overrides: Partial<PipelineTunables>): PipelineTunables {
  return { ...DEFAULT_TUNABLES, ...overrides };
}

// ---------------------------------------------------------------------------
// Rule 4 — the auto-link threshold, the only silent outcome.
// ---------------------------------------------------------------------------

test("an exact-amount pair in different wallets 5 minutes apart auto-links", () => {
  // Every clause of §7 rule 4 satisfied at once: exact amount, both legs inside
  // the primary window, two known and distinct wallets, one candidate pairing.
  // This is the ≥90% auto-link target's happy path.
  const event = makeEvent();
  const candidate = makeCandidate({ id: "tx_gcash_cash_in" });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "auto_link",
    counterpartTransactionId: "tx_gcash_cash_in",
  });
});

test("an in-leg event auto-links to its out-leg candidate", () => {
  // The two legs arrive in whichever order the providers post them, and the
  // receiving side is often first. Orientation must come from each leg's own
  // direction, not from an assumption that the event is the out-leg.
  const event = makeEvent({ direction: "in", walletId: EWALLET });
  const candidate = makeCandidate({
    id: "tx_bank_debit",
    walletId: BANK,
    direction: "out",
    occurredAt: OCCURRED_AT - 2 * MINUTE,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "auto_link",
    counterpartTransactionId: "tx_bank_debit",
  });
});

test("the counterpart's timestamp may be earlier or later than the event's", () => {
  // The window is a distance, not an ordering. A subtraction that forgot its
  // absolute value silently stops linking one of the two arrival orders.
  const event = makeEvent();
  const earlier = makeCandidate({ id: "tx_earlier", occurredAt: OCCURRED_AT - 5 * MINUTE });
  const later = makeCandidate({ id: "tx_later", occurredAt: OCCURRED_AT + 5 * MINUTE });

  expect(detectTransfer(event, [earlier], DEFAULT_TUNABLES)).toEqual({
    kind: "auto_link",
    counterpartTransactionId: "tx_earlier",
  });
  expect(detectTransfer(event, [later], DEFAULT_TUNABLES)).toEqual({
    kind: "auto_link",
    counterpartTransactionId: "tx_later",
  });
});

test("no candidates at all is not a transfer", () => {
  expect(detectTransfer(makeEvent(), [], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
});

// ---------------------------------------------------------------------------
// Rule 2 — the windows. Primary (15 min) auto-links; extended (24 h) NEVER
// does, however perfect the pair looks otherwise.
// ---------------------------------------------------------------------------

test("the same exact pair 20 minutes apart is an extended-window proposal, never a link", () => {
  // §7 rule 2.2: "Pairs found only in the extended window are never auto-linked."
  // The `reason` is asserted, not merely "it wasn't auto_link" — an
  // implementation that returned `multiple_candidates` or `fee_delta` here would
  // route correctly today and mislabel the Review Queue item forever.
  const event = makeEvent();
  const candidate = makeCandidate({
    id: "tx_batched_interbank",
    occurredAt: OCCURRED_AT + 20 * MINUTE,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_batched_interbank",
    reason: "extended_window",
  });
});

test("a pair exactly at the primary window still auto-links", () => {
  // "within 15 minutes" — inclusive.
  const event = makeEvent();
  const candidate = makeCandidate({
    id: "tx_edge_primary",
    occurredAt: OCCURRED_AT + PRIMARY_WINDOW,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "auto_link",
    counterpartTransactionId: "tx_edge_primary",
  });
});

test("a pair one millisecond past the primary window is an extended-window proposal", () => {
  const event = makeEvent();
  const candidate = makeCandidate({
    id: "tx_just_past_primary",
    occurredAt: OCCURRED_AT + PRIMARY_WINDOW + 1,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_just_past_primary",
    reason: "extended_window",
  });
});

test("a pair exactly at the extended window is still a proposal", () => {
  // "up to 24 hours" — inclusive at the far edge too.
  const event = makeEvent();
  const candidate = makeCandidate({
    id: "tx_edge_extended",
    occurredAt: OCCURRED_AT + EXTENDED_WINDOW,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_edge_extended",
    reason: "extended_window",
  });
});

test("a pair one millisecond past the extended window is not a candidate at all", () => {
  // Beyond 24 hours the two legs are unrelated. Proposing them would be noise
  // the user has to clear, and §7 offers no window wider than this one.
  const event = makeEvent();
  const candidate = makeCandidate({
    id: "tx_unrelated",
    occurredAt: OCCURRED_AT + EXTENDED_WINDOW + 1,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
});

// ---------------------------------------------------------------------------
// Rule 3 — the fee tolerance, `≤ max(₱25.00, 1% of out.amount)`. A fee-tolerant
// pair is "plausible" (rule 3.2) and is NEVER auto-linked.
// ---------------------------------------------------------------------------

test("a ₱20.00 fee on a ₱1,000.00 transfer is a proposal, not a link and not a rejection", () => {
  // Both neighbouring answers are wrong: auto-linking guesses that a ₱20.00 gap
  // is a fee, and rejecting outright loses the commonest real transfer shape on
  // PH rails. §7 rule 3.2 routes it for one-tap confirmation.
  const event = makeEvent({ amount: THOUSAND_PESOS });
  const candidate = makeCandidate({
    id: "tx_after_fee",
    amount: THOUSAND_PESOS - 2_000,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_after_fee",
    reason: "fee_delta",
  });
});

test("a ₱30.00 delta on a ₱1,000.00 transfer exceeds the ₱25.00 floor and is not a candidate", () => {
  // `max(₱25.00, 1% of ₱1,000.00)` is `max(2500, 1000)` = ₱25.00, and the delta
  // is ₱30.00. An implementation that used the percentage where the floor wins
  // would accept this; one that used the floor as a ceiling everywhere would
  // reject the ₱40.00-on-₱10,000.00 case below. Both arms are needed.
  const event = makeEvent({ amount: THOUSAND_PESOS });
  const candidate = makeCandidate({ amount: THOUSAND_PESOS - 3_000 });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
});

test("a ₱40.00 delta on a ₱10,000.00 transfer is inside the 1% arm", () => {
  // `max(2500, 10000)` = ₱100.00, so ₱40.00 is tolerated even though it is well
  // past the ₱25.00 floor. This is the case that proves the 1% arm can win.
  const event = makeEvent({ amount: TEN_THOUSAND_PESOS });
  const candidate = makeCandidate({
    id: "tx_one_percent_arm",
    amount: TEN_THOUSAND_PESOS - 4_000,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_one_percent_arm",
    reason: "fee_delta",
  });
});

test("a delta of exactly max(₱25.00, 1%) is within tolerance on both arms", () => {
  // §7 rule 3.2 says `≤`. Written as `<`, an implementation rejects the pair
  // whose fee lands exactly on the threshold — and rails charge round numbers,
  // so the boundary is where real fees actually sit.
  const floorArm = makeEvent({ amount: THOUSAND_PESOS });
  const atFloor = makeCandidate({
    id: "tx_at_floor",
    amount: THOUSAND_PESOS - FEE_FLOOR, // max(2500, 1000) = 2500
  });

  const rateArm = makeEvent({ amount: TEN_THOUSAND_PESOS });
  const atRate = makeCandidate({
    id: "tx_at_rate",
    amount: TEN_THOUSAND_PESOS - 10_000, // max(2500, 10000) = 10000
  });

  expect(detectTransfer(floorArm, [atFloor], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_at_floor",
    reason: "fee_delta",
  });
  expect(detectTransfer(rateArm, [atRate], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_at_rate",
    reason: "fee_delta",
  });
});

test("one centavo past the tolerance is not a candidate on either arm", () => {
  const floorArm = makeEvent({ amount: THOUSAND_PESOS });
  const pastFloor = makeCandidate({ amount: THOUSAND_PESOS - FEE_FLOOR - 1 });

  const rateArm = makeEvent({ amount: TEN_THOUSAND_PESOS });
  const pastRate = makeCandidate({ amount: TEN_THOUSAND_PESOS - 10_001 });

  expect(detectTransfer(floorArm, [pastFloor], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
  expect(detectTransfer(rateArm, [pastRate], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
});

test("the 1% is taken from the out leg, never from the in leg", () => {
  // ₱99.50 off a ₱10,000.00 transfer. `1% of out` is ₱100.00 and tolerates it;
  // `1% of in` is ₱99.005 and does not. §7 rule 3.2 says "1% of out.amount", and
  // the difference only ever shows up when the event is the IN leg, because that
  // is when `event.amount` is the wrong base to reach for.
  const event = makeEvent({
    direction: "in",
    walletId: EWALLET,
    amount: TEN_THOUSAND_PESOS - 9_950,
  });
  const candidate = makeCandidate({
    id: "tx_out_leg_base",
    walletId: BANK,
    direction: "out",
    amount: TEN_THOUSAND_PESOS,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_out_leg_base",
    reason: "fee_delta",
  });
});

test("receiving more than was sent is not a fee and is never tolerated", () => {
  // §7 rule 3.2's precondition is `in.amount < out.amount`. A larger in-leg is
  // not a rail fee — it is a different transaction, or a promo credit that is
  // real income. Tolerating the delta in this direction would let the detector
  // absorb ₱20.00 of genuine income into a transfer and erase it from totals.
  const event = makeEvent({ amount: THOUSAND_PESOS });
  const candidate = makeCandidate({ amount: THOUSAND_PESOS + 2_000 });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
});

// ---------------------------------------------------------------------------
// Rule 1 — what is not even a candidate pair.
// ---------------------------------------------------------------------------

test("two legs in the same wallet are never a transfer", () => {
  // A wallet's two notifications for one event, or a purchase and its refund in
  // one account. Money that never left the wallet did not move between wallets,
  // and §7 rule 1 requires DIFFERENT wallets.
  const event = makeEvent({ walletId: BANK });
  const candidate = makeCandidate({ walletId: BANK });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
});

test("two legs moving the same way are never a transfer", () => {
  // Two outflows are two payments. A transfer has exactly one of each leg
  // (domain §3.3 invariant 1); linking two `out` rows would hide two real
  // expenses and invent a movement that never happened.
  const event = makeEvent({ direction: "out" });
  const candidate = makeCandidate({ direction: "out", walletId: EWALLET });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
});

test("an event whose wallet is unresolved never links", () => {
  // `NormalizedEvent.walletId` is `null` when the Normalizer could not tell which
  // account the money came from (§5) — already a hard route to the Review Queue
  // (§9.2). §7 rule 4 requires both wallets KNOWN and distinct, and with `null`
  // the "different wallets" precondition cannot be established at all: the
  // counterpart could be in the very wallet this event belongs to. Writing a
  // transfer against an account we could not identify is the one thing worse
  // than not writing one, so the pair is not a candidate.
  const event = makeEvent({ walletId: null });
  const candidate = makeCandidate({ id: "tx_perfect_but_unusable" });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
});

test("a candidate already linked to another transfer is never a counterpart", () => {
  // Domain §3.3 invariant 3: a Transaction belongs to at most one Transfer Link.
  // This filter is also what keeps a repeated transfer auto-linking — yesterday's
  // identical ₱1,000.00 leg sits inside the 24-hour extended window and would
  // otherwise compete with today's, so an unfiltered detector degrades every
  // habitual transfer to a Review Queue item.
  const event = makeEvent();
  const spent = makeCandidate({ id: "tx_already_paired", transferLinkId: "link_yesterday" });

  expect(detectTransfer(event, [spent], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
});

// ---------------------------------------------------------------------------
// Rule 4's single-pairing clause, and the money-hiding failure it exists for.
// ---------------------------------------------------------------------------

test("two exact candidates are never silently resolved", () => {
  const event = makeEvent();
  const first = makeCandidate({ id: "tx_gcash", walletId: EWALLET, occurredAt: OCCURRED_AT + MINUTE });
  const second = makeCandidate({
    id: "tx_seabank",
    walletId: SAVINGS,
    occurredAt: OCCURRED_AT + 2 * MINUTE,
  });

  const verdict = detectTransfer(event, [first, second], DEFAULT_TUNABLES);

  expect(verdict).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_gcash",
    reason: "multiple_candidates",
  });
});

test("the spec's coincidence case is a proposal, never a silent link", () => {
  // §7's named failure mode: ₱1,000.00 sent to a friend while a ₱1,000.00 salary
  // advance lands, both inside the primary window. Link them and the expense and
  // the income both vanish from every total with nothing on screen to explain it.
  //
  // What this proves is bounded, and the bound is worth stating: with a second
  // candidate present, rule 4's single-pairing clause catches it. With only the
  // salary advance in range the pair is indistinguishable from a real transfer
  // and WILL auto-link — that residual risk is accepted by the spec, whose
  // mitigation is the unlink UI (§7 rule 7), not a cleverer detector.
  const sentToFriend = makeEvent({ amount: THOUSAND_PESOS, walletId: BANK });
  const salaryAdvance = makeCandidate({
    id: "tx_salary_advance",
    walletId: EWALLET,
    amount: THOUSAND_PESOS,
    occurredAt: OCCURRED_AT + 3 * MINUTE,
  });
  const realTransferLeg = makeCandidate({
    id: "tx_savings_top_up",
    walletId: SAVINGS,
    amount: THOUSAND_PESOS,
    occurredAt: OCCURRED_AT + 8 * MINUTE,
  });

  expect(detectTransfer(sentToFriend, [salaryAdvance, realTransferLeg], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_salary_advance",
    reason: "multiple_candidates",
  });
});

test("a fee-tolerant second candidate also defeats the single-pairing clause", () => {
  // Rule 3.2 calls a fee-tolerant pair "plausible", so it is a candidate pairing
  // and it competes. Counting only exact matches would auto-link the exact leg
  // while a second, equally plausible partner sat in range unmentioned.
  const event = makeEvent();
  const exact = makeCandidate({ id: "tx_exact", walletId: EWALLET, occurredAt: OCCURRED_AT + MINUTE });
  const afterFee = makeCandidate({
    id: "tx_after_fee",
    walletId: SAVINGS,
    amount: THOUSAND_PESOS - 1_500,
    occurredAt: OCCURRED_AT + 2 * MINUTE,
  });

  expect(detectTransfer(event, [exact, afterFee], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_exact",
    reason: "multiple_candidates",
  });
});

test("a competing candidate for the COUNTERPART's leg also defeats auto-link", () => {
  // §7 rule 4: "no competing candidates for EITHER leg". Two wallets each sent
  // ₱1,000.00 minutes apart and one wallet received ₱1,000.00 — the receiving
  // leg has two possible sources, and picking either is a coin flip that hides a
  // real expense. An implementation that only counts candidates for the event's
  // own side sees exactly one pairing here and links it.
  const event = makeEvent({ direction: "out", walletId: BANK });
  const receivingLeg = makeCandidate({
    id: "tx_gcash_receipt",
    walletId: EWALLET,
    direction: "in",
    occurredAt: OCCURRED_AT + MINUTE,
  });
  const otherSender = makeCandidate({
    id: "tx_seabank_debit",
    walletId: SAVINGS,
    direction: "out",
    occurredAt: OCCURRED_AT + 2 * MINUTE,
  });

  expect(detectTransfer(event, [receivingLeg, otherSender], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_gcash_receipt",
    reason: "multiple_candidates",
  });
});

test("a same-direction row that cannot pair with the counterpart does not compete", () => {
  // The mirror of the test above, and the reason the competing check is bounded
  // by the PRIMARY window: a habitual transfer repeats the same amount daily, so
  // an unlinked leg from hours ago sits inside the 24-hour extended window
  // forever. Treating that as competition would push every repeated transfer to
  // the Review Queue and forfeit the ≥90% auto-link target.
  const event = makeEvent({ direction: "out", walletId: BANK });
  const receivingLeg = makeCandidate({
    id: "tx_gcash_receipt",
    walletId: EWALLET,
    direction: "in",
    occurredAt: OCCURRED_AT + MINUTE,
  });
  const yesterdaysOrphan = makeCandidate({
    id: "tx_orphaned_debit",
    walletId: SAVINGS,
    direction: "out",
    occurredAt: OCCURRED_AT - 20 * HOUR,
  });

  expect(detectTransfer(event, [receivingLeg, yesterdaysOrphan], DEFAULT_TUNABLES)).toEqual({
    kind: "auto_link",
    counterpartTransactionId: "tx_gcash_receipt",
  });
});

// ---------------------------------------------------------------------------
// Which row is named. `counterpartTransactionId` is what the pipeline links the
// pair by, so naming the wrong row links the wrong two transactions.
// ---------------------------------------------------------------------------

test("the reported id is the matched row's, not the first row's", () => {
  const event = makeEvent();
  const sameWalletDecoy = makeCandidate({ id: "tx_decoy_same_wallet", walletId: BANK });
  const sameDirectionDecoy = makeCandidate({ id: "tx_decoy_same_direction", direction: "out" });
  const match = makeCandidate({ id: "tx_real_counterpart" });

  expect(
    detectTransfer(event, [sameWalletDecoy, sameDirectionDecoy, match], DEFAULT_TUNABLES),
  ).toEqual({
    kind: "auto_link",
    counterpartTransactionId: "tx_real_counterpart",
  });
});

test("the exact-amount pairing is the one proposed when several compete", () => {
  // The verdict is `multiple_candidates` either way — the user is choosing, not
  // accepting — but the row offered first should be the likelier partner, and an
  // exact amount outranks being thirty seconds nearer.
  const event = makeEvent();
  const nearerButFeeTolerant = makeCandidate({
    id: "tx_nearer_fee",
    walletId: SAVINGS,
    amount: THOUSAND_PESOS - 1_000,
    occurredAt: OCCURRED_AT + 30_000,
  });
  const exact = makeCandidate({
    id: "tx_exact_partner",
    walletId: EWALLET,
    occurredAt: OCCURRED_AT + 4 * MINUTE,
  });

  expect(detectTransfer(event, [nearerButFeeTolerant, exact], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_exact_partner",
    reason: "multiple_candidates",
  });
});

// ---------------------------------------------------------------------------
// Every threshold ships as ruleset data (§7 rule 3.3 / §11.1) so the windows and
// the fee schedule can be recalibrated from the server. A literal in the code
// makes the remote knob look connected and do nothing.
// ---------------------------------------------------------------------------

test("the primary window is read from tunables, not inlined", () => {
  const event = makeEvent();
  const candidate = makeCandidate({
    id: "tx_slow_rail",
    occurredAt: OCCURRED_AT + 20 * MINUTE,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_slow_rail",
    reason: "extended_window",
  });
  expect(
    detectTransfer(event, [candidate], retuned({ transferPrimaryWindowMs: 30 * MINUTE })),
  ).toEqual({ kind: "auto_link", counterpartTransactionId: "tx_slow_rail" });
});

test("the extended window is read from tunables, not inlined", () => {
  const event = makeEvent();
  const candidate = makeCandidate({
    id: "tx_next_day",
    occurredAt: OCCURRED_AT + 20 * HOUR,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_next_day",
    reason: "extended_window",
  });
  expect(detectTransfer(event, [candidate], retuned({ transferExtendedWindowMs: HOUR }))).toEqual({
    kind: "none",
  });
});

test("the fee floor is read from tunables, not inlined", () => {
  const event = makeEvent({ amount: THOUSAND_PESOS });
  const candidate = makeCandidate({ id: "tx_big_fee", amount: THOUSAND_PESOS - 3_000 });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({ kind: "none" });
  expect(
    detectTransfer(event, [candidate], retuned({ transferFeeFloorCentavos: 5_000 })),
  ).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_big_fee",
    reason: "fee_delta",
  });
});

test("the fee rate is read from tunables and stays exact at its boundary", () => {
  // Two claims in one fixture, because the second only shows up at a retuned rate.
  //
  // ₱48,100.00 out, ₱81.77 delta, rate 0.17%. The exact tolerance is 8177
  // centavos and the delta is 8177, so §7 rule 3.2's `≤` includes it. In IEEE-754
  // `0.0017 * 4_810_000` is `8176.999999999999` — a hair BELOW the true value —
  // so a float comparison rejects a pair that lands exactly on the threshold, and
  // rejects it silently. Multiplying through instead (`delta * 10_000 ≤
  // max(floor * 10_000, out * rateBps)`) keeps every term an integer number of
  // centavos, which is the only quantity that exists here.
  const event = makeEvent({ amount: 4_810_000 });
  const candidate = makeCandidate({ id: "tx_exact_rate_boundary", amount: 4_810_000 - 8_177 });

  // At the shipped 1% the tolerance is ₱481.00, so this ₱81.77 delta is
  // comfortably inside it — the pair is fee-tolerant before anything is retuned.
  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_exact_rate_boundary",
    reason: "fee_delta",
  });

  // At 0.17% the delta sits exactly on the threshold — included, not excluded.
  expect(detectTransfer(event, [candidate], retuned({ transferFeeRate: 0.0017 }))).toEqual({
    kind: "ambiguous-transfer",
    counterpartTransactionId: "tx_exact_rate_boundary",
    reason: "fee_delta",
  });

  // One centavo more and the same retuned rate rejects it, so the assertion
  // above is pinning the boundary rather than a permissive comparison.
  const oneCentavoMore = makeCandidate({ amount: 4_810_000 - 8_178 });
  expect(
    detectTransfer(event, [oneCentavoMore], retuned({ transferFeeRate: 0.0017 })),
  ).toEqual({ kind: "none" });
});

test("the windows are measured between the legs, never against a wall clock", () => {
  // Both fixtures are dated years before this test can ever run. A stage that
  // reached for `Date.now()` would put every pair outside every window.
  const longAgo = 1_500_000_000_000;
  const event = makeEvent({ occurredAt: longAgo });
  const candidate = makeCandidate({
    id: "tx_ancient_counterpart",
    occurredAt: longAgo + 5 * MINUTE,
  });

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES)).toEqual({
    kind: "auto_link",
    counterpartTransactionId: "tx_ancient_counterpart",
  });
});

// ---------------------------------------------------------------------------
// The `one_sided` verdict — a movement where only one leg was ever captured,
// because the other account posts no notification (a bank-funded GCash
// cash-in, an ATM withdrawal into cash). `pairingsFor` finds nothing, and
// nothing here MINTS a counterpart row: `one_sided` only ever proposes.
// ---------------------------------------------------------------------------

test("a pairing always outranks a one-sided guess", () => {
  // The event carries `transferIntent` AND a matching rule points at a third
  // wallet, and neither should matter: `pairingsFor` found a real counterpart,
  // and a real pairing always outranks a one-sided guess.
  const event = makeEvent({ direction: "out", walletId: BANK, transferIntent: true });
  const candidate = makeCandidate();
  const rules: MarkTransferRule[] = [
    { matcher: {}, counterpartWalletId: SAVINGS, priority: 100 },
  ];

  expect(detectTransfer(event, [candidate], DEFAULT_TUNABLES, rules)).toEqual({
    kind: "auto_link",
    counterpartTransactionId: "tx_in_leg",
  });
});

test("a text signal with no pairing proposes a one-sided transfer", () => {
  const event = makeEvent({ direction: "in", walletId: EWALLET, transferIntent: true });

  expect(detectTransfer(event, [], DEFAULT_TUNABLES, [])).toEqual({
    kind: "one_sided",
    counterpartWalletId: null,
    signal: "text",
  });
});

test("a matching rule supplies the wallet and wins the prefill", () => {
  const event = makeEvent({
    direction: "in",
    walletId: EWALLET,
    providerKey: "gcash",
    transferIntent: true,
  });
  const rules: MarkTransferRule[] = [
    { matcher: { providerKey: "gcash" }, counterpartWalletId: BANK, priority: 100 },
  ];

  expect(detectTransfer(event, [], DEFAULT_TUNABLES, rules)).toEqual({
    kind: "one_sided",
    counterpartWalletId: BANK,
    signal: "rule",
  });
});

test("two matching rules of different priority pick the higher-priority wallet", () => {
  // The previous task's review found "highest-priority rule wins" resting on
  // code inspection alone — no test exercised two matching rules at once. The
  // wallet this returns is a PREFILL on the one-sided card, and a wrong winner
  // mints a ledger row on the wrong account if the user confirms without
  // reading, so the ordering needs a real assertion, not a read of `sort`.
  //
  // The array is given in ASCENDING priority order on purpose: an
  // implementation that forgot to sort, or sorted ascending instead of
  // descending, would return `matches[0]` as BANK (priority 10) and fail this
  // test. Only a correct descending sort by priority returns SAVINGS.
  const event = makeEvent({
    direction: "in",
    walletId: EWALLET,
    providerKey: "gcash",
    transferIntent: true,
  });
  const rules: MarkTransferRule[] = [
    { matcher: { providerKey: "gcash" }, counterpartWalletId: BANK, priority: 10 },
    { matcher: { providerKey: "gcash" }, counterpartWalletId: SAVINGS, priority: 50 },
  ];

  expect(detectTransfer(event, [], DEFAULT_TUNABLES, rules)).toEqual({
    kind: "one_sided",
    counterpartWalletId: SAVINGS,
    signal: "rule",
  });
});

test("a rule naming the event's own wallet is ignored", () => {
  // A stale rule pointing at the event's own wallet must not produce a card
  // offering to link a wallet to itself — it is discarded, not offered.
  const event = makeEvent({ direction: "in", walletId: EWALLET, providerKey: "gcash" });
  const rules: MarkTransferRule[] = [
    { matcher: { providerKey: "gcash" }, counterpartWalletId: EWALLET, priority: 100 },
  ];

  expect(detectTransfer(event, [], DEFAULT_TUNABLES, rules)).toEqual({ kind: "none" });
});

test("no signal and no rule stays none", () => {
  const event = makeEvent({ direction: "out", walletId: EWALLET, amount: 25_000 });

  expect(detectTransfer(event, [], DEFAULT_TUNABLES, [])).toEqual({ kind: "none" });
});

test("an unresolved wallet never proposes a one-sided transfer", () => {
  // §5.4 of the design spec: with `walletId === null` the distinctness of the
  // two sides cannot even be established, so proposing a transfer against an
  // account we could not identify is worse than proposing none.
  const event = makeEvent({ direction: "in", walletId: null, transferIntent: true });

  expect(detectTransfer(event, [], DEFAULT_TUNABLES, [])).toEqual({ kind: "none" });
});
