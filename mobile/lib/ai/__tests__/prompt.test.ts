// mobile/lib/ai/__tests__/prompt.test.ts
//
// SNAPSHOT-PINNED ON PURPOSE. Spec §5.2 item 10: not because prose can be unit
// tested, but because the prompt is the one file where a well-meaning edit
// re-introduces advisory framing, and a snapshot forces that diff into review.
// If this snapshot fails, READ the diff — do not run `-u` and move on.
//
// The other two tests here are SECURITY tests (§5.8), and they are proved by
// inspecting the exact string handed to `generate()`:
//   - the system prompt is assembled from constants and contains no user data;
//   - tool output appears ONLY inside the delimited channel, never concatenated
//     into the system prompt.
import {
  SYSTEM_PROMPT,
  TOOL_CHANNEL_CLOSE,
  TOOL_CHANNEL_OPEN,
  buildTurnPrompt,
  freeChatSystemPrompt,
} from "../prompt";

const TOOL_RESULTS = [
  {
    ok: true as const,
    tool: "get_spend_by_category",
    data: { topCategory: "Groceries" },
    display: [{ key: "groceries", value: "₱2,400.00", kind: "amount" as const }],
  },
];

const TRANSCRIPT = [
  { role: "user" as const, text: "How much did I spend on Groceries?" },
  { role: "assistant" as const, text: "You spent ₱2,400.00 on Groceries." },
  { role: "user" as const, text: "And in February?" },
];

describe("the system prompt", () => {
  test("is pinned, so advisory framing cannot re-enter without review", () => {
    expect(SYSTEM_PROMPT).toMatchSnapshot();
  });

  test("contains no user data", () => {
    // Assembled from constants only. Building a turn cannot mutate it.
    const before = SYSTEM_PROMPT;
    buildTurnPrompt({ transcript: TRANSCRIPT, toolResults: TOOL_RESULTS });
    expect(SYSTEM_PROMPT).toBe(before);
    for (const leak of ["₱2,400.00", "Groceries", "How much did I spend", "get_spend_by_category"]) {
      expect(SYSTEM_PROMPT).not.toContain(leak);
    }
  });

  test("tells the model to copy display strings rather than re-render them", () => {
    // This instruction is the ENTIRE prompt-side lever on the grounding
    // false-rejection rate (spec §6 risk 4), and it is the only lever, because
    // the check itself does not loosen.
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("character for character");
  });
});

test("the turn tells the model the records are the user's, so it answers with you, not I", () => {
  // On the A54 on 2026-09-25, "How much money do I have?" came back as "I have
  // ₱50.00 in total.": the model echoed the question's first person as if the
  // money were its own.
  const prompt = buildTurnPrompt({ transcript: TRANSCRIPT, toolResults: TOOL_RESULTS });
  expect(prompt).toMatch(/speak to the user as "you"/i);
});

describe("the delimited tool channel", () => {
  const prompt = buildTurnPrompt({ transcript: TRANSCRIPT, toolResults: TOOL_RESULTS });

  test("a tool figure appears inside the delimiters and nowhere else", () => {
    const occurrences = prompt.split("₱2,400.00").length - 1;
    // Once in the channel. The transcript's own assistant turn is a second
    // legitimate occurrence, so the count is asserted against the assembled
    // channel rather than assumed to be one.
    const open = prompt.indexOf(TOOL_CHANNEL_OPEN);
    const close = prompt.indexOf(TOOL_CHANNEL_CLOSE);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);

    const channel = prompt.slice(open, close);
    const inChannel = channel.split("₱2,400.00").length - 1;
    expect(inChannel).toBe(1);

    const outsideChannel = occurrences - inChannel;
    // The only other occurrence permitted is the model's own prior answer,
    // which is transcript, not tool output.
    expect(prompt.slice(0, open) + prompt.slice(close)).not.toContain(
      "get_spend_by_category",
    );
    expect(outsideChannel).toBe(1);
  });

  test("tool output is never concatenated into the system prompt", () => {
    expect(prompt.startsWith(SYSTEM_PROMPT)).toBe(false);
    expect(prompt).not.toContain(SYSTEM_PROMPT);
  });

  test("a turn with no tool results emits no channel at all", () => {
    const bare = buildTurnPrompt({ transcript: TRANSCRIPT, toolResults: [] });
    expect(bare).not.toContain(TOOL_CHANNEL_OPEN);
    expect(bare).not.toContain(TOOL_CHANNEL_CLOSE);
  });

  test("a refusal reaches the model as a refusal, not as an empty result", () => {
    // Spec §3.6: an empty result is indistinguishable from "you have no
    // transactions", and a model handed that will cheerfully tell a locked user
    // they have no money.
    const locked = buildTurnPrompt({
      transcript: TRANSCRIPT,
      toolResults: [
        {
          ok: false as const,
          tool: "get_balance_total",
          reason: "locked" as const,
          message: "The ledger is locked. Unlock the app to read it.",
        },
      ],
    });
    expect(locked).toContain("locked");
    expect(locked).toContain("The ledger is locked. Unlock the app to read it.");
  });

  test("the channel is snapshot-pinned too", () => {
    expect(prompt).toMatchSnapshot();
  });
});

describe("the free-chat system prompts (levels spec §4.2)", () => {
  test.each([3, 4, 5] as const)("level %s is pinned", (level) => {
    expect(freeChatSystemPrompt(level, "April 2025")).toMatchSnapshot();
  });

  test.each([3, 4, 5] as const)("level %s keeps every rule the guards enforce", (level) => {
    const prompt = freeChatSystemPrompt(level, "April 2025").toLowerCase();
    expect(prompt).toContain("never advise");
    expect(prompt).toContain("never state a peso amount");
    expect(prompt).toContain("never include a link");
    expect(prompt).toContain("character for character");
  });

  test("only level 5 names the model's knowledge limit", () => {
    expect(freeChatSystemPrompt(5, "April 2025")).toContain("April 2025");
    expect(freeChatSystemPrompt(3, "April 2025")).not.toContain("April 2025");
    expect(freeChatSystemPrompt(4, "April 2025")).not.toContain("April 2025");
  });

  test("contain no user data", () => {
    for (const level of [3, 4, 5] as const) {
      const prompt = freeChatSystemPrompt(level, "April 2025");
      for (const leak of ["₱2,400.00", "Groceries", "How much did I spend"]) {
        expect(prompt).not.toContain(leak);
      }
    }
  });
});

test("a free-chat turn gets its own closing line, and a chip keeps the narration one", () => {
  const free = buildTurnPrompt({ transcript: TRANSCRIPT, toolResults: TOOL_RESULTS, closing: "free_chat" });
  expect(free).toContain("For anything about the user's money, use only the values above.");
  expect(free).toMatch(/speak to the user as "you"/i);

  const chip = buildTurnPrompt({ transcript: TRANSCRIPT, toolResults: TOOL_RESULTS });
  expect(chip).toContain("Answer the last user message using only the values above.");
  expect(chip).not.toContain("For anything about the user's money");
});
