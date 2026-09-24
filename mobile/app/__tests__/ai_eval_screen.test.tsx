// app/__tests__/ai_eval_screen.test.tsx
//
// WHAT THE EVAL SCREEN ADDS FOR docs/13's SESSION 3, on a development build.
// The thinking switch must hand its run a model that thinks and hand the chat
// back one that does not, and the `[ai_eval]` lines must carry metrics while
// never carrying a prompt, an answer or a figure from a tool result.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { configureAiEval } from "@/lib/ai/eval/harness";
import { EVAL_QUESTIONS } from "@/lib/ai/eval/questions";
import { ok } from "@/lib/ai/tools/types";
import { fakeLlamaBridge, loadCalls, scriptLlama } from "@/test_support/llama_bridge_mock";

import AiEvalScreen from "../(tabs)/more/ai/eval";

const FIGURE = "₱18,320.00";
const OPTIONS = { contextTokens: 2048, suppressThinking: true };

let info: jest.SpyInstance;

beforeEach(() => {
  info = jest.spyOn(console, "info").mockImplementation(() => undefined);
  configureAiEval({
    bridge: fakeLlamaBridge,
    runTool: async () =>
      ok("get_balance_total", { total: 1 }, [{ key: "total", value: FIGURE, kind: "amount" }]),
    readResidentBytes: () => 1_000_000,
    model: { id: "qwen3-0.6b-q4", path: "/models/qwen3-0.6b-q4.gguf", options: OPTIONS },
  });
  // Every question that reaches the model calls a tool, then answers with the
  // figure. Advice questions consume nothing, so a few turns go unused.
  scriptLlama(
    EVAL_QUESTIONS.flatMap(() => [
      { emitToolCall: { name: "get_balance_total", args: {} } },
      { emit: `You have ${FIGURE}.` },
    ]),
  );
});

afterEach(() => {
  info.mockRestore();
  configureAiEval(null);
});

function textOf(testID: string): string {
  return String(screen.getByTestId(testID).props.children);
}

function evalLines(): string[] {
  return info.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("[ai_eval] "));
}

test("the thinking switch loads its run's model with thinking on, then puts it back", async () => {
  render(<AiEvalScreen />);
  fireEvent(screen.getByTestId("ai-eval-thinking-switch"), "valueChange", true);
  fireEvent.press(screen.getByTestId("ai-eval-run"));
  await screen.findByTestId("ai-eval-complete");

  expect(loadCalls().map((call) => call.opts)).toEqual([
    { ...OPTIONS, suppressThinking: false },
    OPTIONS,
  ]);
  expect(textOf("ai-eval-thinking-mode")).toBe("Left on");
  for (const line of evalLines()) expect(line).toContain('"suppressThinking":false');
});

test("with the switch off the model is never reloaded, and the run says it was suppressed", async () => {
  render(<AiEvalScreen />);
  fireEvent.press(screen.getByTestId("ai-eval-run"));
  await screen.findByTestId("ai-eval-complete");

  expect(loadCalls()).toEqual([]);
  expect(textOf("ai-eval-thinking-mode")).toBe("Suppressed");
});

test("one [ai_eval] line per question and one per report, with no text in any of them", async () => {
  render(<AiEvalScreen />);
  fireEvent.press(screen.getByTestId("ai-eval-run"));
  await screen.findByTestId("ai-eval-complete");

  const lines = evalLines();
  expect(lines).toHaveLength(EVAL_QUESTIONS.length + 1);
  for (const line of lines) {
    expect(line).toContain('"tier":"qwen3-0.6b-q4"');
    // Every answer and every tool result in this run carries the figure.
    expect(line).not.toContain(FIGURE);
    for (const question of EVAL_QUESTIONS) expect(line).not.toContain(question.prompt);
  }

  const report: unknown = JSON.parse(lines[lines.length - 1].slice("[ai_eval] ".length));
  expect(report).toMatchObject({
    event: "report",
    completed: EVAL_QUESTIONS.length,
    // Gate 2's denominator: one constrained round per question that reached
    // the model, which docs/13 states as 28 per run.
    constrainedGenerations: EVAL_QUESTIONS.filter((q) => q.expected.kind !== "advice").length,
    malformedGenerations: 0,
  });
});
