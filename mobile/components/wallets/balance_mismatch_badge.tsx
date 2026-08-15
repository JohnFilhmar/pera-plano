// components/wallets/balance_mismatch_badge.tsx — m1c plan Task 4, rule 3.
//
// "Silent disagreement is the one thing a money app may never do." When the
// provider's reported balance-after and the ledger's computed running balance
// disagree beyond tolerance, this says so — WITH BOTH FIGURES. A bare warning
// glyph tells the user something is wrong and gives them nothing to act on;
// the two numbers side by side are the whole point.
//
// FOUR INPUT STATES, ONE OF WHICH SHOWS A BADGE:
//
//   drift === null          the wallet has NEVER received a reported balance —
//                           cash wallets, brand-new wallets, providers that
//                           omit it. There is nothing to agree or disagree
//                           about, so there is no badge. A zero-drift badge
//                           here would claim the bank and the ledger agree on
//                           a wallet the app has never had a bank figure for.
//   |drift| <= tolerance    rounding. Warning on every wallet that has ever
//                           reported a balance trains the user to ignore the
//                           warning, which is how the real one gets missed.
//   already dismissed       the user has seen THIS disagreement and accepted
//                           it (spec rule 3's second offer). Quiet — but only
//                           for the reporting transaction they actually saw.
//   |drift| >  tolerance    say it, with both numbers.
//
// STILL NO DISMISS ACTION IN HERE, and now for a different reason than before.
// The header used to read "NO DISMISS ACTION, DELIBERATELY", because spec rule 3
// offered "record the gap as an adjustment, or dismiss" and nothing in the
// schema could remember a dismissal — so a dismissed drift re-rendered on the
// next open, forever. Migration 003 fixed that half: `BalanceDrift` now carries
// the reporting transaction's id and the dismissed one, and this component
// compares them.
//
// The ACTION still lives elsewhere — on app/wallet/[id].tsx, beside the wallet's
// other actions. This badge renders on the Wallets tab too, where a button on
// every row would be a tap away from silencing a warning the user has not read.
// Rendering the verdict and offering the action are different jobs.
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Chip } from "@/components/ui/chip";
import type { BalanceDrift } from "@/hooks/queries/use_balance_drift";
import type { Centavos } from "@/types/domain";

export type BalanceMismatchBadgeProps = {
  /** `null` means no reported balance has ever arrived — see the header. */
  drift: BalanceDrift | null | undefined;
  /**
   * `tunables.balanceDriftToleranceCentavos` from the installed ruleset.
   *
   * `undefined` means the ruleset has not loaded (or none is installed), and
   * renders NOTHING: without a threshold there is no verdict to state, and
   * falling back to a guessed one would flash a warning that may vanish a frame
   * later. Never inline a literal here — the value is remotely retunable
   * because docs/04-features/02-wallets.md §14 lists it as an open question.
   */
  toleranceCentavos: Centavos | undefined;
  testID?: string;
};

/**
 * Whether this drift is one the app should be raising with the user right now —
 * the badge's whole rule, exported so the screen that offers "Dismiss" decides
 * from the SAME predicate rather than a second copy of it. Two copies is how a
 * button appears beside a badge that is not there, or the reverse.
 *
 * Narrows `drift` on the way through, so a caller that passes the check can read
 * `reportingTransactionId` off it without a second guard.
 */
export function isDriftWorthShowing(
  drift: BalanceDrift | null | undefined,
  toleranceCentavos: Centavos | undefined,
): drift is BalanceDrift {
  if (!drift || toleranceCentavos === undefined) return false;
  // Magnitude, not sign. Negative means the provider holds LESS than the ledger
  // accounts for — spend the app never saw — which is the direction that
  // matters most and would be skipped by a `drift > tolerance` comparison.
  if (Math.abs(drift.drift) <= toleranceCentavos) return false;
  // Migration 003. An EQUALITY against the reporting transaction, never a
  // truthiness test on the dismissal: a dismissal of an older report leaves this
  // one unacknowledged, which is exactly how a newer genuine drift gets said out
  // loud after the user has silenced an earlier one.
  return drift.dismissedTransactionId !== drift.reportingTransactionId;
}

export function BalanceMismatchBadge({
  drift,
  toleranceCentavos,
  testID = "balance-mismatch",
}: BalanceMismatchBadgeProps) {
  if (!isDriftWorthShowing(drift, toleranceCentavos)) return null;

  return (
    <View testID={testID} className="mt-3 gap-2 border-t border-warn pt-3 dark:border-warn-dark">
      <View className="flex-row">
        <Chip label="Balance mismatch" tone="warn" />
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-fg-2 dark:text-fg-2-dark">Your bank reported</Text>
        <AmountText testID={`${testID}-reported`} amount={drift.reported} size="sm" />
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-fg-2 dark:text-fg-2-dark">We counted</Text>
        <AmountText testID={`${testID}-computed`} amount={drift.computed} size="sm" />
      </View>
    </View>
  );
}
