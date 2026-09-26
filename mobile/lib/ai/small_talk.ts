// mobile/lib/ai/small_talk.ts
//
// SMALL TALK NEVER REACHES THE MODEL. On 2026-09-25 the owner typed "hello" and
// got a list of wallets back: the old tool grammar could only call a tool or
// decline, so a greeting had nowhere else to go. Under spec §7.4 typed text does
// not reach the model at all, so a greeting, a thank-you, "what can you do" or a
// goodbye gets a fixed reply from the chat surface instead, in the language it
// was written in.
//
// WHOLE MESSAGES ONLY. Every pattern is anchored at both ends, so "hi, how much
// do I have" is not a greeting and falls through to the rest of triage.
//
// THE TABLE IS DATA, like `triage.ts`'s advice rows: a phrasing seen on a real
// device becomes a row here and a case in `__tests__/small_talk.test.ts`, in the
// same commit.

export type SmallTalk = "greeting" | "thanks" | "help" | "goodbye";

export type ReplyLanguage = "en" | "fil";

export type SmallTalkRow = {
  id: string;
  talk: SmallTalk;
  language: ReplyLanguage;
  /** Matched against triage's normalised text: lowercase, no punctuation. */
  pattern: RegExp;
};

export const SMALL_TALK_ROWS: SmallTalkRow[] = [
  {
    id: "greeting_en",
    talk: "greeting",
    language: "en",
    pattern: /^(hi|hello|hey|hiya|good (morning|afternoon|evening|day))( there)?( po)?$/,
  },
  {
    id: "greeting_fil",
    talk: "greeting",
    language: "fil",
    pattern: /^(kumusta|kamusta|musta|magandang (umaga|tanghali|hapon|gabi|araw))( (po|ka|kayo))?$/,
  },
  {
    id: "thanks_en",
    talk: "thanks",
    language: "en",
    pattern: /^(thanks|thank you|thank you so much|thanks a lot|ty)( po)?$/,
  },
  { id: "thanks_fil", talk: "thanks", language: "fil", pattern: /^(maraming )?salamat( po)?$/ },
  {
    id: "help_en",
    talk: "help",
    language: "en",
    pattern: /^(help|what can you do|what do you do|who are you|how do i use (this|you)|how does this work)$/,
  },
  {
    id: "help_fil",
    talk: "help",
    language: "fil",
    pattern: /^(tulong|ano (ang )?kaya mo|anong kaya mo|sino ka|paano ka gamitin)( po)?$/,
  },
  {
    id: "goodbye_en",
    talk: "goodbye",
    language: "en",
    pattern: /^(bye|bye bye|goodbye|see you|see ya)( po)?$/,
  },
  { id: "goodbye_fil", talk: "goodbye", language: "fil", pattern: /^(paalam|babay|ingat( ka)?)( po)?$/ },
];

/**
 * Common Filipino function words. One of them anywhere in a message is enough
 * to answer in Filipino; a Taglish question almost always carries one.
 */
const FILIPINO_MARKERS =
  /\b(ako|ko|ba|po|mo|ang|ng|mga|magkano|ano|paano|saan|ilan|yung|pera|gastos|sahod|ngayon|natin|namin|kaya)\b/i;

/**
 * Finds the small-talk row a whole message matches.
 *
 * @param text - Triage's normalised text: lowercase, punctuation dropped, spaces collapsed.
 * @returns The matching row, or null when the message is anything more than small talk.
 */
export function matchSmallTalk(text: string): SmallTalkRow | null {
  return SMALL_TALK_ROWS.find((row) => row.pattern.test(text)) ?? null;
}

/**
 * Guesses which language to answer a typed message in.
 *
 * @param text - The message, raw or normalised.
 * @returns `fil` when a common Filipino function word appears anywhere, otherwise `en`.
 */
export function guessLanguage(text: string): ReplyLanguage {
  return FILIPINO_MARKERS.test(text) ? "fil" : "en";
}
