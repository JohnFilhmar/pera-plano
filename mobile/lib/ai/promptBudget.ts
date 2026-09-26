// mobile/lib/ai/promptBudget.ts
//
// FITTING A FREE-CHAT TURN INTO THE CONTEXT. Assistant levels spec §4.3. Both
// catalogue models run a 2,048-token context and the answer keeps 256 of it.
// What is left holds the system prompt, the records snapshot and the new
// message, counted with the resident model's own tokenizer. Free chat sends
// only the snapshot and the new message, never earlier turns (owner,
// 2026-09-26, after the phone check).
//
// WHAT GIVES WAY, IN ORDER: the snapshot's spending breakdown, then its
// limits. Balance and safe-to-spend always stay, and a message that does not
// fit even then is refused before it reaches the model.
import { MAX_RESPONSE_TOKENS } from "@/modules/llama_bridge/types";

import { buildTurnPrompt, type Turn } from "./prompt";
import type { ToolResult } from "./tools/types";

/**
 * The chat template's own tokens for one system and one user message, which
 * `countTokens` never sees. Qwen3's template adds roughly twenty (role markers
 * and the empty think block); 64 leaves room without costing a turn.
 */
export const TEMPLATE_MARGIN_TOKENS = 64;

/** Snapshot tools that may be dropped, in the order they are dropped. */
const DROPPABLE_TOOLS: readonly string[] = ["get_spend_by_category", "get_limits"];

export type FitInput = {
  systemPrompt: string;
  snapshot: ToolResult<unknown>[];
  message: string;
  contextTokens: number;
  countTokens: (text: string) => Promise<number>;
};

export type FittedPrompt = { kind: "fits"; prompt: string; toolsUsed: string[] } | { kind: "too_long" };

/**
 * Builds the largest free-chat prompt that fits the model's context.
 *
 * @param input - The prompt's parts, the context size and the model's tokenizer.
 * @returns The prompt with as much of the snapshot as fits and the tools it
 *   carries, or `too_long` when not even balance and safe-to-spend leave room.
 */
export async function fitFreeChatPrompt(input: FitInput): Promise<FittedPrompt> {
  const budget =
    input.contextTokens -
    MAX_RESPONSE_TOKENS -
    TEMPLATE_MARGIN_TOKENS -
    (await input.countTokens(input.systemPrompt));
  const message: Turn = { role: "user", text: input.message };
  const build = (snapshot: ToolResult<unknown>[]) =>
    buildTurnPrompt({ transcript: [message], toolResults: snapshot, closing: "free_chat" });
  const fits = async (prompt: string) => (await input.countTokens(prompt)) <= budget;

  for (let dropped = 0; dropped <= DROPPABLE_TOOLS.length; dropped += 1) {
    const gone = new Set(DROPPABLE_TOOLS.slice(0, dropped));
    const candidate = input.snapshot.filter((result) => !gone.has(result.tool));
    const prompt = build(candidate);
    if (await fits(prompt)) {
      return { kind: "fits", prompt, toolsUsed: candidate.map((result) => result.tool) };
    }
  }
  return { kind: "too_long" };
}
