// components/recurring/pattern_card.tsx — M3 Part 2 Task 6.
//
// One detected (or already-confirmed) recurring charge: who, how much, how
// often, and when it is expected next. Actions are omitted once a pattern is
// already linked to a Bill (bills rules 28-29) — at that point Bills owns its
// lifecycle, and offering "make this a bill" or "dismiss" again would be a
// second, disagreeing control over the same commitment.
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/datetime";
import type { RecurringPattern } from "@/types/domain";

export type PatternCardProps = {
  pattern: RecurringPattern;
  onPromote?: () => void;
  onDismiss?: () => void;
  onAcknowledge?: () => void;
  testID?: string;
};

/**
 * `periodDays` is the exact cadence (migration 007) and reads better than the
 * three-bucket `period` enum whenever it is known — "Every 14 days" says more
 * than "Weekly" — falling back to the enum only for a pre-migration row that
 * has none.
 */
function cadenceLabel(pattern: RecurringPattern): string {
  const days = pattern.periodDays;
  if (days === null) {
    return pattern.period === "weekly" ? "Weekly" : pattern.period === "monthly" ? "Monthly" : "Annual";
  }
  if (days === 7) return "Weekly";
  if (days === 30 || days === 31) return "Monthly";
  if (days === 365 || days === 366) return "Annual";
  return `Every ${days} days`;
}

export function PatternCard({
  pattern,
  onPromote,
  onDismiss,
  onAcknowledge,
  testID,
}: PatternCardProps) {
  const tracked = pattern.billId !== null;

  return (
    <Card testID={testID}>
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-semibold text-fg dark:text-fg-dark">{pattern.merchant}</Text>
          <Text className="mt-0.5 text-xs text-fg-2 dark:text-fg-2-dark">
            {cadenceLabel(pattern)}
            {pattern.nextExpectedAt !== null
              ? ` · next ${formatDate(pattern.nextExpectedAt)}`
              : ""}
          </Text>
        </View>
        <AmountText
          testID={testID === undefined ? undefined : `${testID}-amount`}
          amount={pattern.amount}
          direction="out"
        />
      </View>

      {tracked ? (
        <Text
          testID={testID === undefined ? undefined : `${testID}-tracked`}
          className="mt-3 text-xs font-medium text-brand dark:text-brand-dark"
        >
          Tracked as a bill
        </Text>
      ) : (
        <View className="mt-3 flex-row gap-2">
          {onPromote ? (
            <Button
              testID={testID === undefined ? undefined : `${testID}-promote`}
              title="Make this a bill"
              variant="secondary"
              onPress={onPromote}
            />
          ) : null}
          {!pattern.acknowledged && onAcknowledge ? (
            <Button
              testID={testID === undefined ? undefined : `${testID}-acknowledge`}
              title="This is recurring"
              variant="ghost"
              onPress={onAcknowledge}
            />
          ) : null}
          {onDismiss ? (
            <Button
              testID={testID === undefined ? undefined : `${testID}-dismiss`}
              title="Dismiss"
              variant="ghost"
              onPress={onDismiss}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}
