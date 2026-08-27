// lib/wallets/classification.ts — decides whether a wallet's balance is money
// the user HAS or money they OWE, from evidence the app can observe rather than
// from a question it used to ask during onboarding.
//
// WHY THE APP STOPPED ASKING. The old `WalletType` picker wanted one of
// bank / e-wallet / cash / credit / savings before the user had entered a
// single transaction — a taxonomy they do not think in, forced to one answer
// when a provider app commonly fronts a current account, a savings account and
// a card, at the moment when both they and the app knew least. Every signal
// that answers it arrives later.
//
// PURE, AND THAT IS THE WHOLE DESIGN. This decides the sign of the first number
// the app states: an owed wallet is excluded from the Wallets-tab total and
// from Safe-to-Spend (lib/wallets/summary.ts), so a wrong verdict inflates a
// budgeting app's headline by the size of the user's debt. A rule that
// important is a function with its own suite, not a condition buried in an
// ingest branch — the same posture lib/ingest/provider_catalogue.ts takes.
//
// INTEGERS, NOT FLOATS. Every weight is scaled by 100 so running scores can be
// summed straight into `wallet_trait_evidence` without a float ever reaching
// SQLite.
import type { Centavos } from "@/types/domain";

/** What one capture contributed, before it is folded into the running total. */
export type EvidenceDelta = { owed: number; held: number };

/** A wallet's accumulated evidence, as stored in `wallet_trait_evidence`. */
export type TraitEvidence = {
  owedScore: number;
  heldScore: number;
  /**
   * Deltas that actually scored. A capture that matched no signal and reported
   * no balance is NOT a sample — counting it would let a wallet reach the
   * sample floor on silence, which is the opposite of evidence.
   */
  sampleCount: number;
};

export const EMPTY_EVIDENCE: TraitEvidence = { owedScore: 0, heldScore: 0, sampleCount: 0 };

/** What the ruleset believes about this wallet's provider before we watch one. */
export type OwedPrior = "likely" | "unlikely" | "unknown";

export type OwedVerdict = {
  owed: boolean;
  /**
   * Whether the evidence settled the question.
   *
   * `{ owed: false, confident: false }` IS NOT A FINDING. It is the
   * assumed-held default, and it is what raises the review-queue question once
   * enough captures have been seen and the balance is material enough to
   * matter. Callers that treat it as "we decided this is held" will pin an
   * assumption the app never made.
   */
  confident: boolean;
};

/** One ruleset-supplied phrase rule, matched case-insensitively as a literal. */
export type TraitSignal = {
  pattern: string;
  trait: "owed" | "held";
  weight: number;
};

export type WalletTraitTunables = {
  /** How far ahead one side must be before the verdict moves. */
  owedMarginThreshold: number;
  /** How many scoring captures must exist before any verdict is trusted. */
  owedSampleFloor: number;
  /** What a ruleset prior is worth, in the same units as a signal weight. */
  priorWeight: number;
};

/**
 * Weight of one balance-movement observation. Deliberately heavier than most
 * single phrases: what the ledger did is harder to fake than what a
 * notification said.
 */
const MOVEMENT_WEIGHT = 200;

function priorDelta(prior: OwedPrior, tunables: WalletTraitTunables): EvidenceDelta {
  if (prior === "likely") return { owed: tunables.priorWeight, held: 0 };
  if (prior === "unlikely") return { owed: 0, held: tunables.priorWeight };
  return { owed: 0, held: 0 };
}

/**
 * The verdict. TWO GATES, BOTH REQUIRED.
 *
 * THE SAMPLE FLOOR IS THE IMPORTANT ONE. A single odd notification — "your
 * statement balance is ready" from a bank that also runs the user's current
 * account — must not be able to move the headline number, however lopsided its
 * score. The margin alone would let it.
 *
 * The prior is added to the scores rather than consulted separately, so a
 * provider we guessed about is outvoted by a few real observations instead of
 * biasing every verdict forever.
 */
export function classifyOwed(
  evidence: TraitEvidence,
  prior: OwedPrior,
  tunables: WalletTraitTunables,
): OwedVerdict {
  const bias = priorDelta(prior, tunables);
  const owed = evidence.owedScore + bias.owed;
  const held = evidence.heldScore + bias.held;

  const enoughSamples = evidence.sampleCount >= tunables.owedSampleFloor;
  const enoughMargin = Math.abs(owed - held) >= tunables.owedMarginThreshold;
  if (!enoughSamples || !enoughMargin) return { owed: false, confident: false };

  return { owed: owed > held, confident: true };
}

/**
 * Phrase evidence, from text the pipeline has ALREADY parsed. No new capture,
 * no new permission, no second read of anything.
 *
 * The signals are ruleset data (lib/ingest/ruleset_types.ts) rather than
 * constants here, so a phrase that turns out to mean the opposite in some
 * bank's wording is corrected without an app release.
 */
export function scoreText(text: string, signals: readonly TraitSignal[]): EvidenceDelta {
  const haystack = text.toLowerCase();
  return signals.reduce<EvidenceDelta>(
    (delta, signal) => {
      if (!haystack.includes(signal.pattern.toLowerCase())) return delta;
      return signal.trait === "owed"
        ? { owed: delta.owed + signal.weight, held: delta.held }
        : { owed: delta.owed, held: delta.held + signal.weight };
    },
    { owed: 0, held: 0 },
  );
}

export type BalanceMovement = {
  direction: "in" | "out";
  amount: Centavos;
  previousBalance: Centavos | null;
  balanceAfter: Centavos | null;
};

/**
 * The strongest signal available, and it costs nothing to collect: migration
 * 002 already stores `balance_after`.
 *
 * On an ordinary account, spending LOWERS the balance and money in RAISES it.
 * On a credit account the stored balance is what is OWED, so both invert:
 * spending raises it, and a payment against the card lowers it.
 *
 * SILENCE IS NOT EVIDENCE. A capture that reported no balance, or reported the
 * same balance as before, scores nothing for either side rather than defaulting
 * to the ordinary case — most notifications carry no balance at all, and
 * treating that absence as "held" would drown every real signal.
 */
export function scoreBalanceMovement(movement: BalanceMovement): EvidenceDelta {
  const { direction, previousBalance, balanceAfter } = movement;
  if (previousBalance === null || balanceAfter === null) return { owed: 0, held: 0 };
  if (balanceAfter === previousBalance) return { owed: 0, held: 0 };

  const rose = balanceAfter > previousBalance;
  const creditShaped = direction === "out" ? rose : !rose;
  return creditShaped ? { owed: MOVEMENT_WEIGHT, held: 0 } : { owed: 0, held: MOVEMENT_WEIGHT };
}

/** Folds one delta into the running total, returning a new object. */
export function addEvidence(current: TraitEvidence, delta: EvidenceDelta): TraitEvidence {
  if (delta.owed === 0 && delta.held === 0) return current;
  return {
    owedScore: current.owedScore + delta.owed,
    heldScore: current.heldScore + delta.held,
    sampleCount: current.sampleCount + 1,
  };
}
