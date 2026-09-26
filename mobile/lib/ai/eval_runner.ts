// mobile/lib/ai/eval_runner.ts
//
// THE DEVICE'S OWN NUMBERS. Spec §2.5: every figure the surface ever shows for
// speed is measured on the phone in the user's hand, never carried over from a
// table written on a different chip.
//
// SINCE 2026-09-25 THE MODEL ONLY NARRATES (spec §7.4), so there is no tool
// choice left to score: each fixed question names its own tool. What the run
// measures is the one generation `answerQuestion` makes per question:
//
//   - Time to the first token, median and p90, counted from the tap, so it
//     holds the tool run and the prefill the user actually waits through. The
//     p90 is what makes a surface feel broken, and a median hides it.
//   - Decode tok/s, median and worst, from the first token to the last.
//   - Answers replaced by a card, and of those, how many misquoted a figure:
//     the user lost a sentence and kept a card.
//   - Blank answers and answers containing `<think>`, which docs/13 Gate 3 reads.
//   - Peak resident memory, the only honest input to `minRamBytes`, and total
//     wall clock, which decides whether anyone sits through the run.
//
// THE RUN IS CANCELLABLE AND RESUMABLE. The abort flag stops the answer in
// flight and asks no further question. A question stopped before its answer
// finished is not recorded, so resuming at `startIndex` asks it again.
//
// EVERY TIMING IS A DIFFERENCE OF INJECTED CLOCK READINGS, never `Date.now()`
// reached for inside this module. `lib/clock.ts` already sets that rule for the
// rest of the app; here it also makes the metrics exactly assertable.
import { answerQuestion, type CardReason, type DispatchDeps, type TurnOutcome } from "./dispatch";
import { FIXED_QUESTIONS, type FixedQuestion } from "./fixed_questions";

/** The measurements of one answered question. */
export type EvalProgress = {
  /** 0-based position in the question list. Resume AFTER this index. */
  index: number;
  questionId: string;
  /** Milliseconds from the tap to the first token. 0 when no token arrived. */
  ttftMs: number;
  /** From the first token to the last. 0 when fewer than two tokens arrived. */
  decodeTokensPerSecond: number;
  residentBytes: number;
  wallClockMs: number;
  outcomeKind: Exclude<TurnOutcome["kind"], "cancelled">;
  /** Why the answer became a card, or `null` when it did not. */
  cardReason: CardReason | null;
  /**
   * The raw answer contained `<think>`, including one a card then replaced:
   * those thinking tokens were still decoded and paid for.
   */
  thinkTag: boolean;
};

/** A run's summary. Every field is a number, so the eval screen logs it whole. */
export type EvalReport = {
  completed: number;
  decodeMedianTps: number;
  decodeWorstTps: number;
  ttftMedianMs: number;
  ttftP90Ms: number;
  peakResidentBytes: number;
  /** Answers replaced by a card, for any reason. */
  cardAnswers: number;
  /** Of those, the ones that stated a figure or date no tool result licensed. */
  ungroundedAnswers: number;
  /** Card reason `empty`: the model said nothing at all. docs/13 Gate 3. */
  emptyAnswers: number;
  /** Answers whose raw text contained `<think>`. docs/13 Gate 3. */
  thinkTagAnswers: number;
  totalWallClockMs: number;
};

/** What a run needs. The first four go to `answerQuestion` unchanged. */
export type EvalDeps = Pick<DispatchDeps, "bridge" | "runTool" | "now" | "abort"> & {
  /** Monotonic milliseconds. Injected, see the header. */
  clock: () => number;
  /** Resident bytes, sampled once per question. */
  readResidentBytes: () => number;
  /** Defaults to `FIXED_QUESTIONS`. */
  questions?: readonly FixedQuestion[];
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
 * Nearest-rank p90, which always returns a value that actually happened. With
 * eight questions it lands on the slowest one.
 */
function p90(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(0.9 * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/**
 * Summarises the records of a run.
 *
 * @param records - Every answered question, across every resumed segment of the
 *   run. May be empty.
 * @returns The report. An empty list gives zeroes, never NaN, because the eval
 *   screen prints these figures.
 */
export function summariseEval(records: readonly EvalProgress[]): EvalReport {
  // Zero is "not measured" for both timings, so a zero averaged in would make
  // the phone look faster than it is.
  const ttfts = records.map((record) => record.ttftMs).filter((ms) => ms > 0);
  const rates = records.map((record) => record.decodeTokensPerSecond).filter((rate) => rate > 0);

  return {
    completed: records.length,
    decodeMedianTps: median(rates),
    decodeWorstTps: rates.length === 0 ? 0 : Math.min(...rates),
    ttftMedianMs: median(ttfts),
    ttftP90Ms: p90(ttfts),
    peakResidentBytes: Math.max(0, ...records.map((record) => record.residentBytes)),
    cardAnswers: records.filter((record) => record.outcomeKind === "card").length,
    ungroundedAnswers: records.filter((record) => record.cardReason === "ungrounded").length,
    emptyAnswers: records.filter((record) => record.cardReason === "empty").length,
    thinkTagAnswers: records.filter((record) => record.thinkTag).length,
    totalWallClockMs: records.reduce((total, record) => total + record.wallClockMs, 0),
  };
}

/**
 * Asks each question in turn and measures the answer.
 *
 * @param deps - The bridge, the fixture tool runner, the pinned `now`, the clock
 *   and the memory reader, plus optional questions, abort flag and resume index.
 * @yields One record per answered question, in order. A question the abort flag
 *   stopped yields nothing and ends the run.
 * @returns The summary of THIS call's records only. A resumed run summarises
 *   every segment's records itself.
 */
export async function* runEval(deps: EvalDeps): AsyncGenerator<EvalProgress, EvalReport> {
  const questions = deps.questions ?? FIXED_QUESTIONS;
  const records: EvalProgress[] = [];

  for (let index = deps.startIndex ?? 0; index < questions.length; index += 1) {
    const question = questions[index];
    let raw = "";
    let tokens = 0;
    let firstTokenAt = 0;
    let lastTokenAt = 0;

    const startedAt = deps.clock();
    const outcome = await answerQuestion(question, {
      bridge: deps.bridge,
      runTool: deps.runTool,
      now: deps.now,
      abort: deps.abort,
      onToken: (token) => {
        lastTokenAt = deps.clock();
        if (tokens === 0) firstTokenAt = lastTokenAt;
        tokens += 1;
        raw += token;
      },
    });
    const finishedAt = deps.clock();

    // Raised before this question or during it. Half an answer is not a
    // measurement, and leaving it unrecorded is what makes a resume re-ask it.
    if (outcome.kind === "cancelled") break;

    const progress: EvalProgress = {
      index,
      questionId: question.id,
      ttftMs: tokens === 0 ? 0 : firstTokenAt - startedAt,
      // The first token's own decode sits inside the TTFT, so the window from
      // the first token to the last holds one token fewer than arrived.
      decodeTokensPerSecond:
        lastTokenAt > firstTokenAt ? ((tokens - 1) * 1000) / (lastTokenAt - firstTokenAt) : 0,
      residentBytes: deps.readResidentBytes(),
      wallClockMs: finishedAt - startedAt,
      outcomeKind: outcome.kind,
      cardReason: outcome.kind === "card" ? outcome.reason : null,
      thinkTag: raw.includes("<think>"),
    };

    records.push(progress);
    yield progress;
  }

  return summariseEval(records);
}
