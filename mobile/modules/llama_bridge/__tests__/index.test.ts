// mobile/modules/llama_bridge/__tests__/index.test.ts
//
// Plan Task 12 — the one module that binds the real `llama.rn` surface.
//
// WHAT THESE TESTS CAN AND CANNOT PROVE. They drive `index.ts` against
// `test_support/llama_rn_mock.ts`, which is shaped like `llama.rn` and records
// every runtime call in order. That pins the BINDING: which runtime call each
// boundary method makes, in what order, with what parameters. It cannot prove
// that llama.cpp honours those parameters — that a GBNF string actually
// constrains decoding, that `enable_thinking: false` actually suppresses
// `<think>`, that one model resident actually fits in RAM. Those are spec
// §5.6's on-device gates and no unit test can stand in for them.
//
// THE MODULE REGISTRY IS RESET PER TEST. `index.ts` holds the resident context
// in module scope — that is what "one model resident" means — so a test that
// left a model loaded would decide the next test's answer to `isLoaded()`.
import { SYSTEM_PROMPT } from "@/lib/ai/prompt";

type BridgeModule = typeof import("../index");
type RuntimeMock = typeof import("@/test_support/llama_rn_mock");

const TIER_1_PATH = "/data/user/0/com.filldev.peraplano/files/models/qwen3-0.6b-q4.gguf";
const TIER_2_PATH = "/data/user/0/com.filldev.peraplano/files/models/qwen3-1.7b-q4.gguf";

/** The value every RAM measurement behind `catalogue.ts` was taken at. */
const CONTEXT_TOKENS = 2048;

let bridge: BridgeModule;
let runtime: RuntimeMock;

beforeEach(() => {
  jest.resetModules();
  runtime = require("@/test_support/llama_rn_mock") as RuntimeMock;
  bridge = require("../index") as BridgeModule;
  runtime.resetLlamaRuntime();
});

async function drain(tokens: AsyncIterable<string>): Promise<string[]> {
  const collected: string[] = [];
  for await (const token of tokens) collected.push(token);
  return collected;
}

describe("llama_bridge — residency", () => {
  it("reports no model loaded before any load", () => {
    expect(bridge.isLoaded()).toBe(false);
  });

  it("reports a model loaded after load, and none after unload", async () => {
    await bridge.load(TIER_1_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });
    expect(bridge.isLoaded()).toBe(true);

    await bridge.unload();
    expect(bridge.isLoaded()).toBe(false);
  });

  it("releases the resident model BEFORE initialising the next one", async () => {
    await bridge.load(TIER_1_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });
    await bridge.load(TIER_2_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });

    // Asserted as the whole ordered log, not as "release was called": a release
    // that lands AFTER the second init means both models are momentarily
    // resident, which on a 6 GB phone is the kill the RAM gate exists to avoid.
    expect(runtime.llamaRuntimeCalls()).toEqual([
      `init:${TIER_1_PATH}`,
      "release",
      `init:${TIER_2_PATH}`,
    ]);
  });

  it("pins n_ctx to the requested context window and n_parallel to one", async () => {
    await bridge.load(TIER_2_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });

    const [params] = runtime.initCalls();
    expect(params.model).toBe(TIER_2_PATH);
    expect(params.n_ctx).toBe(CONTEXT_TOKENS);
    // llama.rn defaults n_parallel to 8, which sizes the KV cache for eight
    // sequences. Every `minRamBytes` in `catalogue.ts` was derived from a
    // single-sequence measurement.
    expect(params.n_parallel).toBe(1);
  });
});

describe("llama_bridge — thinking suppression", () => {
  it("suppresses thinking per load rather than as a module-level flag", async () => {
    await bridge.load(TIER_2_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });
    runtime.scriptLlamaTokens([["a"], ["b"]]);
    await drain(bridge.generate("first").tokens);

    await bridge.load(TIER_1_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: false });
    await drain(bridge.generate("second").tokens);

    const [suppressed, unsuppressed] = runtime.completionCalls();
    expect(suppressed.enable_thinking).toBe(false);
    // ABSENT, not `true`. The 2507 instruct refreshes do not think and must not
    // be told to; this boundary only ever suppresses.
    expect(unsuppressed).not.toHaveProperty("enable_thinking");
  });

  it("sends the system prompt as its own message rather than welded to the turn", async () => {
    await bridge.load(TIER_2_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });
    runtime.scriptLlamaTokens([["ok"]]);

    await drain(bridge.generate("User: how much did I spend?").tokens);

    const [params] = runtime.completionCalls();
    // Two roles, never one concatenated string: the compartment in §3.2's
    // injection argument is the message boundary itself.
    expect(params.messages).toEqual([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "User: how much did I spend?" },
    ]);
    // `enable_thinking` is a chat-template argument; without jinja the template
    // is never applied and the flag is silently ignored.
    expect(params.jinja).toBe(true);
  });

  it("sends a free-chat level's system prompt in place of the default when one is given", async () => {
    await bridge.load(TIER_2_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });
    runtime.scriptLlamaTokens([["ok"]]);

    await drain(bridge.generate("User: hi", "LEVEL 3 PROMPT").tokens);

    const [params] = runtime.completionCalls();
    expect(params.messages).toEqual([
      { role: "system", content: "LEVEL 3 PROMPT" },
      { role: "user", content: "User: hi" },
    ]);
  });
});

describe("llama_bridge — generation", () => {
  it("streams tokens one at a time rather than resolving a whole string", async () => {
    await bridge.load(TIER_1_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });
    runtime.scriptLlamaTokens([["You ", "spent ", "₱2,400.00"]]);

    const seen: string[] = [];
    for await (const token of bridge.generate("q").tokens) seen.push(token);

    expect(seen).toEqual(["You ", "spent ", "₱2,400.00"]);
  });

  it("never sends a grammar: the model only narrates", async () => {
    await bridge.load(TIER_1_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });
    runtime.scriptLlamaTokens([["x"]]);

    await drain(bridge.generate("q").tokens);

    // Spec §7.4: there is no tool call left for a grammar to shape. An
    // empty-string grammar would still be a grammar, and llama.cpp would try to
    // parse it, so the key must be absent rather than empty.
    const [call] = runtime.completionCalls();
    expect(call).not.toHaveProperty("grammar");
  });

  it("stops the iterable and the decoder when cancelled mid-stream", async () => {
    await bridge.load(TIER_1_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });
    runtime.scriptLlamaTokens([["one ", "two ", "three ", "four ", "five"]]);

    const handle = bridge.generate("q");
    const seen: string[] = [];
    for await (const token of handle.tokens) {
      seen.push(token);
      if (seen.length === 2) handle.cancel();
    }

    expect(seen).toEqual(["one ", "two "]);
    // Not just an iterable that stopped yielding: the native decoder has to be
    // told, or it keeps burning battery producing tokens nobody will read.
    expect(runtime.llamaRuntimeCalls()).toContain("stopCompletion");
  });

  it("re-throws a native failure that lands mid-stream", async () => {
    await bridge.load(TIER_1_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });
    runtime.scriptLlamaTokens([["one ", "two ", "three "]]);
    runtime.failNextCompletionAfter(2);

    const handle = bridge.generate("q");
    // Swallowing it would hand the surface a short, clean-looking answer that
    // silently lost its ending.
    await expect(drain(handle.tokens)).rejects.toThrow(/scripted native failure/);
  });

  it("refuses to generate with no model resident", async () => {
    expect(() => bridge.generate("q")).toThrow(/no model/i);
  });
});

describe("llama_bridge — context reset", () => {
  it("clears the conversation without unloading the weights", async () => {
    await bridge.load(TIER_2_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });

    await bridge.resetContext();

    expect(bridge.isLoaded()).toBe(true);
    // `clearData: true`. The cheaper call drops only the cache metadata and
    // leaves the conversation's tensor data in the buffer — which is exactly
    // what §4.5 requires gone when a ledger is sealed.
    expect(runtime.llamaRuntimeCalls()).toEqual([`init:${TIER_2_PATH}`, "clearCache:true"]);
  });

  it("is a no-op rather than a crash when nothing is loaded", async () => {
    await expect(bridge.resetContext()).resolves.toBeUndefined();
    await expect(bridge.unload()).resolves.toBeUndefined();
    expect(runtime.llamaRuntimeCalls()).toEqual([]);
  });
});

describe("llama_bridge: token counting", () => {
  it("counts with the resident model's own tokenizer", async () => {
    await bridge.load(TIER_1_PATH, { contextTokens: CONTEXT_TOKENS, suppressThinking: true });

    // The runtime fake makes four characters one token.
    await expect(bridge.countTokens("12345678")).resolves.toBe(2);
    expect(runtime.llamaRuntimeCalls()).toContain("tokenize");
  });

  it("refuses to count with no model resident", async () => {
    await expect(bridge.countTokens("x")).rejects.toThrow(/no model/i);
  });
});

describe("llama_bridge — the exported value", () => {
  it("satisfies the LlamaBridge contract the rest of the app injects", () => {
    // `dispatch.ts` and `session.ts` take the bridge through a deps bag, so the
    // module has to be usable as a VALUE and not only as named exports.
    expect(typeof bridge.llamaBridge.load).toBe("function");
    expect(typeof bridge.llamaBridge.generate).toBe("function");
    expect(typeof bridge.llamaBridge.resetContext).toBe("function");
    expect(typeof bridge.llamaBridge.unload).toBe("function");
    expect(typeof bridge.llamaBridge.isLoaded).toBe("function");
    expect(typeof bridge.llamaBridge.countTokens).toBe("function");
  });
});
