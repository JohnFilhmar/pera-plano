// mobile/lib/ai/output_guard.ts
//
// DETERMINISTIC, NO LLM, AFTER GENERATION. Spec §4.4. Grounding (§3.5) rules on
// whether the numbers in a sentence are real. This rules on whether the
// sentence is one we are willing to render at all. Both must pass or the
// surface degrades to the card, which carries the true figure anyway.
//
// THE THREE CLASSES, and why each is here:
//
//   1. PRESCRIPTIVE MODALS. The app does not give financial advice — triage.ts
//      stops the user ASKING for it, and this stops the model VOLUNTEERING it
//      on a question that was perfectly answerable. Matched on word boundaries,
//      never as substrings: "Considering only this month, …" is descriptive and
//      must survive.
//
//   2. IMPERATIVES AIMED AT THE USER. Rare in honest output, common in injected
//      output. Anchored to sentence position, because the failure mode is a
//      command ("Call the bank now") and not a noun that shares its stem
//      ("Transfers to Savings totalled …").
//
//   3. CONTACT DETAILS — A HARD DISCARD. No tool result ever legitimately
//      contains a URL or a phone number, so one in an answer is fabricated BY
//      DEFINITION. This is the class with the worst payoff for the attacker and
//      the cheapest test for us: the most dangerous thing a finance app can
//      render is a phone number sitting next to a real balance.
//
// THE TABLES ARE DATA, NOT BRANCHES, on the same terms as triage.ts: every
// phrasing that gets past this on a real device becomes a new row AND a new
// test case, in the same commit.

import type { AnswerLevel } from "./levels";
import { mentionsMoney } from "./moneyWords";

export type GuardReason = "prescriptive" | "imperative" | "contact";

export type GuardVerdict = { suppressed: false } | { suppressed: true; reason: GuardReason };

/**
 * Spec §4.4's named five, plus the phrasings that mean the same thing. `'` is
 * spelled both ways because a model that has seen typographic apostrophes will
 * emit them.
 */
const PRESCRIPTIVE: RegExp[] = [
  /\byou\s(?:should|must|ought\sto|need\sto|have\sto)\b/i,
  /\byou[''`]?d\sbe\sbetter\soff\b/i,
  /\bI\s(?:recommend|suggest|advise)\b/i,
  /\bI[''`]?d\s(?:recommend|suggest|advise)\b/i,
  /\bmy\sadvice\b/i,
  /\btry\sto\b/i,
  // `\b` after the stem is what keeps "Considering only this month, …" alive:
  // the trailing "ing" is a word character, so the boundary fails and the
  // descriptive sentence survives. Do not relax this to a substring test.
  /\bconsider\b/i,
  /\bit[''`]?s\sbest\sto\b/i,
  /\bit\swould\sbe\sbetter\sto\b/i,
];

/**
 * Sentence position is the whole mechanism. The prefix admits the start of the
 * prose, the start of any later sentence, and a leading "Please" — which is
 * where an injected instruction actually lands.
 */
const IMPERATIVE_PREFIX = String.raw`(?:^|[.!?]\s+|\n\s*)(?:please\s+)?`;

const IMPERATIVE_VERBS = [
  "call",
  "dial",
  "text",
  "email",
  "contact",
  "reply",
  "go\\sto",
  "visit",
  "click",
  "tap",
  "open",
  "download",
  "install",
  "transfer",
  "send",
  "pay",
  "sign\\sup",
  "sign\\sin",
  "log\\sin",
  "enter",
  "confirm",
  "verify",
].join("|");

const IMPERATIVE = new RegExp(`${IMPERATIVE_PREFIX}(?:${IMPERATIVE_VERBS})\\b`, "i");

/**
 * URL shapes. The bare-domain rule uses an explicit TLD list rather than a
 * generic `\.[a-z]{2,}` so that ordinary abbreviations in prose ("e.g.") do not
 * read as a domain.
 */
const URL_PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\//i,
  /\bwww\.[a-z0-9-]/i,
  /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|ph|io|co|ly|me|app|info|biz|xyz|link)\b/i,
  /\b[a-z0-9._%-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
];

/**
 * Phone shapes, PH-first.
 *
 * The lookbehinds keep a formatted peso figure out of this: `₱8,888.00` must
 * not read as a landline, and `2026-03-31` must not read as one either. Every
 * pattern therefore refuses to start immediately after a digit, a group
 * separator, a decimal point or the peso mark.
 */
const PHONE_PATTERNS: RegExp[] = [
  // +63 917 123 4567 / +639171234567
  /\+\d{1,3}[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/,
  // (02) 8888-1234
  /\(0\d{1,3}\)\s?\d{3,4}[\s.-]?\d{4}\b/,
  // 09171234567, and any bare run long enough to be dialled
  /(?<![\d,.₱])\d{7,}(?!\d)/,
  // 8888-1234
  /(?<![\d,.₱-])\d{3,4}-\d{4}(?![\d-])/,
];

function matchesAny(prose: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(prose));
}

/**
 * CONTACT IS CHECKED FIRST because it is the hard discard: when a sentence is
 * both advice and a phone number, the phone number is the finding a reviewer
 * needs to see in the log. The order only decides which reason is reported —
 * the prose is suppressed either way.
 */
export function guard(prose: string): GuardVerdict {
  if (matchesAny(prose, URL_PATTERNS) || matchesAny(prose, PHONE_PATTERNS)) {
    return { suppressed: true, reason: "contact" };
  }
  if (matchesAny(prose, PRESCRIPTIVE)) {
    return { suppressed: true, reason: "prescriptive" };
  }
  if (IMPERATIVE.test(prose)) {
    return { suppressed: true, reason: "imperative" };
  }
  return { suppressed: false };
}

/**
 * The guard as a given answer level applies it. Assistant levels spec §5.1.
 *
 * Levels 1 to 4 run the whole guard. Level 5 answers any topic, so advice
 * wording ("you should bring an umbrella") is suppressed only when the question
 * or the answer is about money. Contact details are suppressed at every level:
 * a phone number next to a real balance is the worst thing this app can render.
 *
 * @param prose - The raw answer.
 * @param context.level - The level the answer was generated at.
 * @param context.question - The user's message, so a money question keeps the full guard.
 * @returns The same verdict shape as `guard`.
 */
export function guardAtLevel(prose: string, context: { level: AnswerLevel; question: string }): GuardVerdict {
  const verdict = guard(prose);
  // Level 5 only: advice wording about something other than money survives.
  // Contact details never do, at any level, because `guard` reports them first.
  if (
    verdict.suppressed &&
    verdict.reason !== "contact" &&
    context.level === 5 &&
    !mentionsMoney(context.question) &&
    !mentionsMoney(prose)
  ) {
    return { suppressed: false };
  }
  return verdict;
}
