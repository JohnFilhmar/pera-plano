// mobile/modules/llama_bridge/types.ts
//
// THE BOUNDARY, AS TYPES. Spec §1.1's surface and nothing more.
//
// This file exists SEPARATELY FROM `index.ts` so that everything above the
// boundary — `dispatch.ts`, `session.ts`, the fake bridge, their tests — can be
// written and run against the contract without dragging in `llama.rn` and its
// native artefacts. `index.ts` (plan Task 12) is the one module that imports
// `llama.rn`, and it satisfies `LlamaBridge` below.
//
// THREE THINGS THIS BOUNDARY MUST NOT DO, each one a boundary the design rests
// on (spec §1.2 boundary 1):
//
//   - No import from `lib/db`, `types/domain`, or any service. It takes a path
//     and a string and returns tokens.
//   - `tokens` is an `AsyncIterable<string>`, NEVER a resolved whole string.
//     The surface streams, the round cap counts, and cancellation has to be
//     able to land mid-sentence.
//   - ONE MODEL RESIDENT AT A TIME. Activating a different tier unloads the
//     current one first. A second model may be DOWNLOADED while one is active —
//     that is disk, not RAM — but never loaded alongside.

export type LoadOptions = {
  /**
   * Every RAM measurement behind `catalogue.ts`'s `minRamBytes` was taken at
   * 2048. The KV cache grows with this number, so raising it invalidates the
   * RAM gate that stops Android killing the app mid-answer.
   */
  contextTokens: number;
  /**
   * PER-MODEL DATA, NOT A GLOBAL FLAG. Hybrid-thinking Qwen3 emits
   * `<think>…</think>` unless suppressed; the 2507 instruct refreshes do not
   * think and must not be told to. The spike measured an unsuppressed tier 2
   * spending its entire 64-token budget inside `<think>` and never reaching a
   * word of answer — 11,086 ms against 739 ms suppressed.
   */
  suppressThinking: boolean;
};

export type GenerateHandle = {
  tokens: AsyncIterable<string>;
  /**
   * Cancellation must leave NO assistant message. A half-finished sentence
   * about money is precisely the confidently-wrong artefact this design exists
   * to prevent.
   */
  cancel(): void;
};

/**
 * A CEILING, NOT A TARGET, and shared across the boundary because
 * `lib/ai/promptBudget.ts` reserves exactly this much of the context for the
 * reply before fitting anything else into it. At tier 2's measured 11.45 tok/s
 * an uncapped round could decode for minutes toward a full 2,048-token window.
 */
export const MAX_RESPONSE_TOKENS = 256;

/**
 * The whole native surface the assistant needs.
 *
 * `generate` takes no grammar. Since spec §7.4 (2026-09-25) the model only
 * narrates a result the app already fetched, so there is no tool call for a
 * grammar to shape, and the spike measured that a grammar cannot forbid a
 * format anyway.
 */
export type LlamaBridge = {
  load(modelPath: string, opts: LoadOptions): Promise<void>;
  /**
   * @param systemPrompt - Omitted for chip narration, which uses `SYSTEM_PROMPT`.
   *   Free chat passes its level's prompt (assistant levels spec §4.2). Either
   *   way it travels as its own message, never welded onto the turn.
   */
  generate(prompt: string, systemPrompt?: string): GenerateHandle;
  /**
   * How many tokens the resident model's own tokenizer makes of `text`, so a
   * free-chat prompt is fitted to the context by count rather than estimate.
   */
  countTokens(text: string): Promise<number>;
  /**
   * Drops the conversation, keeps the weights.
   *
   * `resetContext()`, NOT `unload()` — spec §4.5. The KV cache holds the
   * conversation and must go; the weights are public and can stay resident,
   * which is what makes re-entry after unlock fast instead of a multi-second
   * reload. "Clean it all up" is the natural instinct and it is wrong.
   */
  resetContext(): Promise<void>;
  unload(): Promise<void>;
  isLoaded(): boolean;
};
