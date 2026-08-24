// mobile/contexts/__tests__/keypad_context.test.tsx — W1 Task 3.
//
// THE HOST REGISTRY IS WHY THIS FILE EXISTS. components/ui/bottom_sheet.tsx
// is built on the platform Modal, which is its own native window, so a keypad
// hosted once at the root renders BEHIND any open sheet -- and three numeric
// fields live inside sheets. The rule is "the most recently mounted host
// wins", and these tests pin it without a renderer for the panel itself.
import { act, render, screen } from "@testing-library/react-native";
import { Keyboard, Text } from "react-native";
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

// ---------------------------------------------------------------------------
// THE PUBLISHED HEIGHT DIES WITH THE HOST (final review, Critical 2)
// ---------------------------------------------------------------------------
//
// components/ui/keypad_host.tsx zeroes `keypadHeight` from an effect keyed on
// its own `visible`, which fires only on a TRANSITION. When a sheet host takes
// the panel the root host has ALREADY gone `visible: false` and already run
// that effect — so when the sheet host is then torn down, nothing at the root
// re-runs and the sheet's measured ~350dp survives the panel it measured.
// Every consumer keeps reserving a band for a panel that is gone.
//
// FakeHost below deliberately does NOT touch the height, which is the point:
// this pins the guarantee on the PROVIDER, the only place that knows a host
// died, rather than on the host's own cleanup.
describe("the published keypad height", () => {
  function HeightProbe() {
    const { keypadHeight } = useKeypad();
    return <Text testID="height">{String(keypadHeight)}</Text>;
  }

  function height(): string {
    return String(screen.getByTestId("height").props.children);
  }

  test("goes back to zero when the host that was drawing the panel unmounts", () => {
    let openIt: () => void = () => {};
    let measure: (value: number) => void = () => {};

    function Opener() {
      const { open, setKeypadHeight } = useKeypad();
      openIt = () =>
        open({ fieldId: "a", label: "A", mode: "peso", text: "", onChangeText: () => {} });
      measure = setKeypadHeight;
      return null;
    }

    const { rerender } = render(
      <KeypadProvider>
        <HeightProbe />
        <Opener />
        <FakeHost name="root" />
        <FakeHost name="sheet" />
      </KeypadProvider>,
    );

    act(() => openIt());
    // What the sheet host's onLayout does once it is the one drawing.
    act(() => measure(350));
    expect(height()).toBe("350");

    rerender(
      <KeypadProvider>
        <HeightProbe />
        <Opener />
        <FakeHost name="root" />
      </KeypadProvider>,
    );

    // Without this the next sheet gets a ~380dp dead band under Confirm, every
    // migrated form gets ~374px of phantom bottom padding, and the onboarding
    // footer floats ~330dp up — until someone opens AND closes a keypad at the
    // root, which is the only thing that used to reset it.
    expect(height()).toBe("0");
  });

  test("survives an INACTIVE host unmounting, which measured nothing", () => {
    // The guard on the reset: only the host that was actually drawing takes
    // the height with it. A root host disappearing under an open sheet must
    // not wipe the height that sheet just published.
    let openIt: () => void = () => {};
    let measure: (value: number) => void = () => {};

    function Opener() {
      const { open, setKeypadHeight } = useKeypad();
      openIt = () =>
        open({ fieldId: "a", label: "A", mode: "peso", text: "", onChangeText: () => {} });
      measure = setKeypadHeight;
      return null;
    }

    const { rerender } = render(
      <KeypadProvider>
        <Probe />
        <HeightProbe />
        <Opener />
        <FakeHost name="root" />
        <FakeHost name="sheet" />
      </KeypadProvider>,
    );

    act(() => openIt());
    act(() => measure(350));

    rerender(
      <KeypadProvider>
        <Probe />
        <HeightProbe />
        <Opener />
        {null}
        <FakeHost name="sheet" />
      </KeypadProvider>,
    );

    expect(height()).toBe("350");
    expect(state()).toBe("a");
  });
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

// ---------------------------------------------------------------------------
// TWO KEYBOARDS MUST NEVER BE UP AT ONCE (owner's device report).
//
// The reenactment, in their words: "user selects an input to enter an
// alphanumeric characters; user types; user sees another input; user focuses to
// the number only input price etc.; app behaves as user phone keyboard still
// open, app opens numpad user keyboard does not close by itself."
//
// WHY IT HAPPENS. components/ui/numeric_field.tsx is a Pressable, and that is
// the whole point of its design — a component with no TextInput in its tree
// cannot raise the OS keyboard however it is later edited. But the same
// property means tapping it never BLURS the TextInput that is currently
// focused either, because nothing about a Pressable press touches focus. The
// OS keyboard therefore stays up, our panel rises in front of it, and the user
// has to dismiss the OS one by hand. `Keyboard.dismiss` appeared nowhere in
// this codebase before these tests.
//
// WHY BOTH DIRECTIONS ARE ENFORCED HERE AND NOT IN THE FORMS. Nine screens mix
// TextInputs with NumericFields (bill_form, goal_form, loan_form,
// first_limit_form, income_quick_form, quick_wallet_list, correct_sheet,
// manual_entry_form, wallet_form). Wiring an `onFocus` into every TextInput on
// all nine is a convention someone forgets on the tenth; doing it once in the
// provider makes "only one keyboard is ever up" a property of the system, the
// same argument numeric_field.tsx's own header makes for being a Pressable.
//
// NO FEEDBACK LOOP. `Keyboard.dismiss()` raises `keyboardDidHide`, never
// `keyboardDidShow`, so the dismissal below cannot re-enter the close path.
// ---------------------------------------------------------------------------

describe("the two keyboards", () => {
  function OpenerOnly({ fieldId = "a" }: { fieldId?: string }) {
    const { open } = useKeypad();
    openField = () =>
      open({ fieldId, label: "A", mode: "peso", text: "", onChangeText: () => {} });
    return null;
  }

  let openField: () => void = () => {};

  test("opening the panel dismisses the system keyboard", () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});

    render(
      <KeypadProvider>
        <Probe />
        <OpenerOnly />
      </KeypadProvider>,
    );
    expect(dismiss).not.toHaveBeenCalled(); // not merely on mount

    act(() => openField());

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(state()).toBe("a");
    dismiss.mockRestore();
  });

  test("the system keyboard appearing closes the panel", () => {
    // The reverse trip: panel open on an amount, user taps a text field. The
    // OS raises its keyboard, and ours must get out of the way rather than
    // stack in front of it.
    const handlers: Record<string, (...args: never[]) => void> = {};
    const add = jest.spyOn(Keyboard, "addListener").mockImplementation(((
      event: string,
      handler: (...args: never[]) => void,
    ) => {
      handlers[event] = handler;
      return { remove: jest.fn() };
    }) as never);

    render(
      <KeypadProvider>
        <Probe />
        <OpenerOnly />
      </KeypadProvider>,
    );

    act(() => openField());
    expect(state()).toBe("a");

    act(() => handlers.keyboardDidShow?.());

    expect(state()).toBe("closed");
    add.mockRestore();
  });

  test("it unsubscribes from the keyboard when the provider goes away", () => {
    // A provider is torn down and rebuilt on every lock/unlock (app/_layout.tsx
    // mounts it INSIDE the lock gate, deliberately). A listener that outlived
    // it would call setState on a dead tree once per keyboard raise, forever.
    const remove = jest.fn();
    const add = jest
      .spyOn(Keyboard, "addListener")
      .mockImplementation(() => ({ remove }) as never);

    const { unmount } = render(
      <KeypadProvider>
        <Probe />
      </KeypadProvider>,
    );
    unmount();

    expect(remove).toHaveBeenCalled();
    add.mockRestore();
  });
});
