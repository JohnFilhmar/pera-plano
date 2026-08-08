// components/lock/unlock_prompt.tsx — the cold-start / re-lock screen
// (docs/12-encryption-and-app-lock.md §7; task-9-brief.md). Purely
// presentational: contexts/lock_context.tsx owns the state machine, this
// component only renders it and forwards a tap to onUnlock. Requires an
// explicit tap rather than auto-firing the system prompt on mount — this is
// also what makes "NotAuthenticated -> re-prompt and retry" (task-9-brief
// rule 3) a plain, non-looping user action instead of an automatic retry
// that could spin forever on a cancelled prompt.
import { Pressable, Text, View } from "react-native";

export function UnlockPrompt({
  isAuthenticating,
  errorMessage,
  onUnlock,
}: {
  isAuthenticating: boolean;
  errorMessage: string | null;
  onUnlock: () => void;
}) {
  return (
    <View
      testID="unlock-prompt"
      className="flex-1 items-center justify-center gap-4 bg-bg px-6 dark:bg-bg-dark"
    >
      <Text className="text-center text-lg font-semibold text-fg dark:text-fg-dark">
        PeraPlano is locked
      </Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Unlock with your fingerprint, face, or device PIN to see your money.
      </Text>
      {errorMessage ? (
        <Text testID="unlock-error" className="text-center text-danger dark:text-danger-dark">
          {errorMessage}
        </Text>
      ) : null}
      <Pressable
        testID="unlock-button"
        onPress={onUnlock}
        disabled={isAuthenticating}
        accessibilityRole="button"
        accessibilityLabel="Unlock"
        accessibilityState={{ disabled: isAuthenticating }}
        className="rounded-lg bg-brand px-6 py-3 dark:bg-brand-dark"
      >
        <Text className="font-semibold text-surface dark:text-surface-dark">
          {isAuthenticating ? "Unlocking…" : "Unlock"}
        </Text>
      </Pressable>
    </View>
  );
}
