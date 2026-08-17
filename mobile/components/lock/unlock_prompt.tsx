// components/lock/unlock_prompt.tsx — the cold-start / re-lock screen
// (docs/12-encryption-and-app-lock.md §7; task-9-brief.md). Purely
// presentational: contexts/lock_context.tsx owns the state machine, this
// component only renders it and forwards a tap to onUnlock. Requires an
// explicit tap rather than auto-firing the system prompt on mount — this is
// also what makes "NotAuthenticated -> re-prompt and retry" (task-9-brief
// rule 3) a plain, non-looping user action instead of an automatic retry
// that could spin forever on a cancelled prompt.
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function UnlockPrompt({
  isAuthenticating,
  errorMessage,
  onUnlock,
}: {
  isAuthenticating: boolean;
  errorMessage: string | null;
  onUnlock: () => void;
}) {
  // app/_layout.tsx renders this OUTSIDE the router's Stack, so there is no
  // navigator above it to clear the system bars — and with app.json's
  // `edgeToEdgeEnabled` the column is full-bleed. Centred content is safe
  // today, but a long error message grows it toward both bars.
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="unlock-prompt"
      className="flex-1 items-center justify-center gap-4 bg-bg px-6 dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
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
