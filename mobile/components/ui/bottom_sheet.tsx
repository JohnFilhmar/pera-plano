// components/ui/bottom_sheet.tsx — m1c plan Task 2.
//
// Android convention for every picker in the app (docs/11: "sheets for
// pickers"): wallet pickers, category pickers, cash reconciliation, transfer
// linking. Built on the platform `Modal` rather than an absolutely-positioned
// View so it genuinely overlays the whole screen and so Android's system back
// dismisses it (plan rule 5) without a hand-rolled BackHandler subscription
// that has to be torn down correctly on every unmount.
import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
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

/**
 * How much of the space a sheet actually HAS its BODY may occupy before it
 * starts scrolling.
 *
 * A sheet is a decision, not a page, and one that covers the whole screen has
 * stopped being a sheet: the user loses the context they opened it from and the
 * scrim stops reading as "tap here to back out". Seven tenths leaves the scrim
 * legible above the tallest body while giving a loan with six possible payments
 * room to show four of them without moving.
 *
 * TAKEN OF `windowHeight - bottomBand`, NOT OF THE WHOLE WINDOW. The band under
 * the body is not free space the body can be measured against: `paddingBottom`
 * reserves it, so it is ADDED to whatever maxHeight allows rather than being
 * carved out of it. Against the raw window a sheet's total height becomes body
 * + chrome + padding floor + panel, and with the keypad panel open (~350dp,
 * docs/13-on-device-verification.md:1379) that exceeds the screen: on the A54's
 * 891dp window, `891 * 0.7` = 624dp of body plus ~72dp of chrome plus the 32dp
 * floor plus 350dp of panel is ~1078dp, so ~190dp is pushed off the TOP — and
 * off the top goes the scroll area's own viewport, which no gesture can bring
 * back. That is the unreachable-rows defect this scroll area exists to fix,
 * re-created on the one sheet tall enough to open a keypad. Subtracting the
 * band first divides only the space the sheet can really use: panel open,
 * `(891 - 350) * 0.7` is ~379dp of body and the whole sheet ~833dp; panel
 * closed on gesture navigation, ~624dp of body and ~728dp of sheet. Both fit
 * inside 891dp.
 *
 * It bounds the BODY only. The title, the grab handle and the sheet's own
 * bottom padding sit outside the scroll area, so the last row still clears the
 * navigation bar and the keypad panel exactly as before.
 */
const SHEET_MAX_BODY_RATIO = 0.7;

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

  // Read above the early return, same rule as `useKeypadOptional` above: the
  // hook order must never change between a visible and a hidden render.
  const { height: windowHeight } = useWindowDimensions();

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
          {/* THE BODY SCROLLS, THE CHROME DOES NOT (owner's 2026-09-05 report:
              "possible payments can't be scrolled, a loan showing multiple possible
              payments can't show all records").

              A sheet is bottom-aligned inside `flex-1 justify-end`, so an unbounded
              body grows UPWARD and its first rows leave the top of the screen. There is
              no gesture that brings them back, and the taller the list the more of it
              is simply gone. docs/13-on-device-verification.md:1384 names the remedy
              for the same clipping on the correction sheet, in two halves: a maxHeight
              taken from `useWindowDimensions()`, and a scroll area that shrinks while a
              panel is open. This line is both halves at once.

              MEASURED AGAINST THE SPACE LEFT, NOT THE WHOLE WINDOW. `bottomBand` comes
              off before the ratio is applied, because that band is not free space: the
              `paddingBottom` above reserves it, so it stacks ON TOP of this maxHeight
              instead of fitting inside it. Ratio the raw window and a sheet with the
              keypad panel open grows taller than the screen; a bottom-aligned sheet
              overflows UPWARD, so what is lost is the top of the scroll viewport
              itself, and rows above a viewport's top edge cannot be scrolled to at all.
              See SHEET_MAX_BODY_RATIO for the arithmetic on the A54.

              AND NOT A FIXED `max-h-96`. A 384dp cap is most of a small phone's screen
              and a third of a tablet's. correct_sheet.tsx carried exactly that private
              cap and now gives it up in favour of this one, so there is one scroll
              container per sheet rather than two nested ones fighting over the same
              drag.

              `keyboardShouldPersistTaps="handled"` so the first tap on a Confirm button
              presses it, rather than being spent dismissing an open keypad panel. */}
          <ScrollView
            testID="bottom-sheet-scroll"
            style={{ maxHeight: (windowHeight - bottomBand) * SHEET_MAX_BODY_RATIO }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
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
