// components/ui/bottom_sheet.tsx — m1c plan Task 2.
//
// Android convention for every picker in the app (docs/11: "sheets for
// pickers"): wallet pickers, category pickers, cash reconciliation, transfer
// linking. Built on the platform `Modal` rather than an absolutely-positioned
// View so it genuinely overlays the whole screen and so Android's system back
// dismisses it (plan rule 5) without a hand-rolled BackHandler subscription
// that has to be torn down correctly on every unmount.
import type { ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useKeypadOptional } from "@/contexts/keypad_context";
import { KeypadHost } from "./keypad_host";

/**
 * The `pb-8` this sheet used to carry, kept as a FLOOR rather than replaced.
 *
 * On a phone in gesture navigation the bottom inset is a few dp or zero, and an
 * inset-only sheet would end up tighter than it is today; on a phone in
 * three-button navigation the inset is the whole button strip. Adding the two
 * means the sheet's last row clears the system bar on any device and still has
 * the same breathing room it was designed with on the devices that need none.
 *
 * It sits on top of `bottomBand` below, which is the taller of the system bar
 * and our own keypad panel — so this stays a floor whichever of the two the
 * sheet is currently clearing.
 */
const SHEET_BOTTOM_PADDING = 32;

export type BottomSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  children: ReactNode;
};

export function BottomSheet({
  visible,
  onDismiss,
  title,
  children,
}: BottomSheetProps) {
  // EVERY SHEET IN THE APP IS FLUSH WITH THE BOTTOM OF THE SCREEN, and with
  // app.json's `edgeToEdgeEnabled` that bottom is behind Android's navigation
  // bar — so whatever a sheet's last row is (Save, Confirm, the final option in
  // a picker) was sitting under ▢ ◁. Fixed here rather than in each of the ten
  // callers, so a new sheet inherits it.
  //
  // A `Modal` is its own native window: it is NOT inside whatever View the
  // screen behind it padded, so a sheet has to ask for the inset itself rather
  // than inheriting one. It does still inherit React context, which is what
  // makes this hook work here — expo-router's ExpoRoot provides the insets from
  // above the whole app (see app/_layout.tsx).
  const insets = useSafeAreaInsets();

  // Read optionally, and above the early return so the hook order never moves:
  // a sheet rendered outside the app tree (every component suite that mounts
  // one on its own) has no provider, and gets null. See onRequestClose below
  // and `bottomBand` for the two things it is for.
  const keypad = useKeypadOptional();

  // THE SECOND BURIED-BUTTON DEFECT, ON FOUR SHEETS AT ONCE
  // (numeric-input-system Task 14): allocation_sheet, balance_correction_sheet,
  // cash_reconcile_sheet and correct_sheet all end in a Confirm/Save the panel
  // below was painting straight over.
  //
  // WHY THE ROUTES' FIX DOES NOT REACH HERE. Every migrated screen scrolls
  // through components/ui/form_screen.tsx, which pads its scroll CONTENT by
  // the panel's height. A sheet is not a screen and does not scroll: it is
  // bottom-aligned in its own Modal window, its last row sits exactly
  // `paddingBottom` above the window's edge, and the panel is pinned to that
  // same edge at `position: absolute; bottom: 0` (keypad_host.tsx). No amount
  // of scrolling can lift a row out from under it, so the container has to
  // give the band up itself — the same conclusion onboarding_frame.tsx reached
  // for its fixed footer.
  //
  // MAX, NOT SUM, AND THAT IS THE WHOLE ARITHMETIC. Two different things want
  // this bottom strip and they are never stacked: Android's navigation bar
  // (`insets.bottom`) and our own panel. The panel is DRAWN OVER the
  // navigation bar and already pads itself by `insets.bottom + 16`
  // (keypad_host.tsx), so its measured height CONTAINS that strip. Clearing
  // `insets.bottom + keypadHeight` would count the navigation bar twice — a
  // 48dp dead band under the panel on a three-button phone, the same
  // double-count onboarding_frame.tsx documents. Whichever obstruction is
  // taller is the one to clear, and SHEET_BOTTOM_PADDING stays on top of it as
  // the floor it has always been, so Confirm keeps its designed breathing room
  // above the panel rather than resting on it.
  //
  // A GENUINE NO-OP AT ZERO. `keypadHeight` is 0 with no panel open, and null
  // with no provider at all (every suite that mounts a lone sheet), so this
  // resolves to exactly the `SHEET_BOTTOM_PADDING + insets.bottom` the sheet
  // has always carried. Nothing that does not open a keypad can observe it.
  const bottomBand = Math.max(insets.bottom, keypad?.keypadHeight ?? 0);

  // Rendering nothing, not rendering offscreen: an offscreen sheet still
  // covers the screen with an invisible touch target and the app looks frozen.
  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      // Android system back — and the ONLY route to it inside this window.
      // Modal still owns the subscription, so there is no listener here to
      // leak, but it is not merely `onDismiss` any more.
      //
      // WHY THE NESTED KeypadHost CANNOT USE ITS OWN BackHandler. On Android a
      // Modal is a Dialog, and the Dialog's key listener swallows
      // KEYCODE_BACK and calls this prop; the Activity back press that drives
      // JS `BackHandler` listeners never fires while the dialog holds focus.
      // The host's own subscription (components/ui/keypad_host.tsx) is live
      // and correct at the ROOT mount, where there is no dialog in the way,
      // and dead here.
      //
      // So the keypad gets FIRST CLAIM on back: with the panel open, back
      // closes the panel and the sheet stays exactly where it was. Without
      // this, one back press would throw away a half-filled form — the very
      // outcome the keypad's back handling exists to prevent, and worse than
      // it, since a sheet is a whole form rather than one screen.
      onRequestClose={() => (keypad?.request ? keypad.close() : onDismiss())}
    >
      <View className="flex-1 justify-end">
        {/* Scrim. `bg-fg` in light and `bg-bg-dark` in dark are the two
            near-black tokens — a scrim must darken in BOTH themes, so this is
            one of the few places the dark: sibling is not the same hue. */}
        <Pressable
          testID="bottom-sheet-backdrop"
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
          className="absolute inset-0 bg-fg opacity-50 dark:bg-bg-dark"
        />
        <View
          testID="bottom-sheet"
          className="rounded-t-2xl bg-surface p-4 dark:bg-surface-dark"
          style={{ paddingBottom: SHEET_BOTTOM_PADDING + bottomBand }}
        >
          {/* Grab handle — the affordance that says "drag or tap away". */}
          <View className="mb-3 h-1 w-10 self-center rounded-full bg-fg-2 opacity-40 dark:bg-fg-2-dark" />
          {title ? (
            <Text className="mb-3 text-lg font-semibold text-fg dark:text-fg-dark">
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </View>
      {/* A SECOND HOST, NOT A DUPLICATE. This Modal is its own native window, so
          the root host in app/_layout.tsx paints behind it. keypad_context.tsx
          gives the most recently mounted host the panel, which while this sheet is
          open is this one. It reads the context optionally and renders nothing
          when there is no provider, so a sheet mounted on its own — in a test, or
          anywhere outside the app tree — is unaffected. Its own BackHandler
          subscription is inert inside this dialog; `onRequestClose` above is what
          dismisses the panel here. */}
      <KeypadHost />
    </Modal>
  );
}
