// mobile/lib/ai/eval_runner.ts
//
// THE DEVICE'S OWN NUMBERS. Spec §2.5: every figure the surface ever shows for
// speed is measured on the phone in the user's hand, never carried over from a
// table written on a different chip.
//
// THE RUN IS CANCELLABLE AND RESUMABLE, and that is a product requirement, not
// a nicety: "thirty questions at 4 tok/s on tier 5 is well over ten minutes,
// and a modal that cannot be escaped for ten minutes is a bug." Cancelling
// stops before the next question is issued; resuming starts at `startIndex`
// rather than replaying questions that already have a verdict.
//
// THE SIX METRICS, and why each one is here rather than being interesting:
//
//   - Strict tool-pick accuracy — the single number that says whether the
//     feature works at all.
//   - Decode tok/s, median AND worst — whether an answer arrives before the
//     user leaves. The worst case is the one that loses them.
//   - Time-to-first-token, median AND p90 — the p90 is what makes a surface
//     FEEL broken, and a median hides it completely.
//   - Peak resident memory — the real verdict on a big tier on a small phone,
//     and the only honest input to `minRamBytes`.
//   - Grounding-rejection rate — how often the answer had to be thrown away.
//     The felt-quality number: the user lost a sentence and kept a card.
//   - Total wall clock — whether the user will sit through the eval at all.
//
// THE GATE COUNTERS RIDE ALONG, and they are diagnostics, not a seventh
// metric. docs/13's Session 3 reads Gate 2 (malformed output under the tool
// grammar) and Gate 3 (empty answers, `<think>` in the output) off the same
// runs Task 27 makes anyway, so no separate harness has to exist for either.
//
// EVERY TIMING IS A DIFFERENCE OF INJECTED CLOCK READINGS, never `Date.now()`
// reached for inside this module. `lib/clock.ts` already establishes that rule
// for the rest of the app; here it also makes the metrics exactly assertable
// rather than checkable to within a tolerance.
import type { EpochMs } from "@/types/domain";
import type { GenerateHandle, LlamaBridge } from "@/modules/llama_bridge/types";

import {
  parseToolCall,
  runTurn,
  type AbortFlag,
  type CardReason,
  type TurnOutcome,
} from "./dispatch";
import { EVAL_QUESTIONS, type EvalQuestion } from "./eval/questions";
import { scoreQuestion, type RecordedTurn, type Verdict } from "./eval/scorer";
import { CANNOT_ANSWER, FORCED_ANSWER_GRAMMAR } from "./tools/grammar";
import type { ToolResult } from "./tools/types";

export type EvalProgress = {
  /** 0-based position in the question list. Resume AFTER this index. */
  index: number;
  questionId: string;
  verdict: Verdict;
  /** Milliseconds from the request to the first token of the turn. */
  ttftMs: number;
  decodeTokensPerSecond: number;
  /** The answer was discarded for stating a figure no tool licensed. */
  groundingRejected: boolean;
  residentBytes: number;
  wallClockMs: number;
  /**
   * Rounds that ran under the tool grammar and finished. Dispatch constrains
   * only a turn's first round, so this is 1, or 0 for an advice question and
   * for a round that was cancelled or failed mid-stream. A count rather than a
   * flag, so the report can sum it into Gate 2's denominator.
   */
  constrainedGenerations: number;
  /**
   * Of those, outputs that were neither a tool call `parseToolCall` accepts nor
   * exactly `CANNOT_ANSWER`. Under a grammar that holds, always 0.
   */
  malformedGenerations: number;
  outcomeKind: TurnOutcome["kind"];
  /** Why the answer became a card, or `null` when it did not. */
  cardReason: CardReason | null;
  /**
   * Some output of the turn contained `<think>`, counting output that grounding
   * or the guard then replaced with a card: those thinking tokens were still
   * decoded and paid for.
   */
  thinkTag: boolean;
};

export type EvalReport = {
  completed: number;
  toolPickAccuracy: number;
  nameCorrect: number;
  argsCorrect: number;
  decodeMedianTps: number;
  decodeWorstTps: number;
  ttftMedianMs: number;
  ttftP90Ms: number;
  peakResidentBytes: number;
  groundingRejectionRate: number;
  totalWallClockMs: number;
  /** Gate 2's denominator: every constrained round that finished. */
  constrainedGenerations: number;
  /** Gate 2's numerator. */
  malformedGenerations: number;
  /** Turns the model answered with nothing at all, card reason `empty`. Gate 3. */
  emptyAnswers: number;
  /** Turns where some output contained `<think>`. Gate 3. */
  thinkTagAnswers: number;
};

export type EvalDeps = {
  bridge: LlamaBridge;
  runTool: (
    name: string,
    args: Record<string, unknown>,
    now: EpochMs,
  ) => Promise<ToolResult<unknown>>;
  now: EpochMs;
  /** Monotonic milliseconds. Injected — see the header. */
  clock: () => number;
  /** Peak RSS in bytes, sampled once per question. */
  readResidentBytes: () => number;
  questions?: readonly EvalQuestion[];
  abort?: AbortFlag;
  /** Resume point: the first question index to run. */
  startIndex?: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Nearest-rank p90. With 30 questions the distinction between interpolation
 * methods is smaller than the noise, and nearest-rank always returns a value
 * that actually happened.
 */
function p90(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(0.9 * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/**
 * Re-yields a token stream untouched, then hands `onFinished` the whole raw
 * text. A stream that is cancelled or throws never calls it: a half-streamed
 * tool call is not malformed output, it is no output.
 */
async function* observe(
  tokens: AsyncIterable<string>,
  onFinished: (raw: string) => void,
): AsyncGenerator<string> {
  let raw = "";
  for await (const token of tokens) {
    raw += token;
    yield token;
  }
  onFinished(raw);
}

export function summariseEval(records: readonly EvalProgress[]): EvalReport {
  if (records.length === 0) {
    // Zeroes rather than NaN. A report full of NaN renders as "NaN tok/s" on a
    // screen the user is being asked to trust.
    return {
      completed: 0,
      toolPickAccuracy: 0,
      nameCorrect: 0,
      argsCorrect: 0,
      decodeMedianTps: 0,
      decodeWorstTps: 0,
      ttftMedianMs: 0,
      ttftP90Ms: 0,
      peakResidentBytes: 0,
      groundingRejectionRate: 0,
      totalWallClockMs: 0,
      constrainedGenerations: 0,
      malformedGenerations: 0,
      emptyAnswers: 0,
      thinkTagAnswers: 0,
    };
  }

  // Questions that never reached the model contribute no decode rate; averaging
  // a zero in would understate the model's speed with the guardrail's success.
  const decodeRates = records
    .map((record) => record.decodeTokensPerSecond)
    .filter((rate) => rate > 0);

  return {
    completed: records.length,
    toolPickAccuracy:
      records.reduce((total, record) => total + record.verdict.score, 0) / records.length,
    nameCorrect: records.filter((record) => record.verdict.nameCorrect).length,
    argsCorrect: records.filter((record) => record.verdict.argsCorrect).length,
    decodeMedianTps: median(decodeRates),
    decodeWorstTps: decodeRates.length === 0 ? 0 : Math.min(...decodeRates),
    ttftMedianMs: median(records.map((record) => record.ttftMs)),
    ttftP90Ms: p90(records.map((record) => record.ttftMs)),
    peakResidentBytes: Math.max(...records.map((record) => record.residentBytes)),
    groundingRejectionRate:
      records.filter((record) => record.groundingRejected).length / records.length,
    totalWallClockMs: records.reduce((total, record) => total + record.wallClockMs, 0),
    constrainedGenerations: records.reduce(
      (total, record) => total + record.constrainedGenerations,
      0,
    ),
    malformedGenerations: records.reduce(
      (total, record) => total + record.malformedGenerations,
      0,
    ),
    emptyAnswers: records.filter((record) => record.cardReason === "empty").length,
    thinkTagAnswers: records.filter((record) => record.thinkTag).length,
  };
}

export async function* runEval(deps: EvalDeps): AsyncGenerator<EvalProgress, EvalReport> {
  const questions = deps.questions ?? EVAL_QUESTIONS;
  const records: EvalProgress[] = [];

  for (let index = deps.startIndex ?? 0; index < questions.length; index += 1) {
    // Checked BEFORE the question is issued, so a cancel never costs the user
    // one more model round than they asked to wait for.
    if (deps.abort?.aborted) break;

    const question = questions[index];

    const toolCalls: RecordedTurn["toolCalls"] = [];
    let inferenceCalls = 0;
    let constrainedGenerations = 0;
    let malformedGenerations = 0;
    let thinkTag = false;
    let tokens = 0;
    let firstTokenAt: number | null = null;

    // Wrapping the bridge is what makes "an advice question never reached the
    // model" a MEASURED fact here rather than an assumption inherited from the
    // unit tests. It also reads each round's raw text for the gate counters,
    // and judges it by the two rules dispatch itself acts on.
    const countingBridge: LlamaBridge = {
      ...deps.bridge,
      generate: (prompt: string, grammar: string | null): GenerateHandle => {
        inferenceCalls += 1;
        const handle = deps.bridge.generate(prompt, grammar);
        return {
          tokens: observe(handle.tokens, (raw) => {
            if (raw.includes("<think>")) thinkTag = true;
            if (grammar === FORCED_ANSWER_GRAMMAR) return;
            constrainedGenerations += 1;
            if (parseToolCall(raw) === null && raw.trim() !== CANNOT_ANSWER) {
              malformedGenerations += 1;
            }
          }),
          cancel: () => handle.cancel(),
        };
      },
    };

    const startedAt = deps.clock();

    const outcome = await runTurn(question.prompt, {
      bridge: countingBridge,
      now: deps.now,
      abort: deps.abort,
      runTool: async (name, args, now) => {
        toolCalls.push({ name, args });
        return deps.runTool(name, args, now);
      },
      onToken: () => {
        tokens += 1;
        if (firstTokenAt === null) firstTokenAt = deps.clock();
      },
    });

    const finishedAt = deps.clock();
    const wallClockMs = finishedAt - startedAt;
    const decodeMs = firstTokenAt === null ? 0 : finishedAt - firstTokenAt;

    const progress: EvalProgress = {
      index,
      questionId: question.id,
      verdict: scoreQuestion(question.expected, { toolCalls, inferenceCalls }),
      ttftMs: firstTokenAt === null ? 0 : firstTokenAt - startedAt,
      decodeTokensPerSecond: decodeMs > 0 ? (tokens * 1000) / decodeMs : 0,
      groundingRejected: outcome.kind === "card" && outcome.reason === "ungrounded",
      residentBytes: deps.readResidentBytes(),
      wallClockMs,
      constrainedGenerations,
      malformedGenerations,
      outcomeKind: outcome.kind,
      cardReason: outcome.kind === "card" ? outcome.reason : null,
      thinkTag,
    };

    records.push(progress);
    yield progress;
  }

  return summariseEval(records);
}
