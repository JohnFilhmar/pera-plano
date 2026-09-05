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
// `SoonGate` rows that navigate for real now that every key THEIR rollout
// plan owned ships; Shared budgets is a fifth `SoonGate` row that does NOT —
// `shared_budgets` is seeded "soon" and stays that way until the feature
// exists (constants/shipped_features.ts) — so it is the one row on this hub
// that still actually blocks a press. Subscriptions is `PlusGate` (tier
// paywall) instead; Settings is ungated and navigates for real; About is not
// a gate or a navigating row at all — it is a static line. Four distinct row
// behaviours through one field is more machinery than eight rows need.
//
// `SoonGate` STAYS WRAPPED on the four "shipped" rows below even though every
// feature key each one names is "shipped" — the same call m2c Task 6 made on
// the Plan hub once `bills` shipped (app/(tabs)/plan/index.tsx's own comment,
// and app/__tests__/plan_hub.test.tsx's "SoonGate is still wrapped around
// every section" test). A later feature can still land ahead of its own
// rollout, so a future plan adding one should not have to rediscover where
// the gate goes; with nothing soon on THOSE four it no longer blocks
// anything, which is exactly why each of them is asserted to actually
// navigate, not just "no Soon chip renders" (app/__tests__/more_tab.test.tsx,
// app/__tests__/more_hub.test.tsx). Shared budgets is the fifth `SoonGate`
// row and the odd one out: its key is genuinely "soon" today, so its own
// coverage asserts the opposite — the chip renders and the press does not
// navigate.
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
// "SHARED BUDGETS" JOINS THIS FILE (mobile UI revamp Part 3 Task 3). The
// comment this replaces recorded that "Shared budgets" was a stale brief
// claim with no `FeatureKey`, no route and no screen behind it — an earlier
// task correctly declined to invent a row for a destination that did not
// exist. All three now exist (constants/shipped_features.ts's
// `shared_budgets` key, seeded "soon"; app/(tabs)/more/shared_budgets.tsx),
// so this task adds the row that earlier task was right to skip.
//
// SUBTITLELINES (branch-review-correctness.md F2, fix-round-2). Every
// gated/navigating row's subtitle below defaulted to list_row.tsx's
// `numberOfLines={1}` and clips on a real device — the identical bug
// fix-round-1 already paid down on app/(tabs)/more/settings.tsx and
// components/privacy/capture_toggle.tsx (`subtitleLines={4..6}` there),
// missed on this screen because it shipped in the same diff and was never
// swept for. This screen's rows are narrower than either of those: every row
// below carries BOTH a 32dp `RowIconDisc` (left) AND an 18dp `RowChevron`
// (right), where settings.tsx's `SettingCard` rows carry only one flanking
// control and no left icon at all. Absent a device to re-measure this exact
// shape, each value below is `Math.ceil(subtitle.length / 22)` — 22 chars/
// line is this codebase's own most conservative real measurement
// (settings.tsx's recurring-forget row: 129 characters over 6 lines ≈ 21.5),
// deliberately not its most generous one (settings.tsx's bare-Switch rows
// reach ~31 chars/line). `numberOfLines` is a ceiling on wrapping, not a
// fixed height, so over-provisioning here costs nothing visually. Settings'
// subtitle (48 characters) is short enough that branch-review-correctness.md
// hedged "possibly" safe at the default — this file extends the fix to it
// too, since it shares the identical narrow row shape as the six the review
// named and 48 characters clears no chars/line rate this codebase has ever
// measured. About is the one row left at the default: its subtitle is the
// shortest (28 characters) AND the one row with no right chevron at all (see
// "ABOUT GETS NO CHEVRON" above), so it has more width than any other row
// here, not less.
//
// "TURN ON ALERTS" IS THE ONE CONDITIONAL ROW (GAP-003). Every other row on
// this hub always renders; this one appears only while the app cannot post a
// notification, because for a user who granted the permission during
// onboarding it would be a row that does nothing. It is also the only row
// here that is not a destination at all — it either raises the Android 13+
// POST_NOTIFICATIONS dialog or opens the phone's settings, and disappears
// once the grant lands.
//
// "PERMISSIONS" IS THE ROW BESIDE IT, NOT A REPLACEMENT FOR IT (GAP-018).
// The two answer different questions and the second cannot do the first's
// job. "Turn on alerts" is a one-tap fix that appears unprompted, for the one
// grant this hub can actually read; the Permissions row is a plain
// destination (app/(tabs)/more/permissions.tsx) that always renders, because
// the grant it exists for — the battery exemption — cannot be read at all, so
// a row conditional on its state is not a thing that can be built. Making
// this row conditional on the other two would also hide the checklist from
// exactly the user who came looking for it after tracking stopped.
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  Activity,
  BarChart3,
  Bell,
  ChevronRight,
  Info,
  KeyRound,
  LifeBuoy,
  Repeat,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react-native";
import { AppState, Linking, Pressable, ScrollView, View } from "react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { SoonGate } from "@/components/gates/soon_gate";
import { ProfileCard } from "@/components/more/profile_card";
import { registerIcon, type IconComponent } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list_row";
import { SectionHeader } from "@/components/ui/section_header";
import { requestAlertPermission } from "@/lib/alerts/alerts_service";
import { getTier } from "@/lib/entitlements";

/** Mirrors app.json's `expo.version`. No installed screen reads it dynamically. */
const APP_VERSION = "0.1.0";

const AlertsGlyph = registerIcon(Bell);
const ReportsGlyph = registerIcon(BarChart3);
const SubscriptionsGlyph = registerIcon(Repeat);
const SharedBudgetsGlyph = registerIcon(Users);
const SettingsGlyph = registerIcon(SettingsIcon);
const PermissionsGlyph = registerIcon(KeyRound);
const ListenerGlyph = registerIcon(Activity);
const ParserGlyph = registerIcon(Wrench);
const PrivacyGlyph = registerIcon(ShieldCheck);
const ReportProblemGlyph = registerIcon(LifeBuoy);
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

/**
 * What Android will currently let this app do about notifications.
 * `canAskAgain` is the half that decides whether a tap can still raise the
 * one-shot POST_NOTIFICATIONS dialog or has to send the user to the settings
 * app instead. `null` while the first read is in flight, so the row never
 * flashes in and back out on a device that already granted it.
 */
type AlertAccess = { granted: boolean; canAskAgain: boolean };

/**
 * `getPermissionsAsync` DIRECTLY, not through lib/alerts/alerts_service.ts.
 * That module's own non-prompting read (`hasPermission`) is deliberately
 * unexported — "every posting path goes through here" — and widening it for
 * one row would invite a posting path to start asking. This is the read; the
 * only mutation this file can cause is `requestAlertPermission`.
 *
 * `null` ON FAILURE, which the row treats as "say nothing". A read that threw
 * tells us nothing about the grant, and hiding the row costs a user who is
 * already in Settings one extra hop; showing it on a guess would offer a
 * dialog that may never appear.
 */
async function readAlertAccess(): Promise<AlertAccess | null> {
  try {
    const status = await Notifications.getPermissionsAsync();
    return { granted: status.granted, canAskAgain: status.canAskAgain };
  } catch {
    return null;
  }
}

export default function MoreScreen() {
  const router = useRouter();
  const [alertAccess, setAlertAccess] = useState<AlertAccess | null>(null);

  // ON MOUNT AND ON EVERY FOREGROUND, the same shape
  // app/(onboarding)/access.tsx uses for the other permission this app needs.
  // AppState rather than `useFocusEffect`: the grant is changed in ANOTHER
  // app — the system settings screen this row can open — and leaving
  // PeraPlano never unfocuses the tab, so a focus effect would not fire on
  // the one return that matters.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readAlertAccess().then((access) => {
        if (!cancelled) setAlertAccess(access);
      });
    };
    refresh();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const askable = alertAccess !== null && !alertAccess.granted;
  const canAskAgain = alertAccess?.canAskAgain ?? false;

  const turnOnAlerts = useCallback(() => {
    // ONE SHOT, EVER. Android spends the POST_NOTIFICATIONS dialog on the
    // first ask and answers every later request from what it remembers, with
    // nothing shown — so once `canAskAgain` is false, re-requesting here
    // would be a button that silently does nothing. Settings is the only
    // route left.
    if (!canAskAgain) {
      void Linking.openSettings();
      return;
    }
    requestAlertPermission()
      .then(async (granted) => {
        if (granted) {
          setAlertAccess({ granted: true, canAskAgain: false });
          return;
        }
        // The refusal just spent the dialog, so re-read rather than assume:
        // the next tap has to go to settings instead of asking again.
        setAlertAccess((await readAlertAccess()) ?? { granted: false, canAskAgain: false });
      })
      .catch((error: unknown) => {
        console.warn("the alert permission could not be requested", error);
      });
  }, [canAskAgain]);

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
            // 63 chars / 22 — fix-round-2 (see header).
            subtitleLines={3}
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
            // 65 chars / 22 — fix-round-2 (see header).
            subtitleLines={3}
            left={<RowIconDisc icon={SubscriptionsGlyph} />}
            right={<RowChevron />}
          />
        </Pressable>
      </PlusGate>

      {/* `shared_budgets` is the first FeatureKey seeded "soon" since the
          rollout table closed (constants/shipped_features.ts) — this is the
          row SoonGate has a live user for again. The route exists
          (app/(tabs)/more/shared_budgets.tsx) so it can still be opened
          directly during development; SoonGate's own `pointerEvents="none"`
          means this Pressable will not fire its `onPress` while the key
          stays "soon" (components/gates/soon_gate.tsx). Same manually-
          labelled-Pressable-around-a-bare-ListRow shape every other row on
          this hub uses, and deliberately NOT `ListRow`'s own `onPress` — see
          this file's header comment on why the two branches announce
          differently. */}
      <SoonGate feature="shared_budgets">
        <Pressable
          testID="more-shared-budgets"
          onPress={() => router.push("/more/shared_budgets")}
          accessibilityRole="button"
          accessibilityLabel="Shared budgets"
        >
          <ListRow
            title="Shared budgets"
            subtitle="Split a household budget — one pool, separate phones."
            // 53 chars / 22 — fix-round-2 (see header).
            subtitleLines={3}
            left={<RowIconDisc icon={SharedBudgetsGlyph} />}
            right={<RowChevron />}
          />
        </Pressable>
      </SoonGate>

      <SectionHeader title="Tracking" />

      {/* THE RECOVERY ROUTE FOR A SKIPPED OR REFUSED ONBOARDING STEP
          (GAP-003). Ungated and not a `push`: it raises the system dialog
          while Android will still show one, and opens this app's settings
          page once it will not. Hidden entirely while the grant is in place
          — see this file's header and the `alertAccess` read above. First in
          "Tracking" because an app that cannot notify is the one thing on
          this hub the user most needs to know about. */}
      {askable ? (
        <Pressable
          testID="more-turn-on-alerts"
          onPress={turnOnAlerts}
          accessibilityRole="button"
          accessibilityLabel="Turn on alerts"
        >
          <ListRow
            title="Turn on alerts"
            subtitle={
              canAskAgain
                ? "Limit warnings and due-date reminders can't reach your phone until Android lets PeraPlano post notifications."
                : "Android won't ask again — switch notifications on for PeraPlano in your phone's settings."
            }
            // 118 and 89 characters / 22 — same arithmetic as every row here
            // (see header).
            subtitleLines={6}
            left={<RowIconDisc icon={AlertsGlyph} />}
            right={<RowChevron />}
          />
        </Pressable>
      ) : null}

      {/* THE CHECKLIST BEHIND EVERY SKIPPED ONBOARDING GRANT (GAP-018).
          Ungated and always rendered — see this file's header for why it is
          not conditional the way the alerts row above is. Placed before
          Listener health on purpose: that screen diagnoses, this one is where
          the fix lives, and a user who has just read "tracking was
          interrupted" needs the fix next, not another reading. */}
      <Pressable
        testID="more-permissions"
        onPress={() => router.push("/more/permissions")}
        accessibilityRole="button"
        accessibilityLabel="Permissions"
      >
        <ListRow
          title="Permissions"
          subtitle="Notification access, alerts and the battery exemption — turn on anything you skipped during setup."
          // 98 chars / 22 — same arithmetic as every row here (see header).
          subtitleLines={5}
          left={<RowIconDisc icon={PermissionsGlyph} />}
          right={<RowChevron />}
        />
      </Pressable>

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
            // 65 chars / 22 — fix-round-2 (see header).
            subtitleLines={3}
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
            // 67 chars / 22 — fix-round-2 (see header).
            subtitleLines={4}
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
            // 67 chars / 22 — fix-round-2 (see header).
            subtitleLines={4}
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
          // 48 chars / 22 — fix-round-2, extended beyond the review's own
          // "possibly" hedge (see header).
          subtitleLines={3}
          left={<RowIconDisc icon={SettingsGlyph} />}
          right={<RowChevron />}
        />
      </Pressable>

      {/* `problem_reports` ships in the same change as this row and its screen
          (app/(tabs)/more/report_problem.tsx), so the gate never closes on it
          today — kept for the same reason every other gate on this hub is
          kept (see this file's header). Placed in "App" rather than
          "Diagnostics" on purpose: reporting a problem is something the user
          does, not something they inspect. */}
      <SoonGate feature="problem_reports">
        <Pressable
          testID="more-report-problem"
          onPress={() => router.push("/more/report_problem")}
          accessibilityRole="button"
          accessibilityLabel="Report a problem"
        >
          <ListRow
            title="Report a problem"
            subtitle="Tell us what broke. Works offline — we'll send it when you're back on."
            // 70 chars / 22 — same arithmetic as the rows above (see header).
            subtitleLines={4}
            left={<RowIconDisc icon={ReportProblemGlyph} />}
            right={<RowChevron />}
          />
        </Pressable>
      </SoonGate>

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
