// app/(onboarding)/welcome.tsx — the first screen of the M3c numbered
// onboarding flow (m3c-onboarding-client plan Task 2;
// docs/04-features/01-onboarding.md step 1). First of the flow's nine routed
// steps (lib/onboarding/onboarding_state.ts's ONBOARDING_STEPS). Reached from
// app/(onboarding)/index.tsx once the device lock, recovery phrase, and
// (pre-existing) provider picker are done — see that file's header for why
// both its "already_keyed" and post-provider-step branches land here. Because
// onboarding progress is not persisted (onboarding_state.ts's own header:
// "quitting mid-flow restarts at 'welcome' on next launch, deliberately"),
// EVERY path that reaches this numbered flow starts here, at the top, with no
// exception.
//
// NO BACK, NO SKIP. `onBack` is omitted because there is nowhere to go back
// to — the device lock and recovery phrase ahead of this screen are mandatory
// and deliberately outside this flow's own back-stack
// (onboarding_frame.tsx's own header comment says exactly this for
// "welcome"). `onSkip` is omitted for a different reason: this screen asks
// for nothing — no permission, no data — so there is nothing to skip past.
// Rule 5's "both steps are skippable" (task-2-brief.md) names access and
// battery specifically, not this screen; Continue is the only forward action,
// the same as OnboardingFrame's "done" step has no skip because it has
// nothing left to skip either.
import { useCallback } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { BrandMark } from "@/components/ui/brand_mark";

export default function WelcomeScreen() {
  const router = useRouter();

  // nextStep("welcome") === "how_it_works" (lib/onboarding/onboarding_state.ts)
  // — hardcoded rather than computed: the literal has to match a real file
  // (app/(onboarding)/how_it_works.tsx) for expo-router to resolve it.
  const handlePrimary = useCallback(() => {
    router.push("/(onboarding)/how_it_works");
  }, [router]);

  return (
    <OnboardingFrame
      step="welcome"
      title="Welcome to PeraPlano"
      onPrimary={handlePrimary}
      primaryLabel="Get started"
    >
      <View className="items-center gap-4 py-4">
        {/* `static`, deliberately -- Part 3 Task 7 ("place the motion") is
            the task that decides whether and how this plays the `launch`
            take-off, and it lands last, on finished screens. This anchor is
            what it upgrades. */}
        <BrandMark size={72} testID="welcome-brand-mark" />
        <Text
          testID="welcome-promise"
          className="text-center text-section font-semibold text-fg dark:text-fg-dark"
        >
          You never log a transaction. You only set the rules.
        </Text>
        <Text
          testID="welcome-trust"
          className="text-center text-body font-medium text-fg-2 dark:text-fg-2-dark"
        >
          No bank passwords. No account linking. Everything about your money stays on this phone.
        </Text>
      </View>
    </OnboardingFrame>
  );
}
