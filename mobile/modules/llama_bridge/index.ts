// mobile/modules/llama_bridge/index.ts
//
// THE ONE MODULE THAT IMPORTS `llama.rn`. Everything above the boundary talks
// to `types.ts` instead, which is why `dispatch.ts`, `session.ts` and their
// tests run with no native artefacts anywhere near them.
//
// GENERATION NEVER GOES THROUGH THIS MODULE'S OWN KOTLIN. Spec §1.1: `llama.rn`
// already ships its own JNI layer and decodes on a native thread. Wrapping it
// in a second Kotlin module would add a bridge hop per token, pure overhead for
// pure risk at 4-8 tok/s, and duplicate threading logic that already exists.
// The Kotlin this module does have only hashes downloaded models (spec §6 risk
// 8), and `digest.ts` is its JS side. Autolinking builds that Kotlin but never
// runs a config plugin, so the plugin is registered by path in `app.json`.
//
// WHY THE SYSTEM PROMPT IS IMPORTED HERE AND NOWHERE ELSE. `prompt.ts` builds
// the TURN and says so: "the system prompt is passed separately by the bridge
// so that the two can never be accidentally welded together". Sending it as its
// own `messages` entry rather than concatenating it onto the turn is also what
// makes §3.2's injection compartment structural — tool data can only ever
// arrive inside the user message — and it is the only way `enable_thinking`
// reaches the chat template at all, since that flag is a jinja argument and is
// silently ignored when a raw `prompt` string is passed instead of `messages`.
import { initLlama, type LlamaContext, type TokenData } from "llama.rn";

import { SYSTEM_PROMPT } from "@/lib/ai/prompt";

import type { GenerateHandle, LlamaBridge, LoadOptions } from "./types";

/**
 * ONE SEQUENCE, NOT `llama.rn`'s DEFAULT OF EIGHT.
 *
 * `n_parallel` sets `n_seq_max`, and llama.cpp sizes the KV cache for that many
 * sequences. Every `minRamBytes` in `catalogue.ts` was derived from a
 * single-conversation measurement, and this surface holds exactly one
 * conversation, so eight slots would multiply the one allocation the RAM gate
 * is calibrated against.
 */
const PARALLEL_SEQUENCES = 1;

/**
 * A CEILING, NOT A TARGET.
 *
 * An unconstrained round has no structural stopping point, so without a cap it
 * decodes until the context window fills. At tier 2's measured 11.45 tok/s a
 * full 2048-token window is roughly three minutes of a user watching tokens
 * arrive for an answer the system prompt asked to be one or two sentences long.
 */
const MAX_RESPONSE_TOKENS = 256;

/**
 * THE RESIDENT MODEL. Module scope is what "one model resident at a time"
 * means: a second `load` releases this before initialising the next.
 */
let context: LlamaContext | null = null;

/**
 * PER-LOAD, NOT A MODULE-LEVEL POLICY. Hybrid-thinking Qwen3 needs suppressing
 * and the 2507 instruct refreshes must not be told to think at all, so this is
 * data that arrives with the model and is replaced whenever the model is.
 */
let suppressThinking = false;

export async function load(modelPath: string, opts: LoadOptions): Promise<void> {
  // BEFORE, never after. A release that lands after the next init leaves both
  // models momentarily resident, which on a 6 GB phone is the kill the RAM gate
  // exists to avoid.
  await unload();

  context = await initLlama({
    model: modelPath,
    n_ctx: opts.contextTokens,
    n_parallel: PARALLEL_SEQUENCES,
  });
  suppressThinking = opts.suppressThinking;
}

export function generate(prompt: string, grammar: string | null): GenerateHandle {
  const resident = context;
  if (!resident) {
    // Loud rather than an empty stream: "no model loaded" and "the model had
    // nothing to say" are different states and dispatch treats them differently.
    throw new Error("llama_bridge: generate() called with no model loaded");
  }

  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  let failure: unknown = null;
  let cancelled = false;

  /** Wakes a consumer parked on the empty queue, if there is one. */
  function nudge(): void {
    const waiting = wake;
    wake = null;
    waiting?.();
  }

  resident
    .completion(
      {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        // Without jinja the chat template is never applied, and
        // `enable_thinking` — a template argument — is silently ignored.
        jinja: true,
        // ONLY EVER SUPPRESSED, never asserted. Passing `true` to a 2507
        // instruct template tells a model that does not think to start.
        ...(suppressThinking ? { enable_thinking: false } : {}),
        // An empty string would still be a grammar, and llama.cpp would try to
        // parse it. `null` means the forced-answer round, which runs
        // unconstrained on purpose.
        ...(grammar === null ? {} : { grammar }),
        n_predict: MAX_RESPONSE_TOKENS,
      },
      (data: TokenData) => {
        if (cancelled || !data.token) return;
        queue.push(data.token);
        nudge();
      },
    )
    .then(() => {
      done = true;
      nudge();
    })
    .catch((error: unknown) => {
      failure = error;
      done = true;
      nudge();
    });

  async function* stream(): AsyncGenerator<string> {
    for (;;) {
      while (queue.length > 0) {
        if (cancelled) return;
        yield queue.shift() as string;
      }
      if (done) {
        // Re-thrown rather than swallowed: a native failure that ends the
        // stream quietly hands the surface a short, clean-looking answer that
        // silently lost its ending.
        if (failure) throw failure;
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }

  return {
    tokens: stream(),
    cancel: () => {
      cancelled = true;
      // Telling the decoder, not only the iterable. A stream the consumer stops
      // reading leaves llama.cpp decoding tokens nobody will ever see, on
      // battery, for as long as the token cap allows.
      void resident.stopCompletion();
      nudge();
    },
  };
}

export async function resetContext(): Promise<void> {
  // `clearData: true`. The cheaper call drops only the cache metadata and
  // leaves the conversation's tensor data in the buffer — exactly what §4.5
  // requires gone when the ledger is sealed. The weights stay resident, which
  // is what makes re-entry after unlock fast instead of a multi-second reload.
  await context?.clearCache(true);
}

export async function unload(): Promise<void> {
  const resident = context;
  if (!resident) return;
  // Cleared FIRST, so a `release()` that rejects cannot leave a dead context
  // behind that `isLoaded()` still reports as usable.
  context = null;
  suppressThinking = false;
  await resident.release();
}

export function isLoaded(): boolean {
  return context !== null;
}

/**
 * The same surface as a value, because `dispatch.ts` and `session.ts` take the
 * bridge through a deps bag rather than importing it — which is what lets every
 * module above the boundary be tested against `llama_bridge_mock.ts`.
 */
export const llamaBridge: LlamaBridge = {
  load,
  generate,
  resetContext,
  unload,
  isLoaded,
};
