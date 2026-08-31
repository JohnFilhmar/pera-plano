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
 * `grammar` is `null` for an unconstrained round.
 *
 * That is not an oversight, it is the spike's finding: GBNF compels a format
 * and cannot forbid one, so the forced-answer round runs with no grammar at all
 * and `dispatch.ts` refuses to act on a tool call in that round. See
 * `lib/ai/tools/grammar.ts`.
 */
export type LlamaBridge = {
  load(modelPath: string, opts: LoadOptions): Promise<void>;
  generate(prompt: string, grammar: string | null): GenerateHandle;
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
