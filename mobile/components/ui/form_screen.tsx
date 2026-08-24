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
//
// contentContainerStyle CARRIES flexGrow: 1, FIXED HERE RATHER THAN PER-FORM
// (numeric-input-system W1 Task 9 fix round). A form's own `flex-1` root View
// is scroll content once wrapped here, and a `flex: 1` child of a content
// container with no main-axis size collapses to zero height — the classic
// flexBasis-resolves-to-0 case. Every migrated form still wants `flex-1` (so
// it fills the screen when short and scrolls when long), so the container
// that makes that possible belongs in the wrapper all of them share, not
// copy-pasted into each of the five forms still to be migrated.
import type { ReactNode } from "react";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { useKeypad } from "@/contexts/keypad_context";

/**
 * Breathing room under the last control, on top of whatever is covering it.
 *
 * Exported so __tests__/form_screen.test.tsx can assert the CLOSED baseline
 * exactly — `paddingBottom === BASE_PADDING` with nothing focused. That one
 * assertion is what catches a stale `keypadHeight` surviving a panel that is
 * gone (final review, Critical 2); a `toBeGreaterThanOrEqual` on the open
 * case cannot, since it passes just as happily at 100000.
 */
export const BASE_PADDING = 24;

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
      contentContainerStyle={{
        flexGrow: 1,
        // ASSUMES THIS VIEWPORT REACHES THE BOTTOM OF THE WINDOW, and on two
        // routes it does not: app/wallet/new.tsx and app/wallet/edit.tsx wrap
        // this in an outer View carrying `paddingBottom: insets.bottom`, so
        // the panel — pinned to the WINDOW's bottom edge at
        // `position: absolute; bottom: 0` (keypad_host.tsx) — overlaps this
        // scroll view by `keypadHeight - insets.bottom`, not by keypadHeight.
        // Those two forms therefore over-reserve by the inset (126px on the
        // A54). The error direction is safe — it always over-reserves, never
        // under — which is why nothing catches it and why it is recorded as a
        // deferred deviation in the spec rather than fixed here. The clean fix
        // is for the context to publish the panel's TOP EDGE in window
        // coordinates and for this to subtract its own measured bottom.
        paddingBottom: Math.max(keypadHeight, 0) + BASE_PADDING,
      }}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
