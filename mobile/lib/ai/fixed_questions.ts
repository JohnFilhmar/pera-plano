// mobile/lib/ai/fixed_questions.ts
//
// SPEC §7.4, CHOSEN BY THE OWNER ON 2026-09-25: THE USER PICKS THE QUESTION,
// SO THE MODEL NEVER PICKS THE TOOL. The on-device eval measured strict
// tool-pick at 8 to 12 out of 30 for both shipped tiers (docs/13, "Run
// 2026-09-25"), far under the spec's roughly 70% bar. Each question below names
// its tool and arguments outright; the model's only job is to put the result
// into a sentence.
//
// THE LIST IS DATA. A new question is a new row here and nothing else, as long
// as its tool is in `tools/registry.ts` and its arguments are ones that tool's
// schema accepts. `__tests__/fixed_questions.test.ts` holds every row to both.
import type { AiPeriod } from "./tools/period_range";

export type FixedQuestion = {
  id: string;
  /** Shown on the chip, and the question the model is asked to answer. */
  label: string;
  /** A wire name from `tools/registry.ts`. */
  tool: string;
  args: { period?: AiPeriod; limit?: number };
};

export const FIXED_QUESTIONS: readonly FixedQuestion[] = [
  { id: "balance_total", label: "How much money do I have?", tool: "get_balance_total", args: {} },
  { id: "wallets", label: "What wallets do I have?", tool: "get_wallets", args: {} },
  { id: "safe_to_spend", label: "How much is safe to spend?", tool: "get_safe_to_spend", args: {} },
  { id: "limits", label: "How are my limits doing?", tool: "get_limits", args: {} },
  {
    id: "spend_this_month",
    label: "Where did my money go this month?",
    tool: "get_spend_by_category",
    args: { period: "this_month" },
  },
  {
    id: "spend_last_month",
    label: "Where did my money go last month?",
    tool: "get_spend_by_category",
    args: { period: "last_month" },
  },
  {
    id: "transactions_this_month",
    label: "What have I spent on this month?",
    tool: "list_transactions",
    args: { period: "this_month" },
  },
  { id: "income", label: "What does my income look like?", tool: "get_income_profile", args: {} },
];
