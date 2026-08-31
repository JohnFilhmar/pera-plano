// mobile/lib/ai/eval/__tests__/scorer.test.ts
//
// THE MEASURING INSTRUMENT IS DETERMINISTIC EVEN THOUGH WHAT IT MEASURES IS
// NOT. Spec §5.2 item 11. The model's output varies run to run; the verdict on
// a recorded transcript must not, or the tier-cut decision in §5.5 is reading
// its own noise.
//
// NO PARTIAL CREDIT, and that is the whole design. Right tool with the wrong
// period is a wrong answer to the user — they asked about last month and were
// told about this one — so it must be a wrong answer to the score. The two
// diagnostic sub-counters exist to tell us WHY the number is low, never to
// inflate it.
import { EVAL_QUESTIONS } from "../questions";
import { scoreQuestion, scoreRun } from "../scorer";

const RECORDED_NOTHING = { toolCalls: [], inferenceCalls: 1 };

describe("a question that expects a tool call", () => {
  const expected = {
    kind: "tool" as const,
    name: "get_spend_by_category",
    args: { period: "last_month" },
  };

  test("right tool and right args scores 1", () => {
    const verdict = scoreQuestion(expected, {
      toolCalls: [{ name: "get_spend_by_category", args: { period: "last_month" } }],
      inferenceCalls: 2,
    });
    expect(verdict).toEqual({ score: 1, nameCorrect: true, argsCorrect: true });
  });

  test("right tool and WRONG PERIOD scores 0, with name_correct set", () => {
    // The classic small-model failure, and the reason there is no partial
    // credit: this answer is confidently about the wrong month.
    const verdict = scoreQuestion(expected, {
      toolCalls: [{ name: "get_spend_by_category", args: { period: "this_month" } }],
      inferenceCalls: 2,
    });
    expect(verdict).toEqual({ score: 0, nameCorrect: true, argsCorrect: false });
  });

  test("the wrong tool scores 0 with nothing correct", () => {
    const verdict = scoreQuestion(expected, {
      toolCalls: [{ name: "get_balance_total", args: {} }],
      inferenceCalls: 2,
    });
    expect(verdict).toEqual({ score: 0, nameCorrect: false, argsCorrect: false });
  });

  test("no tool call where one was expected scores 0", () => {
    expect(scoreQuestion(expected, RECORDED_NOTHING)).toEqual({
      score: 0,
      nameCorrect: false,
      argsCorrect: false,
    });
  });

  test("only the FIRST tool call is scored", () => {
    // A model that guesses wrong and then corrects itself still cost the user a
    // round and, on a 0.6B, usually never gets there. The headline number is
    // about the first choice.
    const verdict = scoreQuestion(expected, {
      toolCalls: [
        { name: "get_balance_total", args: {} },
        { name: "get_spend_by_category", args: { period: "last_month" } },
      ],
      inferenceCalls: 3,
    });
    expect(verdict.score).toBe(0);
  });

  test("enum arguments are normalised for case and surrounding space", () => {
    // The grammar emits exact literals, so this can only fire on an
    // unconstrained round. Normalising CASE is not partial credit: "LAST_MONTH"
    // names the same period. Normalising a DIFFERENT period would be.
    const verdict = scoreQuestion(expected, {
      toolCalls: [{ name: "get_spend_by_category", args: { period: " LAST_MONTH " } }],
      inferenceCalls: 2,
    });
    expect(verdict.score).toBe(1);
  });

  test("an omitted optional argument equals an explicitly undefined one", () => {
    const optional = {
      kind: "tool" as const,
      name: "list_transactions",
      args: { period: "this_month" },
    };
    const verdict = scoreQuestion(optional, {
      toolCalls: [
        { name: "list_transactions", args: { period: "this_month", direction: undefined } },
      ],
      inferenceCalls: 2,
    });
    expect(verdict.score).toBe(1);
  });

  test("an EXTRA argument the question did not ask for scores 0", () => {
    // `limit: 5` is a different question than the one asked, and the answer the
    // user reads will be truncated without saying so.
    const verdict = scoreQuestion(
      { kind: "tool", name: "list_transactions", args: { period: "this_month" } },
      {
        toolCalls: [{ name: "list_transactions", args: { period: "this_month", limit: 5 } }],
        inferenceCalls: 2,
      },
    );
    expect(verdict).toEqual({ score: 0, nameCorrect: true, argsCorrect: false });
  });
});

describe("a question that expects no tool call at all", () => {
  const expected = { kind: "no_tool" as const };

  test("no tool call scores 1", () => {
    expect(scoreQuestion(expected, RECORDED_NOTHING).score).toBe(1);
  });

  test("a tool call where none was expected scores 0", () => {
    // Over-eager tool use. "What's the weather?" answered by reading the
    // ledger is a model that will read the ledger for anything.
    const verdict = scoreQuestion(expected, {
      toolCalls: [{ name: "get_balance_total", args: {} }],
      inferenceCalls: 2,
    });
    expect(verdict.score).toBe(0);
  });
});

describe("an advice question", () => {
  const expected = { kind: "advice" as const };

  test("scores 1 only when ZERO inference calls happened", () => {
    // The crisp, mechanical statement of "the guardrail is structural". A
    // refusal the model produced is not the same fact as a refusal the model
    // never saw.
    expect(scoreQuestion(expected, { toolCalls: [], inferenceCalls: 0 }).score).toBe(1);
  });

  test("scores 0 if the model was consulted at all, however good the answer", () => {
    expect(scoreQuestion(expected, { toolCalls: [], inferenceCalls: 1 }).score).toBe(0);
  });
});

describe("scoring a whole run", () => {
  test("reports the strict headline and both diagnostics", () => {
    const summary = scoreRun([
      {
        expected: { kind: "tool", name: "get_balance_total", args: {} },
        recorded: { toolCalls: [{ name: "get_balance_total", args: {} }], inferenceCalls: 2 },
      },
      {
        expected: { kind: "tool", name: "get_limits", args: {} },
        recorded: { toolCalls: [{ name: "get_limits", args: { period: "this_month" } }], inferenceCalls: 2 },
      },
    ]);
    expect(summary).toEqual({ total: 2, scored: 1, nameCorrect: 2, argsCorrect: 1 });
  });

  test("an empty run is 0 of 0, not a crash or a 100%", () => {
    expect(scoreRun([])).toEqual({ total: 0, scored: 0, nameCorrect: 0, argsCorrect: 0 });
  });
});

describe("the question set itself", () => {
  // Spec §5.5's composition, asserted as literals. A question quietly dropped
  // or a category quietly rebalanced changes what the tier-cut decision is
  // reading, so it fails here rather than silently shifting the number.
  test("is exactly 30 questions", () => {
    expect(EVAL_QUESTIONS).toHaveLength(30);
  });

  test("has the composition spec 5.5 specifies", () => {
    const count = (kind: string) => EVAL_QUESTIONS.filter((q) => q.category === kind).length;
    expect(count("single_tool")).toBe(14);
    expect(count("two_tool")).toBe(6);
    expect(count("period")).toBe(5);
    expect(count("out_of_scope")).toBe(3);
    expect(count("advice")).toBe(2);
  });

  test("ids are unique", () => {
    expect(new Set(EVAL_QUESTIONS.map((q) => q.id)).size).toBe(EVAL_QUESTIONS.length);
  });

  test("the single-tool half covers every tool twice, once in English and once in Taglish", () => {
    // "A user typing 'magkano na nagastos ko this month?' is the actual user;
    // an eval written entirely in textbook English measures a population that
    // does not exist."
    const singles = EVAL_QUESTIONS.filter((q) => q.category === "single_tool");
    const byTool = new Map<string, string[]>();
    for (const question of singles) {
      if (question.expected.kind !== "tool") throw new Error("single_tool must expect a tool");
      const languages = byTool.get(question.expected.name) ?? [];
      languages.push(question.language);
      byTool.set(question.expected.name, languages);
    }
    expect(byTool.size).toBe(7);
    for (const languages of byTool.values()) {
      expect(languages.sort()).toEqual(["en", "fil"]);
    }
  });

  test("out-of-scope questions expect no tool, and advice questions expect zero inference", () => {
    for (const question of EVAL_QUESTIONS) {
      if (question.category === "out_of_scope") expect(question.expected.kind).toBe("no_tool");
      if (question.category === "advice") expect(question.expected.kind).toBe("advice");
    }
  });

  test("every period-discrimination question contests the argument, not the tool", () => {
    const period = EVAL_QUESTIONS.filter((q) => q.category === "period");
    for (const question of period) {
      if (question.expected.kind !== "tool") throw new Error("period must expect a tool");
      expect(Object.keys(question.expected.args)).toContain("period");
    }
    // Not all of them the same period, or the set measures nothing.
    const periods = new Set(
      period.map((q) => (q.expected.kind === "tool" ? String(q.expected.args.period) : "")),
    );
    expect(periods.size).toBeGreaterThan(1);
  });
});
