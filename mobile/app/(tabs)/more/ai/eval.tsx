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
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { EvalResults, type EvalRunState } from "@/components/ai/eval_results";
import { Card } from "@/components/ui/card";
import type { AbortFlag } from "@/lib/ai/dispatch";
import { FIXTURE_NOW_ISO } from "@/lib/ai/eval/fixture_ledger";
import { EVAL_QUESTIONS } from "@/lib/ai/eval/questions";
import { runEval, summariseEval, type EvalDeps, type EvalProgress } from "@/lib/ai/eval_runner";
import { systemClock } from "@/lib/clock";
import type { LlamaBridge } from "@/modules/llama_bridge/types";

/**
 * Everything the run needs that this screen must not construct for itself.
 *
 * The bridge is native inference and the tool runner is the fixture-backed
 * handler set — a screen that reached for either directly would drag
 * `llama.rn` into every render test in the app, and would put the eval one
 * import away from the user's real ledger.
 */
export type EvalHarness = {
  bridge: LlamaBridge;
  runTool: EvalDeps["runTool"];
  /** Peak RSS in bytes, sampled once per question. */
  readResidentBytes: () => number;
};

let harness: EvalHarness | null = null;

/**
 * Injected by whoever loads a model, and `null` again when it is unloaded.
 *
 * Module-scoped rather than a context for the same reason `lib/ai/session.ts`
 * is: assistant state must never reach react-query, which is persisted to
 * disk. `null` is the honest default — a phone with no model loaded can offer
 * no measurement, and this screen says so rather than rendering an empty
 * report.
 */
export function configureAiEval(next: EvalHarness | null): void {
  harness = next;
}

const TOTAL_QUESTIONS = EVAL_QUESTIONS.length;

export default function AiEvalScreen() {
  const [state, setState] = useState<EvalRunState>({ kind: "never_run" });

  const records = useRef<EvalProgress[]>([]);
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

  const start = useCallback(async (startIndex: number) => {
    if (harness === null) return;

    // A fresh flag per segment: reusing the stopped one would abort the resume
    // before its first question.
    abort.current = { aborted: false };
    setState({ kind: "running", completed: startIndex, total: TOTAL_QUESTIONS });

    const iterator = runEval({
      bridge: harness.bridge,
      runTool: harness.runTool,
      now: Date.parse(FIXTURE_NOW_ISO),
      // The screen is a composition edge, so it is allowed to read the wall
      // clock that `lib/ai/eval_runner.ts` refuses to reach for itself.
      clock: systemClock.now,
      readResidentBytes: harness.readResidentBytes,
      abort: abort.current,
      startIndex,
    });

    for (;;) {
      const step = await iterator.next();
      if (step.done) break;

      records.current.push(step.value);
      if (!mounted.current) return;
      setState({
        kind: "running",
        completed: step.value.index + 1,
        total: TOTAL_QUESTIONS,
      });
    }

    if (!mounted.current) return;
    const report = summariseEval(records.current);
    setState({
      kind: report.completed < TOTAL_QUESTIONS ? "stopped" : "complete",
      report,
      total: TOTAL_QUESTIONS,
    });
  }, []);

  const onRun = useCallback(() => {
    records.current = [];
    void start(0);
  }, [start]);

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

      {/* Clears the tab bar on short devices. */}
      <View className="h-8" />
    </ScrollView>
  );
}
