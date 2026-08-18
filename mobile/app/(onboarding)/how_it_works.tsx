// app/(onboarding)/how_it_works.tsx — the mechanism explanation (m3c-
// onboarding-client plan Task 2; docs/04-features/01-onboarding.md step 2).
// Second of the flow's nine routed steps (lib/onboarding/onboarding_state.ts).
// Reached from welcome.tsx; advances to access.tsx.
//
// SETS UP WHAT access.tsx ASKS PERMISSION FOR, in plain language, with no
// permission screen anywhere in sight yet — rule 1's "value before
// permission" is a property of the whole flow, not just the access step in
// isolation. access.tsx (next) covers the CONCRETE facts a Google Play
// prominent disclosure needs (what is read, what is extracted, what is
// discarded); this screen only has to make the mechanism make sense before
// any of those specifics arrive.
//
// THE SAMPLE NOTIFICATION IS MARKED ILLUSTRATIVE, AND INVENTED (docs rule 15:
// "no invented string is presented as a real provider format"). Not one of
// the fifteen seed package formats has been checked against a device yet
// (lib/ingest/seed_rules.ts's own header), so this screen must say so on its
// face rather than imply the string shown is a real provider's wording.
//
// THE VALUE CAROUSEL ABOVE THAT COPY (task-3-brief.md) FOLLOWS THE SAME
// DISCIPLINE. `ValueCarousel` renders four art-placeholder panels before any
// of this screen's own text; the cafe, the card, and the bank notification
// its briefs describe are all fictional for the identical reason the sample
// notification below is labelled illustrative -- see value_panels.ts's
// header for the no-real-brands rule that governs them.
import { useCallback } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { ValueCarousel } from "@/components/onboarding/value_carousel";
import { Card } from "@/components/ui/card";

export default function HowItWorksScreen() {
  const router = useRouter();

  // nextStep("how_it_works") === "access" (lib/onboarding/onboarding_state.ts)
  // — hardcoded for the same reason welcome.tsx's handlePrimary is.
  const handlePrimary = useCallback(() => {
    router.push("/(onboarding)/access");
  }, [router]);

  return (
    <OnboardingFrame
      step="how_it_works"
      title="How PeraPlano works"
      onPrimary={handlePrimary}
      onBack={() => router.back()}
    >
      <View className="gap-4">
        <ValueCarousel testID="how-it-works-value-carousel" />
        <Text testID="how-it-works-mechanism" className="text-fg dark:text-fg-dark">
          Your bank and e-wallet apps already send you a notification every time money moves.
          PeraPlano reads those notifications and turns them into entries in your ledger, so you
          don&apos;t have to type them in yourself.
        </Text>
        <Card testID="how-it-works-example">
          <Text className="text-xs font-semibold uppercase text-fg-2 dark:text-fg-2-dark">
            Example — illustrative only, not a real notification
          </Text>
          <Text className="mt-1 text-fg dark:text-fg-dark">You sent ₱250.00 to Jollibee</Text>
        </Card>
        <Text testID="how-it-works-trust" className="text-fg-2 dark:text-fg-2-dark">
          Nothing here needs your bank password, and no account gets linked. Next, you&apos;ll see
          exactly what PeraPlano reads and what it never keeps.
        </Text>
      </View>
    </OnboardingFrame>
  );
}
