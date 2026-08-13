// app/wallet/[id].tsx — one wallet's detail (m1c plan Task 4, rule 4).
//
// Balance header, the drift badge, the wallet's matcher chips, and its
// transactions.
//
// TWO THINGS THIS SCREEN DELIBERATELY DOES NOT HAVE YET:
//
//   NO LEDGER LIST. Rule 4 says the detail shows the wallet's transactions
//   "reusing the ledger list from Task 6" — day grouping, category chips,
//   transfer-leg muting, the lot. Task 6 has not happened. The rows below are a
//   plain list from `useTransactions({ walletId })`; building a second ledger
//   here would mean deleting it two tasks from now, and having two of them in
//   the meantime is how a transfer leg ends up muted on one screen and counted
//   as spending on the other.
//
//   NO EDIT / RECONCILE / ARCHIVE ACTIONS. Rule 4 lists all three, and m1c Task
//   5 owns all three: the wallet form (app/wallet/[id]/edit.tsx), the cash
//   reconciliation sheet, and the archive flow's "what happens to this wallet's
//   transactions?" prompt. A button here would either open a route that does
//   not exist or archive a wallet without asking the question that keeps its
//   transactions from being orphaned (invariant 4).
import { useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty_state";
import { SectionHeader } from "@/components/ui/section_header";
import { ListRow } from "@/components/ui/list_row";
import { BalanceMismatchBadge } from "@/components/wallets/balance_mismatch_badge";
import { MatcherChipList } from "@/components/wallets/matcher_chip_list";
import { WalletTypeIcon } from "@/components/wallets/wallet_type_icon";
import { useBalanceDrift } from "@/hooks/queries/use_balance_drift";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useTransactions } from "@/hooks/queries/use_transactions";
import { useWallet } from "@/hooks/queries/use_wallet";
import { useWalletMatchers } from "@/hooks/queries/use_wallet_matchers";
import type { Transaction } from "@/types/domain";

/** `occurredAt` as a short, local, unambiguous date. Not money — no AmountText
 * rule applies — and not the ledger's day grouping, which is Task 6's. */
function occurredOn(transaction: Transaction): string {
  return new Date(transaction.occurredAt).toISOString().slice(0, 10);
}

export default function WalletDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const walletId = id ?? "";

  const { data: wallet, isPending } = useWallet(walletId);
  const { data: drift } = useBalanceDrift(walletId);
  const { data: ruleset } = useRuleset();
  const { data: matchers } = useWalletMatchers(walletId);
  const { data: transactions } = useTransactions({ walletId });

  if (isPending) {
    return <View testID="wallet-detail-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  if (!wallet) {
    // A blank screen for a bad id leaves the user tapping a back button they
    // cannot see. `useWallet` resolves an ARCHIVED wallet normally, so this
    // branch really does mean "no such wallet".
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          testID="wallet-detail-missing"
          title="Wallet not found"
          body="This wallet may have been removed. Go back and pick another one."
        />
      </View>
    );
  }

  // Read from the ruleset, never inlined — see components/wallets/balance_mismatch_badge.tsx.
  const toleranceCentavos = ruleset?.tunables.balanceDriftToleranceCentavos;
  const isCash = wallet.type === "cash";

  return (
    <ScrollView testID="wallet-detail" className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="pb-8 pt-4">
        <View className="px-4">
          <Card>
            <View className="gap-2">
              <View className="flex-row items-center gap-2">
                <WalletTypeIcon type={wallet.type} testID="wallet-detail-icon" />
                <Text className="flex-1 text-lg font-semibold text-fg dark:text-fg-dark">
                  {wallet.name}
                </Text>
                {wallet.isArchived ? <Chip label="Archived" tone="soon" /> : null}
              </View>
              <AmountText
                testID="wallet-detail-balance"
                amount={wallet.balance}
                size="hero"
                showSign={false}
              />
              {wallet.type === "credit" ? (
                // Rule 23: a credit balance is the outstanding amount owed, and
                // is excluded from the Wallets-tab total for that reason.
                // Saying so here too keeps the detail screen from reading like
                // cash.
                <Text className="text-sm text-fg-2 dark:text-fg-2-dark">Owed</Text>
              ) : null}
              <BalanceMismatchBadge
                testID="wallet-detail-drift"
                drift={drift}
                toleranceCentavos={toleranceCentavos}
              />
            </View>
          </Card>
        </View>

        {/* Rule 4: cash wallets have empty matchers and the matcher UI is
            hidden for them — money enters by manual entry, transfer legs and
            reconciliation, never by a notification. */}
        {!isCash && matchers && matchers.length > 0 ? (
          <View>
            <SectionHeader title="Notifications" />
            <View testID="wallet-detail-matchers" className="px-4">
              <MatcherChipList matchers={matchers} providers={ruleset?.providers ?? []} />
            </View>
          </View>
        ) : null}

        <SectionHeader title="Transactions" />
        {transactions && transactions.length === 0 ? (
          <Text
            testID="wallet-detail-no-transactions"
            className="px-4 text-fg-2 dark:text-fg-2-dark"
          >
            Nothing tracked in this wallet yet.
          </Text>
        ) : null}
        {/* PLACEHOLDER LIST — m1c Task 6 replaces this whole block with the
            real ledger list (day grouping, category chips, and the muted
            "Transfer — not counted as spending" row state). Do not grow it. */}
        {(transactions ?? []).map((transaction) => (
          <ListRow
            key={transaction.id}
            testID={`wallet-detail-tx-${transaction.id}`}
            title={transaction.merchant ?? transaction.counterparty ?? "Transaction"}
            subtitle={occurredOn(transaction)}
            right={
              <AmountText amount={transaction.amount} direction={transaction.direction} size="md" />
            }
          />
        ))}
      </View>
    </ScrollView>
  );
}
