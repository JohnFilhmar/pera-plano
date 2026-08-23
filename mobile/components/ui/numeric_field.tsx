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
import { useContext, useEffect, useRef } from "react";
import { Pressable, Text } from "react-native";
import { NavigationContext } from "@react-navigation/native";

import { useKeypad } from "@/contexts/keypad_context";
import { formatPesoInput } from "@/lib/money/peso_input";
import type { KeypadMode } from "./numeric_keypad";

export type NumericFieldSize = "md" | "hero";

export type NumericFieldProps = {
  /** Also the focus identity the context compares against — must be unique on screen. */
  testID: string;
  /** Shown in the panel header and read by screen readers. */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  mode?: KeypadMode;
  placeholder?: string;
  /**
   * What `editable={false}` was on the TextInput this replaces.
   *
   * IT IS A PROP AND NOT A WRAPPER because the two call sites that needed it
   * first (components/goals/allocation_sheet.tsx's skipped rows,
   * components/onboarding/quick_wallet_list.tsx's excluded wallets) each
   * hand-rolled `pointerEvents="none"` and immediately disagreed: one dimmed
   * the row, one left it looking fully enabled while silently swallowing
   * taps. Neither told a screen reader anything — the Pressable kept
   * announcing itself as a plain button. `editable={false}` on a TextInput
   * maps to a disabled accessibility state for free; this restores that, and
   * makes the dimming impossible to forget.
   */
  disabled?: boolean;
  /**
   * `"hero"` (task-4b, review round 2) — the board's large centred amount
   * figure IS this field, sized up in place, rather than a decorative
   * duplicate rendered beside a small, easy-to-miss real one. That duplicate
   * shipped first and was wrong: the decorative figure was the most
   * prominent thing on the screen and did nothing when pressed, while the
   * live control sat below it, smaller, with no visible caption.
   *
   * DEFAULTS TO `"md"` — the field this always was — so every one of this
   * component's other seventeen call sites (bills, goals, limits, loans,
   * `correct_sheet.tsx`, wallets, onboarding...) renders byte-for-byte what
   * it always has; only `manual_entry_form.tsx` opts in. SIZING ONLY: the
   * Pressable-not-TextInput mechanism `no_numeric_keyboard.test.ts` guards,
   * and every prop and testID `numeric_field.test.tsx` pins, are identical
   * at both sizes — nothing here touches the keypad's own files.
   */
  size?: NumericFieldSize;
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
  disabled = false,
  size = "md",
}: NumericFieldProps) {
  const { request, open, close, syncFocused } = useKeypad();
  const focused = request?.fieldId === testID;

  // While focused, keep the panel's copy of the text equal to ours. The
  // context holds onChangeText in a ref, so this cannot loop — see its header.
  useEffect(() => {
    if (!focused) return;
    syncFocused(testID, value, onChangeText);
  }, [focused, testID, value, onChangeText, syncFocused]);

  // THE PANEL DIES WITH THE FIELD IT IS EDITING. Spec §4.2 lists "navigate
  // away / host unmounts → close", and the host half was the only half built:
  // releaseHost only fires when the HOST unmounts, and the root host beside
  // the Stack (app/_layout.tsx) never does. So on every migrated form —
  // bills, goals, limits, loans, wallets — the sequence "tap the amount, tap
  // Save" left a floating keypad over the previous screen, wired to a
  // setState on an unmounted component, with the host's live BackHandler
  // eating the user's next back press instead of navigating.
  //
  // FIXED IN THE FIELD, NOT IN 22 SCREENS, and ownership-checked: only the
  // field the request actually names takes the panel down with it, so a
  // sibling field unmounting (a conditional row, a re-keyed list) cannot
  // close a panel that was never its. Reading `focused` through a ref keeps
  // this a genuine unmount cleanup rather than one that re-runs on every
  // focus change and closes the panel the moment it opens.
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  useEffect(
    () => () => {
      if (focusedRef.current) close();
    },
    [close],
  );

  // AND THE PANEL DOES NOT FOLLOW THE USER TO THE NEXT SCREEN EITHER.
  //
  // The unmount cleanup above covers "the field went away". It cannot cover
  // "the user went away", because `router.push` does NOT unmount the pushing
  // screen — react-navigation keeps it mounted in the stack, which is the whole
  // point of a stack. Owner's device report, reproduced exactly on Plan ->
  // Limits -> new with no income declared: open the amount keypad, tap "Set my
  // income" in the percent-blocked card, and the panel is still up on the
  // income screen, editing a field that is no longer on screen. The root host
  // lives beside the Stack in app/_layout.tsx, outside every screen, so nothing
  // else is in a position to notice.
  //
  // BLUR IS THE SIGNAL — the owner's own words were "whether the input is still
  // in sight/focus".
  //
  // NavigationContext RATHER THAN useNavigation, AND THE DIFFERENCE MATTERS:
  // `useNavigation` THROWS outside a navigator, and this field really is
  // mounted outside one on live paths — app/lock.tsx renders the entire
  // first-run onboarding flow before any navigator exists, and a dozen suites
  // mount forms bare. Reading the context answers `undefined` there, which is
  // the truthful answer: no navigator, no blur to hear.
  //
  // OWNERSHIP-CHECKED, like the cleanup above. Only the field the request
  // actually names takes the panel down, so a blur cannot close a panel opened
  // from a sheet mounted over this screen.
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!focused || !navigation) return;
    return navigation.addListener("blur", () => close());
  }, [focused, navigation, close]);

  const empty = value === "";
  const shown = empty ? placeholder : shownFor(mode, value);
  const hero = size === "hero";

  // Built with `.filter(Boolean).join(" ")` (the same pattern
  // `components/ui/button.tsx`'s `containerClass` already uses) rather than
  // string interpolation, so the `"md"` branch — every call site but
  // manual entry — comes out as the EXACT SAME classes, in the EXACT SAME
  // order, as before this prop existed.
  const containerClass = [
    hero
      ? "items-center justify-center rounded-2xl bg-surface px-4 py-5 dark:bg-surface-dark"
      : "mt-2 rounded-xl bg-surface p-3 dark:bg-surface-dark",
    focused ? "border border-brand dark:border-brand-dark" : "",
    disabled ? "opacity-50" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const textClass = [
    hero ? "text-hero font-extrabold text-center" : "",
    empty ? "text-fg-2 dark:text-fg-2-dark" : "text-fg dark:text-fg-dark",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={empty ? label : `${label}, ${shown}`}
      // `disabled` here is what TalkBack reads out; without it a disabled
      // field announces as an ordinary button and then ignores the tap.
      accessibilityState={{ selected: focused, disabled }}
      onPress={() => open({ fieldId: testID, label, mode, text: value, onChangeText })}
      className={containerClass}
    >
      <Text
        className={textClass}
        // Tabular figures at hero size only — a `"md"` field is a short
        // label/value row, not a number a user's eye tracks as it grows
        // digit by digit the way the manual-entry amount does.
        style={hero ? { fontVariant: ["tabular-nums"] } : undefined}
      >
        {shown}
      </Text>
    </Pressable>
  );
}
