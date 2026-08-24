// components/ui/confirm_dialog.tsx — m1c plan Task 2.
//
// The last thing between a user and an irreversible action — archiving a
// wallet, unlinking a transfer, wiping every transaction on the device. Two of
// its rules exist because getting them wrong makes the dialog worse than no
// dialog at all (plan rule 3).
import { Modal, Pressable, Text, View } from "react-native";

import { Button } from "./button";

export type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  body: string;
  /**
   * REQUIRED, and never "OK".
   *
   * The label must name the action — "Delete wallet", "Erase everything" —
   * because a dialog whose button says "OK" tells the user nothing about what
   * they are agreeing to, and this component guards the wipe. Keeping it
   * required is the enforcement: there is no default to fall back to.
   */
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center p-6">
        {/* Backdrop press cancels. A backdrop that swallows the press leaves
            the user with no way out but the two buttons — and if they do not
            understand either one, they are stuck. */}
        <Pressable
          testID="confirm-dialog-backdrop"
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className="absolute inset-0 bg-fg opacity-50 dark:bg-bg-dark"
        />
        <View
          testID="confirm-dialog"
          className="w-full max-w-sm rounded-2xl bg-surface p-5 dark:bg-surface-dark"
        >
          <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
            {title}
          </Text>
          <Text className="mt-2 text-fg-2 dark:text-fg-2-dark">{body}</Text>
          <View className="mt-5 gap-2">
            {/* `danger` goes on CONFIRM. Painted on cancel instead, the safe
                way out looks like the dangerous one and the irreversible
                action looks safe — the user learns to tap red to escape. */}
            <Button
              testID="confirm-dialog-confirm"
              title={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? "destructive" : "primary"}
            />
            <Button
              testID="confirm-dialog-cancel"
              title="Cancel"
              onPress={onCancel}
              variant="ghost"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
