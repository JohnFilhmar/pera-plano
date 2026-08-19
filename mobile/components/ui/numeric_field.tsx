// mobile/components/ui/numeric_field.tsx — W1 Task 5.
//
// A Pressable. NOT a TextInput, and that is the entire mechanism.
//
// The alternative is a real TextInput with showSoftInputOnFocus={false}, and
// it works -- until someone refactors the props, or a platform ignores the
// flag, or an autofill path routes around it. A component with no text input
// anywhere in its tree cannot raise a keyboard however it is later edited,
// which turns "the OS keypad never appears on a number field" from a
// convention into a property. __tests__/numeric_field.test.tsx asserts it
// directly.
//
// THE PROPS MIRROR TextInput ON PURPOSE. Every form this replaces already
// holds its numeric state as a string and passes value/onChangeText; keeping
// that exact shape makes each migration a component swap rather than a state
// rewrite, which is what keeps eighteen form-test rewrites mechanical.
//
// THE COST, STATED: no caret, no selection, no paste. The keypad's
// press-to-backspace and hold-to-clear cover correction. A paste path is a
// later workstream, not something to smuggle in here.
import { useEffect } from "react";
import { Pressable, Text } from "react-native";

import { useKeypad } from "@/contexts/keypad_context";
import { formatPesoInput } from "@/lib/money/peso_input";
import type { KeypadMode } from "./numeric_keypad";

export type NumericFieldProps = {
  /** Also the focus identity the context compares against — must be unique on screen. */
  testID: string;
  /** Shown in the panel header and read by screen readers. */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  mode?: KeypadMode;
  placeholder?: string;
};

function shownFor(mode: KeypadMode, value: string): string {
  if (mode === "peso") return formatPesoInput(value);
  if (mode === "rate") return `${value}%`;
  return value;
}

export function NumericField({
  testID,
  label,
  value,
  onChangeText,
  mode = "peso",
  placeholder = "",
}: NumericFieldProps) {
  const { request, open, syncFocused } = useKeypad();
  const focused = request?.fieldId === testID;

  // While focused, keep the panel's copy of the text equal to ours. The
  // context holds onChangeText in a ref, so this cannot loop — see its header.
  useEffect(() => {
    if (!focused) return;
    syncFocused(testID, value, onChangeText);
  }, [focused, testID, value, onChangeText, syncFocused]);

  const empty = value === "";
  const shown = empty ? placeholder : shownFor(mode, value);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={empty ? label : `${label}, ${shown}`}
      accessibilityState={{ selected: focused }}
      onPress={() => open({ fieldId: testID, label, mode, text: value, onChangeText })}
      className={`mt-2 rounded-xl bg-surface p-3 dark:bg-surface-dark${
        focused ? " border border-brand dark:border-brand-dark" : ""
      }`}
    >
      <Text className={empty ? "text-fg-2 dark:text-fg-2-dark" : "text-fg dark:text-fg-dark"}>
        {shown}
      </Text>
    </Pressable>
  );
}
