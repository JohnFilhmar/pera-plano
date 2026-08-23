// app/(tabs)/more/index.tsx — the More tab hub (M3 Part 2 Task 6; Reports row
// added by the M3b chart-colours-and-integration task; Settings, Privacy
// centre, Listener health, Parser diagnostics and About-and-tier rows added
// by M3b Task 5; Reports, Privacy centre, Listener health and Parser
// diagnostics all wired to their now-built screens by M3b Task 8, which also
// flipped the last five `SHIPPED_FEATURES` keys). Restyled by the mobile UI
// revamp Part 3 Task 1: a `ProfileCard` up top, then three `SectionHeader`
// groups of `ListRow`s, replacing the flat stack of Card-wrapped Pressables
// this file used to render.
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
// navigates for real; About is not a gate or a navigating row at all — it is
// a static line. Three distinct row behaviours through one field is more
// machinery than seven rows need.
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
//
// EACH GATED/NAVIGATING ROW IS A MANUALLY-WRAPPED `Pressable` AROUND A
// `ListRow` THAT HAS NO `onPress` OF ITS OWN — the same split
// components/transactions/transaction_row.tsx already uses, and for the same
// reason: `ListRow`'s own `onPress` branch derives `accessibilityLabel` from
// `title` + `subtitle` ("${title}, ${subtitle}"), which is NOT the plain
// "Reports" / "Subscriptions" / … label this hub has always announced, and
// which app/__tests__/more_tab.test.tsx and more_hub.test.tsx keep pressing
// by testID. Keeping testID and accessibilityLabel on an outer Pressable —
// with the gate (`SoonGate`/`PlusGate`) wrapped around that same outer
// Pressable, exactly where both already sat — leaves both unchanged while the
// row's insides become a `ListRow`.
//
// ABOUT GETS NO CHEVRON. Read generically, "every row becomes title +
// subtitle + left icon + right ChevronRight" would cover About too, but About
// has never been a Pressable — no onPress, no accessibilityRole — because it
// does not navigate anywhere (see "not a gate or a navigating row" above,
// unchanged by this restyle). A chevron on a row that does nothing when
// pressed promises a tap that goes nowhere, so this row keeps its icon (for
// the same left-aligned rhythm as every other row in the "App" group) but
// drops the chevron and the Pressable both.
//
// "SHARED BUDGETS" IS NOT IN THIS FILE. This task's brief lists the Insights
// group as "Reports, Subscriptions, Shared budgets" — but nothing named
// `shared budgets` exists anywhere in this codebase (no route, no
// `FeatureKey`, no screen), and the task instructions that accompanied that
// brief list Insights as Reports and Subscriptions only. Treated as a stale
// brief claim rather than a row invented for a destination that does not
// exist.
import { useRouter } from "expo-router";
import {
  Activity,
  BarChart3,
  ChevronRight,
  Info,
  Repeat,
  Settings as SettingsIcon,
  ShieldCheck,
  Wrench,
} from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { SoonGate } from "@/components/gates/soon_gate";
import { ProfileCard } from "@/components/more/profile_card";
import { registerIcon, type IconComponent } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list_row";
import { SectionHeader } from "@/components/ui/section_header";
import { getTier } from "@/lib/entitlements";

/** Mirrors app.json's `expo.version`. No installed screen reads it dynamically. */
const APP_VERSION = "0.1.0";

const ReportsGlyph = registerIcon(BarChart3);
const SubscriptionsGlyph = registerIcon(Repeat);
const SettingsGlyph = registerIcon(SettingsIcon);
const ListenerGlyph = registerIcon(Activity);
const ParserGlyph = registerIcon(Wrench);
const PrivacyGlyph = registerIcon(ShieldCheck);
const AboutGlyph = registerIcon(Info);
const ChevronGlyph = registerIcon(ChevronRight);

/** The 32dp glyph-in-a-disc every row's `left` slot uses (contract §2 tokens only). */
function RowIconDisc({ icon: Icon }: { icon: IconComponent }) {
  return (
    <View className="h-8 w-8 items-center justify-center rounded-full bg-chip dark:bg-chip-dark">
      <Icon size={18} className="text-fg-2 dark:text-fg-2-dark" />
    </View>
  );
}

function RowChevron() {
  return <ChevronGlyph size={18} className="text-fg-2 dark:text-fg-2-dark" />;
}

export default function MoreScreen() {
  const router = useRouter();

  return (
    <ScrollView
      testID="more-hub"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-1 p-4"
    >
      <ProfileCard testID="more-profile" />

      <SectionHeader title="Insights" />

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
          <ListRow
            title="Reports"
            subtitle="Spending by category, top merchants, and the trend behind them."
            left={<RowIconDisc icon={ReportsGlyph} />}
            right={<RowChevron />}
          />
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
          <ListRow
            title="Subscriptions"
            subtitle="We flag recurring charges and total what's locked in every month."
            left={<RowIconDisc icon={SubscriptionsGlyph} />}
            right={<RowChevron />}
          />
        </Pressable>
      </PlusGate>

      <SectionHeader title="Tracking" />

      {/* `listener_health` is "shipped" as of m3b Task 8, and its screen
          (app/(tabs)/more/listener_health.tsx) now exists. */}
      <SoonGate feature="listener_health">
        <Pressable
          testID="more-listener-health"
          onPress={() => router.push("/more/listener_health")}
          accessibilityRole="button"
          accessibilityLabel="Listener health"
        >
          <ListRow
            title="Listener health"
            subtitle="Whether tracking is actually connected right now, and since when."
            left={<RowIconDisc icon={ListenerGlyph} />}
            right={<RowChevron />}
          />
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
          <ListRow
            title="Parser diagnostics"
            subtitle="What's parsing per provider, and what's landing in the unknown bin."
            left={<RowIconDisc icon={ParserGlyph} />}
            right={<RowChevron />}
          />
        </Pressable>
      </SoonGate>

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
          <ListRow
            title="Privacy centre"
            subtitle="Export everything, wipe everything, and see exactly what's tracked."
            left={<RowIconDisc icon={PrivacyGlyph} />}
            right={<RowChevron />}
          />
        </Pressable>
      </SoonGate>

      <SectionHeader title="App" />

      {/* Settings is a real, shipped screen (app/(tabs)/more/settings.tsx) —
          no gate, and a real `push` since the route exists. */}
      <Pressable
        testID="more-settings"
        onPress={() => router.push("/more/settings")}
        accessibilityRole="button"
        accessibilityLabel="Settings"
      >
        <ListRow
          title="Settings"
          subtitle="Appearance, alerts, and what leaves this device."
          left={<RowIconDisc icon={SettingsGlyph} />}
          right={<RowChevron />}
        />
      </Pressable>

      {/* Static — no gate, no navigation, no chevron (see this file's header
          comment). Not a feature; just what build and tier the user is on. */}
      <ListRow
        testID="more-about"
        title="About"
        subtitle={`PeraPlano v${APP_VERSION} · ${getTier() === "plus" ? "Plus" : "Free"} tier`}
        left={<RowIconDisc icon={AboutGlyph} />}
      />

      {/* Spacer so the last row clears the tab bar on short devices. */}
      <View className="h-4" />
    </ScrollView>
  );
}
