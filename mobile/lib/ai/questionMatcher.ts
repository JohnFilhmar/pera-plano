// mobile/lib/ai/questionMatcher.ts
//
// LEVEL 2 AND UP: TYPED TEXT CAN ASK ONE OF THE EIGHT QUESTIONS. Assistant
// levels spec §2. The app maps the message to a fixed question and answers it
// exactly as if its chip were tapped, so the model still never picks a tool
// (the 2026-09-25 eval measured it right 27 to 40% of the time).
//
// FIRST MATCH WINS, SO ORDER IS PART OF THE DATA. Last-month rows sit above
// their this-month twins, and the broad "pera ko" balance rows sit last.
//
// THE TABLE GROWS LIKE THE TRIAGE TABLE: a typed phrasing seen on a real device
// that should have matched becomes a row here and a case in the test, in the
// same commit. A wrong match stays visible, because the reply is labelled with
// the question it answered.
import { FIXED_QUESTIONS, type FixedQuestion } from "./fixed_questions";
import { normalise } from "./normalise";
import type { ReplyLanguage } from "./small_talk";

export type QuestionMatchRow = {
  id: string;
  /** An `id` from `fixed_questions.ts`. */
  questionId: string;
  language: ReplyLanguage;
  /** Tested against `normalise()`d text, where "what's" reads "what s". */
  pattern: RegExp;
};

export const QUESTION_MATCH_ROWS: readonly QuestionMatchRow[] = [
  {
    id: "spend_last_month_en",
    questionId: "spend_last_month",
    language: "en",
    pattern: /^(?=.*\blast month\b)(?=.*\b(spend|spent|spending|expenses|money go|buy|bought|purchases)\b)/,
  },
  {
    id: "spend_last_month_fil",
    questionId: "spend_last_month",
    language: "fil",
    pattern: /^(?=.*\b(nakaraang buwan|noong isang buwan|last month)\b)(?=.*\b(gastos|nagastos|ginastos|napunta)\b)/,
  },
  {
    id: "transactions_this_month_en",
    questionId: "transactions_this_month",
    language: "en",
    pattern: /\b(what (have|did) i (spent|spend) on|what did i buy|my (recent )?(transactions|purchases)|list (my )?transactions)\b/,
  },
  {
    id: "transactions_this_month_fil",
    questionId: "transactions_this_month",
    language: "fil",
    pattern: /\b(mga )?(binili|pinamili|transaksyon|transactions) ko\b/,
  },
  {
    id: "spend_this_month_en",
    questionId: "spend_this_month",
    language: "en",
    pattern: /\b(spending this month|where (did|does) (all )?my money go|my spending|how much (did|have) i (spend|spent))\b/,
  },
  {
    id: "spend_this_month_fil",
    questionId: "spend_this_month",
    language: "fil",
    pattern: /\b(saan (napunta|nagpunta) (ang )?(pera|sweldo|sahod) ko|magkano (ang )?(nagastos|ginastos) ko|gastos ko)\b/,
  },
  {
    id: "safe_to_spend_en",
    questionId: "safe_to_spend",
    language: "en",
    pattern: /\b(safe to spend|how much (can|may) i (still )?spend|how much is left to spend)\b/,
  },
  {
    id: "safe_to_spend_fil",
    questionId: "safe_to_spend",
    language: "fil",
    pattern: /\bmagkano (ang )?(pwede|puwede|pwedeng|puwedeng) (kong )?(gastusin|gastos)\b/,
  },
  {
    id: "limits_en",
    questionId: "limits",
    language: "en",
    pattern: /\b(how are my limits|my limits|am i over (my )?(limit|limits|budget))\b/,
  },
  { id: "limits_fil", questionId: "limits", language: "fil", pattern: /\b(mga )?limit ko\b/ },
  {
    id: "wallets_en",
    questionId: "wallets",
    language: "en",
    pattern: /\b((what|which) wallets|my wallets|list (my )?wallets)\b/,
  },
  { id: "wallets_fil", questionId: "wallets", language: "fil", pattern: /\b(mga )?wallet ko\b/ },
  {
    id: "income_en",
    questionId: "income",
    language: "en",
    pattern: /\b(my (income|salary|paycheck)|how much do i (earn|make)|income look)\b/,
  },
  { id: "income_fil", questionId: "income", language: "fil", pattern: /\b(sahod|sweldo|kita) ko\b/ },
  {
    id: "balance_total_en",
    questionId: "balance_total",
    language: "en",
    pattern: /\b(how much (money )?do i have|my (total )?balance|total balance|what (s|is) my balance)\b/,
  },
  {
    id: "balance_total_fil",
    questionId: "balance_total",
    language: "fil",
    pattern: /\b(magkano (pa )?(ang )?pera ko|ilan (ang )?pera ko|balance ko)\b/,
  },
];

/**
 * Finds the fixed question a typed message asks, if any.
 *
 * @param input - The message as typed. It is normalised here.
 * @returns The first fixed question whose row matches, or null when none does.
 */
export function matchFixedQuestion(input: string): FixedQuestion | null {
  const text = normalise(input);
  if (text.length === 0) return null;
  const row = QUESTION_MATCH_ROWS.find((candidate) => candidate.pattern.test(text));
  if (row === undefined) return null;
  return FIXED_QUESTIONS.find((question) => question.id === row.questionId) ?? null;
}
