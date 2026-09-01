// components/ai/grounded_card.tsx — plan Task 23, spec §4.8.
//
// THE DESIGN'S FLOOR: "the worst outcome of a bad generation is a plainer
// answer, never a wrong one."
//
// This is what the surface renders when `dispatch.ts` returns `kind: "card"`.
// The handlers did their job — `get_spend_by_category` returned ₱2,400.00 and
// 34% — and only the sentence about them garbled. Rendering "something went
// wrong" would throw a correct answer away because the narration of it was bad,
// so this card renders the STRUCTURED RESULT and drops the prose.
//
// IT READS ONLY `display`, NEVER `data`. Spec §5.2/7: `display` carries every
// number and date already formatted by `formatCentavos`, and `data` carries
// labels. A card that reached into `data` for a figure would be the second
// place in the codebase that formats currency, and the first place a rounding
// difference could appear between a card and the ledger screen behind it.
//
// REFUSALS RENDER AS THEMSELVES. A `locked` refusal is not an empty ledger and
// must never be shown as one — see `tools/types.ts`. It carries its own
// sentence and this card prints that sentence rather than inventing a state.
import { Text, View } from "react-native";

import type { ToolResult } from "@/lib/ai/tools/types";

export type GroundedCardProps = {
  /** Every result the turn gathered, refusals included. */
  results: ToolResult<unknown>[];
  testID?: string;
};

/**
 * A human heading per tool, because `get_spend_by_category` is a wire name and
 * this card is the only thing the user gets to read on a degraded turn.
 *
 * Unknown keys fall back to the raw tool name rather than to nothing: a card
 * with figures and no heading is worse than one with an ugly heading, and an
 * unmapped tool is a missing row here, not a reason to hide the data.
 */
const TOOL_TITLE: Record<string, string> = {
  get_wallets: "Your wallets",
  get_balance_total: "Total balance",
  get_safe_to_spend: "Safe to spend",
  get_limits: "Your limits",
  get_income_profile: "Your income",
  get_spend_by_category: "Spending by category",
  list_transactions: "Transactions",
};

/**
 * Amounts and percentages are the figures the user came for and are set at
 * reading size; dates and counts are the qualifiers on them and are set
 * quieter. Driven off `DisplayKind` rather than off the key's wording, so a
 * handler renaming a key cannot silently demote its own headline number.
 */
const VALUE_CLASS: Record<string, string> = {
  amount: "text-title font-semibold text-fg dark:text-fg-dark",
  percent: "text-title font-semibold text-fg dark:text-fg-dark",
  date: "text-body text-fg-2 dark:text-fg-2-dark",
  count: "text-body text-fg-2 dark:text-fg-2-dark",
};

/**
 * Says why there is no sentence without calling it a failure. The turn did
 * produce an answer; it is being shown as data because that is the form that
 * cannot be wrong.
 */
const FOOTNOTE = "Straight from your ledger.";

/**
 * Reached only when the turn gathered nothing at all — the model answered from
 * no tool result, and the answer was then rejected. There is no figure to show,
 * and inventing a reassuring one is the exact failure this file exists to stop.
 */
const NO_DATA = "Nothing was read from your ledger for that one.";

export function GroundedCard({ results, testID }: GroundedCardProps) {
  const usable = results.filter((result) => !result.ok || result.display.length > 0);

  return (
    <View
      testID={testID ?? "grounded-card"}
      className="gap-3 rounded-2xl bg-surface p-4 dark:border dark:border-line-dark dark:bg-surface-dark"
    >
      {usable.length === 0 ? (
        <Text className="text-body text-fg-2 dark:text-fg-2-dark">{NO_DATA}</Text>
      ) : (
        usable.map((result, index) => (
          <View key={`${result.tool}-${index}`} className="gap-1">
            <Text className="text-micro font-semibold uppercase text-fg-2 dark:text-fg-2-dark">
              {TOOL_TITLE[result.tool] ?? result.tool}
            </Text>
            {result.ok ? (
              result.display.map((field) => (
                <View
                  key={field.key}
                  className="flex-row items-baseline justify-between gap-3"
                >
                  <Text className="flex-1 text-body text-fg-2 dark:text-fg-2-dark">
                    {field.key}
                  </Text>
                  <Text
                    className={VALUE_CLASS[field.kind] ?? "text-body text-fg dark:text-fg-dark"}
                  >
                    {field.value}
                  </Text>
                </View>
              ))
            ) : (
              <Text className="text-body text-fg dark:text-fg-dark">{result.message}</Text>
            )}
          </View>
        ))
      )}
      {usable.length > 0 ? (
        <Text className="text-micro text-fg-2 dark:text-fg-2-dark">{FOOTNOTE}</Text>
      ) : null}
    </View>
  );
}
