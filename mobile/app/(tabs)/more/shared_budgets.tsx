// app/(tabs)/more/shared_budgets.tsx — mobile UI revamp Part 3 Task 3. Route:
// /more/shared_budgets.
//
// THE FIRST "SOON" BOARD SINCE THE ROLLOUT TABLE CLOSED. constants/
// shipped_features.ts used to say every FeatureKey ships and none is left to
// flip; `shared_budgets` is the first key seeded "soon" since then, and this
// screen — plus the SoonGate-wrapped row in more/index.tsx's Insights group
// — is what gives SoonGate a live user again (see both files' own comments).
// NESTED UNDER app/(tabs)/more/, matching every sibling screen here, for the
// same URL-collision reason their own headers already give.
//
// NO ROUTER, ON PURPOSE. Every other More-tab sub-screen that needs a way
// back relies on the Stack's own back gesture — app/(tabs)/more/_layout.tsx
// renders headerShown:false and nothing under more/ builds its own back
// button (see listener_health.tsx, subscriptions.tsx) — so this screen stays
// consistent and calls no expo-router hook at all. That also means it needs
// no router mock to render in isolation, which is exactly how
// app/__tests__/shared_budgets_screen.test.tsx renders it.
//
// GREY, NEVER BRAND GREEN (docs/11-mobile-app-design-prompt.md "TWO GATING
// STATES"). The whole screen sits inside one `opacity-60` wrapper and every
// glyph on it reads `text-fg-2` — the same dormant treatment
// components/gates/soon_gate.tsx applies to a gated row, just at a screen's
// scale instead of a row's. Grey means "designed, not built"; brand green
// means "built, needs Plus" (components/ui/chip.tsx's tone contract). Those
// are opposite claims, so nothing here reaches for `bg-brand`/`text-brand` or
// any of their `-soft`/`-dark`/`-ink` kin.
//
// NO INTERACTIVE CONTROL ON THIS SCREEN — NOT EVEN A "NOTIFY ME" BUTTON, ON
// PURPOSE. docs/11-mobile-app-design-prompt.md's "TWO GATING STATES" section
// is the authority for what a Soon full-screen placeholder is, and it is
// explicit: "Whole card/row/screen-entry rendered desaturated grey,
// NON-INTERACTIVE, with a small neutral-grey 'Soon' chip. Content still
// readable so users see the roadmap." Its own example of full-screen
// placeholder copy is plain text with nothing to press: "This is coming in
// an update — your tracking already works."
//
// A "Notify me when it ships" button was built here first and its PRESS
// behaviour was honest — it revealed, rather than hid, that there is no
// mechanism to notify anyone. That was not enough: the pre-press state is
// what nearly everyone on a screen with nothing else to tap actually sees —
// a normally-styled, enabled pill, indistinguishable from every real
// "notify me" control elsewhere (app-store pre-orders, back-in-stock
// buttons). This app has no account system and no per-user identity
// anywhere in its only backend channels (anonymous telemetry, ruleset
// sync) — there is no path by which that label could ever become true for
// someone who never presses it. Removed the control rather than trying to
// make its rest state honest too; the spec already shapes this exact screen
// without one. What is left is the static paragraph below the bullets —
// information, not an affordance, so it cannot imply registration no matter
// how it is styled.
import { CircleDashed, Users } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";

import { registerIcon } from "@/components/ui/button";

const UsersGlyph = registerIcon(Users);
const BulletGlyph = registerIcon(CircleDashed);

function Bullet({ testID, children }: { testID: string; children: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <BulletGlyph size={18} className="mt-0.5 text-fg-2 dark:text-fg-2-dark" />
      <Text
        testID={testID}
        className="flex-1 text-body font-medium text-fg-2 dark:text-fg-2-dark"
      >
        {children}
      </Text>
    </View>
  );
}

export default function SharedBudgetsScreen() {
  return (
    <ScrollView
      testID="shared-budgets-screen"
      className="flex-1 bg-bg opacity-60 dark:bg-bg-dark"
      contentContainerClassName="items-center gap-4 px-8 py-12"
    >
      <View className="h-12 w-12 items-center justify-center rounded-full bg-chip dark:bg-chip-dark">
        <UsersGlyph size={24} className="text-fg-2 dark:text-fg-2-dark" />
      </View>

      <Text className="text-center text-title font-bold text-fg dark:text-fg-dark">
        Shared budgets are coming in an update
      </Text>

      <Text className="text-center text-body font-medium text-fg-2 dark:text-fg-2-dark">
        Split a household budget with your partner or family — one pool, separate phones, no
        shared login.
      </Text>

      <View className="w-full gap-3">
        <Bullet testID="shared-budgets-bullet-invite">Invite by QR — still no accounts</Bullet>
        <Bullet testID="shared-budgets-bullet-alerts">Each phone tracks its own alerts</Bullet>
        <Bullet testID="shared-budgets-bullet-limits">Shared limits, private transactions</Bullet>
      </View>

      {/* Static, not a button — see this file's header comment for why the
          earlier interactive version of this line was replaced. Plain
          information about the app's current limits, not an affordance, so
          it cannot be read as signing anyone up for anything. */}
      <Text
        testID="shared-budgets-disclosure"
        className="text-center text-secondary font-medium text-fg-2 dark:text-fg-2-dark"
      >
        There's no account and no push notifications in PeraPlano yet — shared budgets will
        simply appear here once it ships in a future update.
      </Text>
    </ScrollView>
  );
}
