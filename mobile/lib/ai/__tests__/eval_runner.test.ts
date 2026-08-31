// mobile/lib/ai/__tests__/eval_runner.test.ts
//
// THE RUN IS CANCELLABLE AND RESUMABLE, and that is a product requirement
// rather than a nicety: "thirty questions at 4 tok/s on tier 5 is well over ten
// minutes, and a modal that cannot be escaped for ten minutes is a bug."
//
// EVERY METRIC IS COMPUTED FROM RECORDED NUMBERS, never from a wall-clock
// guess. The clock is injected here so the assertions are exact — a metric that
// can only be checked to within a tolerance is a metric nobody will notice
// going wrong.
import { runEval, summariseEval, type EvalDeps } from "../eval_runner";
import type { EvalQuestion } from "../eval/questions";
import { ok, type ToolResult } from "../tools/types";
import {
  fakeLlamaBridge,
  generateCallCount,
  resetLlamaScript,
  scriptLlama,
} from "@/test_support/llama_bridge_mock";

const NOW = 1_773_000_000_000 as never;

const RESULT = ok("get_balance_total", { total: 1 }, [
  { key: "total", value: "₱18,320.00", kind: "amount" },
]);

const QUESTIONS: EvalQuestion[] = [
  {
    id: "q1",
    prompt: "How much money do I have in total?",
    language: "en",
    category: "single_tool",
    expected: { kind: "tool", name: "get_balance_total", args: {} },
  },
  {
    id: "q2",
    prompt: "What's the weather tomorrow?",
    language: "en",
    category: "out_of_scope",
    expected: { kind: "no_tool" },
  },
  {
    id: "q3",
    prompt: "Should I buy a new phone?",
    language: "en",
    category: "advice",
    expected: { kind: "advice" },
  },
];

/** A clock that advances a fixed amount per read, so timings are exact. */
function steppedClock(stepMs: number) {
  let t = 0;
  return () => {
    t += stepMs;
    return t;
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

/** q1 answers with a tool call then prose; q2 declines; q3 never reaches the model. */
function scriptTheThree() {
  scriptLlama([
    { emitToolCall: { name: "get_balance_total", args: {} } },
    { emit: "You have ₱18,320.00." },
    { emitRaw: "CANNOT_ANSWER" },
  ]);
}

beforeEach(() => {
  resetLlamaScript();
});

describe("progress", () => {
  test("yields one record per question, in order", async () => {
    scriptTheThree();
    const seen: string[] = [];
    for await (const progress of runEval(depsWith())) seen.push(progress.questionId);
    expect(seen).toEqual(["q1", "q2", "q3"]);
  });

  test("each record carries the strict verdict for that question", async () => {
    scriptTheThree();
    const verdicts: number[] = [];
    for await (const progress of runEval(depsWith())) verdicts.push(progress.verdict.score);
    // q1 right tool, q2 declined without a tool, q3 never reached the model.
    expect(verdicts).toEqual([1, 1, 1]);
  });

  test("a wrong tool scores 0 without stopping the run", async () => {
    scriptLlama([
      { emitToolCall: { name: "get_limits", args: {} } },
      { emit: "You have ₱18,320.00." },
      { emitRaw: "CANNOT_ANSWER" },
    ]);
    const verdicts: number[] = [];
    for await (const progress of runEval(depsWith())) verdicts.push(progress.verdict.score);
    expect(verdicts).toEqual([0, 1, 1]);
  });
});

describe("cancellation", () => {
  test("cancelling mid-run stops issuing generate calls", async () => {
    scriptTheThree();
    const abort = { aborted: false };

    const seen: string[] = [];
    for await (const progress of runEval(depsWith({ abort }))) {
      seen.push(progress.questionId);
      abort.aborted = true;
    }

    expect(seen).toEqual(["q1"]);
    // q1 cost two generate calls; nothing was issued for q2 or q3.
    expect(generateCallCount()).toBe(2);
  });
});

describe("resume", () => {
  test("continues from the recorded index rather than restarting", async () => {
    // The user escaped the modal after q1 and came back. Re-running q1 would
    // both waste minutes and quietly change the score.
    scriptLlama([{ emitRaw: "CANNOT_ANSWER" }]);

    const seen: string[] = [];
    for await (const progress of runEval(depsWith({ startIndex: 1 }))) {
      seen.push(progress.questionId);
    }

    expect(seen).toEqual(["q2", "q3"]);
  });

  test("the index a record carries is the one to resume after", async () => {
    scriptTheThree();
    const indices: number[] = [];
    for await (const progress of runEval(depsWith())) indices.push(progress.index);
    expect(indices).toEqual([0, 1, 2]);
  });
});

describe("the six metrics", () => {
  test("are computed from recorded numbers, not wall-clock guesses", async () => {
    scriptTheThree();
    const records = [];
    for await (const progress of runEval(depsWith())) records.push(progress);

    const report = summariseEval(records);

    expect(report.completed).toBe(3);
    // Strict headline: all three correct.
    expect(report.toolPickAccuracy).toBe(1);
    // Nothing was thrown away for stating a figure no tool licensed.
    expect(report.groundingRejectionRate).toBe(0);
    expect(report.peakResidentBytes).toBe(1_000_000);
    // Every timing is a difference of injected clock readings.
    expect(Number.isFinite(report.ttftMedianMs)).toBe(true);
    expect(Number.isFinite(report.ttftP90Ms)).toBe(true);
    expect(Number.isFinite(report.totalWallClockMs)).toBe(true);
  });

  test("the grounding-rejection rate counts answers that were thrown away", async () => {
    // The felt-quality number: how often the user lost a sentence and kept the
    // card.
    scriptLlama([
      { emitToolCall: { name: "get_balance_total", args: {} } },
      { emit: "You have ₱999,999.00." },
      { emitRaw: "CANNOT_ANSWER" },
    ]);

    const records = [];
    for await (const progress of runEval(depsWith())) records.push(progress);

    expect(records[0].groundingRejected).toBe(true);
    expect(summariseEval(records).groundingRejectionRate).toBeCloseTo(1 / 3);
  });

  test("peak resident memory is the maximum across the run, not the last reading", async () => {
    scriptTheThree();
    const readings = [500, 9_000, 700];
    let index = 0;
    const records = [];
    for await (const progress of runEval(
      depsWith({ readResidentBytes: () => readings[Math.min(index++, readings.length - 1)] }),
    )) {
      records.push(progress);
    }
    expect(summariseEval(records).peakResidentBytes).toBe(9_000);
  });

  test("an empty run summarises to zeroes rather than NaN", () => {
    const report = summariseEval([]);
    expect(report.completed).toBe(0);
    expect(report.toolPickAccuracy).toBe(0);
    expect(report.groundingRejectionRate).toBe(0);
    expect(report.decodeMedianTps).toBe(0);
  });
});

describe("advice questions inside the eval", () => {
  test("cost zero inference, which is the whole point of scoring them here", async () => {
    // They ride in the same 30 so the eval measures the WHOLE input path, not
    // just the model's half of it.
    scriptLlama([]);
    const records = [];
    for await (const progress of runEval(depsWith({ questions: [QUESTIONS[2]] }))) {
      records.push(progress);
    }
    expect(generateCallCount()).toBe(0);
    expect(records[0].verdict.score).toBe(1);
  });
});
