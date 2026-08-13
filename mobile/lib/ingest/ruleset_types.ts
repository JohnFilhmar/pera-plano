// lib/ingest/ruleset_types.ts — the shape of everything a parser knows.
//
// Parser behaviour lives in DATA, not code (docs/03-ingest-pipeline.md §11):
// a versioned ruleset row the app ships with, and the server can update, so a
// provider changing its notification wording is fixed without an app release.
// The JSON shape below is interface contract §5 and is shared VERBATIM with
// the server's `GET /v1/parser_rules` — `providerKey`, `packageNames`,
// `version`, `templates`, and a template's `id` / `match` / `direction` /
// `confidence` are fixed by that contract and must not be renamed or
// reshaped here.
//
// Three fields extend the contract's sketch rather than reshaping it, each
// because a spec rule needs them and there is nowhere else for them to live:
//   - `channel` — spec §9.1 charges an SMS-channel confidence penalty, and
//     §6 rule 2 keys the twin window on push-vs-SMS. The stage that applies
//     them has only the provider to ask.
//   - `senderIds` — spec §3 rule 2: an SMS-app notification only routes to a
//     bank's rules when its text carries that bank's sender-ID prefix.
//     Without it, a personal text from a friend routes as bank SMS.
//   - `tunables` — spec §11.1 lists dedupe windows, transfer windows and fee
//     tolerances, and the confidence penalties and thresholds as ruleset data
//     precisely so they can be retuned remotely (§6 rule 6, §7 rule 3.3).
import type { Centavos } from "@/types/domain";

/** One ordered pattern within a provider's pack. Contract §5. */
export type ProviderTemplate = {
  id: string;
  /**
   * Regex SOURCE (not a literal) with named groups: `amount`, `direction`,
   * `merchant`, `counterparty`, `ref`, `balance`. Stored as a string so it
   * survives JSON transport; the parser compiles it, and a template whose
   * source fails to compile is skipped rather than crashing the parse
   * (spec §4 rule 4).
   */
  match: string;
  /** Set when the template itself fixes the direction; otherwise inferred from keywords. */
  direction?: "in" | "out";
  /** Base score before penalties: 1.00 exact match, 0.70 partial (spec §9.1). */
  confidence: number;
};

/** One provider's routing identity plus its ordered template pack. Contract §5. */
export type ProviderRuleset = {
  providerKey: string;
  packageNames: string[];
  version: number;
  /** `"sms"` means "posted by the default Messages app", never direct SMS reading (spec §12.2). */
  channel: "push" | "sms";
  /** For `channel: "sms"`: bank sender-ID prefixes, e.g. `["BPI", "BDO"]` (spec §3 rule 2). */
  senderIds?: string[];
  templates: ProviderTemplate[];
};

/**
 * Every threshold the pipeline compares against. Values ship as ruleset data
 * (spec §11.1) so they can be recalibrated against the real corpus without an
 * app release. See DEFAULT_TUNABLES for the shipped values and their sources.
 */
export type PipelineTunables = {
  dedupeStrongWindowMs: number;
  dedupeTwinWindowMs: number;
  transferPrimaryWindowMs: number;
  transferExtendedWindowMs: number;
  transferFeeFloorCentavos: number;
  transferFeeRate: number;
  autoCommitThreshold: number;
  prefilledThreshold: number;
  /**
   * How far a reported balance-after may sit from the computed expectation
   * before the Wallet enters the balance-drift attention state
   * (docs/04-features/02-wallets.md §balance handling rule 3). The snap happens
   * either way — rule 12 — this only decides whether the user is told.
   *
   * Ruleset data rather than a constant BECAUSE THE SPEC ADMITS IT DOES NOT
   * KNOW THE VALUE: §14 open question 1 says the threshold "needs tuning
   * against real parser accuracy data during M1; too tight makes noise, too
   * loose hides parser rot". A number that will certainly be recalibrated
   * belongs where the server can recalibrate it, not where it needs an app
   * release.
   */
  balanceDriftToleranceCentavos: Centavos;
  penalties: {
    weakDirection: number;
    amountAmbiguity: number;
    walletFallback: number;
    merchantMissing: number;
    smsChannel: number;
  };
};

/**
 * One coherent ruleset version — the unit that is installed atomically and
 * rolled back as a whole (spec §11.2). `tunables` is REQUIRED here because
 * this is the read side: every consumer reads its thresholds straight off
 * this object, and an absent field would make each of them `NaN`. The repo
 * fills any gap from DEFAULT_TUNABLES before handing a bundle out.
 */
export type RulesetBundle = {
  version: number;
  providers: ProviderRuleset[];
  tunables: PipelineTunables;
};

/** Tunables as they may arrive — any subset, one level deep. */
export type PartialPipelineTunables = Partial<Omit<PipelineTunables, "penalties">> & {
  penalties?: Partial<PipelineTunables["penalties"]>;
};

/**
 * A bundle as it ARRIVES — from the bundled seed JSON or the server. The only
 * difference from `RulesetBundle` is that `tunables` may be absent or partial:
 * a payload that only wants to change one threshold must not have to restate
 * the other thirteen, and one that cares about none omits the key entirely
 * (plan Task 1 rule 3). Every `RulesetBundle` is a valid input, so callers
 * holding a complete bundle need no conversion.
 */
export type RulesetBundleInput = Omit<RulesetBundle, "tunables"> & {
  tunables?: PartialPipelineTunables;
};

/**
 * The shipped tunables. EVERY VALUE IS COPIED FROM docs/03-ingest-pipeline.md
 * — do not round, re-derive, or "improve" one. Each is the initial value the
 * spec pins, cited inline; the corpus recalibrates them before launch (§9.1),
 * remotely, by shipping a bundle that overrides them.
 */
export const DEFAULT_TUNABLES: PipelineTunables = {
  /** §6 rule 1 — 48 h, wide enough to cover a delayed bank SMS. */
  dedupeStrongWindowMs: 172_800_000,
  /** §6 rule 2 — 180 s between a provider push and its SMS twin. */
  dedupeTwinWindowMs: 180_000,
  /** §7 rule 2.1 — 15 min, the instant-rail window. */
  transferPrimaryWindowMs: 900_000,
  /** §7 rule 2.2 — 24 h; pairs found only here are never auto-linked. */
  transferExtendedWindowMs: 86_400_000,
  /** §7 rule 3.2 — the ₱25.00 floor of `max(₱25.00, 1%)`, in centavos. */
  transferFeeFloorCentavos: 2_500,
  /** §7 rule 3.2 — the 1% ratio of `max(₱25.00, 1%)`. */
  transferFeeRate: 0.01,
  /** §9.2 — `>= 0.90` auto-commits. */
  autoCommitThreshold: 0.9,
  /** §9.2 — `0.60`-`0.89` routes to the Review Queue prefilled; below, needs details. */
  prefilledThreshold: 0.6,
  /**
   * ₱1.00, in centavos. docs/04-features/02-wallets.md §14 open question 1 — an
   * initial value, not a measured one: below ₱1.00 is rounding, above it is a
   * real missed transaction. Retuned remotely once M1 has parser-accuracy data.
   */
  balanceDriftToleranceCentavos: 100,
  penalties: {
    /** §9.1 — direction inferred from weak cues rather than an explicit template field. */
    weakDirection: 0.15,
    /** §9.1 — multiple amount-like tokens survived parsing. */
    amountAmbiguity: 0.3,
    /** §9.1 — wallet resolved by fallback rather than an explicit matcher. */
    walletFallback: 0.1,
    /** §9.1 — merchant missing. */
    merchantMissing: 0.05,
    /** §9.1 — SMS-via-Messages channel; formats are less structured than push. */
    smsChannel: 0.05,
  },
};
