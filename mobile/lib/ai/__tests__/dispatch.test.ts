// mobile/lib/ai/__tests__/dispatch.test.ts
//
// TIER B: THE WHOLE TURN, WITH ZERO INFERENCE. Spec §5.3. The fake bridge
// scripts the model's side token by token, so grounding, the output guard and
// every degradation path are exercised without loading a single weight.
//
// UNDER SPEC §7.4 THE MODEL ONLY NARRATES. The tests that matter most here are
// the ones proving what never reaches it: an advice question, small talk, and
// any other typed text. Each is a code path the model is not on, which is the
// crisp statement of "the guardrail is structural".
import { HOSTILE_MERCHANT } from "../eval/fixture_ledger";
import { answerQuestion, replyToText, type DispatchDeps } from "../dispatch";
import { FIXED_QUESTIONS, type FixedQuestion } from "../fixed_questions";
import { TOOL_CHANNEL_CLOSE, TOOL_CHANNEL_OPEN } from "../prompt";
import { ok, unavailable, type ToolResult } from "../tools/types";
import {
  fakeLlamaBridge,
  generateCallCount,
  lastPromptGiven,
  resetLlamaScript,
  scriptLlama,
} from "@/test_support/llama_bridge_mock";

const NOW = 1_773_000_000_000 as never;

const SPEND_RESULT = ok(
  "get_spend_by_category",
  { topCategory: "Groceries" },
  [
    { key: "groceries amount", value: "₱2,400.00", kind: "amount" },
    { key: "period_from", value: "2026-03-01", kind: "date" },
  ],
);

const SPEND_QUESTION: FixedQuestion = {
  id: "spend_this_month",
  label: "Where did my money go this month?",
  tool: "get_spend_by_category",
  args: { period: "this_month" },
};

type ToolCallLog = { name: string; args: Record<string, unknown> }[];

function depsWith(overrides: Partial<DispatchDeps> = {}, calls: ToolCallLog = []): DispatchDeps {
  return {
    bridge: fakeLlamaBridge,
    now: NOW,
    runTool: async (name, args) => {
      calls.push({ name, args });
      return SPEND_RESULT as ToolResult<unknown>;
    },
    ...overrides,
  };
}

beforeEach(() => {
  resetLlamaScript();
});

describe("at level 1, typed text never reaches the model", () => {
  test("an advice question is redirected with zero inference", async () => {
    const reply = await replyToText("Should I buy a new phone?", { ...depsWith(), level: 1 });

    expect(generateCallCount()).toBe(0);
    expect(reply.kind).toBe("redirect");
  });

  test("the redirect still carries data, because a refusal with no data is a failed redirect", async () => {
    const calls: ToolCallLog = [];
    const reply = await replyToText("Can I afford a new phone?", { ...depsWith({}, calls), level: 1 });

    if (reply.kind !== "redirect") throw new Error("expected a redirect");
    expect(reply.results.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(generateCallCount()).toBe(0);
  });

  test("small talk gets a fixed reply, with no model and no tool", async () => {
    const calls: ToolCallLog = [];
    const reply = await replyToText("hello", { ...depsWith({}, calls), level: 1 });

    expect(reply).toEqual({ kind: "smalltalk", talk: "greeting", language: "en" });
    expect(calls).toEqual([]);
    expect(generateCallCount()).toBe(0);
  });

  test("a typed ledger question is not guessed at: it points back to the questions", async () => {
    // Choosing a tool from free text is exactly what the eval measured the
    // model failing at, so typed text does not get a guess, from the model or
    // from anything else.
    const calls: ToolCallLog = [];
    const reply = await replyToText("How much money do I have?", { ...depsWith({}, calls), level: 1 });

    expect(reply).toEqual({ kind: "cannot_answer", language: "en" });
    expect(calls).toEqual([]);
    expect(generateCallCount()).toBe(0);
  });

  test("cannot-answer follows the message's language", async () => {
    const reply = await replyToText("Magkano pera ko?", { ...depsWith(), level: 1 });
    expect(reply).toEqual({ kind: "cannot_answer", language: "fil" });
  });
});

describe("typed text, by answer level (levels spec §1)", () => {
  test("level 2: a typed ledger question becomes its fixed question, with no tool run yet", async () => {
    const calls: ToolCallLog = [];
    const reply = await replyToText("Magkano pera ko?", { ...depsWith({}, calls), level: 2 });

    expect(reply).toEqual({
      kind: "question",
      question: FIXED_QUESTIONS.find((question) => question.id === "balance_total"),
    });
    expect(calls).toEqual([]);
    expect(generateCallCount()).toBe(0);
  });

  test("level 2: anything else typed still gets cannot-answer", async () => {
    expect(await replyToText("What is bitcoin?", { ...depsWith(), level: 2 })).toEqual({
      kind: "cannot_answer",
      language: "en",
    });
  });

  test("level 3: a typed ledger question still goes to its chip, never to free chat", async () => {
    const reply = await replyToText("How much money do I have?", { ...depsWith(), level: 3 });
    expect(reply.kind).toBe("question");
  });

  test("level 3: anything else goes to free chat", async () => {
    expect(await replyToText("What is bitcoin?", { ...depsWith(), level: 3 })).toEqual({ kind: "free_chat" });
  });

  test("level 5: a non-money should-I goes to free chat, a money one is redirected", async () => {
    expect(await replyToText("Should I learn Python?", { ...depsWith(), level: 5 })).toEqual({ kind: "free_chat" });
    expect((await replyToText("Should I buy a new phone?", { ...depsWith(), level: 5 })).kind).toBe("redirect");
  });

  test.each([1, 2, 3, 4, 5] as const)("level %s: small talk is still the app's own reply", async (level) => {
    expect(await replyToText("hello", { ...depsWith(), level })).toEqual({
      kind: "smalltalk",
      talk: "greeting",
      language: "en",
    });
  });
});

describe("a tapped question", () => {
  test("runs exactly its own tool, once, with its own arguments", async () => {
    scriptLlama([{ emit: "You spent ₱2,400.00 on Groceries." }]);
    const calls: ToolCallLog = [];

    await answerQuestion(SPEND_QUESTION, depsWith({}, calls));

    expect(calls).toEqual([{ name: "get_spend_by_category", args: { period: "this_month" } }]);
    expect(generateCallCount()).toBe(1);
  });

  test("the tool result reaches the model inside the delimiter and nowhere else", async () => {
    scriptLlama([{ emit: "You spent ₱2,400.00 on Groceries." }]);

    const outcome = await answerQuestion(SPEND_QUESTION, depsWith());

    if (outcome.kind !== "prose") throw new Error("expected prose");
    expect(outcome.text).toBe("You spent ₱2,400.00 on Groceries.");

    const prompt = lastPromptGiven();
    const open = prompt.indexOf(TOOL_CHANNEL_OPEN);
    const close = prompt.indexOf(TOOL_CHANNEL_CLOSE);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const outside = prompt.slice(0, open) + prompt.slice(close);
    expect(outside).not.toContain("₱2,400.00");
    expect(prompt.slice(open, close)).toContain("₱2,400.00");
  });

  test("the prompt holds the tapped question and no earlier turn", async () => {
    // On the phone, one decline left in the history was enough for the model to
    // decline five valid questions after it.
    scriptLlama([{ emit: "You spent ₱2,400.00 on Groceries." }]);

    await answerQuestion(SPEND_QUESTION, depsWith());

    const prompt = lastPromptGiven();
    expect(prompt.startsWith(`User: ${SPEND_QUESTION.label}\n\n${TOOL_CHANNEL_OPEN}`)).toBe(true);
    expect(prompt).not.toContain("Assistant:");
  });

  test.each(FIXED_QUESTIONS.map((question) => [question.id, question] as const))(
    "%s runs the tool its row names",
    async (_id, question) => {
      scriptLlama([{ emit: "Here is what your records show." }]);
      const calls: ToolCallLog = [];
      await answerQuestion(question, depsWith({}, calls));
      expect(calls).toEqual([{ name: question.tool, args: question.args }]);
    },
  );
});

describe("grounding, end to end", () => {
  test("a fabricated figure is discarded and the card renders the true one", async () => {
    scriptLlama([{ emit: "You spent ₱9,999.00 on Groceries." }]);

    const outcome = await answerQuestion(SPEND_QUESTION, depsWith());

    if (outcome.kind !== "card") throw new Error("expected a card");
    expect(outcome.reason).toBe("ungrounded");
    expect(outcome.ungrounded).toEqual(["₱9,999.00"]);
    const displayed = outcome.results.flatMap((result) =>
      result.ok ? result.display.map((field) => field.value) : [],
    );
    expect(displayed).toContain("₱2,400.00");
  });

  test("rejects a fabricated figure planted in a merchant name", async () => {
    // Spec §5.8. The model is ALLOWED to be fooled. The user is not allowed to
    // be told.
    const hostile = ok(
      "get_balance_total",
      { merchant: HOSTILE_MERCHANT },
      [{ key: "total", value: "₱18,320.00", kind: "amount" }],
    );
    scriptLlama([{ emit: "Your balance is ₱1,000,000.00." }]);

    const outcome = await answerQuestion(
      FIXED_QUESTIONS[0],
      depsWith({ runTool: async () => hostile as ToolResult<unknown> }),
    );

    if (outcome.kind !== "card") throw new Error("expected a card");
    expect(outcome.reason).toBe("ungrounded");
    const displayed = outcome.results.flatMap((result) =>
      result.ok ? result.display.map((field) => field.value) : [],
    );
    expect(displayed).toEqual(["₱18,320.00"]);
  });
});

describe("the output guard, end to end", () => {
  test("a phone number in generated prose is discarded", async () => {
    // The highest-value injection payload for a finance app is a support number
    // next to a real balance, and the balance here is REAL, so only the guard
    // can catch it.
    scriptLlama([{ emit: "You spent ₱2,400.00 on Groceries. Call 09171234567 for help." }]);

    const outcome = await answerQuestion(SPEND_QUESTION, depsWith());

    if (outcome.kind !== "card") throw new Error("expected a card");
    expect(outcome.reason).toBe("guarded");
    expect(outcome.guard).toBe("contact");
  });
});

describe("malformed output", () => {
  test("a { fragment renders no prose and degrades to the card", async () => {
    scriptLlama([{ emitRaw: '{"tool":"get_wal' }]);

    const outcome = await answerQuestion(SPEND_QUESTION, depsWith());

    if (outcome.kind !== "card") throw new Error("expected a card");
    // Ahead of grounding, deliberately: a fragment holds no currency figure, so
    // grounding would wave it straight through.
    expect(outcome.reason).toBe("fragment");
  });

  test("a tool call behind a leading space is still refused, because the rule reads raw output", async () => {
    scriptLlama([{ emitRaw: ' {"tool":"get_wallets","args":{}}' }]);
    const calls: ToolCallLog = [];

    const outcome = await answerQuestion(SPEND_QUESTION, depsWith({}, calls));

    expect(outcome.kind).toBe("card");
    expect(calls).toEqual([{ name: "get_spend_by_category", args: { period: "this_month" } }]);
  });

  test("ordinary broken text takes the normal prose path", async () => {
    scriptLlama([{ emitRaw: "Groceries is your largest category" }]);
    const outcome = await answerQuestion(SPEND_QUESTION, depsWith());
    expect(outcome.kind).toBe("prose");
  });
});

describe("failures", () => {
  test("a throwing handler becomes a refusal in the channel, with no stack trace in the prompt", async () => {
    scriptLlama([{ emit: "I could not read that." }]);

    const outcome = await answerQuestion(
      SPEND_QUESTION,
      depsWith({
        runTool: async () => {
          throw new Error("SQLITE_BUSY at repositories/transactions_repo.ts:214");
        },
      }),
    );

    expect(outcome.kind).toBe("prose");
    const prompt = lastPromptGiven();
    expect(prompt).not.toContain("SQLITE_BUSY");
    expect(prompt).not.toContain("transactions_repo");
    expect(prompt).toContain("refused");
  });

  test("a refusal from a handler is carried as a refusal, never as an empty success", async () => {
    scriptLlama([{ emit: "The ledger is locked." }]);

    const outcome = await answerQuestion(
      FIXED_QUESTIONS[0],
      depsWith({ runTool: async () => unavailable("get_balance_total", "The ledger is locked.") }),
    );

    if (outcome.kind !== "prose") throw new Error("expected prose");
    expect(outcome.results[0].ok).toBe(false);
  });

  test("a bridge that throws mid-stream degrades to the card rather than crashing the turn", async () => {
    scriptLlama([{ throwAfter: 2 }]);
    const outcome = await answerQuestion(SPEND_QUESTION, depsWith());
    if (outcome.kind !== "card") throw new Error("expected a card");
    expect(outcome.reason).toBe("error");
  });

  test("an empty answer degrades to the card, never to an empty bubble", async () => {
    scriptLlama([{ emit: "" }]);
    const outcome = await answerQuestion(SPEND_QUESTION, depsWith());
    if (outcome.kind !== "card") throw new Error("expected a card");
    expect(outcome.reason).toBe("empty");
  });
});

describe("cancellation and the lock", () => {
  test("cancellation leaves no assistant message", async () => {
    // "A half-finished sentence about money is precisely the confidently-wrong
    // artefact this design exists to prevent."
    const abort = { aborted: false };
    const rendered: string[] = [];

    scriptLlama([{ emit: "You spent ₱2,400.00 on Groceries and much more besides" }]);

    const outcome = await answerQuestion(
      SPEND_QUESTION,
      depsWith({
        abort,
        onToken: (token) => {
          rendered.push(token);
          if (rendered.length === 2) abort.aborted = true;
        },
      }),
    );

    expect(outcome.kind).toBe("cancelled");
    expect(rendered).toHaveLength(2);
  });

  test("tokens emitted after the lock event never reach the surface", async () => {
    // The lock arrives from the UI while tokens arrive from a native thread.
    const abort = { aborted: false };
    const rendered: string[] = [];

    scriptLlama([{ emit: "one two three four five six" }]);

    const outcome = await answerQuestion(
      SPEND_QUESTION,
      depsWith({
        abort,
        onToken: (token) => {
          rendered.push(token);
          abort.aborted = true;
        },
      }),
    );

    expect(rendered).toHaveLength(1);
    expect(outcome.kind).toBe("cancelled");
  });

  test("a flag raised before the tap is honoured before any tool runs", async () => {
    const calls: ToolCallLog = [];
    const outcome = await answerQuestion(SPEND_QUESTION, depsWith({ abort: { aborted: true } }, calls));
    expect(outcome.kind).toBe("cancelled");
    expect(calls).toEqual([]);
    expect(generateCallCount()).toBe(0);
  });
});
