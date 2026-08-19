// mobile/components/ui/form_screen.tsx — W1 Task 7.
//
// THE INFRASTRUCTURE WAS ALREADY PAID FOR. KeyboardProvider from
// react-native-keyboard-controller has been mounted in app/_layout.tsx since
// before W1; what was missing was any consumer. This is that consumer, and it
// is one wrapper rather than per-screen logic so the eight long forms behind
// the "buried input" screenshots cannot each get it slightly wrong.
//
// IT AVOIDS BOTH KEYBOARDS. KeyboardAwareScrollView handles the system one
// with no configuration. Our own panel is not a keyboard as far as the OS is
// concerned, so its height comes from contexts/keypad_context.tsx and is
// applied as bottom padding here. Without that second half, the keypad simply
// reproduces the burial problem it was built to fix.
//
// keypadHeight CAN MOMENTARILY LIE. keypad_host.tsx zeroes it synchronously
// when a panel hides, but a newly-visible host only reports its real height
// from onLayout, which lands after the effect flush — so there is a render
// (root -> sheet handover, or the very first open) where the true height and
// the context's height disagree. `Math.max(keypadHeight, 0)` below is not
// about negative numbers (setKeypadHeight never receives one); it is a single
// obvious place documenting that this value is a best-effort measurement, not
// a guarantee, so a future stale/negative reading clamps to "no extra
// padding" instead of collapsing the content container.
import type { ReactNode } from "react";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { useKeypad } from "@/contexts/keypad_context";

/** Breathing room under the last control, on top of whatever is covering it. */
const BASE_PADDING = 24;

export function FormScreen({
  children,
  testID = "form-screen",
}: {
  children: ReactNode;
  testID?: string;
}) {
  const { keypadHeight } = useKeypad();

  return (
    <KeyboardAwareScrollView
      testID={testID}
      // 'handled', not 'always': a tap on a chip or Save must register on the
      // FIRST press rather than being spent dismissing whatever is focused.
      keyboardShouldPersistTaps="handled"
      bottomOffset={BASE_PADDING}
      contentContainerStyle={{ paddingBottom: Math.max(keypadHeight, 0) + BASE_PADDING }}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
