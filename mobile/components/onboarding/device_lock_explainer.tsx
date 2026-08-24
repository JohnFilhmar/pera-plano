// components/onboarding/device_lock_explainer.tsx — shown when the device
// has no screen lock configured (docs/12-encryption-and-app-lock.md §5a;
// task-9a-brief.md). Two call sites share this exact component:
//
//   1. app/(onboarding)/device_lock.tsx — before any key is ever generated
//      (task-9a-brief rule 1).
//   2. contexts/lock_context.tsx's "needs_device_lock" status, rendered by
//      app/lock.tsx — the mid-life case where a user who removed their
//      screen lock later tries to recover via their phrase, and
//      recreateDeviceKek() cannot create a new auth-gated key with no lock
//      present (docs §5a's "mid-life removal" paragraph).
//
// Purely presentational, exactly like components/lock/unlock_prompt.tsx and
// recovery_unlock_form.tsx: the caller owns checking isDeviceSecure() and
// re-checking on return from Settings; this component only renders the
// explanation and forwards a tap to onOpenSettings.
//
// THERE IS NO SKIP BUTTON ANYWHERE IN THIS FILE (task-9a-brief rule 4). Not
// an oversight to double check for in review — there is deliberately no
// prop, no state, and no code path that could render one. The copy below is
// equally deliberate: it says plainly that the app cannot continue without a
// screen lock, rather than presenting this as a suggestion.
//
// RESTYLE (mobile-ui-revamp Part 3 Task 6) — TOKENS ONLY, NOT THE FRAME.
// "Restyled in place, in the same visual language as the nine designed
// steps" (this task's own hard constraint) does NOT mean wrapped in
// `OnboardingFrame`: that component always renders its own primary button,
// and `components/onboarding/__tests__/device_lock.test.tsx` pins
// `getAllByRole("button")).toHaveLength(1)` on this screen — a second,
// frame-supplied button would fail that test outright, deliberately,
// because it would ALSO be the "second forward action" rule 4 exists to
// forbid. This screen also has no valid `OnboardingStep` to hand a frame's
// `step` prop anyway (lib/onboarding/onboarding_state.ts's own header: the
// device lock runs before that nine-step union even starts). Only the
// className tokens changed below; the tree shape, the testIDs, and the
// exactly-one-button contract are exactly what they were.
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";

export function DeviceLockExplainer({ onOpenSettings }: { onOpenSettings: () => void }) {
  // Call site 2 (app/lock.tsx) renders this OUTSIDE the router's Stack, so no
  // navigator above it clears the system bars, and app.json's
  // `edgeToEdgeEnabled` makes the column full-bleed.
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="device-lock-explainer"
      className="flex-1 items-center justify-center gap-4 bg-bg px-6 dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Text className="text-center text-title font-bold text-fg dark:text-fg-dark">
        Set a screen lock to continue
      </Text>
      <Text className="text-center text-body font-medium text-fg-2 dark:text-fg-2-dark">
        Your phone's own PIN, pattern, password, or fingerprint is what protects the key that
        encrypts your financial data. PeraPlano cannot continue on a phone with no screen lock —
        there is no other way to keep that key safe.
      </Text>
      <View className="w-full">
        <Button
          testID="device-lock-open-settings-button"
          title="Open security settings"
          size="lg"
          onPress={onOpenSettings}
        />
      </View>
    </View>
  );
}
