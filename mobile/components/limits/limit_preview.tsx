// components/limits/limit_preview.tsx — the live "what this Limit actually
// means in pesos" sentence, shared by the onboarding first-Limit step
// (components/onboarding/first_limit_form.tsx) and Plan's Limit editor
// (components/limits/limit_form.tsx).
//
// EXTRACTED RATHER THAN COPIED, for the same reason limit_form.tsx itself was
// extracted out of the create route: the sentence is the only thing that tells
// a user what "20% of income" comes to before they commit to it, and two
// hand-written copies of it are two chances to disagree about the 12/52/365
// conventions. `baseFor` resolves one period and `dailyRateOf` restates it per
// day — both from the engine that will enforce the limit afterwards, so what
// this sentence promises and what the app later measures cannot drift.
//
// A PERCENT LIMIT WITH NO INCOME RESOLVES TO `null`, not to zero — `baseFor`'s
// own contract. Callers must not render this component in that state; both of
// them show their percent-blocked card instead, because "₱0.00 every month" is
// a claim about a number the app does not have.
import { Text } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { dailyRateOf } from "@/lib/limits/limit_derivation";
import { baseFor } from "@/lib/limits/limit_engine";
import type { Centavos, LimitBasis, LimitScope } from "@/types/domain";

/** How the sentence names the period. */
const SCOPE_EVERY: Record<LimitScope, string> = {
  daily: "every day",
  weekly: "every week",
  monthly: "every month",
  annual: "every year",
};

export type LimitPreviewProps = {
  basis: LimitBasis;
  /** Centavos for `fixed`; percent × 100 for `percent-of-income`. */
  value: number;
  scope: LimitScope;
  /** Monthly-equivalent income, or `null` when the app does not know one. */
  monthlyIncome: Centavos | null;
  testID: string;
  /** The host screen's own type scale — the two callers style this differently. */
  className?: string;
};

export function LimitPreview({
  basis,
  value,
  scope,
  monthlyIncome,
  testID,
  className = "text-section font-bold text-fg dark:text-fg-dark",
}: LimitPreviewProps) {
  const periodValue = baseFor({ basis, value, scope }, monthlyIncome) ?? 0;
  const dailyValue = Math.round(dailyRateOf(scope, periodValue));

  return (
    <Text testID={testID} className={className}>
      {scope === "daily"
        ? // "…every day is about ₱X a day" says the same thing twice. On the
          // daily cadence the figure IS the daily figure, so the sentence
          // stops there rather than restating itself.
          `${formatCentavos(periodValue)} every day.`
        : `${formatCentavos(periodValue)} ${SCOPE_EVERY[scope]} is about ${formatCentavos(
            dailyValue,
          )} a day.`}
    </Text>
  );
}
