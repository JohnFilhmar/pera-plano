// mobile/lib/ai/triage.ts
//
// DETERMINISTIC, NO LLM. Spec §4.1: a system prompt saying "never give
// financial advice" holds roughly 80% of the time on the 4B and far less on the
// 0.6B, "and it fails in the direction that matters: the user asks a third
// time, and the model caves. A guardrail that weakens under persistence is not
// a guardrail; it is a speed bump in front of exactly the user who most wants
// to get past it." This module cannot be argued with.
//
// THE TABLE IS DATA, NOT BRANCHES. Spec §5.7 says it "is expected to grow
// forever and is structured for it": every advice phrasing that reaches the
// model on a real device becomes a new row here AND a new test case, in the
// same commit.
//
// TRIAGE KEYS ON MODAL + SECOND PERSON + PROSPECTIVE ACTION, not on a trigger
// word in isolation. "How much should I have left this month?" contains
// "should I" and is a computation; it must pass through. That is what
// QUANTITATIVE_OVERRIDES exists for.

export type AdviceClass = "permission" | "affordability" | "worth" | "direction";

export type AdviceRow = {
  id: string;
  klass: AdviceClass;
  language: "en" | "fil";
  pattern: RegExp;
  /**
   * Spec §4.3: "a refusal with no data attached is a failed redirect." The user
   * asked "can I afford this?" and deserves the two facts they needed to
   * decide, even though the app will not decide for them.
   */
  redirectTools: string[];
};

export type TriageVerdict =
  | { kind: "explanatory" }
  | { kind: "advice"; klass: AdviceClass; redirectTools: string[] };

/**
 * A question that asks for a QUANTITY about the ledger is a computation, no
 * matter which modal it happens to contain. Checked before the advice table,
 * because "how much should I have left" would otherwise trip "should I".
 */
const QUANTITATIVE_OVERRIDES: RegExp[] = [
  /\bhow much\b/,
  /\bhow many\b/,
  /\bwhat'?s the most\b/,
  /\bwhat is the most\b/,
  /\bwhere did\b/,
  /\bmagkano\b/,
  /\bsaan napunta\b/,
  /\bilan\b/,
  /\bnagastos\b/,
];

/** Spec §4.2's table, transcribed. Both language columns, all four classes. */
export const ADVICE_ROWS: AdviceRow[] = [
  // ---- Permission-seeking
  {
    id: "permission_should_i_en",
    klass: "permission",
    language: "en",
    pattern: /\bshould i\b/,
    redirectTools: ["get_safe_to_spend", "get_limits"],
  },
  {
    id: "permission_is_it_okay_en",
    klass: "permission",
    language: "en",
    pattern: /\bis it (okay|ok|alright|fine) to\b/,
    redirectTools: ["get_safe_to_spend", "get_limits"],
  },
  {
    id: "permission_dapat_ba_fil",
    klass: "permission",
    language: "fil",
    pattern: /\bdapat ba (ako|akong|kong)?\b/,
    redirectTools: ["get_safe_to_spend", "get_limits"],
  },
  {
    id: "permission_pwede_ba_fil",
    klass: "permission",
    language: "fil",
    pattern: /\b(pwede|puwede) ba\b/,
    redirectTools: ["get_safe_to_spend", "get_limits"],
  },

  // ---- Affordability
  {
    id: "affordability_can_i_afford_en",
    klass: "affordability",
    language: "en",
    pattern: /\bcan i afford\b/,
    redirectTools: ["get_safe_to_spend", "get_balance_total"],
  },
  {
    id: "affordability_enough_to_en",
    klass: "affordability",
    language: "en",
    pattern: /\bdo i have enough\b/,
    redirectTools: ["get_safe_to_spend", "get_balance_total"],
  },
  {
    id: "affordability_kaya_ko_ba_fil",
    klass: "affordability",
    language: "fil",
    pattern: /\bkaya ko ba\b/,
    redirectTools: ["get_safe_to_spend", "get_balance_total"],
  },

  // ---- Worth / comparison
  {
    id: "worth_is_it_worth_en",
    klass: "worth",
    language: "en",
    pattern: /\bis it worth\b/,
    redirectTools: ["get_spend_by_category", "get_safe_to_spend"],
  },
  {
    id: "worth_which_is_better_en",
    klass: "worth",
    language: "en",
    pattern: /\bwhich (is|one is) better\b/,
    redirectTools: ["get_spend_by_category", "get_safe_to_spend"],
  },
  {
    id: "worth_sulit_ba_fil",
    klass: "worth",
    language: "fil",
    pattern: /\bsulit ba\b/,
    redirectTools: ["get_spend_by_category", "get_safe_to_spend"],
  },

  // ---- Open-ended direction
  {
    id: "direction_what_should_i_do_en",
    klass: "direction",
    language: "en",
    pattern: /\bwhat should i do\b/,
    redirectTools: ["get_safe_to_spend", "get_spend_by_category"],
  },
  {
    id: "direction_how_do_i_save_en",
    klass: "direction",
    language: "en",
    pattern: /\bhow (do|can) i (save|budget|invest)\b/,
    redirectTools: ["get_safe_to_spend", "get_spend_by_category"],
  },
  {
    id: "direction_paano_ipon_fil",
    klass: "direction",
    language: "fil",
    pattern: /\bpaano ako (makaka-?ipon|mag-?ipon|makakatipid)\b/,
    redirectTools: ["get_safe_to_spend", "get_spend_by_category"],
  },
];

/**
 * Lowercased, punctuation dropped, whitespace collapsed. Punctuation goes
 * because "Should I... buy this?!" is the same question as "should i buy this",
 * and a table that only matched the tidy form would be trivially evaded by
 * anyone typing normally.
 *
 * The hyphen SURVIVES, because "makaka-ipon" and "mag-ipon" are spelled with
 * one and dropping it would break the Filipino column.
 */
function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classify(input: string): TriageVerdict {
  const text = normalise(input);
  if (text.length === 0) return { kind: "explanatory" };

  // Quantities first: a computation stays a computation whatever modal it
  // contains.
  if (QUANTITATIVE_OVERRIDES.some((pattern) => pattern.test(text))) {
    return { kind: "explanatory" };
  }

  const row = ADVICE_ROWS.find((candidate) => candidate.pattern.test(text));
  if (row) {
    return { kind: "advice", klass: row.klass, redirectTools: row.redirectTools };
  }

  return { kind: "explanatory" };
}
