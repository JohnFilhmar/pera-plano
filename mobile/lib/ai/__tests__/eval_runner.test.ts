// mobile/lib/ai/__tests__/eval_runner.test.ts
//
// THE RUN IS CANCELLABLE AND RESUMABLE, and a stopped question must come back
// on resume rather than count as answered.
//
// EVERY METRIC IS COMPUTED FROM RECORDED NUMBERS, never from a wall-clock
// guess. The clock is injected so the assertions are exact: a metric that can
// only be checked to within a tolerance is one nobody notices going wrong.
import { runEval, summariseEval, type EvalDeps, type EvalProgress } from "../eval_runner";
import { FIXED_QUESTIONS } from "../fixed_questions";
import { ok, type ToolResult } from "../tools/types";
import type { LlamaBridge } from "@/modules/llama_bridge/types";
import {
  fakeLlamaBridge,
  generateCallCount,
  resetLlamaScript,
  scriptLlama,
  type ScriptedTurn,
} from "@/test_support/llama_bridge_mock";

const NOW = 1_773_000_000_000 as never;

const FIGURE = "₱18,320.00";

const RESULT = ok("get_balance_total", { total: 1 }, [
  { key: "total", value: FIGURE, kind: "amount" },
]);

/** Three tokens once split on whitespace: "You ", "have ", the figure. */
const GROUNDED: ScriptedTurn = { emit: `You have ${FIGURE}.` };

const QUESTIONS = FIXED_QUESTIONS.slice(0, 3);

/** A clock that advances a fixed amount per read, so timings are exact. */
function steppedClock(stepMs: number): () => number {
  let now = 0;
  return () => {
    now += stepMs;
    return now;
  };
}

function depsWith(overrides: Partial<EvalDeps> = {}): EvalDeps {
  return {
    bridge: fakeLlamaBridge,
    now: NOW,
    questions: QUESTIONS,
    clock: steppedClock(100),
    readResidentBytes: () => 1_000_000,
    runTool: async () => RESULT as ToolResult<unknown>,
    ...overrides,
  };
}

async function collect(deps: EvalDeps): Promise<EvalProgress[]> {
  const records: EvalProgress[] = [];
  for await (const progress of runEval(deps)) records.push(progress);
  return records;
}

/** A bridge whose stream raises `abort` as its first token arrives. */
function abortingBridge(abort: { aborted: boolean }): LlamaBridge {
  return {
    ...fakeLlamaBridge,
    generate: (prompt, grammar) => {
      const handle = fakeLlamaBridge.generate(prompt, grammar);
      async function* tokens(): AsyncGenerator<string> {
        for await (const token of handle.tokens) {
          abort.aborted = true;
          yield token;
        }
      }
      return { tokens: tokens(), cancel: () => handle.cancel() };
    },
  };
}

function record(overrides: Partial<EvalProgress>): EvalProgress {
  return {
    index: 0,
    questionId: "q",
    ttftMs: 100,
    decodeTokensPerSecond: 10,
    residentBytes: 0,
    wallClockMs: 1_000,
    outcomeKind: "prose",
    cardReason: null,
    thinkTag: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetLlamaScript();
});

describe("progress", () => {
  test("asks every fixed question by default, one generation each, in order", async () => {
    scriptLlama(FIXED_QUESTIONS.map(() => GROUNDED));

    const records = await collect(depsWith({ questions: undefined }));

    expect(records.map((progress) => progress.questionId)).toEqual(
      FIXED_QUESTIONS.map((question) => question.id),
    );
    expect(generateCallCount()).toBe(FIXED_QUESTIONS.length);
  });

  test("the index a record carries is the one to resume after", async () => {
    scriptLlama([GROUNDED, GROUNDED, GROUNDED]);
    const records = await collect(depsWith());
    expect(records.map((progress) => progress.index)).toEqual([0, 1, 2]);
  });
});

describe("cancellation and resume", () => {
  test("a stop between questions asks nothing further", async () => {
    scriptLlama([GROUNDED, GROUNDED, GROUNDED]);
    const abort = { aborted: false };

    const seen: string[] = [];
    for await (const progress of runEval(depsWith({ abort }))) {
      seen.push(progress.questionId);
      abort.aborted = true;
    }

    expect(seen).toEqual([QUESTIONS[0].id]);
    expect(generateCallCount()).toBe(1);
  });

  test("a question stopped mid-answer leaves no record, so a resume asks it again", async () => {
    const abort = { aborted: false };
    scriptLlama([GROUNDED, GROUNDED, GROUNDED]);

    const step = await runEval(depsWith({ bridge: abortingBridge(abort), abort })).next();

    expect(step).toEqual({ done: true, value: expect.objectContaining({ completed: 0 }) });
    expect(generateCallCount()).toBe(1);
  });

  test("a resume starts at the given index rather than repeating answered questions", async () => {
    scriptLlama([GROUNDED, GROUNDED]);
    const records = await collect(depsWith({ startIndex: 1 }));
    expect(records.map((progress) => progress.questionId)).toEqual([
      QUESTIONS[1].id,
      QUESTIONS[2].id,
    ]);
    expect(generateCallCount()).toBe(2);
  });
});

describe("timings", () => {
  test("every timing is a difference of injected clock readings", async () => {
    scriptLlama([GROUNDED, GROUNDED, GROUNDED]);

    // Per question: a read at the tap, one per token (three), one at the end.
    const records = await collect(depsWith());

    expect(records.map((progress) => progress.ttftMs)).toEqual([100, 100, 100]);
    expect(records.map((progress) => progress.wallClockMs)).toEqual([400, 400, 400]);
    // Two intervals of 100 ms between three tokens.
    expect(records.map((progress) => progress.decodeTokensPerSecond)).toEqual([10, 10, 10]);
    expect(summariseEval(records)).toMatchObject({
      ttftMedianMs: 100,
      ttftP90Ms: 100,
      decodeMedianTps: 10,
      decodeWorstTps: 10,
      totalWallClockMs: 1_200,
    });
  });

  test("the decode window runs from the first token to the last, not to the end of the checks", async () => {
    // Tap at 0, tokens at 1,000, 1,500 and 2,000, and the grounding and guard
    // checks run until 9,000. The checks are not decoding.
    const readings = [0, 1_000, 1_500, 2_000, 9_000];
    let read = 0;
    scriptLlama([GROUNDED]);

    const [progress] = await collect(
      depsWith({ questions: [QUESTIONS[0]], clock: () => readings[read++] }),
    );

    expect(progress.ttftMs).toBe(1_000);
    expect(progress.decodeTokensPerSecond).toBe(2);
    expect(progress.wallClockMs).toBe(9_000);
  });

  test("a single token gives no decode rate rather than an invented one", async () => {
    scriptLlama([{ emit: FIGURE }]);
    const [progress] = await collect(depsWith({ questions: [QUESTIONS[0]] }));
    expect(progress.ttftMs).toBe(100);
    expect(progress.decodeTokensPerSecond).toBe(0);
  });
});

describe("what became of each answer", () => {
  test("cards are counted by reason, and a bridge failure is a card, not a stop", async () => {
    scriptLlama([
      GROUNDED,
      // A figure the tool result never licensed.
      { emit: "You have ₱999,999.00." },
      { emit: "" },
      { throwAfter: 2 },
    ]);

    const records = await collect(depsWith({ questions: FIXED_QUESTIONS.slice(0, 4) }));

    expect(records.map((progress) => [progress.outcomeKind, progress.cardReason])).toEqual([
      ["prose", null],
      ["card", "ungrounded"],
      ["card", "empty"],
      ["card", "error"],
    ]);
    expect(summariseEval(records)).toMatchObject({
      completed: 4,
      cardAnswers: 3,
      ungroundedAnswers: 1,
      emptyAnswers: 1,
    });
  });

  test("<think> counts even split across tokens, and even when a card replaced the answer", async () => {
    scriptLlama([
      // Eight-byte chunks split the tag itself across two tokens.
      { emitRaw: `Ok. <think>hm</think> You have ${FIGURE}.` },
      // Grounding throws this one away, but it was still decoded.
      { emit: "<think>The total is ₱5.00" },
      GROUNDED,
    ]);

    const records = await collect(depsWith());

    expect(records.map((progress) => [progress.outcomeKind, progress.thinkTag])).toEqual([
      ["prose", true],
      ["card", true],
      ["prose", false],
    ]);
    expect(summariseEval(records).thinkTagAnswers).toBe(2);
  });
});

describe("the report", () => {
  test("peak resident memory is the maximum across the run, not the last reading", async () => {
    scriptLlama([GROUNDED, GROUNDED, GROUNDED]);
    const readings = [500, 9_000, 700];
    let read = 0;

    const records = await collect(depsWith({ readResidentBytes: () => readings[read++] }));

    expect(summariseEval(records).peakResidentBytes).toBe(9_000);
  });

  test("questions with no first token, or no decode window, stay out of the timings", () => {
    const report = summariseEval([
      record({ ttftMs: 300, decodeTokensPerSecond: 20 }),
      record({ ttftMs: 100, decodeTokensPerSecond: 5 }),
      record({ ttftMs: 200, decodeTokensPerSecond: 10 }),
      // An empty answer: no token, so neither figure was measured.
      record({ ttftMs: 0, decodeTokensPerSecond: 0, outcomeKind: "card", cardReason: "empty" }),
    ]);

    expect(report).toMatchObject({
      completed: 4,
      ttftMedianMs: 200,
      ttftP90Ms: 300,
      decodeMedianTps: 10,
      decodeWorstTps: 5,
    });
  });

  test("an empty run summarises to zeroes rather than NaN", () => {
    expect(summariseEval([])).toEqual({
      completed: 0,
      decodeMedianTps: 0,
      decodeWorstTps: 0,
      ttftMedianMs: 0,
      ttftP90Ms: 0,
      peakResidentBytes: 0,
      cardAnswers: 0,
      ungroundedAnswers: 0,
      emptyAnswers: 0,
      thinkTagAnswers: 0,
      totalWallClockMs: 0,
    });
  });
});
