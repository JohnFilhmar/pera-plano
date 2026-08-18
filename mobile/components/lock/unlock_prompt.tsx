// components/lock/unlock_prompt.tsx — the cold-start / re-lock screen
// (docs/12-encryption-and-app-lock.md §7; task-9-brief.md; task-6-brief.md).
// Purely presentational: contexts/lock_context.tsx owns the state machine,
// this component only renders it and forwards a tap to onUnlock.
//
// AUTO-FIRES THE SYSTEM PROMPT EXACTLY ONCE, ON FIRST MOUNT (task-6-brief.md)
// — not on re-render, not after a cancellation, not after an error. The
// guard is a ref, not state: setting it does not itself cause a re-render,
// and — the specific failure mode this component is written to survive —
// React StrictMode's dev-only mount -> cleanup -> mount replay reuses that
// same ref rather than resetting it, so the replay still only calls
// `onUnlock` once. See `__tests__/unlock_prompt.test.tsx` for a StrictMode-
// wrapped test that proves this directly rather than assuming it.
//
// AFTER ANY FAILURE OR CANCELLATION, THE FALLBACK IS TODAY'S MANUAL BUTTON —
// THAT FALLBACK IS THE ANTI-LOOP GUARANTEE. app/lock.tsx renders this exact
// component for both the "locked" and "authenticating" statuses, so a
// cancelled or failed attempt (contexts/lock_context.tsx's unlock(): status
// back to "locked", a benign errorMessage set) is a RE-RENDER of this same
// mounted instance, never a remount — the mount-once ref stays set and
// nothing here re-invokes onUnlock automatically. That is what makes
// "NotAuthenticated -> re-prompt and retry" (task-9-brief rule 3) a plain,
// non-looping user action (a fresh tap on the button below) instead of an
// automatic retry that could spin forever on a cancelled prompt.
import { useEffect, useRef } from "react";
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

  // The mount-once guard. A ref survives StrictMode's replay (see header
  // comment) and, unlike state, setting it never itself schedules a
  // re-render — the auto-fire effect below runs purely as a side effect of
  // mounting, not as something this component's own render loop can retrigger.
  const hasFiredRef = useRef(false);
  useEffect(() => {
    if (hasFiredRef.current) return;
    hasFiredRef.current = true;
    onUnlock();
    // Deliberately NOT re-run on `onUnlock` changing identity: the guard
    // above already makes that safe, and an exhaustive-deps array here would
    // wrongly imply this effect is meant to track onUnlock rather than fire
    // once at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
