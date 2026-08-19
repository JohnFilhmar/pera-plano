// mobile/contexts/__tests__/keypad_context.test.tsx — W1 Task 3.
//
// THE HOST REGISTRY IS WHY THIS FILE EXISTS. components/ui/bottom_sheet.tsx
// is built on the platform Modal, which is its own native window, so a keypad
// hosted once at the root renders BEHIND any open sheet -- and three numeric
// fields live inside sheets. The rule is "the most recently mounted host
// wins", and these tests pin it without a renderer for the panel itself.
import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { useEffect, useRef } from "react";

import { KeypadProvider, useKeypad } from "../keypad_context";

/** Mounts and holds a host token for as long as it is rendered. */
function FakeHost({ name }: { name: string }) {
  const { registerHost, releaseHost, activeHost } = useKeypad();
  const tokenRef = useRef<number | null>(null);

  useEffect(() => {
    const token = registerHost();
    tokenRef.current = token;
    return () => releaseHost(token);
  }, [registerHost, releaseHost]);

  const mine = tokenRef.current !== null && tokenRef.current === activeHost;
  return <Text testID={`host-${name}`}>{mine ? "active" : "idle"}</Text>;
}

function Probe() {
  const { request } = useKeypad();
  return <Text testID="probe">{request === null ? "closed" : request.fieldId}</Text>;
}

function state(): string {
  return String(screen.getByTestId("probe").props.children);
}

function hostState(name: string): string {
  return String(screen.getByTestId(`host-${name}`).props.children);
}

test("the most recently mounted host is the active one", () => {
  const { rerender } = render(
    <KeypadProvider>
      <Probe />
      <FakeHost name="root" />
    </KeypadProvider>,
  );

  expect(hostState("root")).toBe("active");

  rerender(
    <KeypadProvider>
      <Probe />
      <FakeHost name="root" />
      <FakeHost name="sheet" />
    </KeypadProvider>,
  );

  expect(hostState("sheet")).toBe("active");
  expect(hostState("root")).toBe("idle");
});

test("the root host takes over again when the sheet host unmounts", () => {
  const { rerender } = render(
    <KeypadProvider>
      <Probe />
      <FakeHost name="root" />
      <FakeHost name="sheet" />
    </KeypadProvider>,
  );

  rerender(
    <KeypadProvider>
      <Probe />
      <FakeHost name="root" />
    </KeypadProvider>,
  );

  expect(hostState("root")).toBe("active");
});

test("a sheet closing while the keypad is open closes the keypad", () => {
  // Not silently re-parented: a keypad that outlives the field it was editing
  // has nowhere to commit to.
  let openIt: () => void = () => {};

  function Opener() {
    const { open } = useKeypad();
    openIt = () =>
      open({ fieldId: "sheet-amount", label: "Amount", mode: "peso", text: "", onChangeText: () => {} });
    return null;
  }

  const { rerender } = render(
    <KeypadProvider>
      <Probe />
      <Opener />
      <FakeHost name="root" />
      <FakeHost name="sheet" />
    </KeypadProvider>,
  );

  act(() => openIt());
  expect(state()).toBe("sheet-amount");

  rerender(
    <KeypadProvider>
      <Probe />
      <Opener />
      <FakeHost name="root" />
    </KeypadProvider>,
  );

  expect(state()).toBe("closed");
});

test("emit routes keystrokes to the focused field's handler", () => {
  const onChangeText = jest.fn();
  let openIt: () => void = () => {};
  let emitIt: (text: string) => void = () => {};

  function Opener() {
    const { open, emit } = useKeypad();
    openIt = () => open({ fieldId: "a", label: "A", mode: "peso", text: "", onChangeText });
    emitIt = emit;
    return null;
  }

  render(
    <KeypadProvider>
      <Probe />
      <Opener />
    </KeypadProvider>,
  );

  act(() => openIt());
  act(() => emitIt("12"));

  expect(onChangeText).toHaveBeenCalledWith("12");
});

test("opening a second field swaps focus without closing", () => {
  let openA: () => void = () => {};
  let openB: () => void = () => {};

  function Opener() {
    const { open } = useKeypad();
    openA = () => open({ fieldId: "a", label: "A", mode: "peso", text: "", onChangeText: () => {} });
    openB = () => open({ fieldId: "b", label: "B", mode: "peso", text: "", onChangeText: () => {} });
    return null;
  }

  render(
    <KeypadProvider>
      <Probe />
      <Opener />
    </KeypadProvider>,
  );

  act(() => openA());
  act(() => openB());

  expect(state()).toBe("b");
});

test("close clears the request", () => {
  let openIt: () => void = () => {};
  let closeIt: () => void = () => {};

  function Opener() {
    const { open, close } = useKeypad();
    openIt = () => open({ fieldId: "a", label: "A", mode: "peso", text: "", onChangeText: () => {} });
    closeIt = close;
    return null;
  }

  render(
    <KeypadProvider>
      <Probe />
      <Opener />
    </KeypadProvider>,
  );

  act(() => openIt());
  act(() => closeIt());

  expect(state()).toBe("closed");
});

test("useKeypad outside a provider throws rather than silently no-opping", () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  function Bare() {
    useKeypad();
    return null;
  }
  expect(() => render(<Bare />)).toThrow("useKeypad must be used within KeypadProvider");
  spy.mockRestore();
});
