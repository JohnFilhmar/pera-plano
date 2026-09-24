// app/(tabs)/more/ai/eval.tsx — AI plan Task 24. Route: /more/ai/eval.
//
// NESTED UNDER app/(tabs)/more/, like every other More screen — NOT a sibling
// app/more/ tree, which would collide on the same /more/* URL space (that
// mistake has landed five times already; see reports.tsx's own header).
//
// THE SCREEN OWNS THE RUN; `components/ai/eval_results.tsx` owns the copy. The
// runner is an async generator with an abort flag and a resume point, and all
// three of those are lifecycle, not presentation — so they live here, and the
// component below stays renderable under Jest with no bridge at all.
//
// THE RUN IS GRADED AGAINST THE FIXTURE LEDGER, NEVER THE USER'S OWN. Spec
// §5.5: the numbers must mean the same thing across runs, the expected answers
// have to be authored to be scored at all, and "running an eval over someone's
// real finances to grade a chatbot is a processing event nobody asked for".
// That is why `now` below is the fixture's pinned instant and not the wall
// clock: "this month" is a fact about when a question was asked, and a fixture
// graded at wall-clock time would change its own right answers at midnight on
// the first of the month.
//
// RECORDS ACCUMULATE ACROSS SEGMENTS, and the report is recomputed from all of
// them. `runEval` returns a summary of the questions ITS OWN pass ran, so a
// resumed run summarised from the generator's return value would silently drop
// every question answered before the stop — reporting a smaller, faster-looking
// run than the device actually performed.
//
// A DEVELOPMENT BUILD ADDS TWO THINGS FOR docs/13's SESSION 3, and a release
// build has neither, because both sit behind `__DEV__`. A switch loads the
// model with thinking left on for one run (Gate 3's comparison), then puts it
// back. And every question and every report writes one `[ai_eval]` JSON line
// to the console, which `adb logcat -s ReactNativeJS` collects so nobody has to
// transcribe a screen. Those lines carry metrics only, never a prompt, an
// answer or a tool result.
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";

import { EvalResults, type EvalRunState } from "@/components/ai/eval_results";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list_row";
import type { AbortFlag } from "@/lib/ai/dispatch";
import { FIXTURE_NOW_ISO } from "@/lib/ai/eval/fixture_ledger";
import { currentAiEval } from "@/lib/ai/eval/harness";
import { EVAL_QUESTIONS } from "@/lib/ai/eval/questions";
import {
  runEval,
  summariseEval,
  type EvalProgress,
  type EvalReport,
} from "@/lib/ai/eval_runner";
import { systemClock } from "@/lib/clock";

/**
 * Fresh runs since the JS bundle loaded. It numbers the `[ai_eval]` lines so
 * one run's lines can be told from the next run's.
 */
let runsStarted = 0;

const TOTAL_QUESTIONS = EVAL_QUESTIONS.length;

/** The stable prefix docs/13's logcat recipes filter on. */
const LOG_PREFIX = "[ai_eval]";

/** What every `[ai_eval]` line of one run repeats, so any single line names its run. */
type RunLabel = { run: number; tier: string; suppressThinking: boolean };

/**
 * One line per finished question. Every field is named here rather than spread
 * from `EvalProgress`, so a prompt or an answer added to that type later cannot
 * ride along into logcat.
 */
function logQuestion(label: RunLabel, progress: EvalProgress): void {
  if (!__DEV__) return;
  const line = {
    event: "question",
    ...label,
    index: progress.index,
    id: progress.questionId,
    score: progress.verdict.score,
    nameCorrect: progress.verdict.nameCorrect,
    argsCorrect: progress.verdict.argsCorrect,
    ttftMs: progress.ttftMs,
    tokensPerSecond: progress.decodeTokensPerSecond,
    wallClockMs: progress.wallClockMs,
    residentBytes: progress.residentBytes,
    constrained: progress.constrainedGenerations,
    malformed: progress.malformedGenerations,
    outcome: progress.outcomeKind,
    cardReason: progress.cardReason,
    empty: progress.cardReason === "empty",
    thinkTag: progress.thinkTag,
  };
  console.info(`${LOG_PREFIX} ${JSON.stringify(line)}`);
}

/** The run's summary line. `EvalReport` holds only numbers, so it goes out whole. */
function logReport(label: RunLabel, report: EvalReport): void {
  if (!__DEV__) return;
  console.info(`${LOG_PREFIX} ${JSON.stringify({ event: "report", ...label, ...report })}`);
}

export default function AiEvalScreen() {
  // Registered by the assistant screen's model load (lib/ai/eval/harness.ts).
  const harness = currentAiEval();
  const [state, setState] = useState<EvalRunState>({ kind: "never_run" });
  // Only a development build renders the switch that sets this.
  const [thinkingAllowed, setThinkingAllowed] = useState(false);

  const records = useRef<EvalProgress[]>([]);
  // Fixed when a run starts, so a resumed segment keeps its run's number and
  // thinking mode even if the switch moved while it was stopped.
  const run = useRef({ index: 0, thinkingAllowed: false });
  const abort = useRef<AbortFlag>({ aborted: false });
  // A run outlives a back-press. Without this the generator keeps calling
  // `setState` on an unmounted screen for the rest of a ten-minute eval.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current.aborted = true;
    };
  }, []);

  // Runs one segment, from `startIndex` to the end or a stop, reloading the
  // model around it when the run allows thinking.
  const start = useCallback(async (startIndex: number) => {
    // Captured once: the harness can be replaced or cleared while this awaits.
    const current = currentAiEval();
    if (current === null) return;
    const { model } = current;
    const allowThinking = run.current.thinkingAllowed;
    const label: RunLabel = {
      run: run.current.index,
      tier: model.id,
      suppressThinking: allowThinking ? false : model.options.suppressThinking,
    };

    // A fresh flag per segment: reusing the stopped one would abort the resume
    // before its first question.
    abort.current = { aborted: false };
    setState({ kind: "running", completed: startIndex, total: TOTAL_QUESTIONS });

    // Gate 3's thinking-on run. The load lands before the first question's
    // clock starts, so it never counts toward wall clock.
    if (allowThinking) {
      await current.bridge.load(model.path, { ...model.options, suppressThinking: false });
    }

    try {
      const iterator = runEval({
        bridge: current.bridge,
        runTool: current.runTool,
        now: Date.parse(FIXTURE_NOW_ISO),
        // The screen is a composition edge, so it is allowed to read the wall
        // clock that `lib/ai/eval_runner.ts` refuses to reach for itself.
        clock: systemClock.now,
        readResidentBytes: current.readResidentBytes,
        abort: abort.current,
        startIndex,
      });

      for (;;) {
        const step = await iterator.next();
        if (step.done) break;

        records.current.push(step.value);
        logQuestion(label, step.value);
        if (!mounted.current) return;
        setState({
          kind: "running",
          completed: step.value.index + 1,
          total: TOTAL_QUESTIONS,
        });
      }
    } finally {
      // Back the way it was loaded, so the chat never inherits a thinking
      // model from a run it never saw.
      if (allowThinking) await current.bridge.load(model.path, model.options);
    }

    const report = summariseEval(records.current);
    logReport(label, report);
    if (!mounted.current) return;
    setState({
      kind: report.completed < TOTAL_QUESTIONS ? "stopped" : "complete",
      report,
      total: TOTAL_QUESTIONS,
      // A release build has no switch, so its results leave the mode out.
      suppressThinking: __DEV__ ? label.suppressThinking : undefined,
    });
  }, []);

  const onRun = useCallback(() => {
    records.current = [];
    runsStarted += 1;
    run.current = { index: runsStarted, thinkingAllowed };
    void start(0);
  }, [start, thinkingAllowed]);

  const onResume = useCallback(() => {
    // The first question with no verdict yet, so a resumed run never replays
    // one that already cost the user a minute.
    const last = records.current[records.current.length - 1];
    void start(last === undefined ? 0 : last.index + 1);
  }, [start]);

  const onCancel = useCallback(() => {
    // The runner checks this BEFORE issuing the next question, so a stop never
    // costs one more model round than the user asked to wait for.
    abort.current.aborted = true;
  }, []);

  return (
    <ScrollView
      testID="ai-eval-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-4 p-4"
    >
      <View>
        <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
          How the assistant does on this phone
        </Text>
        <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
          Every figure here was measured on this device, not copied from a table. Your own
          transactions are never read, and nothing leaves the phone.
        </Text>
      </View>

      {harness === null ? (
        <Card testID="ai-eval-no-model">
          <Text className="text-body font-extrabold text-fg dark:text-fg-dark">
            No model is loaded
          </Text>
          <Text className="mt-1 text-secondary text-fg-2 dark:text-fg-2-dark">
            There is nothing to measure until a model is downloaded and switched on. Download one
            from Assistant models first.
          </Text>
        </Card>
      ) : (
        <EvalResults state={state} onRun={onRun} onResume={onResume} onCancel={onCancel} />
      )}

      {/* `__DEV__` is false in a release build, so this switch never ships. */}
      {__DEV__ && harness !== null ? (
        <Card testID="ai-eval-thinking">
          <ListRow
            title="Let the model think"
            subtitle="Development builds only, for docs/13 Gate 3. The next run loads the model with thinking left on, then puts it back."
            subtitleLines={4}
            right={
              <Switch
                testID="ai-eval-thinking-switch"
                value={thinkingAllowed}
                onValueChange={setThinkingAllowed}
                disabled={state.kind === "running"}
                accessibilityRole="switch"
                accessibilityLabel="Let the model think"
                accessibilityState={{
                  disabled: state.kind === "running",
                  checked: thinkingAllowed,
                }}
              />
            }
          />
        </Card>
      ) : null}

      {/* Clears the tab bar on short devices. */}
      <View className="h-8" />
    </ScrollView>
  );
}
