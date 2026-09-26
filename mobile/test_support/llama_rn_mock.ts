// mobile/test_support/llama_rn_mock.ts
//
// A FAKE OF `llama.rn` ITSELF, not of our bridge. Spec §5.3 wants `^llama\.rn$`
// mapped away in CI so no test can accidentally load real inference; this is
// what it is mapped to.
//
// WHY THIS FILE EXISTS SEPARATELY FROM `llama_bridge_mock.ts`. That file fakes
// OUR boundary — `load`/`generate`/`unload` — and is what everything above the
// boundary is tested against. Mapping the package name to it would hand
// `modules/llama_bridge/index.ts` a module of the wrong shape: `index.ts` is
// the one module that binds the REAL `llama.rn` surface (`initLlama`, a
// context object with `completion`/`stopCompletion`/`clearCache`/`release`),
// and a fake that does not have that shape cannot prove the binding is right
// while looking exactly like a working wire-up.
//
// IT RECORDS AND DOES NOT ENFORCE, for the same reason `llama_bridge_mock.ts`
// does: the one-model-resident invariant is a claim about `index.ts`. If this
// fake released the previous context by itself, the test asserting the release
// lands BEFORE the next init would be testing this file instead.
//
// THE CALLBACK IS ASYNCHRONOUS ON PURPOSE. Real `completion()` fires its token
// callback as the decoder produces pieces and resolves its promise only at the
// end. A fake that emitted every token synchronously before returning would
// let a bridge that buffers the whole string pass a streaming test.

/** The subset of `ContextParams` this app actually sets. */
export type FakeInitParams = {
  model: string;
  n_ctx?: number;
  n_parallel?: number;
  [key: string]: unknown;
};

/** The subset of `CompletionParams` this app actually sets. */
export type FakeCompletionParams = {
  messages?: { role: string; content?: string }[];
  prompt?: string;
  jinja?: boolean;
  enable_thinking?: boolean;
  grammar?: string;
  n_predict?: number;
  [key: string]: unknown;
};

export type FakeTokenData = { token: string };

/**
 * Per-`completion()` token scripts, consumed in order. An exhausted script is
 * an empty generation rather than an error: a bridge test that only cares
 * about load/release ordering should not have to script tokens it never reads.
 */
let tokenScripts: string[][] = [];
let initParamsLog: FakeInitParams[] = [];
let completionParamsLog: FakeCompletionParams[] = [];
let calls: string[] = [];
let nextContextId = 1;
/**
 * Set by `failNextCompletion()`. Modelled as a native rejection AFTER some
 * tokens, because that is the shape the real failure takes and the shape the
 * bridge's iterable has to re-throw rather than silently end on.
 */
let failCompletionAfter: number | null = null;

export function scriptLlamaTokens(scripts: string[][]): void {
  tokenScripts = scripts.map((script) => [...script]);
}

export function failNextCompletionAfter(tokens: number): void {
  failCompletionAfter = tokens;
}

/**
 * The ordered log of every runtime call, as `init:<path>`, `release`,
 * `clearCache:<clearData>`, `completion`, `stopCompletion`.
 *
 * Ordered rather than counted: `initCalls().length` cannot show that a
 * `release` sat BETWEEN two inits, which is the whole of the one-model-resident
 * invariant.
 */
export function llamaRuntimeCalls(): string[] {
  return [...calls];
}

export function initCalls(): FakeInitParams[] {
  return [...initParamsLog];
}

export function completionCalls(): FakeCompletionParams[] {
  return [...completionParamsLog];
}

export function resetLlamaRuntime(): void {
  tokenScripts = [];
  initParamsLog = [];
  completionParamsLog = [];
  calls = [];
  nextContextId = 1;
  failCompletionAfter = null;
}

/** Yields to the microtask queue between tokens. See the header note. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

class FakeLlamaContext {
  id: number;

  private stopped = false;

  constructor(id: number) {
    this.id = id;
  }

  async completion(
    params: FakeCompletionParams,
    callback?: (data: FakeTokenData) => void,
  ): Promise<{ text: string }> {
    completionParamsLog.push(params);
    calls.push("completion");
    this.stopped = false;

    const script = tokenScripts.shift() ?? [];
    const failAfter = failCompletionAfter;
    failCompletionAfter = null;

    let emitted = 0;
    let text = "";

    for (const token of script) {
      await tick();
      // `stopCompletion()` is what a cancel reaches; the real decoder stops
      // producing and the promise resolves with whatever it had.
      if (this.stopped) break;
      if (failAfter !== null && emitted === failAfter) {
        throw new Error("llama_rn_mock: scripted native failure mid-completion");
      }
      callback?.({ token });
      text += token;
      emitted += 1;
    }

    if (failAfter !== null && !this.stopped && emitted === failAfter) {
      throw new Error("llama_rn_mock: scripted native failure mid-completion");
    }

    return { text };
  }

  async stopCompletion(): Promise<void> {
    calls.push("stopCompletion");
    this.stopped = true;
  }

  async clearCache(clearData?: boolean): Promise<void> {
    calls.push(`clearCache:${String(clearData)}`);
  }

  async release(): Promise<void> {
    calls.push("release");
  }

  /**
   * Four characters to a token. A stand-in ratio, not a vocabulary: the bridge
   * only passes the count through, so the number just has to be deterministic.
   */
  async tokenize(text: string): Promise<{ tokens: number[] }> {
    calls.push("tokenize");
    return { tokens: Array.from({ length: Math.ceil(text.length / 4) }, (_, index) => index) };
  }
}

export async function initLlama(params: FakeInitParams): Promise<FakeLlamaContext> {
  initParamsLog.push(params);
  calls.push(`init:${params.model}`);
  const context = new FakeLlamaContext(nextContextId);
  nextContextId += 1;
  return context;
}

export async function releaseAllLlama(): Promise<void> {
  calls.push("releaseAllLlama");
}
