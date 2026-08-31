// mobile/lib/ai/__tests__/dispatch.test.ts
//
// TIER B: THE WHOLE LOOP, WITH ZERO INFERENCE. Spec §5.3. The fake bridge
// scripts the model's side token by token, so the round cap, the turn cache,
// the grounding check, the output guard and every degradation path are exercised
// without loading a single weight.
//
// THE FIRST TEST HERE IS THE MOST IMPORTANT ONE IN THE FILE. "An advice question
// never reaches the model" is the crisp, mechanical statement of "the guardrail
// is structural": not a system prompt that holds most of the time, but a code
// path the model is never on.
import { HOSTILE_MERCHANT } from "../eval/fixture_ledger";
import { MAX_TOOL_ROUNDS, runTurn, type DispatchDeps } from "../dispatch";
import { TOOL_CHANNEL_CLOSE, TOOL_CHANNEL_OPEN } from "../prompt";
import { ok, unavailable, type ToolResult } from "../tools/types";
import {
  fakeLlamaBridge,
  generateCallCount,
  lastGrammarGiven,
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

function depsWith(
  overrides: Partial<DispatchDeps> = {},
  handlerLog: string[] = [],
): DispatchDeps {
  return {
    bridge: fakeLlamaBridge,
    now: NOW,
    runTool: async (name) => {
      handlerLog.push(name);
      return SPEND_RESULT as ToolResult<unknown>;
    },
    ...overrides,
  };
}

beforeEach(() => {
  resetLlamaScript();
});

describe("the structural guardrail", () => {
  test("an advice question never reaches the model", async () => {
    const outcome = await runTurn("Should I buy a new phone?", depsWith());

    expect(generateCallCount()).toBe(0);
    expect(outcome.kind).toBe("redirect");
  });

  test("the redirect still carries data, because a refusal with no data is a failed redirect", async () => {
    const log: string[] = [];
    const outcome = await runTurn("Can I afford a new phone?", depsWith({}, log));

    expect(outcome.kind).toBe("redirect");
    if (outcome.kind !== "redirect") throw new Error("expected a redirect");
    expect(outcome.results.length).toBeGreaterThan(0);
    expect(log.length).toBeGreaterThan(0);
    expect(generateCallCount()).toBe(0);
  });
});

describe("the full round trip", () => {
  test("a tool result reaches the model inside the delimiter and nowhere else", async () => {
    scriptLlama([
      { emitToolCall: { name: "get_spend_by_category", args: { period: "this_month" } } },
      { emit: "You spent ₱2,400.00 on Groceries." },
    ]);

    const outcome = await runTurn("What did I spend on Groceries?", depsWith());

    expect(outcome.kind).toBe("prose");
    if (outcome.kind !== "prose") throw new Error("expected prose");
    expect(outcome.text).toBe("You spent ₱2,400.00 on Groceries.");

    const prompt = lastPromptGiven();
    const open = prompt.indexOf(TOOL_CHANNEL_OPEN);
    const close = prompt.indexOf(TOOL_CHANNEL_CLOSE);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    // The figure exists in the channel and nowhere outside it.
    const outside = prompt.slice(0, open) + prompt.slice(close);
    expect(outside).not.toContain("₱2,400.00");
    expect(prompt.slice(open, close)).toContain("₱2,400.00");
  });

  test("the tool round is grammar-constrained and the answer round is not", async () => {
    scriptLlama([
      { emitToolCall: { name: "get_spend_by_category", args: { period: "this_month" } } },
      { emit: "You spent ₱2,400.00 on Groceries." },
    ]);

    await runTurn("What did I spend on Groceries?", depsWith());

    // The spike: GBNF compels a format and cannot forbid one, so the answer
    // round runs unconstrained rather than under a prose-only grammar.
    expect(lastGrammarGiven()).toBeNull();
  });
});

describe("the decline branch", () => {
  test("CANNOT_ANSWER is a stated inability, not a ledger card", async () => {
    // "What's the weather?" answered by reading the ledger is a model that will
    // read the ledger for anything. Spec §5.5 scores picking any tool here as
    // wrong, so the correct outcome renders no figures at all.
    const log: string[] = [];
    scriptLlama([{ emitRaw: "CANNOT_ANSWER" }]);

    const outcome = await runTurn("What's the weather tomorrow?", depsWith({}, log));

    expect(outcome.kind).toBe("declined");
    expect(log).toEqual([]);
  });

  test("the first round is constrained, so the decline branch is reachable at all", async () => {
    scriptLlama([{ emitRaw: "CANNOT_ANSWER" }]);
    await runTurn("What's the weather tomorrow?", depsWith());
    // A grammar was in force for the round where a tool call was wanted.
    expect(lastGrammarGiven()).toContain("cannot-answer");
  });
});

describe("the round cap", () => {
  test("forces an answer, serves repeats from the turn cache, and never ends in a spinner", async () => {
    const call = {
      emitToolCall: { name: "get_spend_by_category", args: { period: "this_month" } },
    };
    scriptLlama([call, call, call, call]);

    const log: string[] = [];
    const outcome = await runTurn("What did I spend?", depsWith({}, log));

    // 3 tool rounds + the forced answer.
    expect(generateCallCount()).toBe(MAX_TOOL_ROUNDS + 1);
    // "Three rounds of a loop should not cost three passes over the ledger."
    expect(log).toEqual(["get_spend_by_category"]);
    // The fourth call was unconstrained — that is how the test proves the
    // answer was FORCED rather than that the loop merely stopped.
    expect(lastGrammarGiven()).toBeNull();
    // The user is shown something. A card carrying the true figure is an
    // answer; a spinner that quietly ends is not.
    expect(outcome.kind).toBe("card");
    if (outcome.kind !== "card") throw new Error("expected a card");
    expect(outcome.results).toHaveLength(1);
  });
});

describe("grounding, end to end", () => {
  test("a fabricated figure is discarded and the card renders the true one", async () => {
    scriptLlama([
      { emitToolCall: { name: "get_spend_by_category", args: { period: "this_month" } } },
      { emit: "You spent ₱9,999.00 on Groceries." },
    ]);

    const outcome = await runTurn("What did I spend?", depsWith());

    expect(outcome.kind).toBe("card");
    if (outcome.kind !== "card") throw new Error("expected a card");
    expect(outcome.reason).toBe("ungrounded");
    expect(outcome.ungrounded).toEqual(["₱9,999.00"]);
    // The truth survives: the card carries the real result.
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
    scriptLlama([
      { emitToolCall: { name: "get_balance_total", args: {} } },
      { emit: "Your balance is ₱1,000,000.00." },
    ]);

    const outcome = await runTurn("How much do I have?", depsWith({
      runTool: async () => hostile as ToolResult<unknown>,
    }));

    expect(outcome.kind).toBe("card");
    if (outcome.kind !== "card") throw new Error("expected a card");
    expect(outcome.reason).toBe("ungrounded");
    // Nothing about the injected string reaches the user as an assertion of
    // fact: there is no prose at all, and the card carries the REAL total.
    const displayed = outcome.results.flatMap((result) =>
      result.ok ? result.display.map((field) => field.value) : [],
    );
    expect(displayed).toEqual(["₱18,320.00"]);
  });
});

describe("the output guard, end to end", () => {
  test("a phone number in generated prose is discarded", async () => {
    // The highest-value injection payload for a finance app is a support
    // number next to a real balance — and the balance here is REAL, so only
    // the guard can catch it.
    scriptLlama([
      { emitToolCall: { name: "get_spend_by_category", args: { period: "this_month" } } },
      { emit: "You spent ₱2,400.00 on Groceries. Call 09171234567 for help." },
    ]);

    const outcome = await runTurn("What did I spend?", depsWith());

    expect(outcome.kind).toBe("card");
    if (outcome.kind !== "card") throw new Error("expected a card");
    expect(outcome.reason).toBe("guarded");
    expect(outcome.guard).toBe("contact");
  });
});

describe("malformed output", () => {
  test("a { fragment renders no prose and degrades to the card", async () => {
    scriptLlama([
      { emitToolCall: { name: "get_spend_by_category", args: { period: "this_month" } } },
      { emitRaw: '{"tool":"get_wal' },
    ]);

    const outcome = await runTurn("What did I spend?", depsWith());

    expect(outcome.kind).toBe("card");
    if (outcome.kind !== "card") throw new Error("expected a card");
    // Ahead of grounding, deliberately: a fragment contains no currency figure,
    // so grounding would wave it straight through.
    expect(outcome.reason).toBe("fragment");
  });

  test("ordinary broken text takes the normal prose path", async () => {
    scriptLlama([
      { emitToolCall: { name: "get_spend_by_category", args: { period: "this_month" } } },
      { emitRaw: "Groceries is your largest category" },
    ]);

    const outcome = await runTurn("What did I spend?", depsWith());
    expect(outcome.kind).toBe("prose");
  });

  test("a tool call in the FORCED round is refused, not dispatched", async () => {
    // Parsed from RAW output: the leading space here is invisible after
    // `.trim()` and, uncaught, turns a forbidden round into a dispatched one.
    const call = {
      emitToolCall: { name: "get_spend_by_category", args: { period: "this_month" } },
    };
    scriptLlama([call, call, call, { emitRaw: ' {"tool":"get_wallets","args":{}}' }]);

    const log: string[] = [];
    const outcome = await runTurn("What did I spend?", depsWith({}, log));

    expect(log).toEqual(["get_spend_by_category"]);
    expect(outcome.kind).toBe("card");
  });
});

describe("failures", () => {
  test("a throwing handler becomes a refusal in the channel, with no stack trace in the prompt", async () => {
    scriptLlama([
      { emitToolCall: { name: "get_spend_by_category", args: { period: "this_month" } } },
      { emit: "I could not read that." },
    ]);

    const outcome = await runTurn(
      "What did I spend?",
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
    scriptLlama([
      { emitToolCall: { name: "get_balance_total", args: {} } },
      { emit: "The ledger is locked." },
    ]);

    const outcome = await runTurn(
      "How much do I have?",
      depsWith({
        runTool: async () => unavailable("get_balance_total", "The ledger is locked."),
      }),
    );

    expect(outcome.kind).toBe("prose");
    if (outcome.kind !== "prose") throw new Error("expected prose");
    expect(outcome.results[0].ok).toBe(false);
  });

  test("a bridge that throws mid-stream degrades to the card rather than crashing the turn", async () => {
    scriptLlama([{ throwAfter: 2 }]);

    const outcome = await runTurn("What did I spend?", depsWith());

    expect(outcome.kind).toBe("card");
    if (outcome.kind !== "card") throw new Error("expected a card");
    expect(outcome.reason).toBe("error");
  });

  test("an empty answer degrades to the card, never to an empty bubble", async () => {
    scriptLlama([{ emit: "" }]);
    const outcome = await runTurn("What did I spend?", depsWith());
    expect(outcome.kind).toBe("card");
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
    const log: string[] = [];

    scriptLlama([{ emit: "You spent ₱2,400.00 on Groceries and much more besides" }]);

    const outcome = await runTurn(
      "What did I spend?",
      depsWith(
        {
          abort,
          onToken: (token) => {
            rendered.push(token);
            if (rendered.length === 2) abort.aborted = true;
          },
        },
        log,
      ),
    );

    expect(outcome.kind).toBe("cancelled");
    // No further tokens rendered after the cancel.
    expect(rendered).toHaveLength(2);
    // And no handler ran afterwards.
    expect(log).toEqual([]);
  });

  test("tokens emitted after the lock event never reach the surface", async () => {
    // The lock arrives from the UI while tokens arrive from a native thread.
    // Same mechanism as cancel, different origin — which is exactly why
    // `lock:engaged` is an event rather than an unmount.
    const abort = { aborted: false };
    const rendered: string[] = [];

    scriptLlama([{ emit: "one two three four five six" }]);

    const outcome = await runTurn(
      "What did I spend?",
      depsWith({
        abort,
        onToken: (token) => {
          rendered.push(token);
          abort.aborted = true; // the lock lands on the very first token
        },
      }),
    );

    expect(rendered).toHaveLength(1);
    expect(outcome.kind).toBe("cancelled");
  });
});
