// mobile/lib/ai/freeChat.ts
//
// LEVELS 3 TO 5: TYPED TEXT REACHES THE MODEL, BECAUSE THE USER CHOSE IT.
// Assistant levels spec §4. What the chip path guarantees still holds: the
// records arrive only inside the delimited channel, every peso amount and
// numeric date must be copied from them, and nothing is stored.
//
// A FAILED ANSWER IS REPLACED BY A LINE, NOT A CARD. A chip has one tool result
// to fall back to; free chat has a whole snapshot and no single figure the user
// asked for, so the surface shows a fixed line pointing back at the chips
// (spec §5.2).
//
// THE SNAPSHOT IS RE-READ EVERY TURN, so a transaction added mid-chat is in the
// next answer's records. Only the tools the fitted prompt actually carried may
// license a figure.
import { opensWithBrace, readStream, runToolSafely, type DispatchDeps } from "./dispatch";
import { buildCorpus, isGrounded } from "./grounding";
import type { FreeChatLevel } from "./levels";
import { guardAtLevel } from "./output_guard";
import { freeChatSystemPrompt, type Turn } from "./prompt";
import { fitFreeChatPrompt } from "./promptBudget";
import { guessLanguage, type ReplyLanguage } from "./small_talk";
import type { ToolResult } from "./tools/types";

/** The records every free-chat turn carries, in the order the budget keeps them. */
export const SNAPSHOT_TOOLS: readonly { name: string; args: Record<string, unknown> }[] = [
  { name: "get_balance_total", args: {} },
  { name: "get_safe_to_spend", args: {} },
  { name: "get_limits", args: {} },
  { name: "get_spend_by_category", args: { period: "this_month" } },
];

export type FreeChatFailure = "ungrounded" | "advice" | "contact" | "unreadable";

export type FreeChatOutcome =
  | { kind: "prose"; text: string }
  | { kind: "replaced"; failure: FreeChatFailure; language: ReplyLanguage }
  | { kind: "too_long"; language: ReplyLanguage }
  | { kind: "cancelled" };

export type FreeChatDeps = Pick<DispatchDeps, "bridge" | "runTool" | "now" | "abort" | "onToken"> & {
  level: FreeChatLevel;
  /** The resident model's limits, from its catalogue entry. */
  model: { knowledgeLimit: string; contextTokens: number };
  /** The model exchanges on screen, oldest first, in user/assistant pairs. */
  turns: Turn[];
};

/**
 * Answers typed text at level 3, 4 or 5 from the model, a fresh records
 * snapshot and the recent turns.
 *
 * @param message - The message as typed.
 * @param deps - Bridge, tools, clock, level, model limits, recent turns, and the
 *   optional abort flag and token hook. As with `answerQuestion`, streamed
 *   tokens are a preview; the returned outcome is the verdict.
 * @returns Prose that passed every check for its level; `replaced` with the
 *   failure the surface turns into a fixed line; `too_long` when the message
 *   cannot fit the context; or `cancelled` once the abort flag is raised.
 */
export async function answerFreely(message: string, deps: FreeChatDeps): Promise<FreeChatOutcome> {
  const language = guessLanguage(message);
  if (deps.abort?.aborted) return { kind: "cancelled" };

  const snapshot: ToolResult<unknown>[] = [];
  for (const tool of SNAPSHOT_TOOLS) {
    snapshot.push(await runToolSafely(deps, tool.name, tool.args));
  }
  if (deps.abort?.aborted) return { kind: "cancelled" };

  const systemPrompt = freeChatSystemPrompt(deps.level, deps.model.knowledgeLimit);
  const fitted = await fitFreeChatPrompt({
    systemPrompt,
    snapshot,
    turns: deps.turns,
    message,
    contextTokens: deps.model.contextTokens,
    countTokens: (text) => deps.bridge.countTokens(text),
  });
  if (fitted.kind === "too_long") return { kind: "too_long", language };

  // A lock or Stop can land while the fit awaits the tokenizer; generating after
  // it would refill the model context the lock just cleared.
  if (deps.abort?.aborted) return { kind: "cancelled" };

  const streamed = await readStream(deps.bridge.generate(fitted.prompt, systemPrompt), deps);
  if (streamed.kind === "cancelled") return { kind: "cancelled" };
  if (streamed.kind === "error") return { kind: "replaced", failure: "unreadable", language };
  const raw = streamed.raw;

  if (opensWithBrace(raw) || raw.trim().length === 0) {
    return { kind: "replaced", failure: "unreadable", language };
  }

  const carried = snapshot.filter((result) => fitted.toolsUsed.includes(result.tool));
  if (!isGrounded(raw, buildCorpus(carried))) {
    return { kind: "replaced", failure: "ungrounded", language };
  }

  const verdict = guardAtLevel(raw, { level: deps.level, question: message });
  if (verdict.suppressed) {
    return { kind: "replaced", failure: verdict.reason === "contact" ? "contact" : "advice", language };
  }

  return { kind: "prose", text: raw };
}
