// app/(tabs)/wallets.tsx — the Wallets tab (m1c plan Task 4;
// docs/04-features/02-wallets.md; docs/06-information-architecture.md §3.3).
//
// The first real screen in the app — everything before it was infrastructure —
// and the first place the app states a number the user did not type. That
// number is the total row, and rule 23 keeps credit wallets OUT of it: a credit
// balance is money owed, and adding it inflates the headline figure of a
// budgeting app by the size of the user's debt. The arithmetic lives in
// lib/wallets/summary.ts, tested on its own; this file only lays it out.
//
// Three reads, each thin (Global Constraints: components consume hooks, hooks
// call repositories, no SQL here):
//   useWallets({ includeArchived })  the list, keyed BY the toggle
//   useRuleset()                     the drift tolerance and provider catalogue
//   useBalanceDrifts(ids)            one reported-vs-computed pair per wallet
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { AmountText } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";
import { SectionHeader } from "@/components/ui/section_header";
import { WalletCard } from "@/components/wallets/wallet_card";
import { useBalanceDrifts } from "@/hooks/queries/use_balance_drift";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useWallets } from "@/hooks/queries/use_wallets";
import {
  archivedWallets,
  groupWalletsByType,
  totalActiveBalance,
  WALLET_TYPE_LABELS,
} from "@/lib/wallets/summary";
import type { Wallet } from "@/types/domain";

export default function WalletsScreen() {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);

  const { data: wallets } = useWallets({ includeArchived: showArchived });
  const { data: ruleset } = useRuleset();
  // Read from the ruleset, never inlined: docs/04 §14 open question 1 lists the
  // threshold's value as unsettled, so it ships as remotely-retunable data.
  // `undefined` until it loads, which the badge renders as no verdict at all.
  const toleranceCentavos = ruleset?.tunables.balanceDriftToleranceCentavos;
  const drifts = useBalanceDrifts((wallets ?? []).map((wallet) => wallet.id));

  // Render nothing until the list has actually loaded. An empty state that
  // flashes on every cold start reads as data loss on a screen whose whole job
  // is to be trusted about money.
  if (!wallets) {
    return <View testID="wallets-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  if (wallets.length === 0) {
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        {/* Rule 6's sentence, split across EmptyState's heading and body:
            "No wallets yet — add the bank or e-wallet you use most."
            The "Add wallet" action itself belongs to Task 5, which owns
            app/wallet/new.tsx — a button here would open nothing. */}
        <EmptyState
          testID="wallets-empty"
          title="No wallets yet"
          body="Add the bank or e-wallet you use most."
        />
      </View>
    );
  }

  const groups = groupWalletsByType(wallets);
  const archived = archivedWallets(wallets);

  function openWallet(wallet: Wallet): void {
    router.push({ pathname: "/wallet/[id]", params: { id: wallet.id } });
  }

  function renderCard(wallet: Wallet) {
    return (
      <WalletCard
        key={wallet.id}
        wallet={wallet}
        drift={drifts[wallet.id]}
        toleranceCentavos={toleranceCentavos}
        onPress={() => openWallet(wallet)}
      />
    );
  }

  return (
    <ScrollView testID="wallets-screen" className="flex-1 bg-bg dark:bg-bg-dark">
      {/* Padding on an inner View rather than `contentContainerClassName` —
          the same shape components/onboarding/phrase_display.tsx uses. */}
      <View className="pb-8 pt-4">
        <View className="px-4 pb-2">
          <Card>
            <View testID="wallets-total" className="gap-1">
              <Text className="text-sm text-fg-2 dark:text-fg-2-dark">
                Total across your wallets
              </Text>
              <AmountText
                testID="wallets-total-amount"
                amount={totalActiveBalance(wallets)}
                size="hero"
                showSign={false}
              />
              <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
                Credit balances are money you owe, so they are not counted here.
              </Text>
            </View>
          </Card>
        </View>

        {groups.map((group) => (
          <View key={group.type}>
            <SectionHeader
              testID={`wallet-group-${group.type}`}
              title={WALLET_TYPE_LABELS[group.type]}
            />
            {group.wallets.map(renderCard)}
          </View>
        ))}

        {/* Rule 5: archived wallets are hidden by default and collapse into
            their own group at the bottom — never mixed into the type sections,
            where their balances would read as live money. They stay out of the
            total either way (rule 17). */}
        {archived.length > 0 ? (
          <View testID="wallets-archived-section">
            <SectionHeader title="Archived" />
            {archived.map(renderCard)}
          </View>
        ) : null}

        <View className="items-center px-4 pt-2">
          <Button
            testID="wallets-archived-toggle"
            title={showArchived ? "Hide archived" : "Show archived"}
            variant="ghost"
            onPress={() => setShowArchived((shown) => !shown)}
          />
        </View>
      </View>
    </ScrollView>
  );
}
