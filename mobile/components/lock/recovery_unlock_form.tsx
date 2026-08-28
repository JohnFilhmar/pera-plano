// components/lock/recovery_unlock_form.tsx — shown when the device Keystore
// key has been permanently invalidated (docs/12-encryption-and-app-lock.md
// §5, §11a; task-9-brief.md rules 3 & 7). Two jobs, both load-bearing:
//
// 1. Explain PLAINLY why the user is suddenly being asked for their recovery
//    words. A bare "enter your recovery phrase" after a routine settings
//    change (removing a screen lock) reads like the app is broken or
//    compromised, not like a protection working as designed.
// 2. Offer the §11a "wipe and start over" escape hatch for a user who cannot
//    produce their words — behind a DOUBLE confirmation that names exactly
//    what is destroyed, because one confirmation alone must destroy nothing
//    (a single mis-tap must never be irreversible).
//
// Local pre-validation (normalizePhrase + validatePhrase) rejects a
// malformed phrase BEFORE calling onSubmitPhrase at all — see
// recovery_phrase.ts's own doc: the BIP-39 checksum lets a mistyped phrase
// fail in milliseconds instead of after a ~1.5s Argon2id derivation that was
// always going to fail. onSubmitPhrase (wired to
// lock_context.tsx's submitRecoveryPhrase) is only ever called with a
// phrase that already passes this check.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { normalizePhrase, validatePhrase } from "@/lib/crypto/recovery_phrase";
import { usePlaceholderColor } from "@/lib/ui/placeholder";

type WipeStep = "hidden" | "confirm1" | "confirm2";

/**
 * Touch target (design F1 sweep). "Forgot your recovery words?" and both
 * "Cancel" links carry no padding class and no size guarantee — the same
 * bare-Pressable shape as `app/wallet/[id].tsx`'s "Edit". Unlike that
 * control, or `ISOLATED_LINK_HIT_SLOP`'s five call sites, each of these three
 * sits directly BELOW another Pressable in a `gap-*` column ("Unlock" above
 * "Forgot…", each wipe step's own "…continue" button above its "Cancel") —
 * a full-strength slop on that shared edge would reach into the button
 * above it, the vertical version of the mis-tap bug `CHIP_HIT_SLOP`'s own
 * comment documents fixing on the horizontal axis. TOP is capped at half the
 * relevant gap so the two controls' touch regions meet at the gap's midpoint
 * rather than overlap; BOTTOM, LEFT and RIGHT have no neighbour to collide
 * with, so they take the same generous, unstyled-text-safe value
 * `ISOLATED_LINK_HIT_SLOP` documents deriving.
 */
const FORGOT_LINK_HIT_SLOP = { top: 8, bottom: 16, left: 16, right: 16 }; // gap-4 (16px) above, halved
const WIPE_CANCEL_HIT_SLOP = { top: 6, bottom: 16, left: 16, right: 16 }; // gap-3 (12px) above, halved

export function RecoveryUnlockForm({
  errorMessage,
  onSubmitPhrase,
  onWipe,
}: {
  errorMessage: string | null;
  onSubmitPhrase: (phrase: string[]) => void | Promise<void>;
  onWipe: () => void | Promise<void>;
}) {
  const placeholderColor = usePlaceholderColor();
  const [rawInput, setRawInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [wipeStep, setWipeStep] = useState<WipeStep>("hidden");
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

      {wipeStep === "hidden" ? (
        <Pressable
          testID="forgot-phrase-link"
          accessibilityRole="button"
          accessibilityLabel="Forgot your recovery words?"
          onPress={() => setWipeStep("confirm1")}
          hitSlop={FORGOT_LINK_HIT_SLOP}
        >
          <Text className="text-center text-fg-2 underline dark:text-fg-2-dark">
            Forgot your recovery words?
          </Text>
        </Pressable>
      ) : null}

      {wipeStep === "confirm1" ? (
        <View testID="wipe-confirm-1" className="w-full gap-3 rounded-lg border border-danger p-4 dark:border-danger-dark">
          <Text className="text-center text-fg dark:text-fg-dark">
            Without your recovery words, this data cannot be recovered — not by us, not by
            support, not ever. Your only remaining option is to wipe this device's PeraPlano data
            and start over from scratch.
          </Text>
          <Pressable
            testID="wipe-confirm-1-continue"
            onPress={() => setWipeStep("confirm2")}
            accessibilityRole="button"
            className="min-h-[44px] justify-center rounded-lg bg-danger px-4 py-3 dark:bg-danger-dark"
          >
            <Text className="text-center font-semibold text-surface dark:text-surface-dark">
              I understand — continue
            </Text>
          </Pressable>
          <Pressable
            testID="wipe-confirm-1-cancel"
            onPress={() => setWipeStep("hidden")}
            accessibilityRole="button"
            hitSlop={WIPE_CANCEL_HIT_SLOP}
          >
            <Text className="text-center text-fg-2 dark:text-fg-2-dark">Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {wipeStep === "confirm2" ? (
        <View testID="wipe-confirm-2" className="w-full gap-3 rounded-lg border border-danger p-4 dark:border-danger-dark">
          <Text className="text-center font-semibold text-danger dark:text-danger-dark">
            This will permanently delete every transaction, wallet, and setting on this device.
            This cannot be undone.
          </Text>
          <Pressable
            testID="wipe-confirm-2-continue"
            onPress={() => void onWipe()}
            accessibilityRole="button"
            className="min-h-[44px] justify-center rounded-lg bg-danger px-4 py-3 dark:bg-danger-dark"
          >
            <Text className="text-center font-semibold text-surface dark:text-surface-dark">
              Wipe and start over
            </Text>
          </Pressable>
          <Pressable
            testID="wipe-confirm-2-cancel"
            onPress={() => setWipeStep("hidden")}
            accessibilityRole="button"
            hitSlop={WIPE_CANCEL_HIT_SLOP}
          >
            <Text className="text-center text-fg-2 dark:text-fg-2-dark">Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
