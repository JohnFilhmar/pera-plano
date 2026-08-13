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
          className="rounded-t-2xl bg-surface p-4 pb-8 dark:bg-surface-dark"
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
