// mobile/test_support/__tests__/llama_bridge_mock.test.ts
//
// A MOCK WITH NO TEST IS A SECOND UNTESTED IMPLEMENTATION, and this one is
// load-bearing: every claim `dispatch.ts`'s suite makes about streaming, the
// round cap and cancellation is really a claim about this file behaving the way
// a decoder does. If the fake resolves whole strings, or forgets a token, the
// dispatch suite goes green while the real surface is broken.
import {
  generateCallCount,
  lastPromptGiven,
  loadCalls,
  resetLlamaScript,
  scriptLlama,
  bridgeCalls,
  fakeLlamaBridge,
} from "../llama_bridge_mock";

async function drain(handle: { tokens: AsyncIterable<string> }): Promise<string[]> {
  const tokens: string[] = [];
  for await (const token of handle.tokens) tokens.push(token);
  return tokens;
}

beforeEach(() => {
  resetLlamaScript();
});

describe("the queue", () => {
  test("one scripted turn is consumed per generate()", async () => {
    scriptLlama([{ emit: "first answer" }, { emit: "second answer" }]);

    expect((await drain(fakeLlamaBridge.generate("p1"))).join("")).toBe("first answer");
    expect((await drain(fakeLlamaBridge.generate("p2"))).join("")).toBe("second answer");
    expect(generateCallCount()).toBe(2);
  });

  test("generating with an empty script fails loudly rather than returning silence", () => {
    // Silence is indistinguishable from "the model had nothing to say", which
    // is a real branch in dispatch. A missing script must not impersonate it.
    expect(() => fakeLlamaBridge.generate("p")).toThrow(/script/i);
  });
});

describe("streaming", () => {
  test("emit arrives token by token, not as one resolved string", async () => {
    // "Half the surface's bugs live in streaming: a partial tool call rendering
    // as prose before its closing brace, a cancel landing mid-token."
    scriptLlama([{ emit: "You spent ₱2,400.00 today" }]);
    const tokens = await drain(fakeLlamaBridge.generate("p"));
    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens.join("")).toBe("You spent ₱2,400.00 today");
  });

  test("emitRaw passes the string through untouched, however malformed, split across tokens", async () => {
    scriptLlama([{ emitRaw: '{"tool":"get_wal' }]);
    const tokens = await drain(fakeLlamaBridge.generate("p"));
    expect(tokens.join("")).toBe('{"tool":"get_wal');
    // Split, so a consumer that renders before the closing brace is caught.
    expect(tokens.length).toBeGreaterThan(1);
  });

  test("a leading space survives, because dispatch must judge RAW output", async () => {
    // A leading space in front of JSON is invisible after `.trim()`. The fake
    // must be able to reproduce that exactly.
    scriptLlama([{ emitRaw: ' {"tool":"get_wallets","args":{}}' }]);
    const tokens = await drain(fakeLlamaBridge.generate("p"));
    expect(tokens.join("")).toBe(' {"tool":"get_wallets","args":{}}');
  });

  test("throwAfter emits its tokens and then fails mid-stream", async () => {
    scriptLlama([{ throwAfter: 3 }]);
    const handle = fakeLlamaBridge.generate("p");
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const token of handle.tokens) seen.push(token);
      })(),
    ).rejects.toThrow();
    expect(seen).toHaveLength(3);
  });
});

describe("stall, under fake timers", () => {
  test("a stalled turn yields nothing until time is advanced", async () => {
    jest.useFakeTimers();
    try {
      scriptLlama([{ stall: 5000 }]);
      const handle = fakeLlamaBridge.generate("p");
      let done = false;
      const drained = drain(handle).then(() => {
        done = true;
      });

      await Promise.resolve();
      expect(done).toBe(false);

      jest.advanceTimersByTime(5000);
      await drained;
      expect(done).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("cancellation", () => {
  test("cancel() stops the iterable", async () => {
    scriptLlama([{ emit: "one two three four five six seven eight" }]);
    const handle = fakeLlamaBridge.generate("p");

    const seen: string[] = [];
    for await (const token of handle.tokens) {
      seen.push(token);
      if (seen.length === 2) handle.cancel();
    }

    expect(seen).toHaveLength(2);
  });
});

describe("what the fake records", () => {
  test("the prompt of the most recent call", async () => {
    scriptLlama([{ emit: "a" }, { emit: "b" }]);
    await drain(fakeLlamaBridge.generate("first prompt"));
    expect(lastPromptGiven()).toBe("first prompt");

    await drain(fakeLlamaBridge.generate("second prompt"));
    expect(lastPromptGiven()).toBe("second prompt");
  });

  test("loads, with their per-load options", async () => {
    await fakeLlamaBridge.load("/models/tier1.gguf", {
      contextTokens: 2048,
      suppressThinking: true,
    });
    expect(loadCalls()).toEqual([
      { path: "/models/tier1.gguf", opts: { contextTokens: 2048, suppressThinking: true } },
    ]);
  });

  test("suppressThinking is per-load, not a module-level flag", async () => {
    await fakeLlamaBridge.load("/models/a.gguf", { contextTokens: 2048, suppressThinking: true });
    await fakeLlamaBridge.unload();
    await fakeLlamaBridge.load("/models/b.gguf", { contextTokens: 2048, suppressThinking: false });
    expect(loadCalls().map((call) => call.opts.suppressThinking)).toEqual([true, false]);
  });

  test("the ordered call log, so unload-before-load can be proved", async () => {
    // The fake RECORDS and does not ENFORCE. If it auto-unloaded, a test of the
    // one-model-resident invariant would be testing this file instead of the
    // real bridge.
    await fakeLlamaBridge.load("/models/a.gguf", { contextTokens: 2048, suppressThinking: true });
    await fakeLlamaBridge.unload();
    await fakeLlamaBridge.load("/models/b.gguf", { contextTokens: 2048, suppressThinking: true });
    expect(bridgeCalls()).toEqual([
      "load:/models/a.gguf",
      "unload",
      "load:/models/b.gguf",
    ]);
  });

  test("resetContext is recorded and does NOT unload", async () => {
    // Spec §4.5's distinction, and "clean it all up" is the natural instinct
    // and it is wrong: the KV cache must go, the weights may stay resident.
    await fakeLlamaBridge.load("/models/a.gguf", { contextTokens: 2048, suppressThinking: true });
    await fakeLlamaBridge.resetContext();
    expect(bridgeCalls()).toEqual(["load:/models/a.gguf", "resetContext"]);
    expect(fakeLlamaBridge.isLoaded()).toBe(true);
  });

  test("isLoaded is false before any load and false after unload", async () => {
    expect(fakeLlamaBridge.isLoaded()).toBe(false);
    await fakeLlamaBridge.load("/models/a.gguf", { contextTokens: 2048, suppressThinking: true });
    expect(fakeLlamaBridge.isLoaded()).toBe(true);
    await fakeLlamaBridge.unload();
    expect(fakeLlamaBridge.isLoaded()).toBe(false);
  });
});

describe("resetLlamaScript", () => {
  test("clears everything, so one suite cannot leak into the next", async () => {
    scriptLlama([{ emit: "a" }]);
    await drain(fakeLlamaBridge.generate("p"));
    await fakeLlamaBridge.load("/models/a.gguf", { contextTokens: 2048, suppressThinking: true });

    resetLlamaScript();

    expect(generateCallCount()).toBe(0);
    expect(loadCalls()).toEqual([]);
    expect(bridgeCalls()).toEqual([]);
    expect(lastPromptGiven()).toBe("");
    expect(fakeLlamaBridge.isLoaded()).toBe(false);
  });
});
