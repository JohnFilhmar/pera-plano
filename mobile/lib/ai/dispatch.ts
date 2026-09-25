// mobile/lib/ai/dispatch.ts
//
// SPEC §7.4, CHOSEN BY THE OWNER ON 2026-09-25: THE MODEL NEVER CHOOSES A TOOL.
// On the phone it picked the right one 8 to 12 times in 30 (docs/13, "Run
// 2026-09-25"), so the choice moved into the UI:
//
//   tapped question → its fixed tool → ONE narration round → grounding check
//     → output guard → render
//   typed text      → small talk, the advice redirect, a fixed question
//     (answer level 2+), free chat (level 3+), or cannot-answer. See
//     docs/superpowers/specs/2026-09-25-assistant-levels-design.md.
//
// The grammar, the tool-round cap, the turn cache and the malformed-output rule
// went with the model's freedom to choose, as the plan's §7.4 substitution for
// Phase 7 said they would.
//
// THE NARRATION PROMPT HOLDS THE TAPPED QUESTION AND NOTHING EARLIER. The chat
// used to send its whole transcript, and on the phone one decline in that
// history was enough for the model to decline five valid questions in a row. A
// fixed question needs no history to answer.
//
// THE ADVICE BRANCH NEVER CONSULTS THE MODEL, so it can never be talked round:
// `generateCallCount() === 0` after an advice input is a mechanical fact. The
// redirect still carries data, because "a refusal with no data attached is a
// failed redirect".
//
// EVERY RULE ON THE OUTPUT READS RAW TEXT, NEVER A `.trim()`ED COPY, and the
// `{`-fragment rule still sits ahead of grounding: a JSON fragment holds no
// currency figure, so grounding alone would wave it through as an answer.
import type { GenerateHandle, LlamaBridge } from "@/modules/llama_bridge/types";
import type { EpochMs } from "@/types/domain";

import type { FixedQuestion } from "./fixed_questions";
import type { AnswerLevel } from "./levels";
import { buildCorpus, isGrounded, ungroundedFigures } from "./grounding";
import { guard, type GuardReason } from "./output_guard";
import { buildTurnPrompt } from "./prompt";
import { guessLanguage, type ReplyLanguage, type SmallTalk } from "./small_talk";
import { unavailable, type ToolResult } from "./tools/types";
import { classify, type AdviceClass } from "./triage";
import { matchFixedQuestion } from "./questionMatcher";

export type CardReason =
  /** The prose stated a figure or date no tool result licensed. */
  | "ungrounded"
  /** The output guard fired: advice, an imperative, or a contact detail. */
  | "guarded"
  /** Output opened with `{`: a tool call or JSON where a sentence belongs. */
  | "fragment"
  /** The model said nothing at all. */
  | "empty"
  /** The bridge failed mid-stream. */
  | "error";

/** What a tapped question produced. */
export type TurnOutcome =
  | { kind: "prose"; text: string; results: ToolResult<unknown>[] }
  | {
      kind: "card";
      reason: CardReason;
      results: ToolResult<unknown>[];
      /** Populated when `reason` is `ungrounded`, for the card's log. */
      ungrounded?: string[];
      /** Populated when `reason` is `guarded`. */
      guard?: GuardReason;
    }
  /** No assistant message at all. See `abort` below. */
  | { kind: "cancelled" };

/** What typed text produced. The app answers all but `question` and `free_chat` itself. */
export type TextReply =
  | { kind: "redirect"; klass: AdviceClass; results: ToolResult<unknown>[] }
  | { kind: "smalltalk"; talk: SmallTalk; language: ReplyLanguage }
  /** Level 2 and up: the message asks a fixed question. Answer it with `answerQuestion`. */
  | { kind: "question"; question: FixedQuestion }
  /** Level 3 and up: nothing deterministic applies, so answer it with `answerFreely`. */
  | { kind: "free_chat" }
  /** Levels 1 and 2, anything else typed. The questions on screen are the way in. */
  | { kind: "cannot_answer"; language: ReplyLanguage };

/**
 * A plain mutable flag rather than an `AbortSignal`.
 *
 * Two different things set it and neither is a fetch: the user cancelling, and
 * `lock:engaged` arriving from the UI while tokens arrive from a native thread.
 */
export type AbortFlag = { aborted: boolean };

export type DispatchDeps = {
  bridge: LlamaBridge;
  runTool: (
    name: string,
    args: Record<string, unknown>,
    now: EpochMs,
  ) => Promise<ToolResult<unknown>>;
  now: EpochMs;
  abort?: AbortFlag;
  /**
   * Called per token as it arrives.
   *
   * THE SURFACE MUST NOT COMMIT WHAT IT RENDERS HERE. Whether the prose
   * survives is not known until the whole answer has been read and grounding
   * and the guard have ruled on it; a token stream is a preview, and the
   * returned `TurnOutcome` is the verdict.
   */
  onToken?: (token: string) => void;
};

/** True when the first non-space character is `{`, over RAW output. */
export function opensWithBrace(raw: string): boolean {
  return raw.trimStart().startsWith("{");
}

/**
 * Runs one tool, turning a throw into an ordinary refusal.
 *
 * @param deps - The tool runner and the clock.
 * @param name - The tool's wire name.
 * @param args - Its arguments.
 * @returns The tool's result, or an `unavailable` refusal when the handler threw.
 */
export async function runToolSafely(
  deps: Pick<DispatchDeps, "runTool" | "now">,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult<unknown>> {
  try {
    return await deps.runTool(name, args, deps.now);
  } catch {
    // NEVER a stack trace and never a message the model can quote: the failure
    // reaches the channel as an ordinary refusal, and the file and line that
    // failed are ours, not the user's.
    return unavailable(name, "That information could not be read just now.");
  }
}

/** How a streamed answer ended. */
export type StreamResult = { kind: "text"; raw: string } | { kind: "cancelled" } | { kind: "error" };

/**
 * Reads a generation to the end, honouring the abort flag before and after every
 * token and passing each token to the preview hook.
 *
 * @param handle - The generation to read.
 * @param deps - The optional abort flag and token hook.
 * @returns The raw text; `cancelled` once the flag is raised, with the handle
 *   cancelled too; or `error` when the bridge failed mid-stream.
 */
export async function readStream(
  handle: GenerateHandle,
  deps: Pick<DispatchDeps, "abort" | "onToken">,
): Promise<StreamResult> {
  let raw = "";
  try {
    for await (const token of handle.tokens) {
      if (deps.abort?.aborted) {
        handle.cancel();
        return { kind: "cancelled" };
      }
      raw += token;
      deps.onToken?.(token);
      if (deps.abort?.aborted) {
        // The flag can be set BY the render itself, a lock landing while the
        // surface paints. Checked again so the next token never arrives.
        handle.cancel();
        return { kind: "cancelled" };
      }
    }
  } catch {
    // An abort that lands before a native failure is still an abort: a card
    // appended after the lock cleared the screen would put figures back on it.
    return deps.abort?.aborted ? { kind: "cancelled" } : { kind: "error" };
  }
  // The flag can also land after the last token, while the stream is closing.
  if (deps.abort?.aborted) return { kind: "cancelled" };
  return { kind: "text", raw };
}

/**
 * Answers a tapped question: runs its fixed tool, then asks the model to put the
 * result into a sentence.
 *
 * @param question - The question that was tapped. Its tool and arguments are final.
 * @param deps - The bridge, the tool runner, the clock, and the optional abort flag and token hook.
 * @returns Prose that passed grounding and the output guard; a card carrying the
 *   tool result when it did not, when the output was empty or JSON, or when the
 *   bridge failed; or `cancelled` once the abort flag is raised.
 */
export async function answerQuestion(
  question: FixedQuestion,
  deps: DispatchDeps,
): Promise<TurnOutcome> {
  if (deps.abort?.aborted) return { kind: "cancelled" };
  const results = [await runToolSafely(deps, question.tool, question.args)];
  if (deps.abort?.aborted) return { kind: "cancelled" };

  const prompt = buildTurnPrompt({
    transcript: [{ role: "user", text: question.label }],
    toolResults: results,
  });
  const streamed = await readStream(deps.bridge.generate(prompt), deps);
  if (streamed.kind === "cancelled") return { kind: "cancelled" };
  if (streamed.kind === "error") return { kind: "card", reason: "error", results };
  const raw = streamed.raw;

  if (opensWithBrace(raw)) return { kind: "card", reason: "fragment", results };
  if (raw.trim().length === 0) return { kind: "card", reason: "empty", results };

  const corpus = buildCorpus(results);
  if (!isGrounded(raw, corpus)) {
    return {
      kind: "card",
      reason: "ungrounded",
      results,
      ungrounded: ungroundedFigures(raw, corpus),
    };
  }

  const verdictOnProse = guard(raw);
  if (verdictOnProse.suppressed) {
    return { kind: "card", reason: "guarded", results, guard: verdictOnProse.reason };
  }

  return { kind: "prose", text: raw, results };
}

/**
 * Decides who answers typed text: the app, a fixed question, or the model.
 * Assistant levels spec §1: small talk, then money advice, then (level 2+) a
 * fixed question, then (level 3+) free chat, otherwise cannot-answer.
 *
 * @param input - The message as typed.
 * @param deps - The tool runner and clock, used only by the advice redirect,
 *   and the answer level in force.
 * @returns The app's own reply, or which path must answer it next.
 */
export async function replyToText(
  input: string,
  deps: Pick<DispatchDeps, "runTool" | "now"> & { level: AnswerLevel },
): Promise<TextReply> {
  const verdict = classify(input, deps.level);

  if (verdict.kind === "smalltalk") {
    return { kind: "smalltalk", talk: verdict.talk, language: verdict.language };
  }

  if (verdict.kind === "advice") {
    // The user asked "can I afford this?" and deserves the facts they needed to
    // decide, even though the app will not decide for them.
    const results: ToolResult<unknown>[] = [];
    for (const name of verdict.redirectTools) {
      results.push(await runToolSafely(deps, name, {}));
    }
    return { kind: "redirect", klass: verdict.klass, results };
  }

  if (deps.level >= 2) {
    const question = matchFixedQuestion(input);
    if (question !== null) return { kind: "question", question };
  }

  if (deps.level >= 3) return { kind: "free_chat" };

  return { kind: "cannot_answer", language: guessLanguage(input) };
}
