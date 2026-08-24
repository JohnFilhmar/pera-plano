// lib/ingest/dedupe_gate.ts — Stage 4, the only stage that can erase a transaction.
//
// docs/03-ingest-pipeline.md §6. Many PH transactions announce themselves twice
// — a provider push AND a bank SMS delivered as a Messages-app notification —
// and this stage decides whether the second telling is the same money as the
// first. Target: ≥95% of push/SMS twin pairs suppressed.
//
// WHY THIS STAGE IS THE UNFORGIVING ONE. Every other stage produces a record
// that is wrong in some visible way. This one produces NO RECORD: a `duplicate`
// verdict makes the orchestrator return `ignored: "duplicate"` and write nothing
// to the ledger (plan Task 10 rule 5). There is no merged row to split open
// later, no field to correct, and nothing on screen that says a transaction was
// dropped. The user's balance is simply short, and they cannot search for the
// reason.
//
// So the gate has three answers, not two, and the third is the important one:
//
//   duplicate          — the same movement, told twice. Suppress it.
//   unique             — two movements. Record both.
//   possible-duplicate — we cannot tell. The ConfidenceGate hard-routes this to
//                        the Review Queue (§9.2) and a human settles it in one
//                        tap. §6 rule 4 exists precisely so that "same amount,
//                        same channel, close together" is never guessed at,
//                        because both guesses are silent and both cost money.
//
// THE STRUCTURE. All three rules first demand the same four facts — a
// notification-backed row, the same provider, the same amount, the same
// direction (`describesSameMovement`). What separates them is only how the two
// reference numbers relate, whether the channels differ, and which window
// applies:
//
//   reference numbers agree  → rule 1, within 48 h, ANY channel → duplicate
//   no usable reference      → rule 2, within 180 s, different channels → duplicate
//   no usable reference      → rule 4, within 180 s, same channel → possible-duplicate
//   no usable reference      → outside 180 s → unique (rule 3: two ₱100.00 loads
//                              five minutes apart are two real purchases)
//   references disagree      → unique, at any distance
//
// Rules 3 and 4 read as contradictions until you notice that the twin window is
// the only thing between them. Both directions of that comparison are pinned at
// the boundary in the test file.
//
// Pure: no I/O, no clock, no database, and NO `now`. The windows are distances
// between the two events' own `occurredAt` stamps, so the whole stage is a
// function of its three arguments.
import type { NormalizedEvent } from "@/lib/ingest/normalizer";
import type { PipelineTunables } from "@/lib/ingest/ruleset_types";
import type { Centavos, EpochMs, TxDirection } from "@/types/domain";

/**
 * The verdict. Plan Task 6 / consumed by `confidence_gate.ts` (Task 9), which
 * hard-routes `possible-duplicate` to the Review Queue regardless of score.
 *
 * `ofTransactionId` is the id of the ALREADY-COMMITTED row this event matched —
 * never the event's own, and never a placeholder. The pipeline links the pair by
 * it, so the wrong id links the wrong records.
 */
export type DedupeVerdict =
  | { kind: "unique" }
  | { kind: "duplicate"; ofTransactionId: string }
  | { kind: "possible-duplicate"; ofTransactionId: string };

/**
 * One already-committed transaction, carrying the two facts §6 needs that
 * `Transaction` does not have.
 *
 * WHY THIS TYPE EXISTS. Rule 1 keys on "the same underlying provider" and rule 2
 * on "different channels", and `Transaction` (`types/domain.ts`) records
 * neither. Both are recoverable — `transactions.rawNotificationId` →
 * `raw_notifications.package_name` → the provider, and its `channel` off the
 * ruleset — but only by a join, and rule 5 forbids this stage from doing any
 * I/O. So the orchestrator (Task 10) performs the join and hands the result
 * down, exactly as it already hands down wallets and matchers to the Normalizer.
 *
 * `providerKey: null` MEANS "NOT FROM A NOTIFICATION" — a hand-typed entry, an
 * import, a recurring-rule posting. Such a row can never be the twin of a
 * notification event, and `describesSameMovement` refuses it outright. Someone
 * who typed a ₱100.00 entry and then received a ₱100.00 notification may well
 * have made two records of two different things; the notification is the only
 * one this gate can destroy, and there is no evidence here to justify it.
 *
 * `channel: null` means the channel could not be established (the provider left
 * the ruleset, or the raw row aged out of its 30-day window). It is not a third
 * channel and it is not "different from push" — see `channelsDiffer`.
 */
export type RecentEvent = {
  transactionId: string;
  providerKey: string | null;
  channel: "push" | "sms" | null;
  amount: Centavos;
  direction: TxDirection;
  referenceNo: string | null;
  occurredAt: EpochMs;
};

/**
 * How two reference numbers relate. Three states, because "we have two
 * references and they differ" is a completely different fact from "we do not
 * have two references", and collapsing them loses the only piece of positive
 * DISCONFIRMING evidence this stage ever gets.
 */
type ReferenceRelation = "same" | "conflicting" | "unavailable";

/**
 * A reference number folded for comparison, or `null` when it carries no
 * information.
 *
 * BLANK IS ABSENT. A capture group that matched nothing yields `""`; a column
 * round-tripped through a form yields whitespace. Treating either as a real
 * reference would make every reference-less event from a provider a "strong key"
 * match for every other one within 48 hours — the single largest way this gate
 * could eat real money.
 *
 * Case and surrounding whitespace are folded because the push template and the
 * SMS template are written by different teams and one of them shouts. The
 * INTERIOR is left exactly as captured: `ABC-123` and `ABC123` are not asserted
 * to be the same reference, because stripping separators is how two genuinely
 * different codes start colliding.
 */
function foldReference(reference: string | null | undefined): string | null {
  const folded = reference?.trim().toLowerCase();
  return folded === undefined || folded === "" ? null : folded;
}

function compareReferences(
  left: string | null | undefined,
  right: string | null | undefined,
): ReferenceRelation {
  const a = foldReference(left);
  const b = foldReference(right);

  if (a === null || b === null) return "unavailable";
  return a === b ? "same" : "conflicting";
}

/**
 * The four facts every rule requires before any window or channel is considered.
 *
 * ON THE DIRECTION CHECK, which spec §6 rule 1 does not spell out. Rule 1 names
 * provider, reference and amount, and explicitly relaxes only the channel. It is
 * silent on direction — and read as permission to ignore it, the strong key
 * destroys money in a case that is not exotic at all:
 *
 *   REVERSALS AND REFUNDS QUOTE THE ORIGINAL'S REFERENCE. "Your ₱1,000.00
 *   transfer failed and has been reversed. Ref XYZ", minutes after "You sent
 *   ₱1,000.00. Ref XYZ". Same provider, same reference, same amount, opposite
 *   direction, well inside 48 hours. A direction-blind strong key suppresses the
 *   reversal, and the ledger keeps a spend the user got back — permanently, with
 *   no row to correct. The same shape covers e-commerce refunds, which in PH
 *   wallets routinely carry the reference of the purchase they undo.
 *
 * Requiring the direction costs the ≥95% twin target nothing: a push and its SMS
 * relay describe one movement, so they always agree on its sign. It only ever
 * declines to suppress pairs that disagree about which way the money went, and
 * two records that disagree about that are never safe to merge silently.
 */
function describesSameMovement(event: NormalizedEvent, row: RecentEvent): boolean {
  // A hand-typed row is not a telling of a notification. Written as an explicit
  // null test and not folded into the comparison below, because
  // `row.providerKey && row.providerKey !== event.providerKey` reads almost the
  // same and turns null into a wildcard that matches every provider.
  if (row.providerKey === null) return false;
  if (row.providerKey !== event.providerKey) return false;
  if (row.amount !== event.amount) return false;

  return row.direction === event.direction;
}

/**
 * `true` when the two events are certainly on different channels.
 *
 * An unknown channel (`null`) is not a different channel. Rule 2's whole premise
 * is that a push and an SMS relay of the same movement are one transaction; that
 * inference needs both channels established. `row.channel !== event.channel`
 * would read "unknown" as "the other one" and suppress on no evidence.
 */
function channelsDiffer(event: NormalizedEvent, row: RecentEvent): boolean {
  return row.channel !== null && row.channel !== event.channel;
}

/** `true` when both channels are known and equal. `null` matches nothing. */
function channelsMatch(event: NormalizedEvent, row: RecentEvent): boolean {
  return row.channel !== null && row.channel === event.channel;
}

/**
 * Distance between the two events, in either order.
 *
 * ABSOLUTE, DELIBERATELY. The window is a distance, not an ordering. `recent`
 * usually holds older rows, but catch-up processing after an OEM battery kill
 * (§12.4) and a delayed SMS relay both hand this stage a committed row stamped
 * AFTER the event being checked. A bare subtraction goes negative there and
 * quietly compares as "inside every window" or "outside every window" depending
 * on which way it was written — either answer wrong, for exactly the delayed
 * deliveries the 48-hour window was widened to cover.
 *
 * Inclusive at the boundary: spec §6 says "within 48 hours" and "within 180
 * seconds", and a twin landing on the tick is inside both.
 */
function isWithin(event: NormalizedEvent, row: RecentEvent, windowMs: number): boolean {
  return Math.abs(event.occurredAt - row.occurredAt) <= windowMs;
}

/**
 * Spec §6 rule 1 — the strong key, and the main push/SMS twin catcher.
 *
 * REGARDLESS OF CHANNEL, which also makes this the implementable half of §6
 * rule 3: a provider re-posting or echoing its own notification produces a
 * same-channel pair, and when it carries the reference the shared key settles
 * it here. (Rule 3's other half — "identical in text" — cannot be decided at
 * this stage: a `NormalizedEvent` carries no text, by the time it exists the
 * words are gone. Reference-less re-posts therefore fall through to rule 4 and
 * are escalated rather than guessed at. Byte-identical REPLAYS of one capture
 * are a different problem with a cheaper answer, settled by capture id at the
 * pipeline entrance — plan Task 10 rule 11.)
 */
function matchesStrongKey(
  event: NormalizedEvent,
  row: RecentEvent,
  tunables: PipelineTunables,
): boolean {
  return (
    describesSameMovement(event, row) &&
    compareReferences(event.referenceNo, row.referenceNo) === "same" &&
    isWithin(event, row, tunables.dedupeStrongWindowMs)
  );
}

/**
 * Spec §6 rule 2 — the twin window: no usable reference, different channels,
 * within 180 seconds.
 *
 * `"conflicting"` is excluded along with `"same"`, and that exclusion is load
 * bearing in the other direction: one provider that issued two different
 * reference numbers issued two transactions, and no amount of coincidence in
 * timing outranks the provider's own statement that these are not the same
 * thing.
 */
function matchesTwinWindow(
  event: NormalizedEvent,
  row: RecentEvent,
  tunables: PipelineTunables,
): boolean {
  return (
    describesSameMovement(event, row) &&
    compareReferences(event.referenceNo, row.referenceNo) === "unavailable" &&
    channelsDiffer(event, row) &&
    isWithin(event, row, tunables.dedupeTwinWindowMs)
  );
}

/**
 * Spec §6 rule 4 — the case the pipeline cannot decide: same channel, same
 * amount, same direction, no usable reference, inside the twin window.
 *
 * Identical to `matchesTwinWindow` except that the channels AGREE, and that one
 * difference is worth the whole rule. Across channels, a matching pair inside
 * 180 seconds is the twin this stage exists to suppress. On ONE channel there is
 * no relay to explain the second notification, so the pair is either a re-post
 * or two real purchases — and §6 rule 3 insists that two ₱100.00 load purchases
 * minutes apart are real. With nothing left to distinguish them, guessing either
 * way is silent: `duplicate` merges two real transactions, `unique` double-counts
 * one. The Review Queue is the only honest answer.
 *
 * Outside the window this returns `false` and the event is `unique` — rule 3.
 * That boundary is the ONLY thing separating rules 3 and 4, which is why the
 * tests pin it at exactly `dedupeTwinWindowMs` and one millisecond past it.
 */
function matchesUndecidablePair(
  event: NormalizedEvent,
  row: RecentEvent,
  tunables: PipelineTunables,
): boolean {
  return (
    describesSameMovement(event, row) &&
    compareReferences(event.referenceNo, row.referenceNo) === "unavailable" &&
    channelsMatch(event, row) &&
    isWithin(event, row, tunables.dedupeTwinWindowMs)
  );
}

/**
 * The closest match in time, which is the one the verdict names.
 *
 * When more than one committed row satisfies a rule, the nearest is the likeliest
 * counterpart: a twin arrives seconds later, not hours. Ties keep the caller's
 * order (`<`, not `<=`) so the verdict is deterministic for a given `recent`
 * array rather than an accident of iteration.
 */
function nearestInTime(event: NormalizedEvent, rows: RecentEvent[]): RecentEvent | null {
  let nearest: RecentEvent | null = null;
  let smallestDelta = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const delta = Math.abs(event.occurredAt - row.occurredAt);
    if (delta >= smallestDelta) continue;

    nearest = row;
    smallestDelta = delta;
  }

  return nearest;
}

/**
 * Spec §6. Decides whether `event` is a re-telling of something already in the
 * ledger.
 *
 * `recent` is assembled by the orchestrator — the committed transactions inside
 * the strong window, joined to their raw notifications for provider and channel.
 * This stage performs no I/O and takes no clock (§6 rule 5).
 *
 * THE THREE TIERS ARE TRIED IN ORDER, and the order is the answer to "what if
 * two different rows match two different rules?". A shared provider reference
 * number is the strongest evidence available — the provider itself saying these
 * are one transaction — so rule 1 decides even when some other row is minutes
 * closer in time and rule 2 would have named it. Below that, a definite verdict
 * outranks an escalation: sending a pair to the Review Queue that one rule can
 * already settle is noise the user should not have to clear.
 *
 * (No single ROW can match rules 1 and 2 at once — one needs the references to
 * agree and the other needs one of them missing — so the precedence only ever
 * chooses between rows, never between two readings of the same row.)
 */
export function checkDuplicate(
  event: NormalizedEvent,
  recent: RecentEvent[],
  tunables: PipelineTunables,
): DedupeVerdict {
  const strongKey = nearestInTime(
    event,
    recent.filter((row) => matchesStrongKey(event, row, tunables)),
  );
  if (strongKey !== null) {
    return { kind: "duplicate", ofTransactionId: strongKey.transactionId };
  }

  const twin = nearestInTime(
    event,
    recent.filter((row) => matchesTwinWindow(event, row, tunables)),
  );
  if (twin !== null) {
    return { kind: "duplicate", ofTransactionId: twin.transactionId };
  }

  const undecidable = nearestInTime(
    event,
    recent.filter((row) => matchesUndecidablePair(event, row, tunables)),
  );
  if (undecidable !== null) {
    return { kind: "possible-duplicate", ofTransactionId: undecidable.transactionId };
  }

  return { kind: "unique" };
}
