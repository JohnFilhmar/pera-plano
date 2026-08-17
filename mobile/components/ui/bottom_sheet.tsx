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

/**
 * The `pb-8` this sheet used to carry, kept as a FLOOR rather than replaced.
 *
 * On a phone in gesture navigation the bottom inset is a few dp or zero, and an
 * inset-only sheet would end up tighter than it is today; on a phone in
 * three-button navigation the inset is the whole button strip. Adding the two
 * means the sheet's last row clears the system bar on any device and still has
 * the same breathing room it was designed with on the devices that need none.
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

  // Rendering nothing, not rendering offscreen: an offscreen sheet still
  // covers the screen with an invisible touch target and the app looks frozen.
  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      // Android system back. Modal owns this on Android; there is no separate
      // BackHandler listener to leak.
      onRequestClose={onDismiss}
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
          style={{ paddingBottom: SHEET_BOTTOM_PADDING + insets.bottom }}
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
    </Modal>
  );
}
