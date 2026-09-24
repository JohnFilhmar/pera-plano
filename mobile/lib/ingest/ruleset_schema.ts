// lib/ingest/ruleset_schema.ts — the validation boundary for a parser ruleset
// that arrives from outside this app: today the server's `GET /v1/parser_rules`
// body (services/parser_rules.ts), which is the one thing about this app that
// changes without a store release.
//
// A RULESET IS REMOTE CODE IN EVERYTHING BUT NAME. It carries the confidence
// thresholds that decide whether a parsed transaction is committed without the
// user ever seeing it, and the regex sources the parser runs against every
// notification. A bundle that is merely well-SHAPED can still be hostile:
// `autoCommitThreshold: 0` is a perfectly good number and auto-commits
// everything unreviewed, and `(a+)+$` is a perfectly good regex and freezes the
// device on every notification. So this file bounds VALUES and PATTERN COST,
// not just types.
//
// EVERYTHING HERE FAILS CLOSED AND WHOLE. `parseRulesetBundle` returns a reason
// instead of a bundle; the caller keeps whatever ruleset it already had (spec
// §11.2 rollback-safety, services/parser_rules.ts rule 3). There is no partial
// acceptance — the unit of validation is the entire bundle, because a ruleset
// half-applied is a ruleset nobody can reason about.
//
// AUTHENTICITY IS NOT VALIDATED HERE. This says a bundle is well-formed and
// sane, never that it came from us; that needs a signature and a key-
// distribution decision, which is deliberately out of scope.
import { z } from "zod";

import type { RulesetBundleInput } from "@/lib/ingest/ruleset_types";

/**
 * The largest response body `checkForRulesetUpdate` will look at, in UTF-16
 * code units. Compared against the RAW text before `JSON.parse` runs, because
 * parsing a multi-megabyte body is itself the denial of service.
 *
 * A code-unit count rather than a byte count: it needs no `TextEncoder` (not a
 * guaranteed React Native global) and is a strict upper bound on the payload
 * anyway — UTF-8 never uses fewer bytes than the string has code units, so
 * 262 144 code units is at most 768 KB on the wire. The bundled seed
 * (assets/parser_rules/seed.json) is ~18 KB, so this leaves a 14x margin for a
 * catalogue that grows well beyond the thirteen shipped providers.
 */
export const MAX_RESPONSE_CHARS = 256 * 1024;

/**
 * The longest regex SOURCE a template may carry. The longest pattern in the
 * shipped seed is 369 characters, so this is headroom rather than a squeeze.
 *
 * A length cap on its own stops nothing interesting — catastrophic
 * backtracking needs about a dozen characters — but it bounds every check
 * below, which all walk the source.
 */
export const MAX_PATTERN_CHARS = 512;

/**
 * How many unbounded quantifiers (`*`, `+`, `{n,}`) one pattern may contain.
 * The worst pattern in the seed has 8. Each one is a place the engine can
 * backtrack, so this caps how deep a nested search a single template can
 * describe — and, just as importantly, bounds how long `probePatternCost`
 * below can be made to run before it reports.
 */
export const MAX_UNBOUNDED_QUANTIFIERS = 12;

/** Providers per bundle. The seed ships 13. */
export const MAX_PROVIDERS = 64;

/** Templates per provider. The seed's largest pack is 5. */
export const MAX_TEMPLATES_PER_PROVIDER = 64;

/**
 * Templates across the whole bundle. Every one of these compiles and runs on
 * every notification the app sees (lib/ingest/parser.ts), so this is the cap
 * that actually bounds per-notification cost; the seed ships 32.
 */
export const MAX_TEMPLATES_PER_BUNDLE = 512;

/** Trait-signal phrases per bundle. `DEFAULT_TRAIT_SIGNALS` ships 9. */
export const MAX_TRAIT_SIGNALS = 128;

/**
 * The per-pattern time budget for the runtime probe below, and the total
 * across a bundle. Measured against the seed on a developer machine, the
 * slowest shipped pattern needs ~0.35 ms against the worst probe input, and a
 * textbook `(a+)+$` needs ~100 ms — two orders of magnitude apart, which is
 * the gap these numbers sit in. Generous enough that a loaded device does not
 * reject a good bundle; tight enough that an exponential one cannot pass.
 */
export const PATTERN_PROBE_BUDGET_MS = 20;
export const PATTERN_PROBE_TOTAL_BUDGET_MS = 400;

/**
 * Inputs the probe runs every candidate pattern against.
 *
 * DELIBERATELY SHORT. Backtracking blowup is exponential in the input length,
 * so the probe string is the knob that decides how long the probe itself can
 * be made to take: a 24-character run puts a textbook exponential pattern at
 * ~100 ms (detectable), where a 30-character one would put it at ~26 SECONDS
 * (a denial of service performed by the check meant to prevent one). Long runs of a single
 * character with a non-matching tail are the shape that makes an ambiguous
 * quantifier enumerate every split.
 */
const PROBE_INPUTS: readonly string[] = [
  `${"a".repeat(24)}!`,
  `${" ".repeat(24)}!`,
  `${"1".repeat(24)}!`,
  "PHP 1,111,111,111.11 to!",
];

export type PatternRejection =
  | "pattern_too_long"
  | "pattern_uncompilable"
  | "pattern_nested_quantifier"
  | "pattern_too_many_quantifiers";

type QuantifierKind = "none" | "optional" | "repeating" | "unbounded";

/**
 * Classifies the quantifier starting at `index`, if there is one.
 *
 * `"optional"` (`?`, `{0,1}`) is called out separately from `"repeating"`
 * because it is harmless in the position that matters below: `(...)?` tries a
 * group at most once and cannot be made to enumerate splits, and the seed uses
 * that form on almost every optional clause. A lazy marker (`*?`, `{1,48}?`)
 * reads as an `"optional"` on its own and so is never double-counted.
 */
function quantifierAt(source: string, index: number): QuantifierKind {
  const char = source[index];
  if (char === "*" || char === "+") return "unbounded";
  if (char === "?") return "optional";
  if (char !== "{") return "none";

  const braces = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(index));
  if (braces === null) return "none";
  // `{n}` repeats exactly n times; `{n,}` has no upper bound; `{n,m}` stops at m.
  if (braces[2] === undefined) return Number(braces[1]) > 1 ? "repeating" : "none";
  if (braces[3] === "") return "unbounded";
  return Number(braces[3]) > 1 ? "repeating" : "none";
}

/** True for the quantifiers that can make a group enumerate more than one split. */
function isRepeating(kind: QuantifierKind): boolean {
  return kind === "repeating" || kind === "unbounded";
}

/**
 * Walks a regex source once, counting unbounded quantifiers and looking for a
 * repeated group whose body can itself match the same input more than one way
 * — `(a+)+`, `(a|a)*`, `(\w+\s*){2,}`. That ambiguity is what turns a failed
 * match into an exponential search, and it is the shape behind essentially
 * every published ReDoS.
 *
 * BE CLEAR ABOUT WHAT THIS IS: a structural heuristic, not a proof. It rejects
 * benign patterns that happen to wear the dangerous shape (`(?:\d{1,3},)+`
 * terminates in linear time and is refused anyway), and it does not see
 * polynomial blowup spread across sibling quantifiers. It is one of four
 * layers, and the only one of them that is free.
 *
 * Escapes and character classes are skipped so `\(`, `\*` and `[+*]` are read
 * as the literals they are rather than as structure.
 */
export function inspectPattern(source: string): PatternRejection | null {
  if (source.length > MAX_PATTERN_CHARS) return "pattern_too_long";

  const groupStarts: number[] = [];
  let unbounded = 0;
  let inClass = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char === "(") {
      groupStarts.push(i);
      continue;
    }
    if (quantifierAt(source, i) === "unbounded") unbounded += 1;
    if (char !== ")") continue;

    const start = groupStarts.pop();
    // An unbalanced `)` is not this function's problem; the compile below
    // rejects it with a better reason than a structural guess would.
    if (start === undefined) continue;
    if (!isRepeating(quantifierAt(source, i + 1))) continue;
    if (bodyIsAmbiguous(source.slice(start + 1, i))) return "pattern_nested_quantifier";
  }

  if (unbounded > MAX_UNBOUNDED_QUANTIFIERS) return "pattern_too_many_quantifiers";

  try {
    // No flags, matching lib/ingest/parser.ts's compileTemplates: a pattern
    // must be judged in the same dialect it will eventually run in.
    new RegExp(source);
  } catch {
    return "pattern_uncompilable";
  }

  return null;
}

/**
 * True when a repeated group's body could match one input more than one way:
 * it contains a repeating quantifier of its own, or an alternation whose
 * branches this cannot prove disjoint (so it assumes they are not).
 */
function bodyIsAmbiguous(body: string): boolean {
  let inClass = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char === "|") return true;
    if (isRepeating(quantifierAt(body, i))) return true;
  }
  return false;
}

/**
 * The worst wall-clock cost, in milliseconds, of running `source` against the
 * probe inputs. Assumes `inspectPattern` has already passed — the structural
 * checks are what keep this call itself cheap.
 *
 * A warm-up match on a one-character string runs first so the figure measures
 * the pattern rather than the engine's first-call overhead.
 */
export function probePatternCost(source: string): number {
  const regex = new RegExp(source);
  regex.test("0");

  let worst = 0;
  for (const probe of PROBE_INPUTS) {
    const started = Date.now();
    regex.test(probe);
    worst = Math.max(worst, Date.now() - started);
  }
  return worst;
}

const patternSchema = z
  .string()
  .min(1)
  .max(MAX_PATTERN_CHARS, { error: `pattern longer than ${MAX_PATTERN_CHARS} characters` })
  .superRefine((source, ctx) => {
    const rejection = inspectPattern(source);
    if (rejection !== null) ctx.addIssue({ code: "custom", message: rejection });
  });

const templateSchema = z.object({
  id: z.string().min(1).max(64),
  match: patternSchema,
  direction: z.enum(["in", "out"]).optional(),
  /** Base score before penalties (spec §9.1); a probability, so 0..1. */
  confidence: z.number().min(0).max(1),
});

const providerSchema = z.object({
  providerKey: z.string().min(1).max(64),
  packageNames: z.array(z.string().min(1).max(255)).max(32),
  version: z.int().min(0),
  channel: z.enum(["push", "sms"]),
  senderIds: z.array(z.string().min(1).max(32)).max(32).optional(),
  templates: z.array(templateSchema).max(MAX_TEMPLATES_PER_PROVIDER),
  traits: z.object({ owedBalance: z.enum(["likely", "unlikely", "unknown"]).optional() }).optional(),
});

/** A weight in the same units as `DEFAULT_TRAIT_SIGNALS`, whose largest is 250. */
const signalWeightSchema = z.number().min(0).max(10_000);

const traitSignalSchema = z.object({
  // Matched with `String.includes`, never compiled (lib/wallets/classification.ts),
  // so this is bounded for size alone and needs no pattern inspection.
  pattern: z.string().min(1).max(256),
  trait: z.enum(["owed", "held"]),
  weight: signalWeightSchema,
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every tunable, with a range around the value docs/03-ingest-pipeline.md
 * pins (see `DEFAULT_TUNABLES` for each source).
 *
 * THE RANGES ARE THE POINT OF THIS SCHEMA, not the types. Types stop a string
 * where a number belongs, which no attacker needs; ranges stop the numbers
 * that are well-typed and still wrong. Every window is capped so a bundle
 * cannot widen dedupe to "forever" and swallow real transactions, every
 * penalty and threshold is a 0..1 score, and `autoCommitThreshold` carries a
 * hard floor of 0.5: below coin-flip confidence, nothing may ever be booked
 * without the user seeing it, whatever the server says.
 *
 * Each key is optional (a bundle retuning one threshold must not have to
 * restate the other fourteen — `RulesetBundleInput`), but `walletTraits` and
 * `penalties` are all-or-nothing when present, because
 * `parser_rulesets_repo.withDefaultTunables` spreads `walletTraits` whole:
 * a half-stated one would leave the missing fields `undefined` and every
 * comparison against them false.
 */
const tunablesSchema = z.object({
  dedupeStrongWindowMs: z.int().min(0).max(SEVEN_DAYS_MS).optional(),
  dedupeTwinWindowMs: z.int().min(0).max(ONE_DAY_MS).optional(),
  transferPrimaryWindowMs: z.int().min(0).max(ONE_DAY_MS).optional(),
  transferExtendedWindowMs: z.int().min(0).max(SEVEN_DAYS_MS).optional(),
  /** ₱0 to ₱10 000, in centavos. */
  transferFeeFloorCentavos: z.int().min(0).max(1_000_000).optional(),
  transferFeeRate: z.number().min(0).max(1).optional(),
  autoCommitThreshold: z.number().min(0.5).max(1).optional(),
  prefilledThreshold: z.number().min(0.2).max(1).optional(),
  reviewFloorThreshold: z.number().min(0).max(1).optional(),
  /** ₱0 to ₱100 000, in centavos. */
  balanceDriftToleranceCentavos: z.int().min(0).max(10_000_000).optional(),
  walletTraits: z
    .object({
      // At least 1: a zero margin lets a single stray phrase decide whether a
      // balance is the user's money or their debt.
      owedMarginThreshold: z.int().min(1).max(100_000),
      // At least 1: a zero floor trusts a verdict drawn from no observations.
      owedSampleFloor: z.int().min(1).max(1_000),
      priorWeight: z.int().min(0).max(100_000),
    })
    .optional(),
  penalties: z
    .object({
      weakDirection: z.number().min(0).max(1),
      amountAmbiguity: z.number().min(0).max(1),
      walletFallback: z.number().min(0).max(1),
      merchantMissing: z.number().min(0).max(1),
      smsChannel: z.number().min(0).max(1),
    })
    .optional(),
});

/**
 * A bundle as it may arrive from the server or the bundled seed.
 *
 * UNKNOWN KEYS ARE STRIPPED, NOT REJECTED (Zod's default, pinned here on
 * purpose). Rejecting them would make every additive change to the interface
 * contract a flag day where new servers brick old clients; keeping them would
 * store attacker-chosen bytes verbatim in SQLite forever. Stripping does
 * neither, and it is why `parseRulesetBundle` hands back the PARSED value
 * rather than the raw one. The shipped seed's `_note` keys ride this path.
 */
export const rulesetBundleSchema = z
  .object({
    version: z.int().min(1),
    providers: z.array(providerSchema).min(1).max(MAX_PROVIDERS),
    tunables: tunablesSchema.optional(),
    traitSignals: z.array(traitSignalSchema).max(MAX_TRAIT_SIGNALS).optional(),
  })
  .refine(
    (bundle) =>
      bundle.providers.reduce((total, p) => total + p.templates.length, 0) <=
      MAX_TEMPLATES_PER_BUNDLE,
    { error: `more than ${MAX_TEMPLATES_PER_BUNDLE} templates in one bundle` },
  )
  .refine((bundle) => thresholdsAreOrdered(bundle.tunables), {
    error: "thresholds out of order (reviewFloor < prefilled < autoCommit)",
  });

/**
 * The three routing thresholds must stay strictly ordered once merged over
 * `DEFAULT_TUNABLES` — which is the merge the repo actually performs, so a
 * bundle that lowers only `autoCommitThreshold` is checked against the
 * defaults it will really run beside rather than against nothing.
 *
 * Out of order, the gate stops meaning anything: a `prefilledThreshold` above
 * `autoCommitThreshold` makes the auto-commit band unreachable, and a
 * `reviewFloorThreshold` above `prefilledThreshold` discards captures the
 * queue was supposed to see.
 */
function thresholdsAreOrdered(tunables: z.infer<typeof tunablesSchema> | undefined): boolean {
  const reviewFloor = tunables?.reviewFloorThreshold ?? 0.5;
  const prefilled = tunables?.prefilledThreshold ?? 0.6;
  const autoCommit = tunables?.autoCommitThreshold ?? 0.9;
  return reviewFloor < prefilled && prefilled < autoCommit;
}

export type RulesetParseResult =
  | { ok: true; bundle: RulesetBundleInput }
  | { ok: false; reason: string };

/**
 * The whole validation boundary, in the order the checks have to run.
 *
 * 1. shape and ranges, plus per-pattern length and structure (one `safeParse`);
 * 2. per-pattern runtime probe, which only runs on patterns step 1 already
 *    called structurally sane — that ordering is what stops the probe from
 *    becoming the denial of service it exists to catch.
 *
 * The caller gets a stripped, fully-checked bundle or a reason, never a
 * half-checked object.
 */
export function parseRulesetBundle(data: unknown): RulesetParseResult {
  const result = rulesetBundleSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return { ok: false, reason: `${path}${issue.message}` };
  }

  let spent = 0;
  for (const provider of result.data.providers) {
    for (const template of provider.templates) {
      const cost = probePatternCost(template.match);
      spent += cost;
      if (cost > PATTERN_PROBE_BUDGET_MS) {
        return {
          ok: false,
          reason: `${provider.providerKey}/${template.id}: pattern took ${cost}ms against a probe input`,
        };
      }
      if (spent > PATTERN_PROBE_TOTAL_BUDGET_MS) {
        return { ok: false, reason: `patterns took ${spent}ms in total` };
      }
    }
  }

  return { ok: true, bundle: result.data };
}
