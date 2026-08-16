// app/(tabs)/more/index.tsx — the More tab hub (M3 Part 2 Task 6; Reports row
// added by the M3b chart-colours-and-integration task; Settings, Privacy
// centre, Listener health, Parser diagnostics and About-and-tier rows added
// by M3b Task 5; Reports, Privacy centre, Listener health and Parser
// diagnostics all wired to their now-built screens by M3b Task 8, which also
// flipped the last five `SHIPPED_FEATURES` keys).
//
// Converted from the M1 placeholder at app/(tabs)/more.tsx, the same move
// plan/index.tsx made for its own sub-screens: expo-router treats `more.tsx`
// and `more/index.tsx` as the same `/more` route (the tab registration in
// (tabs)/_layout.tsx did not move), which is what lets every screen below
// nest under `more/` without opening a second URL space — `app/more/*.tsx`
// would collide with this one, the same mistake m2b Tasks 4 and 8 and m2c
// Task 5 already made once each.
//
// STILL NOT A DATA-DRIVEN LIST like app/(tabs)/plan/index.tsx's `SECTIONS`.
// Reports, Privacy centre, Listener health and Parser diagnostics are all
// `SoonGate` rows that navigate for real now that every key ships;
// Subscriptions is `PlusGate` (tier paywall) instead; Settings is ungated and
// navigates for real; About-and-tier is not a gate or a navigating row at all
// — it is a static line. Four distinct row behaviours through one field is
// more machinery than seven rows need.
//
// `SoonGate` STAYS WRAPPED on all four rows below even though every feature
// key it names is now "shipped" — the same call m2c Task 6 made on the Plan
// hub once `bills` shipped (app/(tabs)/plan/index.tsx's own comment, and
// app/__tests__/plan_hub.test.tsx's "SoonGate is still wrapped around every
// section" test). A later feature can still land ahead of its own rollout, so
// a future plan adding one should not have to rediscover where the gate
// goes; with nothing soon it no longer blocks anything, which is exactly why
// every row below is asserted to actually navigate, not just "no Soon chip
// renders" (app/__tests__/more_tab.test.tsx, app/__tests__/more_hub.test.tsx).
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { SoonGate } from "@/components/gates/soon_gate";
import { Card } from "@/components/ui/card";
import { getTier } from "@/lib/entitlements";

/** Mirrors app.json's `expo.version`. No installed screen reads it dynamically. */
const APP_VERSION = "0.1.0";

export default function MoreScreen() {
  const router = useRouter();

  return (
    <ScrollView
      testID="more-hub"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-3 p-4"
    >
      {/* `reports` is "shipped" as of m3b Task 8 — SoonGate now renders
          `children` verbatim, with no wrapper and no chip, so this row is
          fully interactive. The gate itself is left in place rather than
          removed (see this file's header comment for why). */}
      <SoonGate feature="reports">
        <Pressable
          testID="more-reports"
          onPress={() => router.push("/more/reports")}
          accessibilityRole="button"
          accessibilityLabel="Reports"
        >
          <Card>
            <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Reports</Text>
            <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
              Spending by category, top merchants, and the trend behind them.
            </Text>
          </Card>
        </Pressable>
      </SoonGate>

      {/* Plan rule 5: a locked door the user can see through converts better
          than a hidden one — Free sees this exact row and its one-line
          explanation, never the merchants or amounts behind it (Reports rule
          19; see app/(tabs)/more/subscriptions.tsx for where that data lives
          and how it stays hidden even if this gate is bypassed). */}
      <PlusGate capability="recurring">
        <Pressable
          testID="more-subscriptions"
          onPress={() => router.push("/more/subscriptions")}
          accessibilityRole="button"
          accessibilityLabel="Subscriptions"
        >
          <Card>
            <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Subscriptions</Text>
            <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
              We flag recurring charges and total what's locked in every month.
            </Text>
          </Card>
        </Pressable>
      </PlusGate>

      {/* Settings is a real, shipped screen (app/(tabs)/more/settings.tsx) —
          no gate, and a real `push` since the route exists. */}
      <Pressable
        testID="more-settings"
        onPress={() => router.push("/more/settings")}
        accessibilityRole="button"
        accessibilityLabel="Settings"
      >
        <Card>
          <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Settings</Text>
          <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
            Appearance, alerts, and what leaves this device.
          </Text>
        </Card>
      </Pressable>

      {/* `privacy_center` is "shipped" as of m3b Task 8, and its screen
          (app/(tabs)/more/privacy.tsx) now exists — same real `push` as
          Settings and Reports above. */}
      <SoonGate feature="privacy_center">
        <Pressable
          testID="more-privacy-center"
          onPress={() => router.push("/more/privacy")}
          accessibilityRole="button"
          accessibilityLabel="Privacy centre"
        >
          <Card>
            <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
              Privacy centre
            </Text>
            <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
              Export everything, wipe everything, and see exactly what's tracked.
            </Text>
          </Card>
        </Pressable>
      </SoonGate>

      {/* `listener_health` is "shipped" as of m3b Task 8, and its screen
          (app/(tabs)/more/listener_health.tsx) now exists. */}
      <SoonGate feature="listener_health">
        <Pressable
          testID="more-listener-health"
          onPress={() => router.push("/more/listener_health")}
          accessibilityRole="button"
          accessibilityLabel="Listener health"
        >
          <Card>
            <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
              Listener health
            </Text>
            <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
              Whether tracking is actually connected right now, and since when.
            </Text>
          </Card>
        </Pressable>
      </SoonGate>

      {/* `parser_diagnostics` is "shipped" as of m3b Task 8, and its screen
          (app/(tabs)/more/parser_diagnostics.tsx) now exists. */}
      <SoonGate feature="parser_diagnostics">
        <Pressable
          testID="more-parser-diagnostics"
          onPress={() => router.push("/more/parser_diagnostics")}
          accessibilityRole="button"
          accessibilityLabel="Parser diagnostics"
        >
          <Card>
            <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
              Parser diagnostics
            </Text>
            <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
              What's parsing per provider, and what's landing in the unknown bin.
            </Text>
          </Card>
        </Pressable>
      </SoonGate>

      {/* Static — no gate, no navigation. Not a feature; just what build and
          tier the user is on. */}
      <Card testID="more-about">
        <Text className="text-lg font-semibold text-fg dark:text-fg-dark">About</Text>
        <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
          PeraPlano v{APP_VERSION} · {getTier() === "plus" ? "Plus" : "Free"} tier
        </Text>
      </Card>

      {/* Spacer so the last card clears the tab bar on short devices. */}
      <View className="h-4" />
    </ScrollView>
  );
}
