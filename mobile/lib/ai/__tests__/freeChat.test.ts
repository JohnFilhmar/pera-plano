// mobile/lib/ai/__tests__/freeChat.test.ts
//
// Assistant levels spec §4 and §5. Free chat is the only path where typed words
// reach the model, so every guarantee the chip path makes is re-proved here:
// records only inside the channel, figures copied from them or the answer is
// replaced, advice and contact details replaced, nothing earlier than what is
// on screen.
import { SNAPSHOT_TOOLS, answerFreely, type FreeChatDeps } from "../freeChat";
import { TOOL_CHANNEL_CLOSE, TOOL_CHANNEL_OPEN, freeChatSystemPrompt } from "../prompt";
import { ok, type ToolResult } from "../tools/types";
import {
  fakeLlamaBridge,
  generateCallCount,
  lastPromptGiven,
  lastSystemPromptGiven,
  resetLlamaScript,
  scriptLlama,
} from "@/test_support/llama_bridge_mock";

const NOW = 1_773_000_000_000;
const MODEL = { knowledgeLimit: "April 2025", contextTokens: 2048 };

const RECORDS: Record<string, ToolResult<unknown>> = {
  get_balance_total: ok("get_balance_total", {}, [{ key: "total", value: "₱18,320.00", kind: "amount" }]),
  get_safe_to_spend: ok("get_safe_to_spend", {}, [{ key: "safe to spend", value: "₱4,000.00", kind: "amount" }]),
  get_limits: ok("get_limits", {}, [{ key: "Groceries limit left", value: "₱1,100.00", kind: "amount" }]),
  get_spend_by_category: ok("get_spend_by_category", {}, [
    { key: "Groceries · this month", value: "₱2,400.00", kind: "amount" },
  ]),
};

function deps(overrides: Partial<FreeChatDeps> = {}, calls: string[] = []): FreeChatDeps {
  return {
    bridge: fakeLlamaBridge,
    now: NOW,
    runTool: async (name) => {
      calls.push(name);
      return RECORDS[name];
    },
    level: 3,
    model: MODEL,
    turns: [],
    ...overrides,
  };
}

beforeEach(() => {
  resetLlamaScript();
});

test("sends the level's own system prompt, with the records only inside the channel", async () => {
  scriptLlama([{ emit: "You have ₱18,320.00 in total." }]);

  const outcome = await answerFreely("Tell me about my money", deps());

  expect(outcome).toEqual({ kind: "prose", text: "You have ₱18,320.00 in total." });
  expect(lastSystemPromptGiven()).toBe(freeChatSystemPrompt(3, "April 2025"));
  const prompt = lastPromptGiven();
  const open = prompt.indexOf(TOOL_CHANNEL_OPEN);
  const close = prompt.indexOf(TOOL_CHANNEL_CLOSE);
  expect(prompt.slice(open, close)).toContain("₱18,320.00");
  expect(prompt.slice(0, open) + prompt.slice(close)).not.toContain("₱18,320.00");
});

test("re-reads the whole snapshot on every turn", async () => {
  scriptLlama([{ emit: "Here you go." }, { emit: "And again." }]);
  const calls: string[] = [];

  await answerFreely("First", deps({}, calls));
  await answerFreely("Second", deps({}, calls));

  const names = SNAPSHOT_TOOLS.map((tool) => tool.name);
  expect(calls).toEqual([...names, ...names]);
});

test("carries the exchanges still on screen", async () => {
  scriptLlama([{ emit: "That is across all your wallets." }]);

  await answerFreely(
    "Is that a lot?",
    deps({
      turns: [
        { role: "user", text: "How much money do I have?" },
        { role: "assistant", text: "You have ₱18,320.00 in total." },
      ],
    }),
  );

  expect(lastPromptGiven()).toContain("User: How much money do I have?");
  expect(lastPromptGiven()).toContain("Assistant: You have ₱18,320.00 in total.");
});

test("a figure not in the records replaces the answer", async () => {
  scriptLlama([{ emit: "You have ₱99.00 saved." }]);
  expect(await answerFreely("Am I doing well?", deps())).toEqual({
    kind: "replaced",
    failure: "ungrounded",
    language: "en",
  });
});

test("the replacement follows the message's language", async () => {
  scriptLlama([{ emit: "May ₱99.00 ka." }]);
  expect(await answerFreely("Magkano ang ipon ko ngayon?", deps())).toMatchObject({ language: "fil" });
});

test("advice wording replaces the answer at level 3", async () => {
  scriptLlama([{ emit: "You should save more." }]);
  expect(await answerFreely("Am I doing well?", deps())).toMatchObject({ kind: "replaced", failure: "advice" });
});

test("at level 5 a non-money answer with advice wording survives", async () => {
  scriptLlama([{ emit: "You should bring an umbrella." }]);
  expect(await answerFreely("Will it rain tomorrow?", deps({ level: 5 }))).toEqual({
    kind: "prose",
    text: "You should bring an umbrella.",
  });
});

test("a phone number replaces the answer even at level 5", async () => {
  scriptLlama([{ emit: "Call 09171234567 if it floods." }]);
  expect(await answerFreely("Will it rain tomorrow?", deps({ level: 5 }))).toMatchObject({
    kind: "replaced",
    failure: "contact",
  });
});

test.each([[{ emitRaw: '{"tool":"get_wal' }], [{ emit: "" }], [{ throwAfter: 1 }]] as const)(
  "unreadable output (%j) replaces the answer",
  async (turn) => {
    scriptLlama([turn]);
    expect(await answerFreely("Hi there, tell me something", deps())).toMatchObject({
      kind: "replaced",
      failure: "unreadable",
    });
  },
);

test("a message that cannot fit the context never reaches the model", async () => {
  expect(await answerFreely("Tell me everything", deps({ model: { knowledgeLimit: "April 2025", contextTokens: 400 } }))).toEqual({
    kind: "too_long",
    language: "en",
  });
  expect(generateCallCount()).toBe(0);
});

test("a raised abort flag stops the turn before any tool runs", async () => {
  const calls: string[] = [];
  expect(await answerFreely("Hi", deps({ abort: { aborted: true } }, calls))).toEqual({ kind: "cancelled" });
  expect(calls).toEqual([]);
});

test("a lock that lands while the prompt is fitted stops the turn before the model runs", async () => {
  const abort = { aborted: false };
  const bridge = {
    ...fakeLlamaBridge,
    countTokens: async (text: string) => {
      abort.aborted = true;
      return Math.ceil(text.length / 4);
    },
  };
  expect(await answerFreely("Tell me about my money", deps({ bridge, abort }))).toEqual({ kind: "cancelled" });
  expect(generateCallCount()).toBe(0);
});

test("a figure from a snapshot tool the budget dropped does not count as grounded", async () => {
  scriptLlama([{ emit: "You spent ₱2,400.00 on Groceries." }]);
  // Any prompt that still carries the spending breakdown is over budget, so the fit drops it.
  const bridge = {
    ...fakeLlamaBridge,
    countTokens: async (text: string) => (text.includes("get_spend_by_category") ? 100_000 : 1),
  };
  expect(await answerFreely("Where did my money go?", deps({ bridge }))).toMatchObject({
    kind: "replaced",
    failure: "ungrounded",
  });
});
