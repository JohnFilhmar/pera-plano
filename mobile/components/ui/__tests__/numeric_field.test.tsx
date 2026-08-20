// mobile/components/ui/__tests__/numeric_field.test.tsx — W1 Task 5.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { TextInput } from "react-native";
import { NavigationContext } from "@react-navigation/native";
import { useState, type ReactNode } from "react";

import { KeypadProvider } from "@/contexts/keypad_context";
import { KeypadHost } from "../keypad_host";
import { NumericField } from "../numeric_field";
import type { KeypadMode } from "../numeric_keypad";

// Explicit prop typing (rather than letting `mode`'s default infer its own
// type) because `mode = "peso" as const` alone locks the inferred type to
// the single literal "peso" and rejects every other KeypadMode a test below
// passes in.
function Harness({ initial = "", mode = "peso" }: { initial?: string; mode?: KeypadMode }) {
  const [value, setValue] = useState(initial);
  return (
    <KeypadProvider>
      <NumericField
        testID="amount"
        label="How much?"
        mode={mode}
        placeholder="Amount"
        value={value}
        onChangeText={setValue}
      />
      <KeypadHost />
    </KeypadProvider>
  );
}

test("THE GUARANTEE: the field renders no TextInput, so no OS keyboard can appear", () => {
  // showSoftInputOnFocus={false} on a real TextInput is the other way to do
  // this, and it is a prop one future edit can drop. A tree with no text
  // input in it cannot raise a keyboard no matter what anyone does later.
  render(<Harness />);

  expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
});

test("pressing the field opens the keypad with its label and mode", () => {
  render(<Harness />);

  fireEvent.press(screen.getByTestId("amount"));

  expect(screen.getByTestId("keypad-host")).toBeTruthy();
  expect(screen.getByTestId("keypad-label").props.children).toBe("How much?");
});

test("keystrokes flow back into the field's own value", () => {
  render(<Harness />);
  fireEvent.press(screen.getByTestId("amount"));

  for (const key of ["1", "0", "0", "0"]) {
    fireEvent.press(screen.getByTestId(`keypad-key-${key}`));
  }

  // Closed first: while the panel is open, "₱1,000" renders in both the
  // field and the panel's own display, and getByText throws on multiple
  // matches. Closing is also what a user actually does to finish entry.
  fireEvent.press(screen.getByTestId("keypad-done"));

  expect(screen.getByText("₱1,000")).toBeTruthy();
});

test("the panel stays in sync as the value grows", () => {
  render(<Harness />);
  fireEvent.press(screen.getByTestId("amount"));

  for (const key of ["9", "9"]) {
    fireEvent.press(screen.getByTestId(`keypad-key-${key}`));
  }

  expect(String(screen.getByTestId("keypad-display").props.children)).toBe("₱99");
});

test("an empty field shows its placeholder", () => {
  render(<Harness />);

  expect(screen.getByText("Amount")).toBeTruthy();
});

test("a seeded field shows the formatted amount", () => {
  render(<Harness initial="1000.50" />);

  expect(screen.getByText("₱1,000.50")).toBeTruthy();
});

test("integer mode shows the raw number, unformatted", () => {
  render(<Harness initial="6" mode="integer" />);

  expect(screen.getByText("6")).toBeTruthy();
});

test("the field is announced with its label and value", () => {
  render(<Harness initial="1000" />);

  expect(screen.getByLabelText("How much?, ₱1,000")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// THE PANEL DOES NOT OUTLIVE THE FIELD (final review, Critical 1)
// ---------------------------------------------------------------------------
//
// Spec §4.2's "navigate away / host unmounts → close" was half-built: the
// provider's releaseHost fires when a HOST unmounts, and the root host beside
// the Stack (app/_layout.tsx) never does. So on every migrated form the
// sequence "tap the amount, tap Save" — Save is reachable while the panel is
// open by design, and calls router.back() — unmounted the screen and left the
// panel floating over the previous one, wired to a setState on a component
// that no longer exists, with the host's live BackHandler eating the user's
// next back press instead of navigating.
//
// The tree below keeps KeypadProvider and KeypadHost at fixed positions and
// swaps only the screen out, which is the shape a stack pop actually takes.
// Unmounting the whole render result would take the host with it and would
// pass with no fix at all.
describe("unmounting the screen that opened the panel", () => {
  function Screen({ fieldId = "amount" }: { fieldId?: string }) {
    const [value, setValue] = useState("");
    return (
      <NumericField testID={fieldId} label={`Label ${fieldId}`} value={value} onChangeText={setValue} />
    );
  }

  function tree(inner: ReactNode) {
    return (
      <KeypadProvider>
        {inner}
        <KeypadHost />
      </KeypadProvider>
    );
  }

  test("closes the panel when that screen's field was the focused one", () => {
    const view = render(tree(<Screen />));
    fireEvent.press(screen.getByTestId("amount"));
    expect(screen.getByTestId("keypad-host")).toBeTruthy(); // sanity: open first

    view.rerender(tree(null));

    expect(screen.queryByTestId("keypad-host")).toBeNull();
  });

  test("leaves the panel alone when the field going away was not the focused one", () => {
    // The other half of the same rule, and the reason the cleanup is
    // ownership-checked rather than unconditional: a conditional row or a
    // re-keyed list item disappearing must not close a panel that belongs to
    // a different field.
    //
    // Every child holds its slot across the rerender — only the second one
    // becomes null. Swapping the SHAPE of the children instead (a fragment
    // for a lone element, say) makes React remount the whole subtree, which
    // would unmount the focused field as well and quietly test nothing.
    function pair(showOther: boolean) {
      return (
        <KeypadProvider>
          <Screen fieldId="amount" />
          {showOther ? <Screen fieldId="other" /> : null}
          <KeypadHost />
        </KeypadProvider>
      );
    }

    const view = render(pair(true));
    fireEvent.press(screen.getByTestId("amount"));

    view.rerender(pair(false));

    expect(screen.queryByTestId("other")).toBeNull(); // sanity: it really went
    expect(screen.getByTestId("keypad-host")).toBeTruthy();
    expect(screen.getByTestId("keypad-label").props.children).toBe("Label amount");
  });
});

// ---------------------------------------------------------------------------
// disabled (final review, Important 4)
// ---------------------------------------------------------------------------
describe("disabled", () => {
  function DisabledHarness({ disabled }: { disabled: boolean }) {
    return (
      <KeypadProvider>
        <NumericField
          testID="amount"
          label="How much?"
          disabled={disabled}
          value="1000"
          onChangeText={() => {}}
        />
        <KeypadHost />
      </KeypadProvider>
    );
  }

  test("a disabled field does not open the panel", () => {
    render(<DisabledHarness disabled />);

    fireEvent.press(screen.getByTestId("amount"));

    expect(screen.queryByTestId("keypad-host")).toBeNull();
  });

  test("a disabled field says so to a screen reader", () => {
    // What editable={false} on the TextInput this replaces gave for free. The
    // two call sites that hand-rolled pointerEvents wrappers instead left the
    // field announcing itself as an ordinary button that then ignored taps.
    render(<DisabledHarness disabled />);

    expect(screen.getByTestId("amount").props.accessibilityState.disabled).toBe(true);
  });

  test("a disabled field is visibly dimmed, so it does not look tappable", () => {
    render(<DisabledHarness disabled />);

    expect(String(screen.getByTestId("amount").props.className)).toMatch(/opacity-50/u);
  });

  test("an enabled field is neither dimmed nor announced as disabled", () => {
    render(<DisabledHarness disabled={false} />);

    expect(screen.getByTestId("amount").props.accessibilityState.disabled).toBe(false);
    expect(String(screen.getByTestId("amount").props.className)).not.toMatch(/opacity-50/u);
  });
});

// ---------------------------------------------------------------------------
// A SEEDED FIGURE IS REPLACED, NOT APPENDED TO (final review, Important 5)
// ---------------------------------------------------------------------------
//
// pesoInputFrom(1833333) is "18333.33", already at appendKey's two-decimal
// cap — and appendKey's `point >= 0` branch then refuses EVERY digit, not
// just fraction digits. Reopening "Change my income" on a detected figure
// (detection produces an average, so a non-round peso is the common case)
// left the whole keypad looking dead: no error, no explanation.
describe("a seeded value", () => {
  test("is replaced by the first digit rather than refusing it", () => {
    render(<Harness initial="18333.33" />);
    fireEvent.press(screen.getByTestId("amount"));

    fireEvent.press(screen.getByTestId("keypad-key-5"));

    expect(String(screen.getByTestId("keypad-display").props.children)).toBe("₱5");
  });

  test("keeps appending from the second key onward", () => {
    render(<Harness initial="1000" />);
    fireEvent.press(screen.getByTestId("amount"));

    fireEvent.press(screen.getByTestId("keypad-key-5"));
    fireEvent.press(screen.getByTestId("keypad-key-0"));

    expect(String(screen.getByTestId("keypad-display").props.children)).toBe("₱50");
  });

  test("is replaced by a first decimal keystroke too", () => {
    render(<Harness initial="18333.33" />);
    fireEvent.press(screen.getByTestId("amount"));

    fireEvent.press(screen.getByTestId("keypad-key-."));

    expect(String(screen.getByTestId("keypad-display").props.children)).toBe("₱0.");
  });

  test("BACKSPACE EDITS IT IN PLACE — it never triggers the replacement", () => {
    // Someone pressing backspace is deliberately correcting the seeded
    // figure. Replacing on the next digit after that would throw away the
    // part they kept.
    render(<Harness initial="18333.33" />);
    fireEvent.press(screen.getByTestId("amount"));

    fireEvent.press(screen.getByTestId("keypad-backspace"));
    expect(String(screen.getByTestId("keypad-display").props.children)).toBe("₱18,333.3");

    fireEvent.press(screen.getByTestId("keypad-key-5"));

    expect(String(screen.getByTestId("keypad-display").props.children)).toBe("₱18,333.35");
  });

  test("re-focusing the field seeds it afresh, so the replacement is per focus", () => {
    render(<Harness initial="1000" />);

    fireEvent.press(screen.getByTestId("amount"));
    fireEvent.press(screen.getByTestId("keypad-key-5"));
    fireEvent.press(screen.getByTestId("keypad-key-0"));
    fireEvent.press(screen.getByTestId("keypad-done"));

    fireEvent.press(screen.getByTestId("amount"));
    fireEvent.press(screen.getByTestId("keypad-key-7"));

    expect(String(screen.getByTestId("keypad-display").props.children)).toBe("₱7");
  });
});

// ---------------------------------------------------------------------------
// THE PANEL DOES NOT FOLLOW THE USER TO THE NEXT SCREEN (owner's device
// report, reproduced from Plan -> Limits -> new with no income declared: open
// the amount keypad, then tap "Set my income" in the percent-blocked card. The
// second screenshot shows the panel still up, on the income screen, focused on
// a field that is no longer visible).
//
// WHY THE EXISTING UNMOUNT CLEANUP DOES NOT CATCH IT. This file's subject
// already closes the panel when the focused field unmounts, and that header
// calls out "navigate away / host unmounts -> close". But `router.push` does
// not unmount the pushing screen — react-navigation keeps it mounted in the
// stack, which is the whole point of a stack. So the field lives, its cleanup
// never runs, and the root host (mounted beside the Stack in app/_layout.tsx,
// outside every screen) keeps drawing over whatever is on top.
//
// SO THE SIGNAL IS BLUR, NOT UNMOUNT. Exactly what the owner asked for:
// "whether the input is still in sight/focus".
//
// NavigationContext IS READ, NOT useNavigation. `useNavigation` THROWS outside
// a navigator, and this field is mounted outside one on real paths — app/
// lock.tsx renders the first-run onboarding flow with no navigator at all, and
// a dozen suites mount forms bare. Reading the context directly answers
// `undefined` there instead, which is the honest answer: no navigator means no
// blur to listen for.
// ---------------------------------------------------------------------------

/** The slice of a navigation object this field uses, and nothing more. */
function fakeNavigation(): { navigation: object; blur: () => void } {
  const listeners = new Set<() => void>();
  return {
    navigation: {
      addListener: (event: string, handler: () => void) => {
        if (event === "blur") listeners.add(handler);
        return () => listeners.delete(handler);
      },
    },
    blur: () => listeners.forEach((handler) => handler()),
  };
}

function NavigatedHarness({ navigation }: { navigation: object }) {
  const [value, setValue] = useState("");
  return (
    <KeypadProvider>
      <NavigationContext.Provider value={navigation as never}>
        <NumericField
          testID="amount"
          label="How much?"
          value={value}
          onChangeText={setValue}
        />
      </NavigationContext.Provider>
      <KeypadHost />
    </KeypadProvider>
  );
}

test("leaving the screen closes the panel, even though the field stays mounted", () => {
  const { navigation, blur } = fakeNavigation();
  render(<NavigatedHarness navigation={navigation} />);

  fireEvent.press(screen.getByTestId("amount"));
  expect(screen.queryByTestId("keypad-host")).toBeTruthy();

  // What `router.push("/plan/income")` does to this screen. The field is still
  // mounted — that is the bug's whole shape — so nothing else can notice.
  act(() => blur());

  expect(screen.queryByTestId("keypad-host")).toBeNull();
});

test("a blur with nothing focused is not an excuse to close someone else's panel", () => {
  // Two fields, one navigator. Only the field the request actually names may
  // take the panel down — the same ownership check the unmount cleanup makes,
  // for the same reason: a sibling must not close a panel that was never its.
  const { navigation, blur } = fakeNavigation();

  function TwoFields() {
    const [a, setA] = useState("");
    return (
      <KeypadProvider>
        <NavigationContext.Provider value={navigation as never}>
          <NumericField testID="amount" label="How much?" value={a} onChangeText={setA} />
        </NavigationContext.Provider>
        {/* Outside the navigator on purpose: a sheet's field, say. */}
        <NumericField testID="other" label="Other" value="" onChangeText={() => {}} />
        <KeypadHost />
      </KeypadProvider>
    );
  }

  render(<TwoFields />);
  fireEvent.press(screen.getByTestId("other"));
  expect(screen.getByTestId("keypad-label").props.children).toBe("Other");

  act(() => blur());

  // "other" never blurred — it is not in that navigator — so its panel stands.
  expect(screen.queryByTestId("keypad-host")).toBeTruthy();
  expect(screen.getByTestId("keypad-label").props.children).toBe("Other");
});

test("a field with no navigator above it still works", () => {
  // app/lock.tsx renders the whole first-run onboarding flow before any
  // navigator exists, and most form suites mount their subject bare. A
  // `useNavigation` here would turn every one of those into a crash.
  render(<Harness />);

  fireEvent.press(screen.getByTestId("amount"));

  expect(screen.queryByTestId("keypad-host")).toBeTruthy();
});
