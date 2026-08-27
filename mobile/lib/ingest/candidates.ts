// lib/ingest/candidates.ts — the best-effort read of a notification NO RULESET
// MATCHED (docs/04-features/08-review-queue.md §"Flow: unknown provider").
//
// WHY THIS EXISTS AT ALL. `pipeline.ts` queues an unknown provider with
// `{ amount: null, direction: null, packageName }` — the parser never ran,
// because there was no template to run. Everything downstream reads that
// payload, so the correction sheet opened blank and the user, who had just
// tapped "This is a money notification", was handed an empty form and asked to
// retype what the notification in front of them already said. The text was
// there the whole time: `raw_notifications` stored it, and the card renders it.
//
// SO THIS MODULE PROPOSES, AND ONLY PROPOSES. Nothing here commits anything;
// nothing here is trusted by the pipeline. `captureCandidates` reads whatever
// it can out of the raw text and, crucially, says WHEN IT CANNOT TELL.
//
// THE ONE FAILURE THAT MATTERS. Not "found nothing" — the user simply types, as
// they do today. It is naming the WRONG number: "You sent ₱1,250.00 … new
// balance ₱3,420.50" committed as a ₱3,420.50 spend is exactly the silent,
// unexplainable ledger error the Review Queue exists to prevent (top risk 4).
// Two defences, in this order:
//
//   1. RANK, don't average. A token introduced by a balance cue is a balance,
//      not a candidate. This is what makes the common two-token notification
//      unambiguous rather than a coin flip — and it is why the one-tap path is
//      the normal case in the field rather than a lucky one.
//   2. REFUSE when two candidates survive ranking. `best` is `null` unless
//      exactly one token is transaction-shaped. A payment and a fee are both
//      real amounts and nothing in the prose ranks them, so the user taps the
//      one they mean. Guessing there would be the wrong kind of helpful.
//
// The same rule governs direction: inferred from the parser's OWN keyword sets
// (`directionFromToken`) or left `null`. A direction guessed from no cue books
// spending as income, and the ledger has no way to notice.
//
// PURE, and deliberately so: no DB, no hooks, no React. The card and the sheet
// both read it, and the Review Queue's tests can pin its judgement without
// rendering anything.
import { amountTokens, parseAmountToCentavos } from "@/lib/ingest/amount";
import { directionFromToken, searchableTexts } from "@/lib/ingest/parser";
import type { Centavos, RawCapture, TxDirection } from "@/types/domain";

/**
 * What a candidate turned out to be.
 *
 * `balance` is not "rejected" — it is still rendered, still tappable, because
 * the ranking is a heuristic over prose and the user is the one who can see
 * that this particular app puts the amount after the word "balance". It is
 * excluded only from `best`, i.e. from anything that would commit without
 * being asked.
 */
export type CandidateRole = "amount" | "balance";

/**
 * One amount-like token, resolved to centavos and located in the line it was
 * found on, so the sheet can render that line with this token pressable.
 */
export type AmountCandidate = {
  centavos: Centavos;
  text: string;
  lineIndex: number;
  start: number;
  end: number;
  role: CandidateRole;
};

/** Everything a card or sheet can say about a capture nothing could parse. */
export type CaptureCandidates = {
  /** The lines shown to the user — the SAME ones `snippetLines` gives the card. */
  lines: readonly string[];
  /** Every resolvable token, in reading order, each ranked. */
  amounts: readonly AmountCandidate[];
  /** The sole transaction-shaped candidate, or `null` when that is a question. */
  best: AmountCandidate | null;
  direction: TxDirection | null;
  merchant: string | null;
};

/** A proposal complete enough to commit in one tap. See `autofillFrom`. */
export type AutofillProposal = {
  amount: Centavos;
  direction: TxDirection;
  merchant: string | null;
};

/**
 * The lines the user is shown, richest-label first, deduped, capped at three.
 *
 * TITLE FIRST HERE, unlike `searchableTexts`. The two orders answer different
 * questions: the parser reads for completeness (expanded body first), while
 * this is a QUOTE of the notification as it appeared, and the notification
 * appeared with its title on top. `subText` is included for the same reason —
 * it is part of what the user saw, even though no parsing stage reads it.
 *
 * Three lines because a notification has at most a title, a body and a label
 * worth quoting; past that it is the same sentence expanded, and a wall of
 * repeated text is not evidence, it is noise.
 */
export function snippetLines(capture: RawCapture): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const field of [capture.title, capture.text, capture.bigText, capture.subText]) {
    const value = field?.trim();
    if (value === undefined || value === "" || seen.has(value)) continue;
    seen.add(value);
    lines.push(value);
    if (lines.length === 3) break;
  }
  return lines;
}

/**
 * The words that mean "this number is what is LEFT, not what MOVED".
 *
 * Matched immediately before a token, with only the small connective words a
 * provider might put between ("balance is ₱x", "Bal: ₱x", "balance ₱x"). The
 * tail is deliberately tight: a cue three clauses away is not describing this
 * token, and a loose match would demote the real amount and leave `best` null
 * on notifications that were never ambiguous.
 */
const BALANCE_CUE_BEFORE =
  /\b(?:bal|balance|available|remaining|natitira)\b(?:\s+(?:is|of|now|na))?\s*[:=-]?\s*$/iu;

/**
 * The same claim made after the number ("₱1,000.00 remaining"). Anchored at the
 * start of what follows, for the same reason the cue above is anchored at the
 * end of what precedes.
 */
const BALANCE_CUE_AFTER = /^\s*(?:is\s+)?(?:remaining|left|balance)\b/iu;

/** How far back a balance cue can sit and still be describing this token. */
const CUE_WINDOW = 24;

function roleOf(line: string, start: number, end: number): CandidateRole {
  const before = line.slice(Math.max(0, start - CUE_WINDOW), start);
  if (BALANCE_CUE_BEFORE.test(before)) return "balance";
  return BALANCE_CUE_AFTER.test(line.slice(end, end + CUE_WINDOW)) ? "balance" : "amount";
}

/**
 * Where a merchant name would be if the notification names one.
 *
 * Three prepositions and nothing cleverer. This field is EDITABLE and never
 * blocks a save, so the cost of a wrong guess is one correction the user was
 * already able to make; the cost of no guess is retyping a name that was on
 * screen. That asymmetry is the whole justification — it would not survive if
 * this fed the amount.
 */
const MERCHANT_PATTERN = /\b(?:to|from|at)\s+(\S[^\n.,;]*)/iu;

/**
 * Where the name stops. Everything after one of these words is notification
 * furniture — a timestamp, a reference number, a running balance.
 */
const MERCHANT_TAIL = /\s+(?:on|ref|ref\.|with|for|via|using|dated|last)\b.*$/iu;

/** Longer than this and the pattern bound a sentence, not a name. */
const MERCHANT_MAX_LENGTH = 40;

/**
 * What the preposition introduced was the user's own account, not a
 * counterparty — "debited from your account", "sent to the wallet".
 *
 * Common enough in bank prose to be worth refusing outright: "your account" in
 * the merchant field is not a harmless wrong guess, it is a merchant name that
 * would go on to key a category rule and match every notification that app
 * ever sends.
 */
const MERCHANT_REJECT = /^(?:your|my|our|the|a|an)\b/iu;

function merchantFrom(texts: readonly string[]): string | null {
  for (const text of texts) {
    const match = MERCHANT_PATTERN.exec(text);
    const candidate = match?.[1]?.replace(MERCHANT_TAIL, "").trim();
    if (candidate === undefined || candidate === "") continue;
    // A name that is really an amount, a date or an account number. `at 10:30`
    // and `to ₱100.00` both land here, and both mean the preposition was not
    // introducing a merchant at all.
    if (/^(?:₱|PHP|Php|\d)/u.test(candidate)) continue;
    if (MERCHANT_REJECT.test(candidate)) continue;
    if (candidate.length > MERCHANT_MAX_LENGTH) continue;
    return candidate;
  }
  return null;
}

/**
 * Read a capture for everything the Review Queue could offer to fill in.
 *
 * Candidates are scanned over the DISPLAYED lines rather than
 * `searchableTexts`, because every candidate carries an offset the sheet uses
 * to make that token pressable inside the line the user is reading. Direction
 * and merchant use `searchableTexts` — they need the richest field, not the
 * one on top.
 */
export function captureCandidates(capture: RawCapture): CaptureCandidates {
  const lines = snippetLines(capture);
  const amounts: AmountCandidate[] = [];

  lines.forEach((line, lineIndex) => {
    for (const token of amountTokens(line)) {
      const centavos = parseAmountToCentavos(token.text);
      // The loose token pattern tolerates grouping the strict parser refuses
      // ("₱12,34"). A token that cannot become centavos cannot become an
      // amount either, so it is not offered as one.
      if (centavos === null) continue;
      amounts.push({
        centavos,
        text: token.text,
        lineIndex,
        start: token.start,
        end: token.end,
        role: roleOf(line, token.start, token.end),
      });
    }
  });

  // A token repeated across title and body is one number said twice, not two
  // candidates — offering it twice would make an unambiguous notification look
  // like a choice and suppress the one-tap path for no reason.
  const live = amounts.filter((candidate) => candidate.role === "amount");
  const distinct = new Set(live.map((candidate) => candidate.centavos));

  const texts = searchableTexts(capture);
  const direction = texts.map((text) => directionFromToken(text)).find((value) => value !== undefined);

  return {
    lines,
    amounts,
    best: distinct.size === 1 ? (live[0] ?? null) : null,
    direction: direction ?? null,
    merchant: merchantFrom(texts),
  };
}

/**
 * The one-tap gate: a proposal, or `null` when anything is still a question.
 *
 * BOTH FIELDS OR NEITHER. A missing amount is obvious. A missing direction is
 * the dangerous one — it has a plausible default ("out" covers most
 * notifications) and defaulting it would book the occasional salary credit as
 * a ₱30,000 spend, quietly, on a card the user cleared in one tap precisely
 * because they trusted it. The sheet is the right answer there: it shows the
 * toggle and makes the choice visible.
 *
 * The merchant rides along and never gates anything.
 */
export function autofillFrom(capture: RawCapture): AutofillProposal | null {
  const { best, direction, merchant } = captureCandidates(capture);
  if (best === null || direction === null) return null;
  return { amount: best.centavos, direction, merchant };
}
