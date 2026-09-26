// mobile/lib/ai/__tests__/promptBudget.test.ts
//
// Assistant levels spec §4.3: the spending breakdown gives way first, then the
// limits; balance and safe-to-spend always stay. A one-character-per-token
// counter makes every budget here exact.
import { MAX_RESPONSE_TOKENS } from "@/modules/llama_bridge/types";

import { TEMPLATE_MARGIN_TOKENS, fitFreeChatPrompt } from "../promptBudget";
import { buildTurnPrompt } from "../prompt";
import { ok, type ToolResult } from "../tools/types";

const SYSTEM = "SYSTEM PROMPT FOR THE TEST";
const MESSAGE = "Is that a lot?";

const SNAPSHOT: ToolResult<unknown>[] = [
  ok("get_balance_total", {}, [{ key: "total", value: "₱18,320.00", kind: "amount" }]),
  ok("get_safe_to_spend", {}, [{ key: "safe to spend", value: "₱4,000.00", kind: "amount" }]),
  ok("get_limits", {}, [{ key: "Groceries limit left", value: "₱1,100.00", kind: "amount" }]),
  ok("get_spend_by_category", {}, [{ key: "Groceries · this month", value: "₱2,400.00", kind: "amount" }]),
];

const count = async (text: string) => text.length;

function lengthOf(snapshot: ToolResult<unknown>[] = SNAPSHOT): number {
  return buildTurnPrompt({
    transcript: [{ role: "user", text: MESSAGE }],
    toolResults: snapshot,
    closing: "free_chat",
  }).length;
}

function contextFor(promptLength: number): number {
  return MAX_RESPONSE_TOKENS + TEMPLATE_MARGIN_TOKENS + SYSTEM.length + promptLength;
}

function fit(contextTokens: number) {
  return fitFreeChatPrompt({ systemPrompt: SYSTEM, snapshot: SNAPSHOT, message: MESSAGE, contextTokens, countTokens: count });
}

const CORE = SNAPSHOT.filter((result) => result.tool === "get_balance_total" || result.tool === "get_safe_to_spend");

test("with room to spare, the whole snapshot goes in", async () => {
  expect(await fit(100_000)).toMatchObject({
    kind: "fits",
    toolsUsed: ["get_balance_total", "get_safe_to_spend", "get_limits", "get_spend_by_category"],
  });
});

test("with no room for the whole snapshot, the spending breakdown goes first", async () => {
  const withoutSpend = SNAPSHOT.filter((result) => result.tool !== "get_spend_by_category");
  expect(await fit(contextFor(lengthOf(withoutSpend)))).toMatchObject({
    kind: "fits",
    toolsUsed: ["get_balance_total", "get_safe_to_spend", "get_limits"],
  });
});

test("balance and safe-to-spend always stay", async () => {
  expect(await fit(contextFor(lengthOf(CORE)))).toMatchObject({
    kind: "fits",
    toolsUsed: ["get_balance_total", "get_safe_to_spend"],
  });
});

test("a message too long even for the smallest prompt is refused", async () => {
  expect(await fit(contextFor(lengthOf(CORE)) - 1)).toEqual({ kind: "too_long" });
});
