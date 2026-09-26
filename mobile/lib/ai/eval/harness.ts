// mobile/lib/ai/eval/harness.ts
//
// WHAT THE EVAL SCREEN RUNS AGAINST, registered by the assistant screen when it
// loads a model. It lives here rather than in the eval route because two routes
// need it, and a route importing a route is the wrong direction for a shared
// piece (see `app/(tabs)/more/ai/models.tsx`).
//
// Module-scoped rather than a context for the same reason `lib/ai/session.ts`
// is: assistant state must never reach react-query, which is persisted to disk.
import type { EvalDeps } from "@/lib/ai/eval_runner";
import type { LlamaBridge, LoadOptions } from "@/modules/llama_bridge/types";

/**
 * Everything the run needs that the eval screen must not construct for itself.
 *
 * The bridge is native inference and the tool runner is the fixture-backed
 * handler set. A screen that reached for either directly would drag `llama.rn`
 * into every render test in the app, and would put the eval one import away
 * from the user's real ledger.
 */
export type EvalHarness = {
  bridge: LlamaBridge;
  runTool: EvalDeps["runTool"];
  /** Peak RSS in bytes, sampled once per question. 0 means it could not be read. */
  readResidentBytes: () => number;
  /**
   * The resident model and the options it was loaded with. `id` goes on every
   * `[ai_eval]` line; `path` and `options` let a development build load it
   * again with thinking left on for one run, then put it back as it was.
   */
  model: { id: string; path: string; options: LoadOptions };
};

let harness: EvalHarness | null = null;

/**
 * Registers the harness for the model just loaded, or clears it.
 *
 * @param next - The loaded model's harness, or `null` when no model is loaded.
 *   `null` is the honest default: a phone with no model loaded can offer no
 *   measurement, and the eval screen says so rather than rendering an empty
 *   report.
 */
export function configureAiEval(next: EvalHarness | null): void {
  harness = next;
}

/**
 * The harness registered by the last model load.
 *
 * @returns The harness, or `null` while no model is loaded.
 */
export function currentAiEval(): EvalHarness | null {
  return harness;
}
