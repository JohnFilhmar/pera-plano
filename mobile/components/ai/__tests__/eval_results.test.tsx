// components/ai/__tests__/eval_results.test.tsx — AI plan Task 24 Step 1.
//
// THE ONE DEFECT THIS FILE EXISTS TO CATCH: a figure from the catalogue's
// estimate table reaching a screen that claims to be showing the user their own
// phone's numbers. "A number measured on the phone in their hand is the only
// honest thing to show." Two independent guards below, because either alone is
// weak: a rendered-text assertion cannot see a field added to `ModelSpec`
// tomorrow, and an import guard cannot see a number typed in as a literal.
//
// PRESENTATIONAL, SO NO HARNESS. `EvalResults` takes a run state and three
// callbacks — it never imports `eval_runner`'s generator, `llama.rn`, or the
// database — which is what lets this file render it with no mock at all.
import fs from "fs";
import path from "path";

import { fireEvent, render, screen } from "@testing-library/react-native";

import { EvalResults } from "../eval_results";
import { MODEL_CATALOGUE } from "@/lib/ai/catalogue";
import type { EvalReport } from "@/lib/ai/eval_runner";

/**
 * Deliberately un-round values.
 *
 * A fixture full of 10s and 30s would match a plausible spec-sheet figure by
 * coincidence, and then the "no estimate reached the screen" assertions below
 * would pass on a screen that was showing an estimate.
 */
function report(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    completed: 30,
    toolPickAccuracy: 26 / 30,
    nameCorrect: 28,
    argsCorrect: 26,
    decodeMedianTps: 11.24,
    decodeWorstTps: 6.41,
    ttftMedianMs: 1240,
    ttftP90Ms: 4830,
    peakResidentBytes: 1_290_000_000,
    groundingRejectionRate: 2 / 30,
    totalWallClockMs: 492_000,
    ...overrides,
  };
}

function textOf(testID: string): string {
  return String(screen.getByTestId(testID).props.children);
}

const METRIC_TEST_IDS = [
  "ai-eval-decode-median",
  "ai-eval-decode-worst",
  "ai-eval-ttft-median",
  "ai-eval-ttft-p90",
  "ai-eval-tool-pick",
  "ai-eval-grounding",
  "ai-eval-peak-memory",
  "ai-eval-wall-clock",
];

test("a finished run states this phone's own measured numbers", () => {
  render(
    <EvalResults
      state={{ kind: "complete", report: report(), total: 30 }}
      onRun={jest.fn()}
      onResume={jest.fn()}
      onCancel={jest.fn()}
    />,
  );

  expect(textOf("ai-eval-headline")).toBe(
    "On your phone: 11.2 tokens per second, picked the right tool 26 times out of 30.",
  );

  expect(textOf("ai-eval-decode-median")).toBe("11.2 tokens/second");
  expect(textOf("ai-eval-decode-worst")).toBe("6.4 tokens/second");
  expect(textOf("ai-eval-ttft-median")).toBe("1.2 s");
  expect(textOf("ai-eval-ttft-p90")).toBe("4.8 s");
  expect(textOf("ai-eval-tool-pick")).toBe("26 of 30");
  expect(textOf("ai-eval-grounding")).toBe("2 of 30");
  expect(textOf("ai-eval-peak-memory")).toBe("1.3 GB");
  expect(textOf("ai-eval-wall-clock")).toBe("8 min 12 s");
});

test("no catalogue spec figure appears anywhere on the screen", () => {
  render(
    <EvalResults
      state={{ kind: "complete", report: report(), total: 30 }}
      onRun={jest.fn()}
      onResume={jest.fn()}
      onCancel={jest.fn()}
    />,
  );

  for (const spec of MODEL_CATALOGUE) {
    // A spec sheet is exactly `displayName` + `params` + `quant` + a RAM
    // figure. Any of the four on this screen means the surface stopped being
    // about the device and started being about the table.
    for (const literal of [spec.displayName, spec.params, spec.quant]) {
      expect(screen.queryByText(literal, { exact: false })).toBeNull();
    }
    expect(screen.queryByText(`${(spec.minRamBytes / 1e9).toFixed(1)} GB`)).toBeNull();
  }
});

test("the component cannot reach the catalogue at all", () => {
  // The durable half of the guard. `ModelSpec` carries no speed figure TODAY,
  // so a rendered-text assertion would silently stop covering the failure the
  // moment one is added back. An import is the thing that has to be absent.
  const source = fs.readFileSync(path.resolve(__dirname, "../eval_results.tsx"), "utf8");
  const importsCatalogue = /^\s*import[^;]*from\s+["'][^"']*\/catalogue["'];/mu.test(source);

  expect(importsCatalogue).toBe(false);
});

test("a stopped run says it is partial and scopes every number to what ran", () => {
  render(
    <EvalResults
      state={{
        kind: "stopped",
        report: report({
          completed: 12,
          toolPickAccuracy: 9 / 12,
          groundingRejectionRate: 1 / 12,
        }),
        total: 30,
      }}
      onRun={jest.fn()}
      onResume={jest.fn()}
      onCancel={jest.fn()}
    />,
  );

  expect(textOf("ai-eval-partial-notice")).toBe(
    "Stopped early. These numbers cover the 12 questions that ran, not all 30.",
  );
  expect(textOf("ai-eval-headline")).toBe(
    "On your phone so far: 11.2 tokens per second, picked the right tool 9 times out of 12.",
  );
  // The denominator is what ran, never the question set's size. "9 of 30"
  // would read as a much worse model than the run actually measured.
  expect(textOf("ai-eval-tool-pick")).toBe("9 of 12");
  expect(textOf("ai-eval-grounding")).toBe("1 of 12");
});

test("a run in progress offers a stop, and nothing else does", () => {
  const onCancel = jest.fn();
  const { rerender } = render(
    <EvalResults
      state={{ kind: "running", completed: 12, total: 30 }}
      onRun={jest.fn()}
      onResume={jest.fn()}
      onCancel={onCancel}
    />,
  );

  expect(textOf("ai-eval-progress")).toBe("Question 13 of 30");
  fireEvent.press(screen.getByTestId("ai-eval-cancel"));
  expect(onCancel).toHaveBeenCalledTimes(1);

  rerender(
    <EvalResults
      state={{ kind: "complete", report: report(), total: 30 }}
      onRun={jest.fn()}
      onResume={jest.fn()}
      onCancel={onCancel}
    />,
  );
  expect(screen.queryByTestId("ai-eval-cancel")).toBeNull();

  rerender(
    <EvalResults
      state={{ kind: "never_run" }}
      onRun={jest.fn()}
      onResume={jest.fn()}
      onCancel={onCancel}
    />,
  );
  expect(screen.queryByTestId("ai-eval-cancel")).toBeNull();
});

test("a stopped run can be continued rather than only restarted", () => {
  const onResume = jest.fn();
  const onRun = jest.fn();
  render(
    <EvalResults
      state={{ kind: "stopped", report: report({ completed: 12 }), total: 30 }}
      onRun={onRun}
      onResume={onResume}
      onCancel={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByTestId("ai-eval-resume"));
  expect(onResume).toHaveBeenCalledTimes(1);

  fireEvent.press(screen.getByTestId("ai-eval-run"));
  expect(onRun).toHaveBeenCalledTimes(1);
});

test("a never-run screen offers the run instead of showing zeroes", () => {
  const onRun = jest.fn();
  render(
    <EvalResults
      state={{ kind: "never_run" }}
      onRun={onRun}
      onResume={jest.fn()}
      onCancel={jest.fn()}
    />,
  );

  screen.getByTestId("ai-eval-never-run");
  fireEvent.press(screen.getByTestId("ai-eval-run"));
  expect(onRun).toHaveBeenCalledTimes(1);

  // A zeroed `EvalReport` renders as "0 tokens/second, picked the right tool 0
  // times out of 30" — a measurement the device never took, and a damning one.
  expect(screen.queryByTestId("ai-eval-headline")).toBeNull();
  for (const testID of METRIC_TEST_IDS) {
    expect(screen.queryByTestId(testID)).toBeNull();
  }
  expect(screen.queryByText(/tokens\/second|tokens per second| GB/)).toBeNull();
});
