// lib/ingest/parser.ts — Stage 2, the template engine.
//
// docs/03-ingest-pipeline.md §4. One routed capture in, one `ParsedEvent` or
// `null` out. This is where a wall of provider prose becomes an amount, a
// direction and a score, and the score is what decides whether a human ever
// sees the result: at `>= 0.90` the transaction is committed silently (§9.2).
//
// Three things this stage must never do, each because the failure is invisible:
//
//   - Produce a number reached through floating-point arithmetic. Delegated
//     entirely to `amount.ts`, which explains why.
//   - Guess a direction. Money with no sign is unusable, and inventing one
//     books a spend as income. When nothing yields a direction, this returns
//     `null` and the raw capture goes to the Review Queue instead.
//   - Throw. Templates are REMOTE DATA (spec §11.1); one malformed row from
//     the server must cost that one template, not every parse on the device
//     until the next app release (§4 rule 4).
//
// Pure: no I/O, no clock, no database. `occurredAt` comes from the capture's
// own `postedAt`, so the whole stage is a function of its two arguments.
import { countAmountTokens, parseAmountToCentavos } from "@/lib/ingest/amount";
import { DEFAULT_TUNABLES, type PipelineTunables } from "@/lib/ingest/ruleset_types";

import type { ProviderRuleset, ProviderTemplate } from "@/lib/ingest/ruleset_types";
import type { Centavos, RawCapture, TxDirection } from "@/types/domain";

/**
 * One parsed notification. Interface contract §5 — do not reshape, rename or
 * extend. Downstream stages (`normalizer`, `dedupe_gate`, `transfer_detector`)
 * and the server's own model are written against exactly these field names.
 */
export type ParsedEvent = {
  providerKey: string;
  amount: Centavos;
  direction: TxDirection;
  merchant?: string;
  counterparty?: string;
  referenceNo?: string;
  balanceAfter?: Centavos;
  occurredAt: number;
  walletHint?: string;
  confidence: number;
};

/**
 * The keyword sets of plan Task 4 rule 4, and the LAST resort for direction.
 *
 * Matched at a word boundary with no trailing boundary, so each entry is a stem
 * — "debit" covers "debited", "withdraw" covers "withdrawn" and "withdrawal".
 * Case-insensitive because notification prose capitalises inconsistently.
 *
 * ONE ALTERNATION, NOT TWO PASSES. Scanning the `out` set to exhaustion and
 * then the `in` set would make the answer depend on which set was checked
 * first: "You sent ₱500.00 as a refund" carries both cues, and a two-pass
 * implementation books it as income. A single alternation finds the EARLIEST
 * cue in the text, which is the verb describing the event.
 */
const DIRECTION_KEYWORDS: ReadonlyArray<readonly [string, TxDirection]> = [
  ["sent", "out"],
  ["paid", "out"],
  ["purchase", "out"],
  ["debit", "out"],
  ["withdraw", "out"],
  ["received", "in"],
  ["credited", "in"],
  ["refund", "in"],
  ["cash-in", "in"],
  ["deposit", "in"],
];

const DIRECTION_KEYWORD_PATTERN = new RegExp(
  `\\b(${DIRECTION_KEYWORDS.map(([word]) => word).join("|")})`,
  "iu",
);

/** How a direction was arrived at. Only `keyword` is a weak cue (§9.1). */
type DirectionSource = "template_field" | "capture_group" | "keyword";

type ResolvedDirection = { direction: TxDirection; source: DirectionSource };

/** A template with its regex already compiled, or dropped because it would not compile. */
type CompiledTemplate = {
  provider: ProviderRuleset;
  template: ProviderTemplate;
  regex: RegExp;
};

/**
 * Confidence is computed in ten-thousandths and divided back at the end.
 *
 * Not pedantry — a routing bug. Computed naively, `0.70 - 0.05 - 0.05` is
 * `0.5999999999999999` in IEEE-754, which is BELOW the 0.60 prefilled
 * threshold: an SMS partial match with no merchant would route to "needs
 * details" instead of "prefilled" purely on rounding dust, and the spec's table
 * would read as though it said something it does not (§9.2).
 *
 * Ten-thousandths rather than hundredths so that a remotely retuned penalty
 * finer than the spec's two decimals survives intact (§11.1).
 */
const SCORE_SCALE = 10_000;

const toScaled = (value: number): number => Math.round(value * SCORE_SCALE);

/**
 * Compiles every template up front, dropping the ones that will not compile.
 *
 * NO FLAGS. The source string is authored against whatever dialect the ruleset
 * author used, and `u` mode is strict enough to reject patterns that are
 * perfectly valid without it — a template that worked yesterday must not stop
 * compiling because this file added a flag. No `g` either: `exec` on a global
 * regex advances `lastIndex`, so the same template would match or miss
 * depending on what was parsed before it.
 *
 * A pattern that throws is SKIPPED SILENTLY (spec §4 rule 4). Doing it here,
 * once, rather than inside the search loops also means a malformed row costs
 * one failed compile per parse instead of one per text field.
 */
function compileTemplates(rules: ProviderRuleset[]): CompiledTemplate[] {
  const compiled: CompiledTemplate[] = [];

  for (const provider of rules) {
    for (const template of provider.templates) {
      try {
        compiled.push({ provider, template, regex: new RegExp(template.match) });
      } catch {
        // A malformed pattern from the server. Skipping is the whole point.
        continue;
      }
    }
  }

  return compiled;
}

/**
 * The notification's text fields, richest first.
 *
 * `bigText` → `text` → `title`, per plan rule 2 and spec §5: the expanded text
 * is the most complete, and §4's failure-mode table warns that collapsed text
 * arrives with "fields cut off" — a truncated `text` can bind an amount chopped
 * mid-number, so the expanded form must win whenever it exists.
 *
 * `subText` is excluded, matching `source_router.ts`. It carries an app-supplied
 * label (account nickname, folder, sender line), not the body. The two stages
 * have to agree on this list: a capture the router retained on the strength of a
 * field the parser never reads would sit in the Review Queue unparseable forever.
 *
 * Blank fields are dropped so an empty `bigText` cannot shadow a populated `text`.
 */
function searchableTexts(capture: RawCapture): string[] {
  return [capture.bigText, capture.text, capture.title].filter(
    (field): field is string => field !== null && field.trim() !== "",
  );
}

/**
 * Currency markers that are definitively NOT Philippine pesos.
 *
 * `PHP`, `Php` and `₱` are deliberately absent — those are ours. So is a bare
 * `P`, which is a peso marker here (see `amount.ts`).
 *
 * `$` is included and is the one worth thinking about: it is ambiguous (many
 * currencies use it) and it appears in ordinary merchant names. Including it
 * over-triggers slightly, sending the odd legitimate transaction to the Review
 * Queue. That is the correct direction to be wrong — spec §1 principle 1 makes
 * the Review Queue the remedy for uncertainty, and the alternative is booking a
 * foreign amount as pesos, which corrupts totals with no visible symptom.
 */
const FOREIGN_CURRENCY = /\b(USD|EUR|GBP|JPY|AUD|CAD|SGD|HKD|CNY|RMB|KRW|THB|MYR|IDR|VND|AED|CHF|NZD|TWD|INR)\b|[$€£¥₩]/u;

/**
 * True when a currency marker other than the peso sits next to the captured
 * amount.
 *
 * Scoped to a window around the amount rather than the whole text on purpose: a
 * notification may legitimately mention another currency elsewhere ("USD rates
 * updated") while the transaction itself is in pesos. What must never pass is a
 * foreign marker attached to THIS number.
 */
function hasForeignCurrencyMarker(text: string, rawAmount: string): boolean {
  const at = text.indexOf(rawAmount);
  if (at === -1) return FOREIGN_CURRENCY.test(text);

  // Enough to cover "USD " / "US$" before, and " USD" after.
  const WINDOW = 6;
  const before = text.slice(Math.max(0, at - WINDOW), at);
  const after = text.slice(at + rawAmount.length, at + rawAmount.length + WINDOW);

  return FOREIGN_CURRENCY.test(before) || FOREIGN_CURRENCY.test(after) || FOREIGN_CURRENCY.test(rawAmount);
}

/** A bound group's text, trimmed, or `undefined` when unbound or blank. */
function boundValue(groups: Record<string, string | undefined>, name: string): string | undefined {
  const trimmed = groups[name]?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/** Reads a direction out of one word or phrase — `"in"`/`"out"` literally, or a keyword. */
function directionFromToken(token: string): TxDirection | undefined {
  const normalized = token.trim().toLowerCase();
  if (normalized === "in" || normalized === "out") return normalized;

  const match = DIRECTION_KEYWORD_PATTERN.exec(normalized);
  if (match === null) return undefined;

  return DIRECTION_KEYWORDS.find(([word]) => word === match[1]?.toLowerCase())?.[1];
}

/**
 * Plan Task 4 rule 4, corrected 2026-08-10 — three paths, in this order:
 *
 *   1. The template's own `direction` field. The author fixed it; nothing is
 *      being inferred. No penalty. (All 32 shipped seed templates use this.)
 *   2. A bound `(?<direction>…)` capture group. Contract §5 lists `direction`
 *      among the named groups, so a template declaring one has stated the
 *      direction explicitly — a group match is an EXPLICIT CUE and takes no
 *      penalty. Without this path the group would be captured and silently
 *      ignored, making the contract's named-group list a lie.
 *   3. Keyword inference over the text. This one really is a guess from
 *      surrounding prose, and it is the only path that pays the §9.1
 *      weak-direction penalty.
 *
 * A group that bound something unrecognised ("Processed") falls through to
 * path 3 rather than failing the parse — the prose usually still explains the
 * event, and it is charged the weak-cue penalty because that is now what it is.
 *
 * Returns `undefined` when no path yields a direction. The caller refuses the
 * parse: a transaction with no direction cannot be added to or subtracted from
 * anything, and guessing books spending as income.
 */
function resolveDirection(
  template: ProviderTemplate,
  groups: Record<string, string | undefined>,
  text: string,
): ResolvedDirection | undefined {
  if (template.direction !== undefined) {
    return { direction: template.direction, source: "template_field" };
  }

  const group = boundValue(groups, "direction");
  if (group !== undefined) {
    const fromGroup = directionFromToken(group);
    if (fromGroup !== undefined) return { direction: fromGroup, source: "capture_group" };
  }

  const fromKeyword = directionFromToken(text);
  return fromKeyword === undefined ? undefined : { direction: fromKeyword, source: "keyword" };
}

/**
 * Spec §9.1's amount-ambiguity test: did any amount-like token survive parsing
 * unaccounted for?
 *
 * The template accounts for one token by binding `amount`, and for a second by
 * binding `balance` — the case §4's failure-mode table names ("amount +
 * balance-after → wrong amount risk"). Anything left over is a number a looser
 * template could have bound as the amount instead, and that is the risk the
 * −0.30 buys down.
 *
 * WHY THE COUNT AND NOT JUST THE PLAN'S TWO-TOKEN RULE. Plan rule 3 phrases
 * this as "`countAmountTokens > 1` and the template did not bind an explicit
 * balance group to absorb the second token", which assumes there are exactly
 * two tokens. Spec §9.1's own wording is the general form — "multiple
 * amount-like tokens SURVIVED parsing" — so a third, unbound token (a fee, say)
 * is still ambiguous even when the balance group did absorb the second. Per the
 * plan's Global Constraints the spec wins where the two disagree. Both of the
 * two-token cases score identically under either reading.
 *
 * Note this leans on `countAmountTokens`, which requires a real currency
 * marker; an under-count merely withholds the penalty, which is the harmless
 * direction.
 */
function hasAmbiguousAmount(text: string, balanceBound: boolean): boolean {
  const accountedFor = balanceBound ? 2 : 1;
  return countAmountTokens(text) > accountedFor;
}

/**
 * The §9.1 score: the template's declared base, minus every penalty this stage
 * owns, clamped to `[0, 1]`.
 *
 * THE BASE IS THE TEMPLATE'S `confidence` WHENEVER THE REGEX MATCHED — 1.00 for
 * an exact template, 0.70 for one written as a partial/fuzzy strategy (contract
 * §5, spec §5 rule 2). It is NOT downgraded because a declared-optional group
 * failed to bind. Plan rule 3 was corrected on 2026-08-10 for exactly this:
 * Task 2 rule 4 REQUIRES merchant and reference groups to be optional, those
 * groups are unbound in most real notifications, and downgrading the base for
 * them would score nearly every notification 1.00 → 0.70 → −0.05 = 0.65, below
 * the 0.90 auto-commit threshold, permanently. The lost information is already
 * charged once as the merchant-missing penalty; charging it twice is what broke
 * the arithmetic.
 *
 * CLAMPED ONCE, AFTER SUMMING. Clamping per penalty would let the order they
 * are applied in change the answer.
 *
 * The wallet-fallback penalty (0.10) is deliberately absent — the Normalizer
 * applies it, because it is the stage that resolves wallets (plan Task 5).
 *
 * PENALTY VALUES ARE PASSED IN, not read from `DEFAULT_TUNABLES`. Spec §9.1's
 * table "ships as tunable ruleset data (§11)", so a server bundle must be able
 * to retune these four penalties without an app release. Contract §5 originally
 * pinned `parseCapture` to `(capture, rules)` with no tunables argument, which
 * made that impossible — and made it silently impossible, since the Normalizer's
 * and DedupeGate's tunables *were* passed in and moved normally. The contract
 * was corrected on 2026-08-10 to take `tunables` as its trailing argument, the
 * same shape every other stage already used.
 */
function scoreMatch(args: {
  template: ProviderTemplate;
  provider: ProviderRuleset;
  directionSource: DirectionSource;
  merchant: string | undefined;
  ambiguousAmount: boolean;
  tunables: PipelineTunables;
}): number {
  const { penalties } = args.tunables;
  let scaled = toScaled(args.template.confidence);

  if (args.directionSource === "keyword") scaled -= toScaled(penalties.weakDirection);
  if (args.ambiguousAmount) scaled -= toScaled(penalties.amountAmbiguity);
  if (args.merchant === undefined) scaled -= toScaled(penalties.merchantMissing);
  if (args.provider.channel === "sms") scaled -= toScaled(penalties.smsChannel);

  return Math.min(SCORE_SCALE, Math.max(0, scaled)) / SCORE_SCALE;
}

/**
 * Builds the event for one template that matched, or `undefined` when the match
 * cannot become a usable transaction.
 *
 * The two refusals are deliberate and both fall through to the next template
 * rather than ending the parse: a template can match text whose amount will not
 * parse (it caught a version string, or a fraction finer than centavos), and a
 * template can match text carrying no direction at all. In both cases another
 * template may read the same notification correctly, and neither refusal can
 * ever produce a wrong number — which is the property that matters.
 */
function buildEvent(
  compiled: CompiledTemplate,
  match: RegExpExecArray,
  text: string,
  capture: RawCapture,
  tunables: PipelineTunables,
): ParsedEvent | undefined {
  const { provider, template } = compiled;
  const groups = match.groups ?? {};

  const rawAmount = boundValue(groups, "amount");
  if (rawAmount === undefined) return undefined;

  // Spec §5 rule 1 / §9.2: PHP only in MVP, and a non-PHP amount is a HARD
  // route to the Review Queue regardless of score.
  //
  // This check belongs here and nowhere else. `parseAmountToCentavos` accepts a
  // BARE "50.00", so a template that captures only the digits out of
  // "USD 50.00" yields 5000 centavos and books fifty dollars as fifty pesos --
  // silently, with full confidence. The Normalizer cannot catch it either: it
  // receives a ParsedEvent, which carries no text, so by then the currency
  // marker is already gone. The parser is the only stage that sees the amount
  // and the words around it at the same time.
  //
  // Refusing returns `undefined`, so the search falls through to the next
  // template and ultimately to `null` -- the raw capture reaches the Review
  // Queue with its text intact, which is exactly what the spec asks for.
  if (hasForeignCurrencyMarker(text, rawAmount)) return undefined;

  const amount = parseAmountToCentavos(rawAmount);
  if (amount === null) return undefined;

  const resolved = resolveDirection(template, groups, text);
  if (resolved === undefined) return undefined;

  const rawBalance = boundValue(groups, "balance");
  // An unreadable balance is not a parse failure — spec §5 rule 5 says it
  // "never overrides the ledger", so it costs nothing to drop.
  const balanceAfter = rawBalance === undefined ? null : parseAmountToCentavos(rawBalance);

  const merchant = boundValue(groups, "merchant");

  const event: ParsedEvent = {
    providerKey: provider.providerKey,
    amount,
    direction: resolved.direction,
    occurredAt: capture.postedAt, // spec §10 — never `capturedAt`. See parseCapture.
    confidence: scoreMatch({
      template,
      provider,
      directionSource: resolved.source,
      merchant,
      ambiguousAmount: hasAmbiguousAmount(text, rawBalance !== undefined),
      tunables,
    }),
  };

  // Optional fields are assigned only when present, so the object matches the
  // contract shape exactly rather than carrying a spread of `undefined` keys.
  if (merchant !== undefined) event.merchant = merchant;

  const counterparty = boundValue(groups, "counterparty");
  if (counterparty !== undefined) event.counterparty = counterparty;

  const referenceNo = boundValue(groups, "ref");
  if (referenceNo !== undefined) event.referenceNo = referenceNo;

  if (balanceAfter !== null) event.balanceAfter = balanceAfter;

  const walletHint = boundValue(groups, "walletHint");
  if (walletHint !== undefined) event.walletHint = walletHint;

  return event;
}

/**
 * Parses one capture against an ordered list of provider rulesets. Contract §5.
 *
 * SEARCH ORDER: the richest text field first, and within a field the templates
 * in array order (plan rules 2 and 5). Field outside template on purpose —
 * spec §4's truncation failure mode makes preferring the expanded text a safety
 * property, and nesting it the other way would let a template early in the
 * array bind a chopped amount out of the collapsed `text` while the complete
 * `bigText` sat unread. In practice `bigText` is a superset of `text`, so the
 * two orderings agree on everything except the case the safety property exists
 * for.
 *
 * `occurredAt` is `capture.postedAt`, never `capturedAt` (spec §10): a capture
 * drained from the native buffer after a reboot can be hours or days younger
 * than the notification it describes, and the notification's own timestamp is
 * what decides which Limit period the money lands in.
 *
 * Returns `null` when nothing usable was found — no template matched, or the
 * ones that did carried no readable amount or no resolvable direction. That is
 * not an error: spec §4 rule 3 has this stage classify and drop OTPs,
 * marketing and balance inquiries, and the orchestrator routes a known
 * provider's unparsed capture to the Review Queue with its raw text intact.
 */
export function parseCapture(
  capture: RawCapture,
  rules: ProviderRuleset[],
  tunables: PipelineTunables = DEFAULT_TUNABLES,
): ParsedEvent | null {
  const templates = compileTemplates(rules);

  for (const text of searchableTexts(capture)) {
    for (const compiled of templates) {
      const match = compiled.regex.exec(text);
      if (match === null) continue;

      const event = buildEvent(compiled, match, text, capture, tunables);
      if (event !== undefined) return event;
    }
  }

  return null;
}
