// app/(tabs)/more/subscriptions.tsx — the Subscriptions screen (M3 Part 2
// Task 6). Route: /more/subscriptions.
//
// FREE SEES A COUNT, NEVER THE LIST. Reports rule 19 is explicit: "The Free
// locked preview shows the count of detected patterns only ... never real
// gated data behind a blur." That is a DIFFERENT discipline from every other
// PlusGate in this app (components/loans/schedule_table.tsx previews the real
// amortization numbers, intercepting only the touch) — recurring detection is
// the one surface the spec asks to stay opaque even as a preview, because a
// merchant list is a privacy-shaped thing a screenshot or a shoulder-surf can
// read at a glance. So this screen does NOT wrap its pattern list in
// `PlusGate` the way `schedule_table.tsx` does; on Free it renders a
// dedicated locked frame that shows only a count. In normal use a Free user
// never reaches this branch at all — the More-tab entry
// (app/(tabs)/more/index.tsx) is itself `PlusGate`-wrapped and intercepts the
// press before navigation — but this screen checks again on its own rather
// than trusting that its only caller got it right.
//
// mobile-ui-revamp Part 3 Task 4 — three deliberate departures from the
// brief's literal wording, each forced by something outside this file's
// reach rather than skipped for convenience:
//
//   1. "One ListRow per service" does not replace `PatternCard` here.
//      `components/recurring/**` is owned by a different task's file list
//      (this task's own Files section names only `components/reports/*` and
//      `components/privacy/*`), and
//      components/recurring/__tests__/subscriptions_screen.test.tsx —
//      likewise outside this task's ownership — already pins this screen to
//      `pattern-card-${id}`, `pattern-card-${id}-promote` and
//      `pattern-card-${id}-dismiss`. Swapping in a bespoke ListRow would
//      silently drop the promote/acknowledge/dismiss actions those tests
//      exercise. `LockedInHeader` is the same story for "the total card" —
//      already a Card with the one figure the brief asks for, already
//      outside this file's ownership, so it stays exactly as it is.
//   2. No price-change alert banner. The board draws one, but
//      `RecurringPattern` (types/domain.ts) carries only the CURRENT
//      `amount` — no prior value, no history — and neither
//      `lib/recurring/recurring_service.ts` nor the repo behind it computes
//      one. A banner needs a change to compare against; inventing that
//      comparison here would be new arithmetic in a restyle task, the same
//      trap components/reports/trend_line.tsx's header flags for the
//      over-limit fill it also could not build. Noted as follow-up, not
//      silently dropped.
//   3. The beta badge is NOT a `<PlusGate>` wrap. Wrapping the real content
//      in `PlusGate` would put it in the tree under `pointerEvents="none"`
//      on free tier (see that component's own free-tier branch) — exactly
//      the "real gated data behind a blur" point 1 above says this screen
//      must never do. Point 3's badge below is the same soft-brand `Chip`
//      language `PlusGate`'s unlocked branch renders, shown only once
//      `hasRecurringDetection()` has already gated the branch it sits in.
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { PLUS_BETA_LABEL } from "@/components/gates/plus_gate";
import { UpgradeSheet } from "@/components/gates/upgrade_sheet";
import { LockedInHeader } from "@/components/recurring/locked_in_header";
import { PatternCard } from "@/components/recurring/pattern_card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useAcknowledgePattern } from "@/hooks/mutations/use_acknowledge_pattern";
import { useDismissPattern } from "@/hooks/mutations/use_dismiss_pattern";
import { usePromoteToBill } from "@/hooks/mutations/use_promote_to_bill";
import { useRecurringPatterns } from "@/hooks/queries/use_recurring_patterns";
import { hasRecurringDetection } from "@/lib/entitlements";
import { monthlyLockedIn } from "@/lib/recurring/recurring_service";
import { ISOLATED_LINK_HIT_SLOP } from "@/lib/ui/hit_slop";

/** Plan rule 6, verbatim. */
const EMPTY_TITLE = "Nothing recurring spotted yet";
const EMPTY_BODY = "We'll flag subscriptions as they repeat.";

function LockedPreview({ count }: { count: number }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <View
      testID="subscriptions-locked-preview"
      className="flex-1 items-center justify-center gap-3 bg-bg px-8 dark:bg-bg-dark"
    >
      <Text
        testID="subscriptions-locked-count"
        className="text-center text-2xl font-semibold text-fg dark:text-fg-dark"
      >
        {count === 1 ? "1 recurring payment spotted" : `${count} recurring payments spotted`}
      </Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Upgrade to Plus to see who it's for, how much, and what's locked in every month.
      </Text>
      {/* Touch target (design F1 sweep): `mt-2` is margin only — no padding,
          no size guarantee on the unstyled Text below it, no sibling
          Pressable within slop distance. */}
      <Pressable
        testID="subscriptions-upgrade"
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="See what PeraPlano Plus includes"
        className="mt-2"
        hitSlop={ISOLATED_LINK_HIT_SLOP}
      >
        <Text className="font-semibold text-brand dark:text-brand-dark">See what's included</Text>
      </Pressable>
      <UpgradeSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        capability="recurring"
      />
    </View>
  );
}

export default function SubscriptionsScreen() {
  const { data: patterns } = useRecurringPatterns();
  const promote = usePromoteToBill();
  const acknowledge = useAcknowledgePattern();
  const dismiss = useDismissPattern();

  if (!hasRecurringDetection()) {
    return <LockedPreview count={patterns?.length ?? 0} />;
  }

  if (patterns === undefined) {
    return (
      <View testID="subscriptions-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={5} />
      </View>
    );
  }

  if (patterns.length === 0) {
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState testID="subscriptions-empty" title={EMPTY_TITLE} body={EMPTY_BODY} />
      </View>
    );
  }

  const monthlyTotal = monthlyLockedIn(patterns);

  return (
    <ScrollView
      testID="subscriptions-list"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-3 p-4"
    >
      <LockedInHeader testID="subscriptions-locked-in" monthlyTotal={monthlyTotal} />
      {/* Task 2's unlocked-tier promise, restated here rather than via
          `PlusGate` — see this file's header, point 3. Every current tester
          reaches this branch (`hasRecurringDetection()` is what gated the
          count-only preview above), so this is the only badge this screen
          can ever actually render, same as `PlusGate`'s own unlocked path. */}
      <View className="self-start">
        <Chip testID="subscriptions-beta-badge" label={PLUS_BETA_LABEL} tone="brand" fill="soft" />
      </View>
      {patterns.map((pattern) => (
        <PatternCard
          key={pattern.id}
          testID={`pattern-card-${pattern.id}`}
          pattern={pattern}
          onPromote={() => promote.mutate(pattern.id)}
          onAcknowledge={() => acknowledge.mutate(pattern.id)}
          onDismiss={() => dismiss.mutate(pattern.id)}
        />
      ))}
    </ScrollView>
  );
}
