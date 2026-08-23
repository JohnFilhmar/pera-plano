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
// are opposite claims, so nothing here — including the button below — reaches
// for `bg-brand`/`text-brand` or any of their `-soft`/`-dark`/`-ink` kin.
//
// WHY THE NOTIFY BUTTON IS NOT `components/ui/button.tsx`'s `Button`. Every
// one of Button's five variants paints either brand green or danger red
// (VARIANT_BG/VARIANT_FG in that file) — there is no neutral option — so
// reaching for it here would either import brand colour onto the one screen
// that exists specifically to not promise Plus, or require adding a sixth,
// neutral-grey Button variant purely for this screen's sake. That is a
// shared-component change with app-wide reach that a single Soon board does
// not justify on its own, so `QuietButton` below stays local: the same
// touch-target and shape conventions Button uses (min-h-[44px], rounded-full,
// centered label), restricted to the grey tokens already on this screen
// (`bg-chip` / `text-fg-2`).
//
// THE NOTIFY BUTTON DOES NOT PROMISE A NOTIFICATION. There is no account and
// no push registration anywhere in this app — silently "signing the user up"
// for a notification that can never arrive is a broken promise, worse than no
// button at all. Pressing it instead reveals, in place, the actual state of
// affairs: nothing in this codebase can page a user, on this screen or
// anywhere else (verified — there is no changelog/release-notes feature here
// either, so the disclosure does not lean on one that does not exist). The
// label stays an honest expression of interest, not a functioning signup.
import { useState } from "react";
import { CircleDashed, Users } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";

import { registerIcon } from "@/components/ui/button";

const UsersGlyph = registerIcon(Users);
const BulletGlyph = registerIcon(CircleDashed);

const NOTIFY_NOTE =
  "PeraPlano can't notify you — there's no account or push notifications yet. Check back here after updating the app.";

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

/** See this file's header comment for why this is not `components/ui/button.tsx`'s `Button`. */
function QuietButton({
  title,
  onPress,
  testID,
}: {
  title: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="min-h-[44px] w-full flex-row items-center justify-center rounded-full bg-chip px-5 py-2.5 dark:bg-chip-dark"
    >
      <Text className="text-body font-semibold text-fg-2 dark:text-fg-2-dark">{title}</Text>
    </Pressable>
  );
}

export default function SharedBudgetsScreen() {
  const [notified, setNotified] = useState(false);

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

      <QuietButton
        testID="shared-budgets-notify"
        title="Notify me when it ships"
        onPress={() => setNotified(true)}
      />

      {notified ? (
        <Text
          testID="shared-budgets-notify-note"
          className="text-center text-secondary font-medium text-fg-2 dark:text-fg-2-dark"
        >
          {NOTIFY_NOTE}
        </Text>
      ) : null}
    </ScrollView>
  );
}
