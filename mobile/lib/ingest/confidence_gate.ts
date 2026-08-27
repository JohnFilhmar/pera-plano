// lib/ingest/confidence_gate.ts — Stage 7, the stage that decides.
//
// docs/03-ingest-pipeline.md §9.2. This is the single point in the pipeline
// where a number becomes "write this to the ledger without asking" or "ask a
// human". Every earlier stage — router, parser, normalizer, dedupe, transfer,
// categorizer — exists to produce the score and the five facts this function
// reads, and nothing downstream revisits the choice.
//
// THE TWO FAILURE DIRECTIONS ARE BOTH NAMED IN THE SPEC, and they pull opposite
// ways. Too lax and wrong data is committed silently: totals drift, Safe-to-
// Spend lies, and the user has no reason to suspect any of it (top risk 4).
// Too strict and the Review Queue fills with items the pipeline could have
// settled, until the user stops reading it and the queue's own signal is gone.
// Everything below is written with those two costs in view.
//
// THE SHAPE OF THE DECISION IS TWO INDEPENDENT QUESTIONS, deliberately:
//
//   1. Is there a reason a human MUST look at this?  (the hard routes)
//   2. How much of the card can we fill in for them? (the score bands)
//
// They are orthogonal, and keeping them so is the difference between a 0.99
// unmapped-wallet event being one tap from correct and being a raw notification
// the user retypes. See `decideRoute`.
//
// Pure: no I/O, no clock, no database, no `now`. All three thresholds arrive
// in `tunables`, so the entire stage is a function of its one argument.
import type { DedupeVerdict } from "@/lib/ingest/dedupe_gate";
import type { PipelineTunables } from "@/lib/ingest/ruleset_types";
import type { RoutedCapture } from "@/lib/ingest/source_router";
import type { TransferVerdict } from "@/lib/ingest/transfer_detector";

/**
 * The decision. Plan Task 9 / consumed by `pipeline.ts` (Task 10), which either
 * commits the Transaction (§9.3) or enqueues a Review Queue item carrying
 * `reason` as its card text.
 *
 * BOTH REVIEW VARIANTS CARRY A REASON, not only the hard routes. §9.2 rule 3
 * demands one for a hard route, but a plain low score is the most common way to
 * reach the queue and a card that cannot say why it is there is exactly the
 * mystery that rule exists to prevent. `auto_commit` carries none because
 * nothing is shown: the row simply appears in the ledger.
 *
 * `discard` (§9.2 amendment, 2026-08-20) ALSO CARRIES NO REASON, for the same
 * reason `auto_commit` doesn't: nothing is shown to anybody. This is the one
 * route that neither writes the ledger nor asks the user anything — see
 * `decideRoute`'s discard branch for what earns it and, more importantly,
 * what never does.
 */
export type GateDecision =
  | { route: "auto_commit" }
  | { route: "review_prefilled"; reason: string }
  | { route: "review_needs_details"; reason: string }
  | { route: "discard" };

/**
 * Everything the gate reads. Named only so tests and the orchestrator can
 * refer to the shape; the fields are exactly plan Task 9's inline signature.
 *
 * `nonPhpCurrency` CANNOT CURRENTLY BE `true`. The parser refuses a
 * foreign-currency amount outright (`hasForeignCurrencyMarker`, commit
 * `d6014c3`) and returns `null`, so the raw capture reaches the Review Queue
 * unparsed and no `ParsedEvent` can carry a non-PHP amount. The parameter and
 * its branch are kept because §9.2 states the hard route explicitly and a
 * future design that FLAGS rather than refuses would need it — but nothing sets
 * it today, so do not read the covered branch as a live path.
 */
export type GateInput = {
  confidence: number;
  /**
   * Did an amount actually parse out of this capture. Everything arriving
   * from `runStages` has one by construction — the parser refuses to return a
   * `ParsedEvent` without an amount — so `true` is the ordinary path.
   *
   * `false` is the unreadable-capture path: `pipeline.ts`'s `parsed === null`
   * branch, a provider was matched but nothing in the text could be read. It
   * exists so the review-floor discard (see `decideRoute`) can tell "nothing
   * to show" apart from "a real number scored low", because only the first of
   * those is safe to drop without a trace.
   */
  hasAmount: boolean;
  walletId: string | null;
  dedupe: DedupeVerdict;
  transfer: TransferVerdict;
  routed: RoutedCapture["kind"];
  nonPhpCurrency: boolean;
  tunables: PipelineTunables;
};

/**
 * The card text, one entry per route. Exported so the Review Queue and its
 * tests refer to the same strings rather than each keeping a copy that drifts.
 *
 * Every string names what the app could not settle AND what the user does about
 * it, because §9.2 rule 3's "why is this here?" is only answered by the pair.
 */
export const GATE_REASONS = {
  /** Should be unreachable — see `hardRouteReason`. */
  duplicate:
    "This looks like a transaction PeraPlano already recorded. Dismiss it, or confirm it is separate.",
  possibleDuplicate:
    "This may repeat a transaction already recorded — same amount, around the same time.",
  ambiguousTransfer:
    "This may be a transfer between your own accounts rather than money leaving your budget.",
  oneSidedTransfer:
    "This looks like money moving between your own accounts. Tell PeraPlano where the other half went.",
  /** Should be unreachable — see `hardRouteReason`. */
  notFinancial:
    "PeraPlano did not read this notification as money, so none of these details were verified.",
  unknownProvider:
    "This came from an app PeraPlano does not recognize, so nothing here matched a known format.",
  nonPhpCurrency: "The amount is not in Philippine pesos. Enter the peso value you were charged.",
  unmappedWallet: "PeraPlano could not tell which account this came from. Choose the wallet.",
  /** Not a hard route: the score alone put the event in the queue. */
  lowConfidence: "Some details were read with less certainty. Check them, then confirm.",
  /** Not a hard route. */
  unreadable: "PeraPlano could not read this notification confidently. Please supply the details.",
} as const;

/**
 * Confidence is compared in ten-thousandths, matching `parser.ts`'s
 * `SCORE_SCALE` and `transfer_detector.ts`'s `RATE_SCALE`.
 *
 * NOT PEDANTRY — the routing bug this stage is most likely to ship. The score
 * arrives after arbitrary float subtraction, some of it applied by the
 * ORCHESTRATOR after every earlier stage's own scaling: the categorizer's 0.05
 * learned penalty is subtracted there, so a 0.95 parse reaches this function as
 * `0.95 - 0.05`, which IEEE-754 makes `0.8999999999999999`. A naive
 * `confidence >= 0.90` sends that clean auto-commit to the Review Queue, and
 * the spec's table reads as though it said something it does not. The same
 * dust has already cost this pipeline two bugs — `0.70 - 0.05 - 0.05` in the
 * parser and a rejected fee at `8176.999999999999` in the transfer detector.
 *
 * Ten-thousandths rather than hundredths so a remotely retuned threshold finer
 * than the spec's two decimals (§11.1) still separates 0.8999 from 0.90 instead
 * of rounding them together.
 */
const SCORE_SCALE = 10_000;

const toScaled = (value: number): number => Math.round(value * SCORE_SCALE);

/** The four bands of §9.2's table (plus its 2026-08-20 amendment), as the route each would take on its own. */
type ScoreBand = "auto_commit" | "review_prefilled" | "review_needs_details" | "discard";

/**
 * §9.2 rule 1 — `≥ 0.90` auto-commit · `0.60`–`0.89` prefilled · above the
 * floor and below 0.60 needs details · `<= reviewFloorThreshold` discard
 * (§9.2 amendment, 2026-08-20).
 *
 * THE FIRST TWO COMPARISONS ARE INCLUSIVE AT THEIR HIGHER SIDE; THE NEW ONE IS
 * INCLUSIVE AT ITS LOWER SIDE, DELIBERATELY. The first two are `>=`: the spec
 * writes "≥ 0.90" and "0.60 – 0.89", so a score landing exactly on an edge
 * belongs to the band ABOVE it, and 0.90 is not an exotic score — it is a
 * 1.00 exact match carrying one 0.10 wallet-fallback penalty. The discard
 * check is `<=`, inclusive at its LOWER side, because the owner's rule is
 * "higher than 50" — 0.50 itself is discarded, not queued. Writing it as `<`
 * would silently promote 0.50 into the Review Queue and contradict the
 * rule's own wording.
 *
 * All three values are read from the ruleset rather than written here because
 * §9.2's table "ships as tunable ruleset data (§11)" and these are the likeliest
 * numbers in the whole pipeline to be recalibrated against the corpus (§11.3).
 * Inlined, the remote tuning knob would turn and change nothing.
 *
 * THE DISCARD CHECK IS WRITTEN DIRECTLY, NOT AS THE INVERSE OF "above the
 * floor" — that is what protects a non-number `confidence`. `NaN <= x` is
 * `false` no matter where the check sits, so it already loses this comparison
 * the same way it loses the two `>=` checks above and falls through to
 * `review_needs_details`, the safe end. Written instead as the inverse —
 * "discard unless the score is above the floor" — the same NaN would satisfy
 * that inverted test (`NaN > x` is also `false`, so "not above" reads `true`)
 * and get silently thrown away regardless of where the check sits, which is
 * exactly the failure this file's existing NaN handling exists to prevent.
 *
 * THE ORDER — checked LAST, after both `>=` checks — IS STILL LOAD-BEARING,
 * for a different reason: it keeps `auto_commit` and `review_prefilled`
 * winning if a remote bundle ever retunes `reviewFloorThreshold` to at or
 * above `prefilledThreshold`. Nothing in this file validates that the three
 * thresholds stay ordered `reviewFloorThreshold < prefilledThreshold <
 * autoCommitThreshold`, so a misconfigured floor checked FIRST would discard
 * scores the two bands above it were meant to keep. This is already pinned
 * incidentally — `confidence_gate.test.ts`'s "a lowered prefilledThreshold
 * lifts a needs-details score up to prefilled" retunes `prefilledThreshold`
 * below a confidence that also sits at-or-under the shipped
 * `reviewFloorThreshold`, and fails if `scoreBand` checks the floor first.
 */
function scoreBand(confidence: number, tunables: PipelineTunables): ScoreBand {
  const scaled = toScaled(confidence);

  if (scaled >= toScaled(tunables.autoCommitThreshold)) return "auto_commit";
  if (scaled >= toScaled(tunables.prefilledThreshold)) return "review_prefilled";
  if (scaled <= toScaled(tunables.reviewFloorThreshold)) return "discard";
  return "review_needs_details";
}

/**
 * §9.2's hard routes, in a FIXED precedence, or `null` when the score decides
 * alone.
 *
 * WHY A FIXED ORDER AT ALL. Several of these are routinely true together — an
 * unknown provider with an unmapped wallet and a possible duplicate is one
 * capture, not three — and the Review Queue card shows ONE reason. A card whose
 * wording depends on which branch happened to be evaluated first makes the same
 * input produce different support conversations on different days.
 *
 * WHY THIS ORDER. Each question, once answered, makes the ones below it moot,
 * so the card names the question the user should be asked first:
 *
 *   1-2. Is this a new row at all?  A duplicate is not recorded, so its wallet,
 *        its currency and its provider stop mattering the moment the user says
 *        so. Nothing outranks the question of whether the row should exist.
 *   3.   Is it a transfer between the user's own accounts?  Answering this
 *        changes what the row MEANS — both legs leave spend and income entirely
 *        (domain invariant I2) — and settles the wallet question along the way.
 *        `one_sided` shares this slot with `ambiguous-transfer`: it is the
 *        SAME question ("is this a transfer?"), just answered from only one
 *        captured leg instead of two, so it outranks provenance and currency
 *        for the identical reason.
 *   4-5. Do we know where it came from?  With the provenance unestablished,
 *        every parsed field below is a guess, including the currency and the
 *        wallet, so it outranks both.
 *   6.   Is the amount even in pesos?  The single most important field is in the
 *        wrong unit.
 *   7.   Which pocket did it come from?  One missing field, one tap. Last
 *        because everything else on the card is trustworthy.
 *
 * Within a pair, the stronger statement of the same question comes first: a
 * confirmed `duplicate` ahead of a `possible-duplicate`, and a `not_financial`
 * routing ahead of an `unknown` one.
 *
 * TWO OF THESE SHOULD BE UNREACHABLE, and are handled anyway. Plan Task 10 rule
 * 5 drops a `duplicate` before this stage and its rule 1 drops a
 * `not_financial` capture, so either arriving here means the orchestrator's
 * contract is broken. They hard-route rather than throw: a throw inside a
 * background notification handler loses the capture with no trace and no row to
 * correct, which is the one outcome worse than an extra card in the queue. The
 * distinct wording also makes the breach diagnosable from a support screenshot
 * instead of hiding inside the neighbouring reason.
 *
 * §9.2 also names "fee-tolerant transfer candidates (§7 rule 3.2)" as a hard
 * route. No separate branch: the TransferDetector already delivers those as
 * `ambiguous-transfer` with `reason: "fee_delta"`, so they are covered by the
 * transfer branch below (pinned by its own test).
 *
 * `auto_link` is deliberately NOT a hard route. It is the TransferDetector
 * stating it is certain — exact amount, primary window, two known and distinct
 * wallets, exactly one pairing — and §9.2 hard-routes only the ambiguous pairs.
 */
function hardRouteReason(input: GateInput): string | null {
  if (input.dedupe.kind === "duplicate") return GATE_REASONS.duplicate;
  if (input.dedupe.kind === "possible-duplicate") return GATE_REASONS.possibleDuplicate;
  if (input.transfer.kind === "ambiguous-transfer") return GATE_REASONS.ambiguousTransfer;
  if (input.transfer.kind === "one_sided") return GATE_REASONS.oneSidedTransfer;
  if (input.routed === "not_financial") return GATE_REASONS.notFinancial;
  if (input.routed === "unknown") return GATE_REASONS.unknownProvider;
  if (input.nonPhpCurrency) return GATE_REASONS.nonPhpCurrency;
  if (input.walletId === null) return GATE_REASONS.unmappedWallet;

  return null;
}

/**
 * Spec §9.2. Decides whether a candidate Transaction is committed silently or
 * put in front of the user, and with how much of the card filled in.
 *
 * A HARD ROUTE KEEPS THE BAND ITS SCORE EARNED. §9.2 rule 2 says only "review",
 * and the plan's type offers two review bands, so the split is this file's call:
 * a hard route demotes `auto_commit` to `review_prefilled` and leaves
 * `review_needs_details` where it is. The two questions are independent — the
 * hard route decides THAT a human looks, the score decides HOW MUCH we can fill
 * in — and collapsing them costs real accuracy in both directions. Forcing
 * every hard route to `needs_details` would show the raw capture for a 0.99
 * unmapped-wallet event and make the user re-supply an amount, a direction and
 * a date the parser read correctly; that is §9.2's "too strict" failure, the one
 * that trains users to ignore the queue. Promoting a 0.30 hard route to
 * `prefilled` would be worse: it presents fields we do not trust as if we do.
 *
 * The one uncomfortable case is `nonPhpCurrency`, where "prefilled" prefills an
 * amount in the wrong unit. It still keeps its band: the merchant, date and
 * direction are correct and worth keeping, the card's reason tells the user the
 * amount must be re-entered, and a `review_prefilled` item is editable by
 * definition. That branch is also unreachable today (see `GateInput`), so
 * special-casing it would be untested complexity guarding nothing.
 *
 * THE DISCARD BAND (§9.2 amendment, 2026-08-20) IS RESOLVED BEFORE THE HARD
 * ROUTES, and that ordering is the point. A hard route is a QUESTION ABOUT A
 * CANDIDATE TRANSACTION — which wallet, is this a duplicate, is this a
 * transfer. Below the floor with nothing parsed there is no candidate, so
 * there is no question worth waking the user for, and letting a hard route
 * such as `unmappedWallet` run first would rescue the whole pile of unreadable
 * captures straight back into the Review Queue this amendment exists to keep
 * clear.
 *
 * BUT A PARSED AMOUNT IS NEVER THROWN AWAY ON A SCORE ALONE. It is real money
 * data, and losing it is invisible to the user and corrupts totals with no
 * trace — the exact top risk this whole pipeline is built around (see the
 * file header). That constraint is in tension with the owner's "ignore at or
 * below 50%" rule, and the constraint wins: a below-floor score that DID parse
 * an amount drops only to the lowest band that still ASKS
 * (`review_needs_details`), never to `discard`, and the ordinary hard-route /
 * band logic below then runs exactly as it always has.
 */
export function decideRoute(input: GateInput): GateDecision {
  const scored = scoreBand(input.confidence, input.tunables);

  // `=== false`, not `!input.hasAmount`: a missing/non-boolean `hasAmount` must
  // fall to the safe side (queued, not discarded), matching this file's own
  // doctrine that ambiguity resolves to the end that never throws data away.
  if (scored === "discard" && input.hasAmount === false) return { route: "discard" };

  const band = scored === "discard" ? "review_needs_details" : scored;
  const hardReason = hardRouteReason(input);

  if (hardReason !== null) {
    return band === "review_needs_details"
      ? { route: "review_needs_details", reason: hardReason }
      : { route: "review_prefilled", reason: hardReason };
  }

  if (band === "auto_commit") return { route: "auto_commit" };
  if (band === "review_prefilled") {
    return { route: "review_prefilled", reason: GATE_REASONS.lowConfidence };
  }

  return { route: "review_needs_details", reason: GATE_REASONS.unreadable };
}
