// mobile/components/ui/__tests__/keypad_host.test.tsx — W1 Task 4.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { BackHandler, Pressable, Text } from "react-native";
import { useEffect, useState } from "react";

import { KeypadProvider, useKeypad } from "@/contexts/keypad_context";
import { KeypadHost } from "../keypad_host";

/**
 * A field-shaped opener that keeps its own text, exactly as the real
 * NumericField does — including the sync effect, which is what keeps the
 * panel's copy of the text from going stale as the value grows.
 */
function Opener({
  fieldId = "amount",
  label = "Amount",
  mode = "peso" as const,
}: {
  fieldId?: string;
  label?: string;
  mode?: "peso" | "integer" | "rate";
}) {
  const { open, syncFocused, request } = useKeypad();
  const [text, setText] = useState("");
  const focused = request?.fieldId === fieldId;

  // In an effect, never during render: syncFocused calls setState, and doing
  // that in a render body is the warning-then-loop the real field avoids too.
  useEffect(() => {
    if (!focused) return;
    syncFocused(fieldId, text, setText);
  }, [focused, fieldId, text, syncFocused]);

  return (
    <>
      <Pressable
        testID={`open-${fieldId}`}
        onPress={() => open({ fieldId, label, mode, text, onChangeText: setText })}
      >
        <Text>open</Text>
      </Pressable>
      <Text testID={`value-${fieldId}`}>{text}</Text>
    </>
  );
}

function press(testID: string): void {
  fireEvent.press(screen.getByTestId(testID));
}

function display(): string {
  return String(screen.getByTestId("keypad-display").props.children);
}

function renderHost(mode: "peso" | "integer" | "rate" = "peso") {
  render(
    <KeypadProvider>
      <Opener mode={mode} />
      <KeypadHost />
    </KeypadProvider>,
  );
}

test("the panel is absent until a field opens it", () => {
  renderHost();

  expect(screen.queryByTestId("keypad-host")).toBeNull();

  press("open-amount");

  expect(screen.getByTestId("keypad-host")).toBeTruthy();
  expect(screen.getByTestId("keypad-label").props.children).toBe("Amount");
});

test("keystrokes build a peso amount and show it grouped", () => {
  renderHost();
  press("open-amount");

  for (const key of ["1", "0", "0", "0"]) press(`keypad-key-${key}`);

  expect(display()).toBe("₱1,000");
  expect(screen.getByTestId("value-amount").props.children).toBe("1000");
});

test("the decimal point survives as an intermediate state", () => {
  renderHost();
  press("open-amount");

  for (const key of ["1", "0", ".", "5"]) press(`keypad-key-${key}`);

  expect(display()).toBe("₱10.5");
});

test("backspace removes one character", () => {
  renderHost();
  press("open-amount");
  for (const key of ["1", "2", "3"]) press(`keypad-key-${key}`);

  press("keypad-backspace");

  expect(screen.getByTestId("value-amount").props.children).toBe("12");
});

test("long-pressing backspace clears", () => {
  renderHost();
  press("open-amount");
  for (const key of ["1", "2", "3"]) press(`keypad-key-${key}`);

  fireEvent(screen.getByTestId("keypad-backspace"), "longPress");

  expect(screen.getByTestId("value-amount").props.children).toBe("");
});

describe("dismissal", () => {
  // x and Done are the SAME action. The field commits on every keystroke, so
  // by the time either is pressed there is nothing uncommitted to discard.
  test("Done closes the panel and keeps the value", () => {
    renderHost();
    press("open-amount");
    for (const key of ["5", "0"]) press(`keypad-key-${key}`);

    press("keypad-done");

    expect(screen.queryByTestId("keypad-host")).toBeNull();
    expect(screen.getByTestId("value-amount").props.children).toBe("50");
  });

  test("x closes the panel and keeps the value, identically", () => {
    renderHost();
    press("open-amount");
    for (const key of ["5", "0"]) press(`keypad-key-${key}`);

    press("keypad-close");

    expect(screen.queryByTestId("keypad-host")).toBeNull();
    expect(screen.getByTestId("value-amount").props.children).toBe("50");
  });

  test("hardware back closes the panel and is consumed, not navigated", () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((_event, handler) => {
        handlers.push(handler as () => boolean);
        return { remove: () => {} } as never;
      });

    renderHost();
    press("open-amount");

    // Through act(), unlike the fireEvent presses above. Android calls this
    // handler from outside React, so the setState it raises is not inside an
    // event React already knows about — without act() React schedules the
    // close and the assertion below reads the tree from before it.
    let consumed: boolean[] = [];
    act(() => {
      consumed = handlers.map((handler) => handler());
    });

    expect(consumed).toContain(true);
    expect(screen.queryByTestId("keypad-host")).toBeNull();
    spy.mockRestore();
  });
});

test("rate mode suffixes a percent sign", () => {
  renderHost("rate");
  press("open-amount");

  for (const key of ["1", "2"]) press(`keypad-key-${key}`);

  expect(display()).toBe("12%");
});

test("integer mode shows the raw number and refuses the decimal key", () => {
  renderHost("integer");
  press("open-amount");

  for (const key of ["6"]) press(`keypad-key-${key}`);
  press("keypad-key-.");

  expect(display()).toBe("6");
  expect(screen.getByTestId("value-amount").props.children).toBe("6");
});

test("only the most recently mounted host draws the panel", () => {
  render(
    <KeypadProvider>
      <Opener />
      <KeypadHost />
      <KeypadHost />
    </KeypadProvider>,
  );

  press("open-amount");

  // Two hosts are mounted; exactly one renders.
  expect(screen.getAllByTestId("keypad-host")).toHaveLength(1);
});
