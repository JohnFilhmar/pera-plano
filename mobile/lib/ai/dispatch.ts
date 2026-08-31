// mobile/lib/ai/dispatch.ts
//
// THE LOOP. Spec §3.4:
//
//   triage → [advice? → app-generated redirect, ZERO inference] → generate
//     ↳ tool call → handler → result into the delimited channel → generate again
//     ↳ prose     → grounding check → output guard → render
//
// THE ADVICE BRANCH RETURNS BEFORE THE MODEL IS EVER CONSULTED. That is what
// makes the guardrail structural rather than a system prompt that holds most of
// the time: `generateCallCount() === 0` after an advice input is a mechanical
// fact, not a behaviour we hope for. And the redirect still carries data,
// because "a refusal with no data attached is a failed redirect".
//
// CAPPED AT 3 TOOL ROUNDS, THEN FORCED TO ANSWER. Small models loop: they
// re-call the same tool with the same arguments, read the same result, and call
// it again. The cap converts an infinite spinner into a slightly worse answer.
// Within a turn, an identical repeat call is served from that turn's cache —
// three rounds of a loop should not cost three passes over the ledger.
//
// THE FORCED ROUND CARRIES NO GRAMMAR, and this file refuses to act on a tool
// call in it. The plan originally said "prose-only grammar"; the spike measured
// that GBNF compels a format and cannot forbid one, and every attempt at a
// grammar meaning "anything except a tool call" was defeated. See
// `tools/grammar.ts`. Asserting the forced round was UNCONSTRAINED is how a
// test proves the answer was forced rather than that the loop merely stopped.
//
// EVERY PARSE IS OVER RAW OUTPUT, NEVER A `.trim()`ED COPY. The spike measured
// a model smuggling a complete tool call past a grammar that forbade one by
// prefixing a single space, which is invisible after trimming and turns a
// forbidden round into a dispatched one.
//
// THE `{`-FRAGMENT RULE SITS AHEAD OF GROUNDING, deliberately. A JSON fragment
// contains no currency figure, so grounding would wave it straight through and
// the user would be shown `{"tool":"get_wal` as an answer. Under a working
// grammar this is unreachable, which is exactly why it needs a stated
// behaviour: the day the grammar breaks, or a future runtime has no grammar
// support at all, this is the rule that holds.
import type { LlamaBridge } from "@/modules/llama_bridge/types";
import type { EpochMs } from "@/types/domain";

import { buildCorpus, isGrounded, ungroundedFigures } from "./grounding";
import { guard, type GuardReason } from "./output_guard";
import { buildTurnPrompt, type Turn } from "./prompt";
import { CANNOT_ANSWER, FORCED_ANSWER_GRAMMAR, compileGrammar } from "./tools/grammar";
import { TOOL_SCHEMAS } from "./tools/schemas";
import { unavailable, type ToolResult } from "./tools/types";
import { classify, type AdviceClass } from "./triage";

/** Three tool rounds, then the answer is forced. */
export const MAX_TOOL_ROUNDS = 3;

export type CardReason =
  /** The prose stated a figure or date no tool result licensed. */
  | "ungrounded"
  /** The output guard fired: advice, an imperative, or a contact detail. */
  | "guarded"
  /** Output opened with `{` and did not parse as a tool call. */
  | "fragment"
  /** The model said nothing at all. */
  | "empty"
  /** The bridge failed mid-stream. */
  | "error";

export type TurnOutcome =
  | { kind: "redirect"; klass: AdviceClass; results: ToolResult<unknown>[] }
  | { kind: "prose"; text: string; results: ToolResult<unknown>[] }
  /**
   * The model took the grammar's `CANNOT_ANSWER` branch. A stated inability,
   * which for an out-of-scope question is the right answer rather than a
   * failure — spec §5.5 scores picking any tool here as wrong.
   */
  | { kind: "declined"; results: ToolResult<unknown>[] }
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
  /** Prior turns. The current input is appended by this module. */
  transcript?: Turn[];
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

type ParsedCall = { name: string; args: Record<string, unknown> };

/** True when the first non-space character is `{`, over RAW output. */
function opensWithBrace(raw: string): boolean {
  return raw.trimStart().startsWith("{");
}

function parseToolCall(raw: string): ParsedCall | null {
  if (!opensWithBrace(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (typeof parsed !== "object" || parsed === null) return null;
    const { tool, args } = parsed as { tool?: unknown; args?: unknown };
    if (typeof tool !== "string") return null;
    if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
    return { name: tool, args: args as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** Stable across key order, so a repeat call is recognised as one. */
function cacheKey(call: ParsedCall): string {
  const entries = Object.entries(call.args).sort(([left], [right]) => left.localeCompare(right));
  return `${call.name}(${JSON.stringify(entries)})`;
}

export async function runTurn(input: string, deps: DispatchDeps): Promise<TurnOutcome> {
  const results: ToolResult<unknown>[] = [];

  const runToolSafely = async (name: string, args: Record<string, unknown>) => {
    try {
      return await deps.runTool(name, args, deps.now);
    } catch {
      // NEVER a stack trace and never a message the model can quote: the
      // failure reaches the channel as an ordinary refusal, and the file and
      // line that failed are ours, not the user's.
      return unavailable(name, "That information could not be read just now.");
    }
  };

  const verdict = classify(input);
  if (verdict.kind === "advice") {
    // ZERO INFERENCE. The model is never consulted, so it can never be talked
    // round. The redirect still runs the tools the table named, because the
    // user asked "can I afford this?" and deserves the facts they needed to
    // decide even though the app will not decide for them.
    for (const name of verdict.redirectTools) {
      results.push(await runToolSafely(name, {}));
    }
    return { kind: "redirect", klass: verdict.klass, results };
  }

  const transcript: Turn[] = [...(deps.transcript ?? []), { role: "user", text: input }];
  const toolGrammar = compileGrammar(TOOL_SCHEMAS);
  const cache = new Map<string, ToolResult<unknown>>();

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    if (deps.abort?.aborted) return { kind: "cancelled" };

    const forced = round === MAX_TOOL_ROUNDS;
    // CONSTRAINED ONLY WHILE THERE IS NOTHING TO ANSWER FROM.
    //
    // The tool grammar can express a call or a decline, and cannot express an
    // answer — so a round run under it can never produce one. That is correct
    // for the FIRST round, where a tool call is what we want and where the
    // spike measured the grammar carrying tier 1 from 58% to 78%. It would be
    // fatal for every round after: the model would hold the data and be unable
    // to say anything about it, which is "a total failure that a 'does it
    // compile' test happily passes".
    //
    // Once a result exists the round runs unconstrained. A tool call may still
    // come back — a two-tool question needs exactly that — and this loop
    // dispatches it while rounds remain.
    const constrained = results.length === 0 && !forced;
    const prompt = buildTurnPrompt({ transcript, toolResults: results });
    const handle = deps.bridge.generate(prompt, constrained ? toolGrammar : FORCED_ANSWER_GRAMMAR);

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
          // The flag can be set BY the render itself — a lock landing while the
          // surface paints. Checked again so the next token never arrives.
          handle.cancel();
          return { kind: "cancelled" };
        }
      }
    } catch {
      return { kind: "card", reason: "error", results };
    }

    if (raw.trim() === CANNOT_ANSWER) {
      // The model took the decline branch. A stated inability is the CORRECT
      // answer to "what's the weather?", and rendering a ledger card for it
      // would be answering a question nobody asked.
      return { kind: "declined", results };
    }

    const call = parseToolCall(raw);

    if (call && !forced) {
      const key = cacheKey(call);
      const cached = cache.get(key);
      if (cached === undefined) {
        const result = await runToolSafely(call.name, call.args);
        cache.set(key, result);
        results.push(result);
      }
      // A repeat is not pushed again: the channel would otherwise carry the
      // same result three times and spend the context window saying it.
      continue;
    }

    // From here the round produced an answer, or something that must not be
    // rendered as one.

    if (opensWithBrace(raw)) {
      // Either a fragment, or a tool call in the forced round. Both are
      // discarded, and neither is ever rendered as prose.
      return { kind: "card", reason: "fragment", results };
    }

    if (raw.trim().length === 0) {
      return { kind: "card", reason: "empty", results };
    }

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

  // Unreachable: the forced round always returns. Kept because a loop that can
  // fall out of its own bottom should say what that would mean.
  return { kind: "card", reason: "empty", results };
}
