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
// THREE NUMBERED CARDS REPLACE THE VALUE CAROUSEL HERE (mobile-ui-revamp
// Part 3 Task 6). `ValueCarousel` (task-3-brief.md) was always a stand-in
// for photography that does not exist yet -- four art-placeholder panels,
// each rendering its own brief as visible text. The design's board for this
// screen is a finished composition, not a placeholder: three numbered cards
// with mint glyph discs walking "grant access -> set your rules -> tracked
// 24/7" (docs/11-mobile-app-design-prompt.md's own "How it works (3 cards)"
// line). `ValueCarousel`/`value_panels.ts` are left exactly as they were --
// still exported, still tested by their own suite -- simply no longer
// mounted here; deleting either was out of this task's file list and would
// have meant deleting or rewriting components/onboarding/__tests__/
// value_carousel.test.tsx too, which this task may not touch.
//
// THE MECHANISM / EXAMPLE / TRUST COPY BELOW THE CARDS IS UNCHANGED, WORD
// FOR WORD AND TESTID FOR TESTID. components/onboarding/__tests__/
// how_it_works_step.test.tsx (out of this task's file list) pins
// "how-it-works-mechanism" plus the words "notification", "ledger",
// "illustrative" and "not a real notification" appearing somewhere in this
// screen's tree; app/(onboarding)/__tests__/setup_flow_e2e.test.tsx pins
// "how-it-works-mechanism" too. Only the numbered cards above this copy, and
// this file's own "renders the carousel above the mechanism copy" ordering
// test (app/(onboarding)/__tests__/how_it_works.test.tsx, which this task
// DOES own), changed.
import { useCallback } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { Card } from "@/components/ui/card";

type MechanismStep = { id: string; number: number; title: string; body: string };

const MECHANISM_STEPS: readonly MechanismStep[] = [
  {
    id: "grant_access",
    number: 1,
    title: "Grant access",
    body: "Let PeraPlano read your bank and e-wallet notifications on this phone.",
  },
  {
    id: "set_your_rules",
    number: 2,
    title: "Set your rules",
    body: "Limits, goals, bills, and loans — you decide what PeraPlano watches for.",
  },
  {
    id: "tracked_24_7",
    number: 3,
    title: "Tracked 24/7",
    body: "Every matching notification becomes a ledger entry automatically, day or night.",
  },
];

function MechanismCard({ step }: { step: MechanismStep }) {
  return (
    <Card testID={`how-it-works-step-${step.id}`}>
      <View className="flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-brand-soft dark:bg-brand-soft-dark">
          <Text className="text-row font-extrabold text-brand dark:text-brand-dark">
            {step.number}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-row font-bold text-fg dark:text-fg-dark">{step.title}</Text>
          <Text className="mt-0.5 text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
            {step.body}
          </Text>
        </View>
      </View>
    </Card>
  );
}

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
        <View testID="how-it-works-mechanism-cards" className="gap-3">
          {MECHANISM_STEPS.map((step) => (
            <MechanismCard key={step.id} step={step} />
          ))}
        </View>
        <Text
          testID="how-it-works-mechanism"
          className="text-body font-medium text-fg dark:text-fg-dark"
        >
          Your bank and e-wallet apps already send you a notification every time money moves.
          PeraPlano reads those notifications and turns them into entries in your ledger, so you
          don&apos;t have to type them in yourself.
        </Text>
        <Card testID="how-it-works-example">
          <Text className="text-micro font-semibold uppercase text-fg-2 dark:text-fg-2-dark">
            Example — illustrative only, not a real notification
          </Text>
          <Text className="mt-1 text-body font-medium text-fg dark:text-fg-dark">
            You sent ₱250.00 to Jollibee
          </Text>
        </Card>
        <Text
          testID="how-it-works-trust"
          className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark"
        >
          Nothing here needs your bank password, and no account gets linked. Next, you&apos;ll see
          exactly what PeraPlano reads and what it never keeps.
        </Text>
      </View>
    </OnboardingFrame>
  );
}
