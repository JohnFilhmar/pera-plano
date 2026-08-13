// components/wallets/balance_mismatch_badge.tsx — m1c plan Task 4, rule 3.
//
// "Silent disagreement is the one thing a money app may never do." When the
// provider's reported balance-after and the ledger's computed running balance
// disagree beyond tolerance, this says so — WITH BOTH FIGURES. A bare warning
// glyph tells the user something is wrong and gives them nothing to act on;
// the two numbers side by side are the whole point.
//
// THREE INPUT STATES, ONE OF WHICH SHOWS A BADGE:
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
//   |drift| >  tolerance    say it, with both numbers.
//
// NO DISMISS ACTION, DELIBERATELY. Spec rule 3 offers "record the gap as an
// adjustment, or dismiss", but there is no acknowledged/dismissed flag anywhere
// in the schema — a dismissed drift would re-render on the next open, forever.
// The badge is display-only until m1c Task 5 designs the reconcile flow and
// whatever flag it needs.
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

export function BalanceMismatchBadge({
  drift,
  toleranceCentavos,
  testID = "balance-mismatch",
}: BalanceMismatchBadgeProps) {
  if (!drift || toleranceCentavos === undefined) return null;
  // Magnitude, not sign. Negative means the provider holds LESS than the ledger
  // accounts for — spend the app never saw — which is the direction that
  // matters most and would be skipped by a `drift > tolerance` comparison.
  if (Math.abs(drift.drift) <= toleranceCentavos) return null;

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
