// mobile/test_support/llama_bridge_mock.ts
//
// A SCRIPTED ACTOR, NOT A CONSTRAINED DECODER. Spec §5.3. It lets the entire
// dispatch loop — the round cap, the turn cache, grounding, the output guard
// and every degradation path — be tested with ZERO inference.
//
// FOUR DECISIONS, EACH WITH ITS REASON:
//
//   1. IT EMITS TOKEN BY TOKEN, never a resolved whole string. "Half the
//      surface's bugs live in streaming: a partial tool call rendering as prose
//      before its closing brace, a cancel landing mid-token, a `<think>` tag
//      split across two tokens. A fake that resolves whole strings tests none
//      of them." `perTokenDelayMs` defaults to 0 so the suite stays fast; the
//      stall and cancel tests use fake timers.
//
//   2. IT DOES NOT VALIDATE AGAINST THE GRAMMAR. It RECORDS the grammar so a
//      test can assert the right one was passed — including `null` for the
//      forced-answer round, which is how that round is proved unconstrained.
//      Proving a grammar constrains anything is llama.cpp's job (§5.6), not a
//      claim any fake can make.
//
//   3. `emitRaw` EXISTS SO MALFORMED OUTPUT HAS DEFINED BEHAVIOUR. "GBNF makes
//      malformed output impossible" is a claim about the real decoder. The loop
//      still needs a specified response if it ever sees garbage — a grammar
//      bug, or a future backend with no grammar support at all. It passes the
//      string through UNTOUCHED, leading space included, because the spike
//      measured a leading space smuggling a tool call past a grammar that
//      forbade one, and `dispatch.ts` must parse raw output to catch it.
//
//   4. IT RECORDS AND DOES NOT ENFORCE. `bridgeCalls()` gives the ordered log so
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
  /** Serialised exactly as `grammar.ts` compels the real decoder to emit it. */
  | { emitToolCall: { name: string; args: unknown } }
  /** Deliberately malformed output, passed through byte for byte. */
  | { emitRaw: string }
  /** No tokens for n ms. */
  | { stall: number }
  /** A native failure mid-stream, after n tokens. */
  | { throwAfter: number };

let script: ScriptedTurn[] = [];
let generateCalls = 0;
let lastPrompt = "";
let lastGrammar: string | null = null;
let loads: { path: string; opts: LoadOptions }[] = [];
let calls: string[] = [];
let loaded = false;

export function scriptLlama(turns: ScriptedTurn[]): void {
  script = [...turns];
}

export function lastPromptGiven(): string {
  return lastPrompt;
}

export function lastGrammarGiven(): string | null {
  return lastGrammar;
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
  lastGrammar = null;
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
 * A tool call splits on a fixed width rather than on whitespace: it contains
 * none, and the bug worth reproducing is a consumer rendering `{"tool":"get_wal`
 * as prose before the closing brace ever arrives.
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
  if ("emitToolCall" in turn) {
    // Key order matters: this is the shape `grammar.ts` compels.
    const serialised = JSON.stringify({ tool: turn.emitToolCall.name, args: turn.emitToolCall.args });
    return chunk(serialised, 8);
  }
  return [];
}

function generate(prompt: string, grammar: string | null): GenerateHandle {
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
  lastGrammar = grammar;

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
