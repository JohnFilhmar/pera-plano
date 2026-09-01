// components/ai/__tests__/chat_surface.test.tsx — plan Task 23.
//
// DRIVEN BY THE SCRIPTED BRIDGE, NOT BY PROPS. The surface runs the real
// `runTurn` loop over `test_support/llama_bridge_mock.ts`, so every assertion
// here is about what a user actually sees while a model decodes: a suppressed
// half-written tool call, a tool line filling the dead air before the first
// word, a cancel that leaves nothing behind, and a bad sentence collapsing to
// the card that still carries the true figure.
//
// A SURFACE THAT TOOK ITS TOKENS AS A PROP WOULD PASS EVERY TEST IN THIS FILE
// WITHOUT STREAMING ANYTHING. That is why the fake bridge is here and why the
// incremental test uses fake timers: `perTokenDelayMs` is the only way to stand
// between two tokens and look at the screen.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { ChatSurface } from "../chat_surface";
import { destroySession } from "@/lib/ai/session";
import { ok, type ToolResult } from "@/lib/ai/tools/types";
import { fakeLlamaBridge, resetLlamaScript, scriptLlama } from "@/test_support/llama_bridge_mock";

const NOW = 1_773_000_000_000;

/** The true figures. Nothing the model says may contradict these. */
const SPEND_RESULT: ToolResult<unknown> = ok("get_spend_by_category", { topCategory: "Groceries" }, [
  { key: "Groceries · this month", value: "₱2,400.00", kind: "amount" },
  { key: "share of your spending", value: "34%", kind: "percent" },
]);

const LIMITS_RESULT: ToolResult<unknown> = ok("get_limits", { count: 2 }, [
  { key: "Groceries limit left", value: "₱1,100.00", kind: "amount" },
]);

/** A stand-in for Task 22's picker: this surface only has to render it. */
function StubPicker() {
  return <Text testID="model-picker">Choose a model</Text>;
}

type Overrides = {
  runTool?: (
    name: string,
    args: Record<string, unknown>,
    now: number,
  ) => Promise<ToolResult<unknown>>;
  disclaimerAcknowledged?: boolean;
  onAcknowledgeDisclaimer?: () => void;
};

function readySurface(overrides: Overrides = {}) {
  return (
    <ChatSurface
      phase="ready"
      picker={<StubPicker />}
      bridge={fakeLlamaBridge}
      runTool={overrides.runTool ?? (async () => SPEND_RESULT)}
      now={() => NOW}
      disclaimerAcknowledged={overrides.disclaimerAcknowledged ?? true}
      onAcknowledgeDisclaimer={overrides.onAcknowledgeDisclaimer ?? (() => {})}
    />
  );
}

function ask(question: string) {
  fireEvent.changeText(screen.getByTestId("ai-composer-input"), question);
  fireEvent.press(screen.getByTestId("ai-composer-send"));
}

/** A tool call the test releases by hand, so "before the first token" is a fact. */
function gatedTool(result: ToolResult<unknown>) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runTool = async (): Promise<ToolResult<unknown>> => {
    await gate;
    return result;
  };
  return { runTool, release: () => release() };
}

beforeEach(async () => {
  resetLlamaScript();
  // The session is module-scoped and outlives a test. A transcript left behind
  // would put the previous test's question in this one's prompt.
  await destroySession();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the four states", () => {
  test("no model yet: the surface IS the picker, and reads as an invitation rather than an error", () => {
    render(
      <ChatSurface
        phase="no_model"
        picker={<StubPicker />}
        bridge={null}
        runTool={async () => SPEND_RESULT}
        now={() => NOW}
        disclaimerAcknowledged
        onAcknowledgeDisclaimer={() => {}}
      />,
    );

    expect(screen.getByTestId("model-picker")).toBeTruthy();
    expect(screen.queryByTestId("ai-error")).toBeNull();
    expect(screen.queryByText(/something went wrong|couldn't|failed|unavailable/i)).toBeNull();
    // No composer: there is nothing to ask yet.
    expect(screen.queryByTestId("ai-composer-input")).toBeNull();
  });

  test("waking up is distinguishable from no model — the picker never flashes at someone who has one", () => {
    render(
      <ChatSurface
        phase="waking"
        picker={<StubPicker />}
        bridge={fakeLlamaBridge}
        runTool={async () => SPEND_RESULT}
        now={() => NOW}
        disclaimerAcknowledged
        onAcknowledgeDisclaimer={() => {}}
      />,
    );

    expect(screen.getByTestId("ai-waking")).toBeTruthy();
    expect(screen.queryByTestId("model-picker")).toBeNull();
    expect(screen.queryByTestId("ai-no-model")).toBeNull();
    expect(screen.getByTestId("ai-waking")).toHaveTextContent(/waking up/i);
  });
});

describe("generating", () => {
  test("tokens render incrementally — never spinner-then-dump", async () => {
    // `setImmediate` and the microtask queue stay REAL. React's async `act` and
    // RNTL's own flush both drain themselves through them, and faking those
    // deadlocks the flush against the very clock this test is holding still.
    jest.useFakeTimers({ doNotFake: ["setImmediate", "queueMicrotask", "nextTick"] });
    scriptLlama([{ emit: "Groceries was your biggest category.", perTokenDelayMs: 10 }]);

    render(readySurface());
    ask("how much did I spend on groceries?");

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("ai-stream")).toHaveTextContent(/^Groceries$/);
    expect(screen.getByTestId("ai-stream")).not.toHaveTextContent(/was/);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("ai-stream")).toHaveTextContent(/^Groceries was$/);
    expect(screen.getByTestId("ai-stream")).not.toHaveTextContent(/biggest/);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("Groceries was your biggest category.")).toBeTruthy();
    expect(screen.queryByTestId("ai-stream")).toBeNull();
  });

  test("the tool-call line appears before the first token, and the half-written call never renders as prose", async () => {
    const { runTool, release } = gatedTool(LIMITS_RESULT);
    scriptLlama([
      { emitToolCall: { name: "get_limits", args: {} } },
      { emit: "Your Groceries limit still has room." },
    ]);

    render(readySurface({ runTool }));
    ask("how much is left in my limit?");

    await waitFor(() => {
      expect(screen.getByTestId("ai-activity")).toHaveTextContent(/looking at your limits/i);
    });
    // The whole first round was a JSON tool call. Not one character of it is
    // allowed on screen as an answer.
    expect(screen.queryByTestId("ai-stream")).toBeNull();
    expect(screen.queryByText(/get_limits/)).toBeNull();
    expect(screen.queryByText(/\{/)).toBeNull();

    await act(async () => {
      release();
    });

    await waitFor(() => {
      expect(screen.getByText("Your Groceries limit still has room.")).toBeTruthy();
    });
    expect(screen.queryByTestId("ai-activity")).toBeNull();
  });

  test("cancel is present only while generating, and leaves no assistant message behind", async () => {
    const { runTool, release } = gatedTool(LIMITS_RESULT);
    scriptLlama([
      { emitToolCall: { name: "get_limits", args: {} } },
      { emit: "Your Groceries limit still has room." },
    ]);

    render(readySurface({ runTool }));
    expect(screen.queryByTestId("ai-cancel")).toBeNull();

    ask("how much is left in my limit?");
    await waitFor(() => {
      expect(screen.getByTestId("ai-cancel")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("ai-cancel"));
    await act(async () => {
      release();
    });

    await waitFor(() => {
      expect(screen.queryByTestId("ai-cancel")).toBeNull();
    });
    expect(screen.queryByText("Your Groceries limit still has room.")).toBeNull();
    expect(screen.queryByTestId("ai-stream")).toBeNull();
    expect(screen.queryByTestId("ai-activity")).toBeNull();
  });
});

describe("degradation", () => {
  test("a grounding failure renders the card with the TRUE figure and none of the prose", async () => {
    scriptLlama([
      { emitToolCall: { name: "get_spend_by_category", args: { period: "this_month" } } },
      { emit: "You spent ₱9,999.00 on Groceries this month." },
    ]);

    render(readySurface());
    ask("how much did I spend on groceries?");

    await waitFor(() => {
      expect(screen.getByTestId("grounded-card")).toBeTruthy();
    });

    // Regexes, not strings: RNTL's string form of this matcher is an exact,
    // whole-content comparison, and the card legitimately holds more than one
    // field.
    expect(screen.getByTestId("grounded-card")).toHaveTextContent(/₱2,400\.00/);
    expect(screen.getByTestId("grounded-card")).toHaveTextContent(/34%/);
    expect(screen.getByTestId("grounded-card")).toHaveTextContent(/Groceries · this month/);
    // The fabricated figure and the sentence carrying it are both gone.
    expect(screen.queryByText(/9,999/)).toBeNull();
    expect(screen.queryByText(/You spent/)).toBeNull();
    // A card is data, not a failure notice.
    expect(screen.queryByText(/something went wrong|error|try again/i)).toBeNull();
  });
});

describe("the disclaimer", () => {
  test("renders in full at first use, then only as a quiet marker", () => {
    const acknowledge = jest.fn();
    const { rerender } = render(
      readySurface({ disclaimerAcknowledged: false, onAcknowledgeDisclaimer: acknowledge }),
    );

    expect(screen.getByTestId("ai-disclaimer")).toBeTruthy();
    expect(screen.queryByTestId("ai-disclaimer-marker")).toBeNull();

    fireEvent.press(screen.getByTestId("ai-disclaimer-ack"));
    expect(acknowledge).toHaveBeenCalledTimes(1);

    rerender(readySurface({ disclaimerAcknowledged: true, onAcknowledgeDisclaimer: acknowledge }));

    expect(screen.queryByTestId("ai-disclaimer")).toBeNull();
    expect(screen.getByTestId("ai-disclaimer-marker")).toBeTruthy();
  });
});
