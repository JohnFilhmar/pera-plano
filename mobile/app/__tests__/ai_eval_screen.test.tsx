// app/__tests__/ai_eval_screen.test.tsx
//
// WHAT THE EVAL SCREEN ADDS FOR docs/13's SESSION 3, on a development build.
// The thinking switch must hand its run a model that thinks and hand the chat
// back one that does not, and the `[ai_eval]` lines must carry metrics while
// never carrying a prompt, an answer or a figure from a tool result.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { configureAiEval } from "@/lib/ai/eval/harness";
import { FIXED_QUESTIONS } from "@/lib/ai/fixed_questions";
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
  // One narration per question, each stating the tool result's figure.
  scriptLlama(FIXED_QUESTIONS.map(() => ({ emit: `You have ${FIGURE}.` })));
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
  expect(lines).toHaveLength(FIXED_QUESTIONS.length + 1);
  for (const line of lines) {
    expect(line).toContain('"tier":"qwen3-0.6b-q4"');
    // Every answer and every tool result in this run carries the figure.
    expect(line).not.toContain(FIGURE);
    for (const question of FIXED_QUESTIONS) expect(line).not.toContain(question.label);
  }

  // docs/13's logcat recipes read these fields by name, and `toEqual` fails
  // on any field added or dropped.
  const question: unknown = JSON.parse(lines[0].slice("[ai_eval] ".length));
  expect(question).toEqual({
    event: "question",
    run: expect.any(Number),
    tier: "qwen3-0.6b-q4",
    suppressThinking: true,
    index: 0,
    id: FIXED_QUESTIONS[0].id,
    ttftMs: expect.any(Number),
    tokensPerSecond: expect.any(Number),
    wallClockMs: expect.any(Number),
    residentBytes: 1_000_000,
    outcome: "prose",
    cardReason: null,
    empty: false,
    thinkTag: false,
  });

  const report: unknown = JSON.parse(lines[lines.length - 1].slice("[ai_eval] ".length));
  expect(report).toMatchObject({
    event: "report",
    completed: FIXED_QUESTIONS.length,
    cardAnswers: 0,
    ungroundedAnswers: 0,
    emptyAnswers: 0,
    thinkTagAnswers: 0,
  });
});

test("a stop inside the first question brings back the offer, not a report of zeroes", async () => {
  // Slow enough that the stop lands before the first answer finishes.
  scriptLlama([{ emit: `You have ${FIGURE} in all your wallets.`, perTokenDelayMs: 200 }]);

  render(<AiEvalScreen />);
  fireEvent.press(screen.getByTestId("ai-eval-run"));
  fireEvent.press(await screen.findByTestId("ai-eval-cancel"));

  await screen.findByTestId("ai-eval-never-run");
  expect(screen.queryByTestId("ai-eval-headline")).toBeNull();
});
