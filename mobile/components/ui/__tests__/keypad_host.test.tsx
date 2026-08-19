// mobile/components/ui/__tests__/keypad_host.test.tsx — W1 Task 4.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { BackHandler, Modal, Pressable, Text } from "react-native";
import { useEffect, useState } from "react";

import { KeypadProvider, useKeypad } from "@/contexts/keypad_context";
import { BottomSheet } from "../bottom_sheet";
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

test("renders nothing when there is no KeypadProvider above it", () => {
  // The reason KeypadHost reads the context optionally. components/ui/
  // bottom_sheet.tsx mounts one inside every sheet, and BottomSheet is a
  // shared primitive that a dozen suites render on its own — a throwing read
  // would make KeypadProvider a dependency of all of them.
  render(<KeypadHost />);

  expect(screen.queryByTestId("keypad-host")).toBeNull();
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

/**
 * SYSTEM BACK INSIDE A SHEET GOES THROUGH THE MODAL, NOT THROUGH BackHandler.
 *
 * On Android a Modal is a Dialog, and its key listener swallows KEYCODE_BACK
 * and calls `onRequestClose`; the Activity back press that drives JS
 * `BackHandler` listeners never fires while the dialog has focus. So the
 * host's own subscription — the one the test above proves works — is dead
 * inside a sheet, and without the routing in bottom_sheet.tsx a single back
 * press would dismiss the whole sheet and discard a half-filled form.
 *
 * These two tests are the pair that pins the routing: the keypad gets back
 * FIRST, and the sheet gets it back once the keypad is gone.
 */
describe("system back inside a sheet", () => {
  function renderSheet(onDismiss: () => void) {
    render(
      <KeypadProvider>
        <BottomSheet visible onDismiss={onDismiss} title="Pick a wallet">
          <Opener />
        </BottomSheet>
      </KeypadProvider>,
    );
  }

  /** What Android's dialog does to a back press. */
  function requestClose(): void {
    const modal = screen.UNSAFE_getByType(Modal);
    expect(typeof modal.props.onRequestClose).toBe("function");
    // act() for the same reason the hardware-back test above needs it: this
    // call comes from outside React.
    act(() => {
      (modal.props.onRequestClose as () => void)();
    });
  }

  test("back closes the keypad and leaves the sheet open", () => {
    const onDismiss = jest.fn();
    renderSheet(onDismiss);
    press("open-amount");
    expect(screen.getByTestId("keypad-host")).toBeTruthy();

    requestClose();

    expect(screen.queryByTestId("keypad-host")).toBeNull();
    // The form is still there. This is the whole point.
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId("open-amount")).toBeTruthy();
  });

  test("back dismisses the sheet once the keypad is closed", () => {
    const onDismiss = jest.fn();
    renderSheet(onDismiss);

    requestClose();

    // No panel to claim it, so the sheet's own dismissal is untouched.
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
