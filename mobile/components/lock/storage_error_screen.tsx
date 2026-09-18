// components/lock/storage_error_screen.tsx — the §11a screen for the OTHER
// unrecoverable state (GAP-034): the app cannot read its own key state at all
// because the device's secure storage is failing, which some OEM Keystore
// states do persistently.
//
// WHY THIS IS NOT RecoveryUnlockForm WITH DIFFERENT WORDS. That form's whole
// subject is the recovery phrase, and on this failure the phrase is a dead
// route: key_manager's recovery path reads `recoveryWrap` and `recoverySalt`
// out of the same SecureStore whose read just threw, and then writes the new
// device wrap back to it. Offering a twelve-word field here would ask a user
// to fetch a piece of paper in order to watch the app fail a second time, and
// the form's own explanation ("your phone's screen lock was recently removed
// or reset") would be telling them something untrue about their phone.
//
// TRY AGAIN COMES FIRST, AND IT IS NOT A COURTESY. The only other control on
// this screen destroys every transaction the user has. A read that failed
// once may simply have failed once, so the non-destructive route has to be
// the obvious one, and the wipe stays a link the user has to open.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WipeAndStartOver } from "./wipe_and_start_over";

/**
 * Shown when `getKeyState()` rejects, so the app knows neither whether this
 * device has keys nor whether it has ever been set up.
 *
 * @param errorMessage A fixed, non-sensitive message from a previous attempt
 *   on this screen, or null. Never raw error text, matching every other lock
 *   surface.
 * @param onRetry Re-reads the key state. Resolves whether it succeeded or
 *   not: a success moves the app off this screen by changing lock status, so
 *   this component only has to stop showing its own pending state.
 * @param onWipe The §11a destruction, behind the shared double confirmation.
 */
export function StorageErrorScreen({
  errorMessage,
  onRetry,
  onWipe,
}: {
  errorMessage: string | null;
  onRetry: () => void | Promise<void>;
  onWipe: () => void | Promise<void>;
}) {
  const [isRetrying, setIsRetrying] = useState(false);
  // Rendered by app/lock.tsx OUTSIDE the router's Stack, so no navigator above
  // it clears the system bars. This one grows: the two-step wipe confirmation
  // pushes the column toward Android's navigation bar.
  const insets = useSafeAreaInsets();

  const handleRetry = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <View
      testID="storage-error-screen"
      className="flex-1 items-center justify-center gap-4 bg-bg px-6 dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Text className="text-center text-lg font-semibold text-fg dark:text-fg-dark">
        PeraPlano can't reach its secure storage
      </Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Your data is still encrypted and still on this phone. What PeraPlano can't do right now is
        reach the part of Android that holds the key, so it has no way to open anything. This is
        usually temporary, and restarting the phone often clears it.
      </Text>

      {errorMessage ? (
        <Text testID="storage-error-message" className="text-center text-danger dark:text-danger-dark">
          {errorMessage}
        </Text>
      ) : null}

      <Pressable
        testID="storage-error-retry-button"
        onPress={() => void handleRetry()}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        accessibilityState={{ disabled: isRetrying }}
        disabled={isRetrying}
        className="min-h-[44px] justify-center rounded-lg bg-brand px-6 py-3 dark:bg-brand-dark"
      >
        <Text className="font-semibold text-surface dark:text-surface-dark">
          {isRetrying ? "Checking…" : "Try again"}
        </Text>
      </Pressable>

      <WipeAndStartOver
        triggerTestID="storage-error-wipe-link"
        triggerLabel="Still stuck?"
        firstConfirmMessage={
          "If this keeps happening, the key that opens your data can no longer be read, and " +
          "nothing can bring it back — not us, and not support. Your recovery words can't help " +
          "either: they unlock a second copy of the key that is kept in the same secure storage " +
          "that isn't responding. Your only remaining option is to wipe this device's PeraPlano " +
          "data and start over from scratch."
        }
        onWipe={onWipe}
      />
    </View>
  );
}
