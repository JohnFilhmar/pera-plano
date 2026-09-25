// components/ai/__tests__/chat_surface.test.tsx — plan Task 23, reshaped for
// spec §7.4 on 2026-09-25.
//
// DRIVEN BY THE SCRIPTED BRIDGE, NOT BY PROPS. The surface runs the real
// `answerQuestion` over `test_support/llama_bridge_mock.ts`, so every assertion
// here is about what a user actually sees while a model decodes: a tool line
// filling the dead air before the first word, JSON that never renders as prose,
// a cancel that leaves nothing behind, and a bad sentence collapsing to the
// card that still carries the true figure.
//
// UNDER §7.4 A CHIP IS THE ONLY WAY TO THE MODEL. Typed text gets the app's own
// reply, and `generateCallCount()` staying at zero is how these tests prove it.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Text } from "react-native";

import { ChatSurface } from "../chat_surface";
import {
  CANNOT_ANSWER_REPLY,
  FREE_CHAT_REPLACED,
  LEVEL_MARKER,
  MONEY_TALK_NOTICE,
  SMALL_TALK_REPLY,
} from "../chat_copy";
import type { AnswerLevel } from "@/lib/ai/levels";
import { ok, type ToolResult } from "@/lib/ai/tools/types";
import { emitAppEvent } from "@/lib/events/app_events";
import {
  fakeLlamaBridge,
  generateCallCount,
  lastPromptGiven,
  resetLlamaScript,
  scriptLlama,
} from "@/test_support/llama_bridge_mock";

const NOW = 1_773_000_000_000;

/** The true figures. Nothing the model says may contradict these. */
const SPEND_RESULT: ToolResult<unknown> = ok("get_spend_by_category", { topCategory: "Groceries" }, [
  { key: "Groceries · this month", value: "₱2,400.00", kind: "amount" },
  { key: "share of your spending", value: "34%", kind: "percent" },
]);

const LIMITS_RESULT: ToolResult<unknown> = ok("get_limits", { count: 2 }, [
  { key: "Groceries limit left", value: "₱1,100.00", kind: "amount" },
]);

/** One result per snapshot tool, so free chat's corpus holds four distinct figures. */
const SNAPSHOT_RESULTS: Record<string, ToolResult<unknown>> = {
  get_balance_total: ok("get_balance_total", {}, [{ key: "total", value: "₱18,320.00", kind: "amount" }]),
  get_safe_to_spend: ok("get_safe_to_spend", {}, [{ key: "safe to spend", value: "₱4,000.00", kind: "amount" }]),
  get_limits: LIMITS_RESULT,
  get_spend_by_category: SPEND_RESULT,
};

const byName = async (name: string): Promise<ToolResult<unknown>> => SNAPSHOT_RESULTS[name] ?? SPEND_RESULT;

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
  level?: AnswerLevel;
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
      level={overrides.level ?? 1}
      model={{ knowledgeLimit: "April 2025", contextTokens: 2048 }}
    />
  );
}

function tap(questionId: string) {
  fireEvent.press(screen.getByTestId(`ai-question-chips-${questionId}`));
}

function type(text: string) {
  fireEvent.changeText(screen.getByTestId("ai-composer-input"), text);
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

beforeEach(() => {
  resetLlamaScript();
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
        level={1}
        model={null}
      />,
    );

    expect(screen.getByTestId("model-picker")).toBeTruthy();
    expect(screen.queryByTestId("ai-error")).toBeNull();
    expect(screen.queryByText(/something went wrong|couldn't|failed|unavailable/i)).toBeNull();
    // Nothing to ask yet: no chips and no composer.
    expect(screen.queryByTestId("ai-composer-input")).toBeNull();
    expect(screen.queryByTestId("ai-question-chips")).toBeNull();
  });

  test("waking up is distinguishable from no model: the picker never flashes at someone who has one", () => {
    render(
      <ChatSurface
        phase="waking"
        picker={<StubPicker />}
        bridge={fakeLlamaBridge}
        runTool={async () => SPEND_RESULT}
        now={() => NOW}
        disclaimerAcknowledged
        onAcknowledgeDisclaimer={() => {}}
        level={1}
        model={null}
      />,
    );

    expect(screen.getByTestId("ai-waking")).toBeTruthy();
    expect(screen.queryByTestId("model-picker")).toBeNull();
    expect(screen.queryByTestId("ai-no-model")).toBeNull();
    expect(screen.getByTestId("ai-waking")).toHaveTextContent(/waking up/i);
  });
});

describe("a tapped question", () => {
  test("shows as the user's own message and is answered from its tool", async () => {
    scriptLlama([{ emit: "Groceries took ₱2,400.00 this month." }]);
    render(readySurface());

    tap("spend_this_month");

    // Scoped to the transcript: the chip itself carries the same words.
    expect(within(screen.getByTestId("ai-transcript")).getByText("Where did my money go this month?")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Groceries took ₱2,400.00 this month.")).toBeTruthy();
    });
    expect(generateCallCount()).toBe(1);
  });

  test("tokens render incrementally, never spinner-then-dump", async () => {
    // `setImmediate` and the microtask queue stay REAL. React's async `act` and
    // RNTL's own flush both drain themselves through them, and faking those
    // deadlocks the flush against the very clock this test is holding still.
    jest.useFakeTimers({ doNotFake: ["setImmediate", "queueMicrotask", "nextTick"] });
    scriptLlama([{ emit: "Groceries was your biggest category.", perTokenDelayMs: 10 }]);

    render(readySurface());
    tap("spend_this_month");

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("ai-stream")).toHaveTextContent(/^Groceries$/);
    expect(screen.getByTestId("ai-stream")).not.toHaveTextContent(/was/);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("ai-stream")).toHaveTextContent(/^Groceries was$/);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("Groceries was your biggest category.")).toBeTruthy();
    expect(screen.queryByTestId("ai-stream")).toBeNull();
  });

  test("the tool line fills the wait before the first word", async () => {
    const { runTool, release } = gatedTool(LIMITS_RESULT);
    scriptLlama([{ emit: "Your Groceries limit has ₱1,100.00 left." }]);

    render(readySurface({ runTool }));
    tap("limits");

    await waitFor(() => {
      expect(screen.getByTestId("ai-activity")).toHaveTextContent(/looking at your limits/i);
    });

    await act(async () => {
      release();
    });

    await waitFor(() => {
      expect(screen.getByText("Your Groceries limit has ₱1,100.00 left.")).toBeTruthy();
    });
    expect(screen.queryByTestId("ai-activity")).toBeNull();
  });

  test("JSON from the model never renders as prose", async () => {
    scriptLlama([{ emitRaw: '{"tool":"get_wal' }]);
    render(readySurface());

    tap("spend_this_month");

    await waitFor(() => {
      expect(screen.getByTestId("grounded-card")).toBeTruthy();
    });
    expect(screen.queryByText(/get_wal/)).toBeNull();
    expect(screen.queryByText(/\{/)).toBeNull();
  });

  test("the chips stop being tappable while an answer is being written", async () => {
    const { runTool, release } = gatedTool(LIMITS_RESULT);
    scriptLlama([{ emit: "Your Groceries limit has ₱1,100.00 left." }]);

    render(readySurface({ runTool }));
    tap("limits");
    await waitFor(() => {
      expect(screen.getByTestId("ai-cancel")).toBeTruthy();
    });

    // A second tap mid-answer must not start a second turn.
    tap("wallets");
    expect(within(screen.getByTestId("ai-transcript")).queryByText("What wallets do I have?")).toBeNull();

    await act(async () => {
      release();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("ai-cancel")).toBeNull();
    });
  });

  test("cancel is present only while generating, and leaves no assistant message behind", async () => {
    const { runTool, release } = gatedTool(LIMITS_RESULT);
    scriptLlama([{ emit: "Your Groceries limit has ₱1,100.00 left." }]);

    render(readySurface({ runTool }));
    expect(screen.queryByTestId("ai-cancel")).toBeNull();

    tap("limits");
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
    expect(screen.queryByText("Your Groceries limit has ₱1,100.00 left.")).toBeNull();
    expect(screen.queryByTestId("ai-stream")).toBeNull();
    expect(screen.queryByTestId("ai-activity")).toBeNull();
  });
});

describe("typed text never reaches the model", () => {
  test("hello gets a greeting back, not a wallet list", async () => {
    render(readySurface());
    type("hello");

    await waitFor(() => {
      expect(screen.getByText(SMALL_TALK_REPLY.greeting.en)).toBeTruthy();
    });
    expect(generateCallCount()).toBe(0);
  });

  test("a greeting in Filipino is answered in Filipino", async () => {
    render(readySurface());
    type("Kumusta po");

    await waitFor(() => {
      expect(screen.getByText(SMALL_TALK_REPLY.greeting.fil)).toBeTruthy();
    });
  });

  test("a typed ledger question points back at the chips instead of guessing", async () => {
    const runTool = jest.fn(async () => SPEND_RESULT);
    render(readySurface({ runTool }));
    type("How much money do I have?");

    await waitFor(() => {
      expect(screen.getByText(CANNOT_ANSWER_REPLY.en)).toBeTruthy();
    });
    expect(runTool).not.toHaveBeenCalled();
    expect(generateCallCount()).toBe(0);
  });

  test("the cannot-answer line follows the message's language", async () => {
    render(readySurface());
    type("Magkano pera ko?");

    await waitFor(() => {
      expect(screen.getByText(CANNOT_ANSWER_REPLY.fil)).toBeTruthy();
    });
  });

  test("an advice question still gets the redirect with data, and still no model", async () => {
    render(readySurface());
    type("Should I buy a new phone?");

    await waitFor(() => {
      expect(screen.getByTestId("grounded-card")).toBeTruthy();
    });
    expect(screen.getByText(/does not tell you what to do with your money/)).toBeTruthy();
    expect(generateCallCount()).toBe(0);
  });
});

describe("degradation", () => {
  test("a grounding failure renders the card with the TRUE figure and none of the prose", async () => {
    scriptLlama([{ emit: "You spent ₱9,999.00 on Groceries this month." }]);

    render(readySurface());
    tap("spend_this_month");

    await waitFor(() => {
      expect(screen.getByTestId("grounded-card")).toBeTruthy();
    });

    // Regexes, not strings: RNTL's string form of this matcher is an exact,
    // whole-content comparison, and the card legitimately holds more than one
    // field.
    expect(screen.getByTestId("grounded-card")).toHaveTextContent(/₱2,400\.00/);
    expect(screen.getByTestId("grounded-card")).toHaveTextContent(/34%/);
    expect(screen.getByTestId("grounded-card")).toHaveTextContent(/Groceries · this month/);
    expect(screen.queryByText(/9,999/)).toBeNull();
    expect(screen.queryByText(/You spent/)).toBeNull();
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

describe("answer levels", () => {
  test("level 2: a typed ledger question is answered as its chip, labelled with the question", async () => {
    scriptLlama([{ emit: "You have ₱2,400.00 in total." }]);
    const runTool = jest.fn(async () => SPEND_RESULT);
    render(readySurface({ runTool, level: 2 }));

    type("magkano pera ko");

    await waitFor(() => {
      expect(screen.getByText("You have ₱2,400.00 in total.")).toBeTruthy();
    });
    expect(screen.getByTestId("ai-answering")).toHaveTextContent("Answering: How much money do I have?");
    expect(runTool).toHaveBeenCalledWith("get_balance_total", {}, NOW);
  });

  test("level 2: anything else typed still gets cannot-answer, with no model", async () => {
    render(readySurface({ level: 2 }));
    type("What is bitcoin?");

    await waitFor(() => {
      expect(screen.getByText(CANNOT_ANSWER_REPLY.en)).toBeTruthy();
    });
    expect(generateCallCount()).toBe(0);
  });

  test("level 3: free chat answers from the model, with no notice", async () => {
    scriptLlama([{ emit: "Your records show ₱2,400.00 on Groceries." }]);
    render(readySurface({ level: 3, runTool: byName }));
    type("How was my week?");

    await waitFor(() => {
      expect(screen.getByText("Your records show ₱2,400.00 on Groceries.")).toBeTruthy();
    });
    expect(screen.queryByTestId("ai-answer-notice")).toBeNull();
  });

  test("level 4: a free-chat answer carries the general-knowledge notice", async () => {
    scriptLlama([{ emit: "An emergency fund is money set aside for surprises." }]);
    render(readySurface({ level: 4, runTool: byName }));
    type("What is an emergency fund?");

    await waitFor(() => {
      expect(screen.getByTestId("ai-answer-notice")).toHaveTextContent(MONEY_TALK_NOTICE);
    });
  });

  test("level 5: the notice names the model's knowledge limit", async () => {
    scriptLlama([{ emit: "José Rizal was a Filipino writer." }]);
    render(readySurface({ level: 5, runTool: byName }));
    type("Who was José Rizal?");

    await waitFor(() => {
      expect(screen.getByTestId("ai-answer-notice")).toHaveTextContent(
        "From the model's memory. It can be wrong, and it knows nothing after April 2025.",
      );
    });
  });

  test("a free-chat answer that fails grounding is replaced, never shown", async () => {
    scriptLlama([{ emit: "You have ₱99,999.00 saved." }]);
    render(readySurface({ level: 3, runTool: byName }));
    type("Am I doing well?");

    await waitFor(() => {
      expect(screen.getByText(FREE_CHAT_REPLACED.ungrounded.en)).toBeTruthy();
    });
    expect(screen.queryByText(/99,999/)).toBeNull();
  });

  test("a follow-up carries the earlier exchange to the model", async () => {
    scriptLlama([{ emit: "You have ₱18,320.00 in total." }, { emit: "That is across all your wallets." }]);
    render(readySurface({ level: 3, runTool: byName }));

    type("Tell me about my money");
    await waitFor(() => {
      expect(screen.getByText("You have ₱18,320.00 in total.")).toBeTruthy();
    });
    type("Is that a lot?");
    await waitFor(() => {
      expect(screen.getByText("That is across all your wallets.")).toBeTruthy();
    });

    expect(lastPromptGiven()).toContain("User: Tell me about my money");
    expect(lastPromptGiven()).toContain("Assistant: You have ₱18,320.00 in total.");
  });

  test("the lock clears what the model would be sent back, not only the screen", async () => {
    scriptLlama([{ emit: "You have ₱18,320.00 in total." }, { emit: "Nothing earlier is on record here." }]);
    render(readySurface({ level: 3, runTool: byName }));

    type("Tell me about my money");
    await waitFor(() => {
      expect(screen.getByText("You have ₱18,320.00 in total.")).toBeTruthy();
    });
    await act(async () => {
      await emitAppEvent("lock:engaged", {});
    });
    type("What did I just ask?");
    await waitFor(() => {
      expect(screen.getByText("Nothing earlier is on record here.")).toBeTruthy();
    });

    expect(lastPromptGiven()).not.toContain("Tell me about my money");
  });

  test("the top line follows the level", () => {
    render(readySurface({ level: 5 }));
    expect(screen.getByTestId("ai-disclaimer-marker")).toHaveTextContent(LEVEL_MARKER[5]);
  });
});
