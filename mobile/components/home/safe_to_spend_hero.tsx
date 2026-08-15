// components/home/safe_to_spend_hero.tsx — M3 Part 2 Task 4, rules 1-2.
//
// The largest element on the screen, showing ONE number. Everything else on
// Home is context for it.
//
// NEVER RENDERS A NEGATIVE (rule 1). The engine floors at zero and reports the
// shortfall separately, and this component keeps that separation: "-₱3,499.00
// safe to spend" is not a sentence, and a minus sign in the hero would read as
// a balance rather than as a budget overrun.
//
// THE NO-LIMIT STATE INVITES RATHER THAN SCOLDS. It is the FIRST-RUN state —
// the very first thing a new user sees — so it cannot read as an error. They
// have not done anything wrong; the app just does not know their ceiling yet.
import { Pressable, Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import type { SafeToSpendResult, SafeToSpendState } from "@/lib/safe_to_spend";

export type SafeToSpendHeroProps = {
  result: SafeToSpendResult;
  /** Names the driving limit's scope — "monthly", "weekly". */
  scopeLabel: string | null;
  onSetLimit: () => void;
  onOpenReviewQueue: () => void;
  testID?: string;
};

/**
 * Tone per state. `warn` at 80% and `danger` only once actually over — the
 * same discipline as every chip in the app: red spent on "getting close"
 * leaves nothing louder for "you have gone past it".
 */
const TONE_CLASS: Record<Exclude<SafeToSpendState, "no_limit">, string> = {
  healthy: "text-brand dark:text-brand-dark",
  tight: "text-warn dark:text-warn-dark",
  over: "text-danger dark:text-danger-dark",
};

export function SafeToSpendHero({
  result,
  scopeLabel,
  onSetLimit,
  onOpenReviewQueue,
  testID,
}: SafeToSpendHeroProps) {
  if (result.state === "no_limit") {
    return (
      <View testID={testID ?? "sts-hero"} className="items-center gap-3 px-6 py-8">
        <Text className="text-center text-xl font-semibold text-fg dark:text-fg-dark">
          Set a limit to see what's safe to spend
        </Text>
        <Text className="text-center text-fg-2 dark:text-fg-2-dark">
          Tell PeraPlano what you want to keep under, and it will do the arithmetic every day.
        </Text>
        <Pressable
          testID="sts-set-limit"
          accessibilityRole="button"
          onPress={onSetLimit}
          className="rounded-lg bg-brand px-4 py-3 dark:bg-brand-dark"
        >
          <Text className="font-semibold text-surface dark:text-surface-dark">Set a limit</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View testID={testID ?? "sts-hero"} className="items-center gap-1 px-6 py-8">
      <Text className="text-fg-2 dark:text-fg-2-dark">Safe to spend today</Text>

      <View testID="sts-amount" className={TONE_CLASS[result.state]}>
        <AmountText amount={result.perDay} size="hero" />
      </View>

      {result.state === "over" ? (
        <Text testID="sts-over-by" className="mt-1 text-center text-danger dark:text-danger-dark">
          {"You're "}
          <AmountText amount={result.overBy} /> over for this period
        </Text>
      ) : null}

      {/* Rule 2: name the limit driving the number. A figure with no stated
          source invites the user to wonder what it is counting — and the
          filtered case is exactly when they most need telling, because the
          number then describes a slice rather than everything. */}
      {scopeLabel === null ? null : (
        <Text testID="sts-caption" className="mt-1 text-center text-fg-2 dark:text-fg-2-dark">
          {result.drivingFilterLabel === null
            ? `from your ${scopeLabel} limit`
            : `from your ${result.drivingFilterLabel} limit`}
        </Text>
      )}

      {/* Rule 2's second half, and rule 12's disclosure. Users must never
          wonder why the number looks off — an uncounted queue is the one
          discrepancy the app knows about and can name. */}
      {result.reviewQueueCount > 0 ? (
        <Pressable testID="sts-review-note" accessibilityRole="button" onPress={onOpenReviewQueue}>
          <Text className="mt-2 text-center text-sm text-fg-2 underline dark:text-fg-2-dark">
            {result.reviewQueueCount === 1
              ? "1 item awaiting review isn't counted yet"
              : `${result.reviewQueueCount} items awaiting review aren't counted yet`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
