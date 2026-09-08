// components/income/income_summary_card.tsx — m2-part2 Task 13, rules 1-2.
//
// LEADS WITH A SENTENCE, NOT AN ENUM. Rule 1: "You're paid twice a month,
// around ₱18,500 each time" — not "kinsenas". The cadence names are the app's
// internal vocabulary; "kinsenas" happens to be the one a Filipino user would
// recognise, but "irregular" reads as a judgement about them rather than a
// description of their pay, and none of the four belongs on a card.
//
// STATUS IS HONEST AND VISIBLE (rule 2). A provisional guess says it is a
// guess and offers both answers; a confirmed one is quiet; a lapsed one asks
// rather than silently going stale. The one thing this card never does is show
// a figure without saying where it came from.
//
// BUG FOUND WHILE RESTYLING (mobile-ui-revamp Part 3 Task 4b): the confirmed
// checkmark below was a bare `<Check>`, never run through `registerIcon`.
// Without that, `className` never reaches the glyph (`components/ui/button.tsx`'s
// header explains the mechanism), and it renders in lucide's own default
// colour regardless of theme rather than `text-brand`. It happened not to be
// visibly broken only because `components/transactions/category_picker.tsx`
// already calls `registerIcon(Check)` at its own module's top level, and
// `cssInterop` registration is a side effect on the shared `Check` component
// object — so on any screen where that module has already loaded, this icon
// rode along for free. `IncomeScreen`'s own suite never imports
// category_picker.tsx, so this file's `Check` was unstyled there, and would be
// on-device the first time a user reaches this card before ever opening
// transaction categorisation. Fixed here, not routed around.
import { Check } from "lucide-react-native";
import { Text, View } from "react-native";

import { Button, registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCentavos } from "@/components/ui/amount_text";
import type { IncomeSummary } from "@/lib/income/income_service";
import type { Centavos, IncomeCadence } from "@/types/domain";

const CheckGlyph = registerIcon(Check);

export type IncomeSummaryCardProps = {
  summary: IncomeSummary;
  onConfirm: () => void;
  onDismiss: () => void;
  onSetManually: () => void;
  busy?: boolean;
};

/**
 * Rule 1's sentence, one per cadence.
 *
 * Each says how OFTEN and how MUCH, because those are the two things the rest
 * of the app derives from income — the cadence sets the expected windows, the
 * amount sets every percent-of-income limit. "Twice a month" rather than
 * "on the 15th and 30th": payday slides for weekends and holidays (rule 7), and
 * a card that names exact dates would look wrong for half the year.
 */
export function incomeSentence(summary: IncomeSummary): string {
  const { cadence, averageAmount, monthlyEquivalent } = summary;
  if (cadence === null || averageAmount === null) {
    return "PeraPlano hasn't worked out your income yet.";
  }

  const each = formatCentavos(averageAmount);
  switch (cadence) {
    case "kinsenas":
      return `You're paid twice a month, around ${each} each time.`;
    case "weekly":
      return `You're paid weekly, around ${each} each time.`;
    case "monthly":
      return `You're paid monthly, around ${each}.`;
    case "irregular":
      // No "each time" — there is no typical payday to describe, only a
      // monthly total (rule 9 already made this figure monthly).
      return `Your income varies — about ${formatCentavos(monthlyEquivalent ?? averageAmount)} a month.`;
  }
}

/** What detection is seeing now, said as a rate rather than as a cadence enum. */
function detectedRate(cadence: IncomeCadence, amount: Centavos): string {
  const each = formatCentavos(amount);
  switch (cadence) {
    case "kinsenas":
      return `We're seeing about ${each} twice a month now.`;
    case "weekly":
      return `We're seeing about ${each} every week now.`;
    case "monthly":
      return `We're seeing about ${each} a month now.`;
    case "irregular":
      return `We're seeing about ${each} a month now, arriving irregularly.`;
  }
}

/**
 * The one suggestion card, in the two shapes income rule 14 gives it.
 *
 * WITH NO DECLARATION it is a discovery: the card's own sentence already shows
 * the detected figures, so the prompt only has to ask.
 *
 * OVER A DECLARATION it is news of a CHANGE, and it has to carry the new number
 * itself — everything else on that card is the user's own figure, so "is this
 * right?" would be asking them to accept something they cannot see. It also
 * must not read as a discovery: a user who typed their salary in knows perfectly
 * well when they are paid, and being told the app "spotted" it says the app
 * forgot.
 */
export function suggestionPrompt(summary: IncomeSummary): string {
  const suggested = summary.suggestedChange ?? null;
  if (!summary.isManualOverride || suggested === null) {
    return "We think we spotted your payday. Is this right?";
  }
  return `Your pay looks like it changed. ${detectedRate(
    suggested.cadence,
    suggested.averageAmount,
  )} Update the income you set?`;
}

export function IncomeSummaryCard({
  summary,
  onConfirm,
  onDismiss,
  onSetManually,
  busy = false,
}: IncomeSummaryCardProps) {
  const known = summary.cadence !== null && summary.averageAmount !== null;

  return (
    <Card testID="income-summary-card">
      <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
        {incomeSentence(summary)}
      </Text>

      {known ? (
        <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
          {`That's about ${formatCentavos(summary.monthlyEquivalent ?? 0)} a month.`}
        </Text>
      ) : null}

      {summary.isManualOverride ? (
        <Text testID="income-manual-note" className="mt-3 text-fg-2 dark:text-fg-2-dark">
          You set this yourself, so PeraPlano won&apos;t change it.
        </Text>
      ) : null}

      {/* Rule 2, provisional: say it is a guess, and offer both answers. The
          suggestion is suppressed once dismissed (rule 3) — `hasPendingSuggestion`
          is what carries that, not the status alone. It also carries income
          rule 14's divergence suggestion over a DECLARED income, which is the
          same offer about the same figures and so is the same block; only the
          words change. */}
      {summary.hasPendingSuggestion ? (
        <View testID="income-suggestion" className="mt-4">
          <Text testID="income-suggestion-prompt" className="text-fg dark:text-fg-dark">
            {suggestionPrompt(summary)}
          </Text>
          <View className="mt-3 flex-row gap-3">
            <Button
              title={summary.isManualOverride ? "Update it" : "Confirm"}
              onPress={onConfirm}
              testID="income-confirm"
              loading={busy}
            />
            <Button
              title={summary.isManualOverride ? "Keep mine" : "Not right"}
              variant="secondary"
              onPress={onDismiss}
              testID="income-dismiss"
              loading={busy}
            />
          </View>
        </View>
      ) : null}

      {/* Rule 2, confirmed: a quiet checkmark. Nothing to do, so nothing to tap. */}
      {summary.status === "confirmed" && !summary.isManualOverride ? (
        <View testID="income-confirmed-mark" className="mt-3 flex-row items-center gap-2">
          <CheckGlyph size={16} className="text-brand dark:text-brand-dark" />
          <Text className="text-fg-2 dark:text-fg-2-dark">Matched to your recent paydays</Text>
        </View>
      ) : null}

      {/* Rule 2, lapsed: ask, do not silently go stale. Rule 13 keeps the
          figures in use meanwhile, so the card still shows them above. */}
      {summary.status === "lapsed" ? (
        <View testID="income-lapsed" className="mt-4">
          <Text className="text-fg dark:text-fg-dark">
            We haven&apos;t seen your usual pay for a while. Has your income changed?
          </Text>
          <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
            If your pay is arriving but PeraPlano missed it, check that notification access is
            still on.
          </Text>
          <View className="mt-3">
            <Button
              title="Update my income"
              variant="secondary"
              onPress={onSetManually}
              testID="income-lapsed-update"
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
}
