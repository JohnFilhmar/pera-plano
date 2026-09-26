// components/ai/eval_results.tsx — AI plan Task 24.
//
// THIS PHONE'S NUMBERS, NEVER A SPEC SHEET. "On your phone: the first word in
// 1.2 s, then 11.2 tokens per second." A number measured on the phone in the
// user's hand is the only honest thing to show, and it is also more persuasive
// than any benchmark table. The table was written on a different chip, at a
// different temperature, with a different amount of free RAM.
//
// NOTHING HERE MEASURES TOOL CHOICE. Since spec §7.4 each question names its own
// tool, so the model only narrates, and narration is what the rows describe.
//
// THE PROPS ARE THE ENFORCEMENT. This component takes an `EvalReport` and
// nothing else that carries a figure: there is no `spec`, no `tier`, and no
// import of `lib/ai/catalogue`, so a §2.1 estimate has no route onto this
// screen even by accident. `__tests__/eval_results.test.tsx` asserts the
// absence of that import as well as the absence of the numbers, because the
// import is the thing that stays checkable when the catalogue's shape changes.
//
// PRESENTATIONAL, LIKE `components/privacy/health_card.tsx`. The run lives in
// `app/(tabs)/more/ai/eval.tsx`; this file renders a state and calls back. That
// split is what lets it be rendered under Jest with no bridge, no database and
// no mock.
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list_row";
import type { EvalReport } from "@/lib/ai/eval_runner";

/**
 * `stopped` is a first-class state, not `complete` with a smaller number.
 *
 * A run on a slow phone takes minutes, so it is meant to be escapable, and a
 * partial result rendered in the finished layout is a lie the user has no way
 * to detect. `total` rides along so the offer can say how many questions there
 * are, and the partial notice what fraction of them actually ran.
 *
 * `suppressThinking` is the load option the run's model had, and only a
 * development build sets it. There the eval screen can load the model with
 * thinking left on (docs/13 Gate 3), and a screenshot of either kind of run has
 * to say which kind it was.
 */
export type EvalRunState =
  | { kind: "never_run"; total: number }
  | { kind: "running"; completed: number; total: number }
  | { kind: "stopped"; report: EvalReport; total: number; suppressThinking?: boolean }
  | { kind: "complete"; report: EvalReport; total: number; suppressThinking?: boolean };

export type EvalResultsProps = {
  state: EvalRunState;
  /** Starts from question one, discarding any partial run. */
  onRun: () => void;
  /** Continues from the first question with no result yet. */
  onResume: () => void;
  onCancel: () => void;
  testID?: string;
};

/**
 * One decimal, always, including a trailing `.0`.
 *
 * Rounding to a whole number is tempting and wrong at the low end: a tier that
 * decodes at 4.4 tok/s and one at 4.9 both render as "4", which erases exactly
 * the difference the eval exists to measure. The fixed decimal also keeps the
 * column from jittering sideways between rows.
 */
function tokensPerSecond(value: number): string {
  return `${value.toFixed(1)} tokens/second`;
}

/** Seconds with one decimal: a time-to-first-token of 1.2 s and 1.9 s are different waits. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * "8 min 12 s", never "492 s" and never "0.14 h".
 *
 * This is the number that decides whether the user sits through the run at all,
 * so it is written the way someone estimates a wait rather than the way a
 * stopwatch reports one.
 */
function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes === 0 ? `${remainder} s` : `${minutes} min ${remainder} s`;
}

/** Decimal GB, matching how `downloader.ts` states a model's size to the same user. */
function gigabytes(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function headlineFor(report: EvalReport, partial: boolean): string {
  const opening = partial ? "On your phone so far" : "On your phone";
  return (
    `${opening}: the first word in ${seconds(report.ttftMedianMs)}, ` +
    `then ${report.decodeMedianTps.toFixed(1)} tokens per second.`
  );
}

function MetricRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View className="border-t border-line dark:border-line-dark">
      <ListRow
        title={label}
        right={
          <Text
            testID={testID}
            className="text-row font-semibold text-fg dark:text-fg-dark"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {value}
          </Text>
        }
      />
    </View>
  );
}

export function EvalResults({ state, onRun, onResume, onCancel, testID }: EvalResultsProps) {
  if (state.kind === "never_run") {
    return (
      <Card testID={testID ?? "ai-eval-never-run"}>
        <Text className="text-body font-extrabold text-fg dark:text-fg-dark">
          Nothing measured yet
        </Text>
        {/* NO ZEROED REPORT HERE. A never-run screen that renders an empty
            `EvalReport` says "the first word in 0.0 s", a measurement the
            device never took. The offer replaces the numbers rather than
            sitting under them. */}
        <Text className="mt-1 text-secondary text-fg-2 dark:text-fg-2-dark">
          PeraPlano can time the assistant on this phone and count how often an answer has to be
          replaced by a card. It asks {state.total} questions about a built-in practice ledger, so
          your own transactions are never read, and nothing leaves the phone.
        </Text>
        <View className="mt-4">
          <Button testID="ai-eval-run" title={`Run the ${state.total} questions`} onPress={onRun} />
        </View>
      </Card>
    );
  }

  if (state.kind === "running") {
    return (
      <Card testID={testID ?? "ai-eval-running"}>
        <Text className="text-body font-extrabold text-fg dark:text-fg-dark">
          Measuring on this phone
        </Text>
        {/* `completed` is a count of finished questions, so the one in flight
            is the next index — clamped, because the last question is briefly
            finished while the report is still being assembled and "Question 31
            of 30" is a bug the user gets to read. */}
        <Text
          testID="ai-eval-progress"
          className="mt-1 text-secondary text-fg-2 dark:text-fg-2-dark"
        >
          {`Question ${Math.min(state.completed + 1, state.total)} of ${state.total}`}
        </Text>
        <Text className="mt-1 text-secondary text-fg-2 dark:text-fg-2-dark">
          This takes several minutes on a slower phone. Stopping keeps whatever has been measured
          so far.
        </Text>
        <View className="mt-4">
          <Button testID="ai-eval-cancel" title="Stop" variant="secondary" onPress={onCancel} />
        </View>
      </Card>
    );
  }

  const { report, total, suppressThinking } = state;
  const partial = state.kind === "stopped";

  return (
    <Card testID={testID ?? (partial ? "ai-eval-stopped" : "ai-eval-complete")}>
      {partial ? (
        <View className="mb-3 rounded-lg bg-chip px-4 py-3 dark:bg-chip-dark">
          <Text
            testID="ai-eval-partial-notice"
            className="text-fg-2 dark:text-fg-2-dark"
          >
            {`Stopped early. These numbers cover the ${report.completed} questions that ran, not all ${total}.`}
          </Text>
        </View>
      ) : null}

      <Text
        testID="ai-eval-headline"
        className="text-body font-extrabold text-fg dark:text-fg-dark"
      >
        {headlineFor(report, partial)}
      </Text>

      <View className="mt-3">
        {suppressThinking === undefined ? null : (
          <MetricRow
            label="Model thinking"
            value={suppressThinking ? "Suppressed" : "Left on"}
            testID="ai-eval-thinking-mode"
          />
        )}
        <MetricRow
          label="Typing speed"
          value={tokensPerSecond(report.decodeMedianTps)}
          testID="ai-eval-decode-median"
        />
        {/* The worst case is the one that loses the user, and a median hides it
            completely — so both are rows, never one averaged figure. */}
        <MetricRow
          label="Slowest answer"
          value={tokensPerSecond(report.decodeWorstTps)}
          testID="ai-eval-decode-worst"
        />
        <MetricRow
          label="Wait for the first word"
          value={seconds(report.ttftMedianMs)}
          testID="ai-eval-ttft-median"
        />
        <MetricRow
          label="Longest wait, 9 times in 10"
          value={seconds(report.ttftP90Ms)}
          testID="ai-eval-ttft-p90"
        />
        {/* Every count is out of `completed`, never `total`, because a question
            a stopped run never asked was neither answered nor replaced.
            Misquoted and blank answers are also in the card count. */}
        <MetricRow
          label="Answers replaced by a card"
          value={`${report.cardAnswers} of ${report.completed}`}
          testID="ai-eval-cards"
        />
        <MetricRow
          label="Answers that misquoted a figure"
          value={`${report.ungroundedAnswers} of ${report.completed}`}
          testID="ai-eval-grounding"
        />
        <MetricRow
          label="Blank answers"
          value={`${report.emptyAnswers} of ${report.completed}`}
          testID="ai-eval-empty"
        />
        <MetricRow
          label="Answers with thinking text"
          value={`${report.thinkTagAnswers} of ${report.completed}`}
          testID="ai-eval-think"
        />
        {/* A peak of 0 means /proc could not be read, not that nothing was
            resident. docs/13 Gate 4 takes TOTAL PSS from `adb shell dumpsys
            meminfo` either way, never from this row. */}
        <MetricRow
          label="Peak memory used"
          value={
            report.peakResidentBytes > 0
              ? gigabytes(report.peakResidentBytes)
              : "Not measured on this phone"
          }
          testID="ai-eval-peak-memory"
        />
        <MetricRow
          label="Time taken"
          value={duration(report.totalWallClockMs)}
          testID="ai-eval-wall-clock"
        />
      </View>

      {/* Spec §5.4: prose quality is bounded below by the guardrails and above
          by nothing, so this screen must not let a good score be read as a
          promise that the answers read well. */}
      <Text testID="ai-eval-caveat" className="mt-3 text-secondary text-fg-2 dark:text-fg-2-dark">
        This measures speed on this phone, against a built-in practice ledger. It cannot tell you
        whether an answer reads well.
      </Text>

      <View className="mt-4 gap-2">
        {partial ? (
          // Resuming starts at the first question with no result rather than
          // replaying the ones already answered, which is why `eval_runner`
          // takes a `startIndex`.
          <Button testID="ai-eval-resume" title="Continue the run" onPress={onResume} />
        ) : null}
        <Button
          testID="ai-eval-run"
          title={partial ? "Start over" : "Run it again"}
          variant="secondary"
          onPress={onRun}
        />
      </View>
    </Card>
  );
}
