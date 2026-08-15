// app/(tabs)/plan/index.tsx — the Plan hub (m2 Task 8;
// docs/06-information-architecture.md §2 "PlanTab").
//
// FOUR SECTIONS, NOT FIVE. The IA's PlanTab subgraph is explicit: "Plan hub:
// Limits, Goals, Loans, Bills". The m2 plan's own snippet adds an Income row
// pointing at `/plan/income`, but income is an ONBOARDING step (IA §5 step 7)
// and a settings-side declaration — it has no hub row, and the one place a user
// needs it from here is the percent-of-income create flow, which links to it
// inline.
//
// SECTIONS GO LIVE AS THEIR PLANS FLIP THEM. `constants/shipped_features.ts`
// is the single per-build rollout switch and the foundation plan's rollout
// table assigns each key to exactly one plan: `limits` with `income` (M2 Part 2
// Task 14, since a percent-of-income limit is not usable until income is),
// `goals` and `loans` together (m2b Task 9), and `bills` last (m2c Task 6).
// A section with no `href` yet is one whose screens do not exist — the type
// says so, and `SoonGate` makes the card inert either way.
//
// This file replaced the M1 placeholder at `app/(tabs)/plan.tsx`. The route is
// unchanged (`/plan`) and the tab registration in `(tabs)/_layout.tsx` did not
// move — expo-router treats `plan.tsx` and `plan/index.tsx` as the same route,
// which is what lets the feature screens nest under `plan/`.
import { useRouter, type Href } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { SoonGate } from "@/components/gates/soon_gate";
import { Card } from "@/components/ui/card";
import type { FeatureKey } from "@/constants/shipped_features";

type Section = {
  feature: Extract<FeatureKey, "limits" | "goals" | "loans" | "bills">;
  /**
   * `undefined` until that section's screens exist. `typedRoutes` is on, so a
   * route that has not been built is not a valid `Href` — which is the type
   * system stating the same fact `SHIPPED_FEATURES` states at runtime, and it
   * means m2b and m2c cannot forget to fill these in.
   */
  href?: Href;
  title: string;
  blurb: string;
};

const SECTIONS: readonly Section[] = [
  {
    feature: "limits",
    href: "/plan/limits",
    title: "Limits",
    blurb: "Spending caps that warn you at 50%, 80% and 100%.",
  },
  {
    feature: "goals",
    href: "/plan/goals",
    title: "Goals",
    blurb: "Savings targets backed by a real wallet.",
  },
  {
    feature: "loans",
    href: "/plan/loans",
    title: "Loans",
    blurb: "Utang both ways — balances and what is due next.",
  },
  {
    feature: "bills",
    title: "Bills",
    blurb: "Due-date reminders, matched to payments automatically.",
  },
];

export default function PlanScreen() {
  // `useRouter` + `Pressable`, not `<Link asChild>`: every navigating screen in
  // this app already does it this way, and one file reaching for the other API
  // would make the screen tests need two different mocks of expo-router.
  const router = useRouter();

  return (
    <ScrollView
      testID="plan-hub"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-3 p-4"
    >
      {SECTIONS.map((section) => (
        <SoonGate key={section.feature} feature={section.feature}>
          <Pressable
            testID={`plan-section-${section.feature}`}
            onPress={() => {
              if (section.href !== undefined) router.push(section.href);
            }}
          >
            <Card>
              <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
                {section.title}
              </Text>
              <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">{section.blurb}</Text>
            </Card>
          </Pressable>
        </SoonGate>
      ))}
      {/* Spacer so the last card clears the tab bar on short devices. */}
      <View className="h-4" />
    </ScrollView>
  );
}
