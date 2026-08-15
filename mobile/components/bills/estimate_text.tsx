// components/bills/estimate_text.tsx — m2c Task 5, rule 3.
//
// NEVER PRESENT AN ESTIMATE AS IF IT WERE A BILL YOU HAVE RECEIVED. That is
// rule 3's whole point, and spec rule 7 makes it concrete: an estimated amount
// "always renders with a `~` prefix everywhere it appears, including inside
// Safe-to-Spend explanations".
//
// A VARIABLE BILL IS SHOWN AS A RANGE. Meralco is never the same twice, and a
// single "~₱2,350.00" invites the user to plan against a figure the app has no
// business being that confident about. When the last three payments actually
// were tight, the range collapses and the single figure is the honest one —
// so the shape of the number is itself a statement about how sure the app is.
//
// NOT ITS OWN MONEY FORMATTER: everything here goes through `formatCentavos`,
// which components/ui/amount_text.tsx declares the only one in the app.
import { Text } from "react-native";

import { AmountText, formatCentavos } from "@/components/ui/amount_text";
import type { AmountEstimate } from "@/lib/bills/amount_estimator";

/**
 * How wide a spread has to be, as a share of the estimate, before the range is
 * worth showing. Below it the extra numbers are noise — "usually ₱2,340 to
 * ₱2,360" says nothing "₱2,350" did not.
 */
const MEANINGFUL_SPREAD_PCT = 10;

export type EstimateTextProps = {
  estimate: AmountEstimate;
  testID?: string;
  /** Applies to the estimated form only — a fixed amount renders as `AmountText`. */
  className?: string;
};

export function hasMeaningfulSpread(estimate: AmountEstimate): boolean {
  if (estimate.basis !== "history" || estimate.sampleSize < 2) return false;
  if (estimate.amount <= 0) return false;
  return (estimate.spread / estimate.amount) * 100 >= MEANINGFUL_SPREAD_PCT;
}

/** `Usually ₱1,800.00 – ₱2,400.00`, or `~₱2,350.00`, or a plain fixed amount. */
export function estimateLabel(estimate: AmountEstimate): string {
  if (estimate.basis === "fixed") return formatCentavos(estimate.amount);

  if (hasMeaningfulSpread(estimate)) {
    const half = Math.round(estimate.spread / 2);
    return `Usually ${formatCentavos(estimate.amount - half)} – ${formatCentavos(
      estimate.amount + half,
    )}`;
  }

  // Spec rule 7's `~`. It travels with the number wherever the number goes.
  return `~${formatCentavos(estimate.amount)}`;
}

export function EstimateText({ estimate, testID, className }: EstimateTextProps) {
  // A fixed amount is a fact, so it renders as one — `AmountText` carries the
  // app's money styling and its accessibility label.
  if (estimate.basis === "fixed") {
    return <AmountText testID={testID} amount={estimate.amount} />;
  }

  return (
    <Text testID={testID} className={className ?? "text-fg dark:text-fg-dark"}>
      {estimateLabel(estimate)}
    </Text>
  );
}
