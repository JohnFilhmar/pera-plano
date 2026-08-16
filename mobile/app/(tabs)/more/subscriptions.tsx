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
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { LockedInHeader } from "@/components/recurring/locked_in_header";
import { PatternCard } from "@/components/recurring/pattern_card";
import { UpgradeSheet } from "@/components/gates/upgrade_sheet";
import { EmptyState } from "@/components/ui/empty_state";
import { useAcknowledgePattern } from "@/hooks/mutations/use_acknowledge_pattern";
import { useDismissPattern } from "@/hooks/mutations/use_dismiss_pattern";
import { usePromoteToBill } from "@/hooks/mutations/use_promote_to_bill";
import { useRecurringPatterns } from "@/hooks/queries/use_recurring_patterns";
import { hasRecurringDetection } from "@/lib/entitlements";
import { monthlyLockedIn } from "@/lib/recurring/recurring_service";

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
      <Pressable
        testID="subscriptions-upgrade"
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="See what PeraPlano Plus includes"
        className="mt-2"
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
    return <View testID="subscriptions-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
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
