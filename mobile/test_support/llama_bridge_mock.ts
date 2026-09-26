// mobile/test_support/llama_bridge_mock.ts
//
// A SCRIPTED ACTOR, NOT A DECODER. Spec §5.3. It lets the narration round,
// grounding, the output guard and every degradation path be tested with ZERO
// inference.
//
// THREE DECISIONS, EACH WITH ITS REASON:
//
//   1. IT EMITS TOKEN BY TOKEN, never a resolved whole string. "Half the
//      surface's bugs live in streaming: a partial JSON object rendering as
//      prose before its closing brace, a cancel landing mid-token, a `<think>`
//      tag split across two tokens. A fake that resolves whole strings tests
//      none of them." `perTokenDelayMs` defaults to 0 so the suite stays fast;
//      the stall and cancel tests use fake timers.
//
//   2. `emitRaw` EXISTS SO MALFORMED OUTPUT HAS DEFINED BEHAVIOUR. Since spec
//      §7.4 no grammar is sent at all, so nothing stops the model writing JSON
//      where a sentence belongs. `emitRaw` passes the string through UNTOUCHED,
//      leading space included, because `dispatch.ts` must judge raw output: a
//      leading space is invisible after `.trim()`.
//
//   3. IT RECORDS AND DOES NOT ENFORCE. `bridgeCalls()` gives the ordered log so
//      the one-model-resident invariant (unload before the second load) can be
//      asserted against the REAL bridge once `modules/llama_bridge/index.ts`
//      exists. If this fake auto-unloaded, that test would be testing this file.
//
// NOT YET WIRED THROUGH `moduleNameMapper`. Spec §5.3 wants `^llama\.rn$`
// mapped here so no test can accidentally load real inference in CI. That
// mapping belongs with plan Task 12, which is the module that actually imports
// `llama.rn` and binds its real surface: mapping the package name to this
// bridge-shaped fake before then would hand Task 12 a module of the wrong shape
// and look like a working wire-up. Until then `llama.rn` is not installed and
// the risk it guards against does not exist. Consumers take the bridge through
// their deps bag instead.
import type { GenerateHandle, LlamaBridge, LoadOptions } from "@/modules/llama_bridge/types";

export type ScriptedTurn =
  /** Prose, split into tokens. */
  | { emit: string; perTokenDelayMs?: number }
  /** Deliberately malformed output, passed through byte for byte. */
  | { emitRaw: string }
  /** No tokens for n ms. */
  | { stall: number }
  /** A native failure mid-stream, after n tokens. */
  | { throwAfter: number };

let script: ScriptedTurn[] = [];
let generateCalls = 0;
let lastPrompt = "";
let lastSystemPrompt: string | null = null;
let loads: { path: string; opts: LoadOptions }[] = [];
let calls: string[] = [];
let loaded = false;

export function scriptLlama(turns: ScriptedTurn[]): void {
  script = [...turns];
}

export function lastPromptGiven(): string {
  return lastPrompt;
}

/** The system prompt the last `generate` was given, or null when it used the default. */
export function lastSystemPromptGiven(): string | null {
  return lastSystemPrompt;
}

export function generateCallCount(): number {
  return generateCalls;
}

export function loadCalls(): { path: string; opts: LoadOptions }[] {
  return [...loads];
}

/**
 * The ordered log of every bridge call, as `load:<path>`, `unload`,
 * `resetContext`. An extension beyond spec §5.3's listed surface: `loadCalls()`
 * alone cannot show that an `unload` sat BETWEEN two loads, which is the whole
 * of the one-model-resident invariant.
 */
export function bridgeCalls(): string[] {
  return [...calls];
}

export function resetLlamaScript(): void {
  script = [];
  generateCalls = 0;
  lastPrompt = "";
  lastSystemPrompt = null;
  loads = [];
  calls = [];
  loaded = false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Prose splits on whitespace, keeping it, the way a decoder's pieces arrive. */
function proseTokens(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

/**
 * Raw output splits on a fixed width rather than on whitespace: JSON has none,
 * and the bug worth reproducing is a consumer rendering `{"tool":"get_wal` as
 * prose before the closing brace ever arrives.
 */
function chunk(text: string, width: number): string[] {
  const pieces: string[] = [];
  for (let index = 0; index < text.length; index += width) {
    pieces.push(text.slice(index, index + width));
  }
  return pieces;
}

function tokensFor(turn: ScriptedTurn): string[] {
  if ("emit" in turn) return proseTokens(turn.emit);
  if ("emitRaw" in turn) return chunk(turn.emitRaw, 8);
  return [];
}

function generate(prompt: string, systemPrompt?: string): GenerateHandle {
  const shifted = script.shift();
  if (shifted === undefined) {
    // Loud, because silence is a real branch in dispatch ("the model had
    // nothing to say") and an unscripted call must never impersonate it.
    throw new Error("llama_bridge_mock: generate() called with an empty script");
  }
  // Re-bound after the guard: the narrowing does not survive into the
  // generator closure below, and `turn!` would hide a real mistake later.
  const turn: ScriptedTurn = shifted;

  generateCalls += 1;
  lastPrompt = prompt;
  lastSystemPrompt = systemPrompt ?? null;

  let cancelled = false;

  async function* stream(): AsyncGenerator<string> {
    if ("stall" in turn) {
      await delay(turn.stall);
      return;
    }

    if ("throwAfter" in turn) {
      for (let index = 0; index < turn.throwAfter; index += 1) {
        if (cancelled) return;
        yield `tok${index} `;
      }
      throw new Error("llama_bridge_mock: scripted native failure mid-stream");
    }

    const perTokenDelayMs = "emit" in turn ? (turn.perTokenDelayMs ?? 0) : 0;
    for (const token of tokensFor(turn)) {
      if (cancelled) return;
      if (perTokenDelayMs > 0) await delay(perTokenDelayMs);
      yield token;
    }
  }

  return {
    tokens: stream(),
    cancel: () => {
      cancelled = true;
    },
  };
}

/** The fake, shaped exactly like the real boundary. */
export const fakeLlamaBridge: LlamaBridge = {
  async load(modelPath: string, opts: LoadOptions): Promise<void> {
    loads.push({ path: modelPath, opts });
    calls.push(`load:${modelPath}`);
    loaded = true;
  },
  generate,
  /** Four characters to a token, the same stand-in ratio as `llama_rn_mock.ts`. */
  async countTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  },
  async resetContext(): Promise<void> {
    // Records only. The weights stay resident — that is the point of §4.5's
    // distinction and the reason re-entry after unlock is fast.
    calls.push("resetContext");
  },
  async unload(): Promise<void> {
    calls.push("unload");
    loaded = false;
  },
  isLoaded(): boolean {
    return loaded;
  },
};
