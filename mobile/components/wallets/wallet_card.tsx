// components/wallets/wallet_card.tsx — m1c plan Task 4.
//
// One row of the Wallets tab: type icon, name, balance, and the drift badge
// when the provider and the ledger disagree.
//
// PRESENTATIONAL — it takes its drift and its tolerance as props rather than
// reading them itself. The screen owns the queries (one drift per wallet, one
// ruleset read for the whole list), which keeps this component testable with
// no database and no QueryClient, and keeps the tolerance read in one place
// instead of once per row.
//
// A CREDIT WALLET'S BALANCE IS LABELLED "Owed". Rule 23: it is the outstanding
// amount, not spendable money. The label is the row's half of that rule;
// `lib/wallets/summary.ts` keeping it out of the total is the other half, and
// both are needed — a labelled row inside an inflated total still lies.
import { View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list_row";
import type { BalanceDrift } from "@/hooks/queries/use_balance_drift";
import type { Centavos, Wallet } from "@/types/domain";

import { BalanceMismatchBadge } from "./balance_mismatch_badge";
import { WalletTypeIcon } from "./wallet_type_icon";

export type WalletCardProps = {
  wallet: Wallet;
  /** `null` = this wallet has never reported a balance. See the badge. */
  drift: BalanceDrift | null | undefined;
  /** The ruleset's `balanceDriftToleranceCentavos`; `undefined` until loaded. */
  toleranceCentavos: Centavos | undefined;
  onPress?: () => void;
  testID?: string;
};

/**
 * The second line, or nothing.
 *
 * Archived wins over "Owed" when both apply: an archived wallet is out of every
 * total and every picker, which is the more important thing to know about the
 * row in front of you.
 */
function subtitleFor(wallet: Wallet): string | undefined {
  if (wallet.isArchived) return "Archived";
  if (wallet.type === "credit") return "Owed";
  return undefined;
}

export function WalletCard({
  wallet,
  drift,
  toleranceCentavos,
  onPress,
  testID,
}: WalletCardProps) {
  const rowTestID = testID ?? `wallet-card-${wallet.id}`;

  return (
    <View className="px-4 pb-3">
      <Card>
        <ListRow
          testID={rowTestID}
          title={wallet.name}
          subtitle={subtitleFor(wallet)}
          left={<WalletTypeIcon type={wallet.type} testID={`${rowTestID}-icon`} />}
          right={
            <AmountText
              testID={`${rowTestID}-balance`}
              amount={wallet.balance}
              size="lg"
              // No sign: a balance is a position, not a movement. Signing it
              // would read as an amount that just left or arrived.
              showSign={false}
            />
          }
          onPress={onPress}
        />
        {/* Reconcile, edit and archive actions are m1c Task 5's — each needs a
            flow this task does not build, and a button that opens nothing is
            worse than no button. */}
        <BalanceMismatchBadge
          testID={`${rowTestID}-drift`}
          drift={drift}
          toleranceCentavos={toleranceCentavos}
        />
      </Card>
    </View>
  );
}
