// lib/ingest/transfer_detector.ts — Stage 5, the stage that can hide two
// transactions with one decision.
//
// docs/03-ingest-pipeline.md §7. Moving money between the user's own wallets —
// a bank→GCash cash-in, a GCash→SeaBank padala to self — produces an `out` in
// one wallet and an `in` in another. Left unpaired, the pair inflates both spend
// and income. This stage pairs the legs into a TransferLink, and linked legs
// stop counting toward spend, income, Limits and reports while still moving the
// wallet balances (domain invariant I2). Target: ≥90% of internal transfers
// auto-linked.
//
// WHY THE BAR FOR `auto_link` IS SO HIGH. Every wrong answer this stage can give
// is silent, but they are not symmetric:
//
//   MISSED LINK — the transfer is counted as a real expense and a real income.
//   Both totals are inflated, a Limit may trip early, and the user can see all of
//   it: two transactions are sitting in the ledger with a "link as transfer"
//   action next to them (§7 failure modes).
//
//   FALSE LINK — two UNRELATED transactions stop counting. The spec's own
//   example is sending ₱1,000.00 to a friend while a ₱1,000.00 salary advance
//   lands: the expense and the income both vanish from every total at once, the
//   balances still move so nothing looks broken, and there is no row to inspect
//   because the damage is the ABSENCE of two rows from every sum.
//
// One is a visible overcount with a one-tap fix; the other is invisible. So
// `auto_link` is the only outcome that happens without asking, §7 rule 4 loads
// it with four simultaneous conditions, and everything short of that becomes an
// `ambiguous-transfer` the user confirms with one tap. When in doubt, propose.
//
// WHAT IS DELIBERATELY NOT HERE:
//
//   - §7 rule 5 (fee accounting) is the committer's job: `feeAmount` is derived
//     from the linked pair (`outLeg.amount − inLeg.amount`), so this stage only
//     has to decide WHETHER a delta is a plausible fee, never record it.
//   - §7 rule 6 (cash legs never auto-link) needs each leg's WALLET TYPE, and a
//     `Transaction` carries only a `walletId`. It is really a Review Queue
//     affordance anyway — a cash leg has at most one notification, so the second
//     leg does not exist until the user records it, and that flow creates the
//     link explicitly.
//   - §7 rule 7 (unlink) is a ledger operation, not a detection rule.
//   - Rule 4's "one leg still uncommitted in the Review Queue" is decided by
//     what the orchestrator puts in `candidates`; an uncommitted leg is not a
//     `Transaction` and cannot appear here.
//
// Pure: no I/O, no clock, no database, and NO `now`. Both windows are distances
// between the two legs' own `occurredAt` stamps, so the whole stage is a
// function of its three arguments.
import type { NormalizedEvent } from "@/lib/ingest/normalizer";
import type { PipelineTunables } from "@/lib/ingest/ruleset_types";
import type { Centavos, EpochMs, Transaction, TxDirection } from "@/types/domain";

/**
 * Why a plausible pair was not linked outright. Each maps to one clause of §7
 * rule 4, and all three route to the same place — the Review Queue, as
 * `ambiguous-transfer` (`ReviewKind`, `types/domain.ts`) with a one-tap confirm.
 * They differ only in what the item has to explain to the user.
 */
export type TransferAmbiguity = "fee_delta" | "extended_window" | "multiple_candidates";

/**
 * The verdict. Plan Task 7 / consumed by `confidence_gate.ts` (Task 9) and the
 * committer.
 *
 * `counterpartTransactionId` is the id of the ALREADY-COMMITTED row this event
 * pairs with — never the event's own. The pipeline links the pair by it, so the
 * wrong id links the wrong two transactions and hides the wrong two amounts.
 */
export type TransferVerdict =
  | { kind: "none" }
  | { kind: "auto_link"; counterpartTransactionId: string }
  | {
      kind: "ambiguous-transfer";
      counterpartTransactionId: string;
      reason: TransferAmbiguity;
    };

/**
 * Fee arithmetic in ten-thousandths, for the reason `parser.ts` and
 * `normalizer.ts` scale their confidence: floating point has already cost this
 * pipeline two bugs, and here the quantity being compared is CENTAVOS — integers
 * by definition (`Centavos`, contract §3). `transferFeeRate * out.amount`
 * produces fractional centavos, a quantity that does not exist, and the dust
 * lands exactly on §7 rule 3.2's inclusive `≤`: at a fee rate of 0.0017 and an
 * out-leg of ₱48,100.00 the true tolerance is 8177 centavos but IEEE-754 says
 * 8176.999999999999, so a fee sitting precisely on the threshold is rejected.
 *
 * Multiplying both sides through by this scale keeps every term an integer:
 *
 *   delta * RATE_SCALE  ≤  max(feeFloor * RATE_SCALE, out.amount * rateScaled)
 *
 * 10_000 rather than 100 so a rate can be retuned to a basis point (0.0017 →
 * 17) without losing precision; a shipped 1% is 100. Headroom is ample —
 * ₱10,000,000.00 is 1e9 centavos and 1e9 * 10_000 is 1e13, three orders below
 * `Number.MAX_SAFE_INTEGER`.
 */
const RATE_SCALE = 10_000;

/**
 * One side of a candidate pair, reduced to the four facts §7 rules 1–3 read.
 *
 * `walletId` is nullable because a `NormalizedEvent`'s is: the Normalizer
 * returns `null` when it could not tell which account the money came from (§5),
 * and that possibility has to survive into the comparison rather than be
 * asserted away. A committed `Transaction` always has one.
 */
type Leg = {
  walletId: string | null;
  amount: Centavos;
  direction: TxDirection;
  occurredAt: EpochMs;
};

/** The same pair, oriented by direction — which §7 rule 3 needs to say "out". */
type OrientedPair = { out: Centavos; in: Centavos };

const eventLeg = (event: NormalizedEvent): Leg => ({
  walletId: event.walletId,
  amount: event.amount,
  direction: event.direction,
  occurredAt: event.occurredAt,
});

const transactionLeg = (transaction: Transaction): Leg => ({
  walletId: transaction.walletId,
  amount: transaction.amount,
  direction: transaction.direction,
  occurredAt: transaction.occurredAt,
});

/**
 * `null` when the two legs move the same way, and so are not a transfer at all.
 *
 * Two outflows are two payments; linking them would hide two real expenses and
 * invent a movement that never happened. A TransferLink has exactly one leg of
 * each direction (domain §3.3 invariant 1).
 */
function orient(a: Leg, b: Leg): OrientedPair | null {
  if (a.direction === b.direction) return null;

  return a.direction === "out" ? { out: a.amount, in: b.amount } : { out: b.amount, in: a.amount };
}

/**
 * Spec §7 rule 3.2 — `in.amount < out.amount` and
 * `(out.amount − in.amount) ≤ max(₱25.00, 1% of out.amount)`.
 *
 * THE `in < out` PRECONDITION IS LOAD BEARING and is not merely "the amounts are
 * close". A delta in the other direction — receiving MORE than was sent — is not
 * a rail fee. It is either a different transaction, or a promo credit that is
 * genuine income; tolerating it would let the detector absorb real money into a
 * transfer and erase it from every total.
 *
 * BOTH ARMS ARE NEEDED, and they cross over at ₱2,500.00. Below that the ₱25.00
 * floor is the larger and the percentage would reject ordinary fees; above it
 * the percentage is the larger and the floor would reject a proportionate one.
 * An implementation that keeps only one arm is correct on exactly one side of
 * the crossover.
 */
function isFeeTolerant(pair: OrientedPair, tunables: PipelineTunables): boolean {
  if (pair.in >= pair.out) return false;

  const delta = pair.out - pair.in;
  const rateScaled = Math.round(tunables.transferFeeRate * RATE_SCALE);
  const tolerance = Math.max(
    tunables.transferFeeFloorCentavos * RATE_SCALE,
    pair.out * rateScaled,
  );

  // `≤`, per §7 rule 3.2. Rails charge round numbers, so the boundary is where
  // real fees actually sit.
  return delta * RATE_SCALE <= tolerance;
}

/** §7 rule 3.1 — the only amount relation eligible for `auto_link`. */
const isExactMatch = (pair: OrientedPair): boolean => pair.in === pair.out;

/**
 * Everything §7 rule 1 demands of a pair before any window is considered: one
 * `out` and one `in`, in DIFFERENT and KNOWN wallets, at a plausible amount.
 *
 * AN UNRESOLVED WALLET FAILS HERE, and that is the whole answer to "what if the
 * event's wallet is `null`?". Rule 4 requires both wallets known and distinct,
 * and with `null` the distinctness cannot even be established — the counterpart
 * could be sitting in the very wallet this event belongs to, which is the
 * same-wallet case rule 1 excludes. Such an event is already a hard route to the
 * Review Queue (§9.2), so nothing is lost silently: the user assigns the wallet
 * there, and the pair can be linked from the ledger afterwards. Proposing a
 * transfer against an account we could not identify is the one outcome worse
 * than proposing none.
 */
function canPair(a: Leg, b: Leg, tunables: PipelineTunables): OrientedPair | null {
  if (a.walletId === null || b.walletId === null) return null;
  if (a.walletId === b.walletId) return null;

  const pair = orient(a, b);
  if (pair === null) return null;
  if (!isExactMatch(pair) && !isFeeTolerant(pair, tunables)) return null;

  return pair;
}

/** Inclusive: §7 rule 2 says "within 15 minutes" and "up to 24 hours". */
const isWithin = (a: Leg, b: Leg, windowMs: number): boolean =>
  Math.abs(a.occurredAt - b.occurredAt) <= windowMs;

/** One committed row this event could pair with, plus the facts rule 4 grades. */
type Pairing = {
  counterpart: Transaction;
  exactAmount: boolean;
  insidePrimaryWindow: boolean;
  distanceMs: number;
};

/**
 * Every committed transaction that forms a candidate pair with the event, out to
 * the EXTENDED window — because rule 4 counts candidate pairings, and a pairing
 * found only in the extended window is still a pairing (rule 2.2 merely forbids
 * linking it silently).
 *
 * ALREADY-LINKED ROWS ARE NOT CANDIDATES. A Transaction belongs to at most one
 * Transfer Link (domain §3.3 invariant 3), so a row that is already half of a
 * link cannot become half of another. This filter is also what keeps a HABITUAL
 * transfer auto-linking: someone who moves ₱1,000.00 to savings every morning
 * has yesterday's identical leg sitting inside today's 24-hour extended window,
 * and without the filter it would compete with today's real counterpart and
 * demote every repeat to the Review Queue — forfeiting the ≥90% target on the
 * most predictable transfers there are.
 */
function pairingsFor(
  event: NormalizedEvent,
  candidates: Transaction[],
  tunables: PipelineTunables,
): Pairing[] {
  const from = eventLeg(event);
  const pairings: Pairing[] = [];

  for (const candidate of candidates) {
    if (candidate.transferLinkId !== null) continue;

    const to = transactionLeg(candidate);
    const pair = canPair(from, to, tunables);
    if (pair === null) continue;
    if (!isWithin(from, to, tunables.transferExtendedWindowMs)) continue;

    pairings.push({
      counterpart: candidate,
      exactAmount: isExactMatch(pair),
      insidePrimaryWindow: isWithin(from, to, tunables.transferPrimaryWindowMs),
      distanceMs: Math.abs(from.occurredAt - to.occurredAt),
    });
  }

  return pairings;
}

/**
 * The pairing offered to the user when several compete.
 *
 * An exact amount outranks being nearer in time, then the nearest wins; ties
 * keep the caller's order so the proposal is deterministic for a given
 * `candidates` array rather than an accident of iteration. The verdict in that
 * situation is `multiple_candidates` either way — the user is choosing, not
 * accepting — but the row shown first should be the likelier partner.
 */
function bestOf(pairings: Pairing[]): Pairing {
  let best = pairings[0];

  for (const pairing of pairings.slice(1)) {
    if (pairing.exactAmount !== best.exactAmount) {
      if (pairing.exactAmount) best = pairing;
      continue;
    }
    if (pairing.distanceMs < best.distanceMs) best = pairing;
  }

  return best;
}

/**
 * Spec §7 rule 4's "no competing candidates for EITHER leg", second half.
 *
 * The event's own side is covered by counting `pairingsFor`. This is the other
 * side: another committed transaction, moving the same way as the event, that
 * could equally have been the counterpart's partner. Two wallets each send
 * ₱1,000.00 within minutes and one wallet receives ₱1,000.00 — the receiving leg
 * has two possible sources and picking either is a coin flip that hides a real
 * expense. A detector that counts only its own side sees exactly one pairing
 * here and links it.
 *
 * BOUNDED BY THE PRIMARY WINDOW, not the extended one. Auto-link already
 * requires both legs inside the primary window, so a rival that is further out
 * could never have auto-linked with this counterpart either — it is at most a
 * Review Queue proposal, not competition for a silent link. Using the extended
 * window here would resurrect exactly the habitual-transfer problem the
 * already-linked filter solves, this time through unconfirmed orphan legs.
 */
function hasRivalForCounterpart(
  event: NormalizedEvent,
  counterpart: Transaction,
  candidates: Transaction[],
  tunables: PipelineTunables,
): boolean {
  const target = transactionLeg(counterpart);

  return candidates.some((other) => {
    if (other.id === counterpart.id) return false;
    if (other.transferLinkId !== null) return false;
    if (other.direction !== event.direction) return false;

    const rival = transactionLeg(other);
    if (canPair(rival, target, tunables) === null) return false;

    return isWithin(rival, target, tunables.transferPrimaryWindowMs);
  });
}

/**
 * Spec §7. Decides whether `event` is one leg of an internal transfer.
 *
 * `candidates` is assembled by the orchestrator — the committed transactions
 * inside the extended window. It is not pre-filtered by direction: the rival
 * check above needs the rows moving the SAME way as the event, and a stage that
 * only ever saw opposite-direction rows could not implement rule 4's "either
 * leg". This stage performs no I/O and takes no clock.
 *
 * THE DISQUALIFIERS ARE ORDERED, and the order is the answer to "what if a pair
 * fails more than one clause of rule 4?" — a fee-tolerant pair twenty hours away
 * is both. All three route to the same Review Queue with the same one-tap
 * confirm, so the order decides only how the item explains itself:
 *
 *   1. `multiple_candidates` — a statement about the candidate SET. When the
 *      pairing itself is in question, the properties of any one pair are moot.
 *   2. `extended_window` — §7 rule 2.2 in spec order, and categorical: pairs
 *      found only in the extended window are NEVER auto-linked, whatever else
 *      is true of them.
 *   3. `fee_delta` — §7 rule 3.2, the last thing left once the pairing is
 *      unique and the timing is tight.
 */
export function detectTransfer(
  event: NormalizedEvent,
  candidates: Transaction[],
  tunables: PipelineTunables,
): TransferVerdict {
  const pairings = pairingsFor(event, candidates, tunables);
  if (pairings.length === 0) return { kind: "none" };

  const best = bestOf(pairings);
  const counterpartTransactionId = best.counterpart.id;

  if (
    pairings.length > 1 ||
    hasRivalForCounterpart(event, best.counterpart, candidates, tunables)
  ) {
    return { kind: "ambiguous-transfer", counterpartTransactionId, reason: "multiple_candidates" };
  }

  if (!best.insidePrimaryWindow) {
    return { kind: "ambiguous-transfer", counterpartTransactionId, reason: "extended_window" };
  }

  if (!best.exactAmount) {
    return { kind: "ambiguous-transfer", counterpartTransactionId, reason: "fee_delta" };
  }

  return { kind: "auto_link", counterpartTransactionId };
}
