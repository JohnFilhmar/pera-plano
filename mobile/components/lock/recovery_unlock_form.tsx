// components/lock/recovery_unlock_form.tsx — shown when the device Keystore
// key has been permanently invalidated (docs/12-encryption-and-app-lock.md
// §5, §11a; task-9-brief.md rules 3 & 7). Two jobs, both load-bearing:
//
// 1. Explain PLAINLY why the user is suddenly being asked for their recovery
//    words. A bare "enter your recovery phrase" after a routine settings
//    change (removing a screen lock) reads like the app is broken or
//    compromised, not like a protection working as designed.
// 2. Offer the §11a "wipe and start over" escape hatch for a user who cannot
//    produce their words. The hatch itself now lives in
//    wipe_and_start_over.tsx, which GAP-034 gave a second caller, and it
//    still carries the DOUBLE confirmation for the reason its own header
//    gives. Only the two sentences that are about a lost RECOVERY PHRASE
//    rather than about destruction are passed in from here.
//
// Local pre-validation (normalizePhrase + validatePhrase) rejects a
// malformed phrase BEFORE calling onSubmitPhrase at all — see
// recovery_phrase.ts's own doc: the BIP-39 checksum lets a mistyped phrase
// fail in milliseconds instead of after a ~1.5s Argon2id derivation that was
// always going to fail. onSubmitPhrase (wired to
// lock_context.tsx's submitRecoveryPhrase) is only ever called with a
// phrase that already passes this check.
//
// THE SAME CAPTURE GUARD THE ONBOARDING PHRASE SCREENS CARRY (GAP-017). This
// form does not display the phrase, it receives it -- but a screenshot of a
// filled-in field leaks exactly as much as a screenshot of the word list, and
// this is the screen a user reaches with their paper copy in hand. So:
// usePreventScreenCapture on its own key, scoped to the mount and released on
// unmount (see phrase_display.tsx's header for why the key must not be
// shared, and for why FLAG_SECURE is Android-effective rather than a
// guarantee), plus `importantForAutofill="no"` so the OS autofill service is
// never offered twelve recovery words to remember.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePreventScreenCapture } from "expo-screen-capture";
import { normalizePhrase, validatePhrase } from "@/lib/crypto/recovery_phrase";
import { usePlaceholderColor } from "@/lib/ui/placeholder";
import { WipeAndStartOver } from "./wipe_and_start_over";

/** This surface's own prevent/allow key -- see phrase_display.tsx's header
 * for why the three phrase surfaces must not share one. */
const CAPTURE_GUARD_KEY = "recovery-phrase-unlock";

export function RecoveryUnlockForm({
  errorMessage,
  onSubmitPhrase,
  onWipe,
}: {
  errorMessage: string | null;
  onSubmitPhrase: (phrase: string[]) => void | Promise<void>;
  onWipe: () => void | Promise<void>;
}) {
  usePreventScreenCapture(CAPTURE_GUARD_KEY);

  const placeholderColor = usePlaceholderColor();
  const [rawInput, setRawInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  // Rendered by app/lock.tsx OUTSIDE the router's Stack, so no navigator above
  // it clears the system bars. This one grows: the two-step wipe confirmation
  // pushes the column toward Android's navigation bar.
  const insets = useSafeAreaInsets();

  const handleSubmit = () => {
    const words = normalizePhrase(rawInput);
    const { ok, badIndexes } = validatePhrase(words);
    if (!ok) {
      setValidationError(
        badIndexes.length > 0
          ? "That doesn't look like a valid recovery phrase — check the words and try again."
          : "Those words don't check out together. Check for a typo and try again.",
      );
      return;
    }
    setValidationError(null);
    void onSubmitPhrase(words);
  };

  return (
    <View
      testID="recovery-unlock-form"
      className="flex-1 items-center justify-center gap-4 bg-bg px-6 dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Text className="text-center text-lg font-semibold text-fg dark:text-fg-dark">
        We need your recovery words
      </Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Your phone's screen lock was recently removed or reset. That protects your data, but it
        also destroyed the key your fingerprint or PIN used to unlock it. Enter your 12 recovery
        words to get back in — this will not affect any of your data.
      </Text>

      <TextInput
        placeholderTextColor={placeholderColor}
        testID="recovery-phrase-input"
        value={rawInput}
        onChangeText={setRawInput}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        importantForAutofill="no"
        placeholder="your 12 recovery words, separated by spaces"
        accessibilityLabel="Recovery words"
        className="w-full rounded-lg border border-fg-2 p-3 text-fg dark:border-fg-2-dark dark:text-fg-dark"
      />

      {validationError ? (
        <Text testID="recovery-validation-error" className="text-center text-danger dark:text-danger-dark">
          {validationError}
        </Text>
      ) : null}
      {errorMessage ? (
        <Text testID="recovery-error" className="text-center text-danger dark:text-danger-dark">
          {errorMessage}
        </Text>
      ) : null}

      <Pressable
        testID="recovery-submit-button"
        onPress={handleSubmit}
        accessibilityRole="button"
        accessibilityLabel="Unlock with recovery words"
        className="min-h-[44px] justify-center rounded-lg bg-brand px-6 py-3 dark:bg-brand-dark"
      >
        <Text className="font-semibold text-surface dark:text-surface-dark">Unlock</Text>
      </Pressable>

      <WipeAndStartOver
        triggerLabel="Forgot your recovery words?"
        firstConfirmMessage={
          "Without your recovery words, this data cannot be recovered — not by us, not by " +
          "support, not ever. Your only remaining option is to wipe this device's PeraPlano data " +
          "and start over from scratch."
        }
        onWipe={onWipe}
      />
    </View>
  );
}
