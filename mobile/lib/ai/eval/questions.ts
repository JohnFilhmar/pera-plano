// mobile/lib/ai/eval/questions.ts
//
// THIRTY QUESTIONS, BUILT TO COVER THE FAILURE MODES RATHER THAN TO BE EASY.
// Spec §5.5's composition, and the counts are asserted as literals in the test:
//
//   14 single-tool, two per tool — one plain English, one Taglish
//    6 two-tool                  — multi-round dispatch
//    5 period discrimination     — obvious tool, contested argument
//    3 out of scope              — over-eager tool use
//    2 advice                    — the whole input path, zero inference
//
// THE TAGLISH HALF IS NOT GARNISH. "A user typing 'magkano na nagastos ko this
// month?' is the actual user; an eval written entirely in textbook English
// measures a population that does not exist." Code-switching is the normal
// register here, not an edge case, and a tier that only works in textbook
// English has not passed.
//
// THE PERIOD BLOCK IS THE ONE THAT FINDS REAL BUGS. The classic small-model
// failure is the right tool with the wrong argument, which produces a fluent,
// confident answer about the wrong month. Scoring is strict for exactly this.
import type { Expectation } from "./scorer";

export type EvalCategory = "single_tool" | "two_tool" | "period" | "out_of_scope" | "advice";

export type EvalQuestion = {
  id: string;
  prompt: string;
  language: "en" | "fil";
  category: EvalCategory;
  expected: Expectation;
  /**
   * The tool a two-tool question should reach SECOND. Diagnostic only — the
   * score is about the first call, because a model that opens with the wrong
   * tool has already cost the user a round and, on tier 1, usually never
   * recovers.
   */
  thenName?: string;
};

export const EVAL_QUESTIONS: readonly EvalQuestion[] = [
  // --- 14 single-tool: every tool twice, once in each register ---------------
  {
    id: "s01",
    prompt: "What wallets do I have?",
    language: "en",
    category: "single_tool",
    expected: { kind: "tool", name: "get_wallets", args: {} },
  },
  {
    id: "s02",
    prompt: "Anong mga wallet meron ako?",
    language: "fil",
    category: "single_tool",
    expected: { kind: "tool", name: "get_wallets", args: {} },
  },
  {
    id: "s03",
    prompt: "How much money do I have in total?",
    language: "en",
    category: "single_tool",
    expected: { kind: "tool", name: "get_balance_total", args: {} },
  },
  {
    id: "s04",
    prompt: "Magkano lahat ng pera ko?",
    language: "fil",
    category: "single_tool",
    expected: { kind: "tool", name: "get_balance_total", args: {} },
  },
  {
    id: "s05",
    prompt: "How much can I spend a day for the rest of the period?",
    language: "en",
    category: "single_tool",
    expected: { kind: "tool", name: "get_safe_to_spend", args: {} },
  },
  {
    id: "s06",
    prompt: "Magkano pwede kong gastusin araw-araw hanggang matapos ang buwan?",
    language: "fil",
    category: "single_tool",
    expected: { kind: "tool", name: "get_safe_to_spend", args: {} },
  },
  {
    id: "s07",
    prompt: "What are my spending limits and how much of each have I used?",
    language: "en",
    category: "single_tool",
    expected: { kind: "tool", name: "get_limits", args: {} },
  },
  {
    id: "s08",
    prompt: "Kumusta na yung mga limit ko?",
    language: "fil",
    category: "single_tool",
    expected: { kind: "tool", name: "get_limits", args: {} },
  },
  {
    id: "s09",
    prompt: "How often does my income come in?",
    language: "en",
    category: "single_tool",
    expected: { kind: "tool", name: "get_income_profile", args: {} },
  },
  {
    id: "s10",
    prompt: "Gaano kadalas dumarating ang sahod ko?",
    language: "fil",
    category: "single_tool",
    expected: { kind: "tool", name: "get_income_profile", args: {} },
  },
  {
    id: "s11",
    prompt: "What did I spend on by category this month?",
    language: "en",
    category: "single_tool",
    expected: { kind: "tool", name: "get_spend_by_category", args: { period: "this_month" } },
  },
  {
    id: "s12",
    prompt: "Magkano na nagastos ko this month, per category?",
    language: "fil",
    category: "single_tool",
    expected: { kind: "tool", name: "get_spend_by_category", args: { period: "this_month" } },
  },
  {
    id: "s13",
    prompt: "Show me my transactions this month.",
    language: "en",
    category: "single_tool",
    expected: { kind: "tool", name: "list_transactions", args: { period: "this_month" } },
  },
  {
    id: "s14",
    prompt: "Pakita mo yung mga gastos ko this month.",
    language: "fil",
    category: "single_tool",
    expected: { kind: "tool", name: "list_transactions", args: { period: "this_month" } },
  },

  // --- 6 two-tool: multi-round dispatch -------------------------------------
  {
    id: "t01",
    prompt: "How much do I have, and how much can I spend a day?",
    language: "en",
    category: "two_tool",
    expected: { kind: "tool", name: "get_balance_total", args: {} },
    thenName: "get_safe_to_spend",
  },
  {
    id: "t02",
    prompt: "Magkano pera ko, tapos magkano pwede kong gastusin kada araw?",
    language: "fil",
    category: "two_tool",
    expected: { kind: "tool", name: "get_balance_total", args: {} },
    thenName: "get_safe_to_spend",
  },
  {
    id: "t03",
    prompt: "Where did most of my money go this month, and how are my limits doing?",
    language: "en",
    category: "two_tool",
    expected: { kind: "tool", name: "get_spend_by_category", args: { period: "this_month" } },
    thenName: "get_limits",
  },
  {
    id: "t04",
    prompt: "Saan ako pinakamalaki gumastos this month, at kumusta yung limit ko?",
    language: "fil",
    category: "two_tool",
    expected: { kind: "tool", name: "get_spend_by_category", args: { period: "this_month" } },
    thenName: "get_limits",
  },
  {
    id: "t05",
    prompt: "What does my income look like, and what is left for me to spend?",
    language: "en",
    category: "two_tool",
    expected: { kind: "tool", name: "get_income_profile", args: {} },
    thenName: "get_safe_to_spend",
  },
  {
    id: "t06",
    prompt: "List last month's transactions, then tell me the category totals.",
    language: "en",
    category: "two_tool",
    expected: { kind: "tool", name: "list_transactions", args: { period: "last_month" } },
    thenName: "get_spend_by_category",
  },

  // --- 5 period discrimination: the tool is obvious, the argument is not -----
  {
    id: "p01",
    prompt: "What did I spend by category LAST month, not this one?",
    language: "en",
    category: "period",
    expected: { kind: "tool", name: "get_spend_by_category", args: { period: "last_month" } },
  },
  {
    id: "p02",
    prompt: "Noong nakaraang buwan, saan napunta ang pera ko?",
    language: "fil",
    category: "period",
    expected: { kind: "tool", name: "get_spend_by_category", args: { period: "last_month" } },
  },
  {
    id: "p03",
    prompt: "Show me my transactions from the past week.",
    language: "en",
    category: "period",
    expected: { kind: "tool", name: "list_transactions", args: { period: "last_7_days" } },
  },
  {
    id: "p04",
    prompt: "Yung mga gastos ko sa nakaraang tatlumpung araw, pakita mo.",
    language: "fil",
    category: "period",
    expected: { kind: "tool", name: "list_transactions", args: { period: "last_30_days" } },
  },
  {
    id: "p05",
    prompt: "Category spending over the last 30 days, please.",
    language: "en",
    category: "period",
    expected: { kind: "tool", name: "get_spend_by_category", args: { period: "last_30_days" } },
  },

  // --- 3 out of scope: a stated inability is the correct answer --------------
  {
    id: "o01",
    prompt: "What's the weather tomorrow?",
    language: "en",
    category: "out_of_scope",
    expected: { kind: "no_tool" },
  },
  {
    id: "o02",
    prompt: "Sino ang pangulo ng Pilipinas?",
    language: "fil",
    category: "out_of_scope",
    expected: { kind: "no_tool" },
  },
  {
    id: "o03",
    prompt: "Write me a short poem about the sea.",
    language: "en",
    category: "out_of_scope",
    expected: { kind: "no_tool" },
  },

  // --- 2 advice: correct behaviour is ZERO inference -------------------------
  {
    id: "a01",
    prompt: "Should I buy a new phone this month?",
    language: "en",
    category: "advice",
    expected: { kind: "advice" },
  },
  {
    id: "a02",
    prompt: "Kaya ko ba bumili ng bagong cellphone ngayon?",
    language: "fil",
    category: "advice",
    expected: { kind: "advice" },
  },
];
