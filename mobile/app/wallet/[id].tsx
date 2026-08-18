// app/wallet/[id].tsx — one wallet's detail (m1c plan Task 4, rule 4).
//
// Balance header, the drift badge, the wallet's matcher chips, and its
// transactions.
//
// THE LEDGER LIST ARRIVED WITH m1c TASK 6. Rule 4 says the detail shows the
// wallet's transactions "reusing the ledger list from Task 6" — day grouping,
// category chips, transfer-leg muting, the lot — and until that task existed
// this screen carried a deliberately plain list instead, with a comment saying
// why. That placeholder is gone: there is now exactly ONE ledger implementation
// in the app, which is the point. Two of them was never a styling problem, it is
// how a transfer leg ends up muted on one screen and counted as spending on the
// other, with neither screen admitting they disagree.
//
// The screen keeps its OWN empty state (`LedgerList`'s `empty` slot): "Nothing
// tracked in this wallet yet" is a narrower and more useful statement than the
// tab-wide one, and it is true even when the rest of the ledger is full.
//
// THE THREE ACTIONS ARRIVED WITH m1c TASK 5 (rule 4: edit, reconcile, archive),
// each behind the thing that makes it safe, and DISMISS joined them with
// migration 003:
//
//   EDIT opens app/wallet/[id]/edit.tsx.
//   RECONCILE is offered for `type: "cash"` ONLY (Task 5 rule 6). A wallet with
//     a provider re-anchors itself from the reported balance-after; a typed
//     adjustment there would fight the next snap.
//   DISMISS is the other half of balance-handling rule 3 ("record the gap as an
//     adjustment, or dismiss") and appears ONLY while the drift badge is
//     actually showing — decided by the badge's own `isDriftWorthShowing`, so a
//     button can never appear beside a badge that is not there. It names the
//     reporting transaction the user is looking at, which is what lets a NEWER
//     report raise the badge again instead of being silenced by an old tap.
//   ARCHIVE opens the sheet that asks what happens to this wallet's
//     transactions — never a bare confirm, because archiving without that
//     question is how history gets orphaned or silently relocated.
//
// THERE IS NO DELETE, and there is no route to one. Invariant 4 forbids orphan
// Transactions, the schema's NO ACTION foreign key blocks the DELETE outright,
// and `wallets_repo` exports no `deleteWallet` to call.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LedgerList } from "@/components/transactions/ledger_list";
import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty_state";
import { SectionHeader } from "@/components/ui/section_header";
import { ArchiveWalletSheet } from "@/components/wallets/archive_wallet_sheet";
import { BalanceCorrectionSheet } from "@/components/wallets/balance_correction_sheet";
import {
  BalanceMismatchBadge,
  isDriftWorthShowing,
} from "@/components/wallets/balance_mismatch_badge";
import { CashReconcileSheet } from "@/components/wallets/cash_reconcile_sheet";
import { MatcherChipList } from "@/components/wallets/matcher_chip_list";
import { WalletTypeIcon } from "@/components/wallets/wallet_type_icon";
import { useArchiveWallet } from "@/hooks/mutations/use_archive_wallet";
import { useDismissDrift } from "@/hooks/mutations/use_dismiss_drift";
import { useBalanceDrift } from "@/hooks/queries/use_balance_drift";
import { useCategories } from "@/hooks/queries/use_categories";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useTransactions } from "@/hooks/queries/use_transactions";
import { useWallet } from "@/hooks/queries/use_wallet";
import { useWalletMatchers } from "@/hooks/queries/use_wallet_matchers";
import { useWallets } from "@/hooks/queries/use_wallets";

export default function WalletDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const walletId = id ?? "";
  // A full-screen route outside the tab navigator: nothing above it clears the
  // status bar or Android's navigation bar. See app/_layout.tsx's
  // SafeAreaProvider comment for why each surface pads its own edges.
  const insets = useSafeAreaInsets();
  const [reconciling, setReconciling] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const { data: wallet, isPending } = useWallet(walletId);
  const { data: drift } = useBalanceDrift(walletId);
  const { data: ruleset } = useRuleset();
  const { data: matchers } = useWalletMatchers(walletId);
  const { data: transactions } = useTransactions({ walletId });
  const { data: wallets } = useWallets();
  const { data: categories } = useCategories();
  const archiveWallet = useArchiveWallet();
  const dismissDrift = useDismissDrift();

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
  // The badge's own predicate, so the action and the badge cannot disagree about
  // whether there is a drift to dismiss. Narrowed to the drift itself, because
  // the mutation needs the reporting transaction's id off it.
  const dismissibleDrift = isDriftWorthShowing(drift, toleranceCentavos) ? drift : null;

  return (
    // DEVICE-TESTING FIX (2026-08-18, Task 2): the insets used to sit on the
    // ScrollView's `style` prop, which is the ScrollView's OUTER FRAME, not
    // its scrolling content — so the header rendered under the status bar and
    // the last row of the ledger could scroll in behind Android's navigation
    // bar. Matches `app/review/index.tsx`'s shape (insets on a padding-free
    // outer View wrapping the ScrollView), the same house pattern
    // `components/onboarding/onboarding_frame.tsx` uses, rather than
    // inventing a third: the outer View reserves both system-bar edges
    // first, so the ScrollView's own viewport — and everything that scrolls
    // inside it — never extends into either one.
    <View
      testID="wallet-detail"
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView className="flex-1">
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

          {/* Rule 4's three actions. There is no fourth: see the file header on
              why delete is offered nowhere. Archived wallets get none of them —
              an archived wallet is read-only until it is unarchived (spec §UX
              states, "rows are read-only until unarchived"). */}
          {!wallet.isArchived ? (
            <View className="flex-row gap-2 px-4 pt-3">
              <View className="flex-1">
                <Button
                  testID="wallet-detail-edit"
                  title="Edit"
                  variant="secondary"
                  onPress={() =>
                    router.push({ pathname: "/wallet/[id]/edit", params: { id: wallet.id } })
                  }
                />
              </View>
              {isCash ? (
                <View className="flex-1">
                  <Button
                    testID="wallet-detail-reconcile"
                    title="Reconcile"
                    variant="secondary"
                    onPress={() => setReconciling(true)}
                  />
                </View>
              ) : (
                // DEVICE-TESTING FIX (2026-08-18, Task 4): every wallet used
                // to start at ₱0.00 with no way to say "this already has
                // ₱3,000 in it" once it existed — CashReconcileSheet is
                // cash-only by rule 6/its own header, so non-cash wallets get
                // their own correction, writing a ledger entry the same way
                // (see balance_correction_sheet.tsx for why it is a
                // different sheet, not a modified one).
                <View className="flex-1">
                  <Button
                    testID="wallet-detail-adjust-balance"
                    title="Adjust balance"
                    variant="secondary"
                    onPress={() => setCorrecting(true)}
                  />
                </View>
              )}
              {dismissibleDrift ? (
                <View className="flex-1">
                  <Button
                    testID="wallet-detail-dismiss-drift"
                    title="Dismiss"
                    variant="secondary"
                    loading={dismissDrift.isPending}
                    // The id from the drift ON SCREEN, never a fresh read: this
                    // records what the user actually looked at and accepted. A
                    // report that lands between this render and the tap keeps its
                    // own drift, and the badge comes back for it.
                    onPress={() =>
                      dismissDrift.mutate({
                        walletId: wallet.id,
                        transactionId: dismissibleDrift.reportingTransactionId,
                      })
                    }
                  />
                </View>
              ) : null}
              <View className="flex-1">
                <Button
                  testID="wallet-detail-archive"
                  title="Archive"
                  variant="ghost"
                  onPress={() => setArchiving(true)}
                />
              </View>
            </View>
          ) : null}

          <CashReconcileSheet
            wallet={wallet}
            visible={reconciling}
            onDismiss={() => setReconciling(false)}
          />
          <BalanceCorrectionSheet
            wallet={wallet}
            visible={correcting}
            onDismiss={() => setCorrecting(false)}
          />
          <ArchiveWalletSheet
            wallet={wallet}
            visible={archiving}
            onDismiss={() => setArchiving(false)}
            otherWallets={wallets ?? []}
            transactionCount={(transactions ?? []).length}
            onArchive={(moveTransactionsTo) => {
              archiveWallet.mutate(
                { id: wallet.id, moveTransactionsTo },
                { onSuccess: () => setArchiving(false) },
              );
            }}
          />

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
          {/* THE app's ONE ledger list (m1c Task 6). `filtered` stays false: the
              wallet scope is what this screen IS, not a filter the user applied,
              so an empty one is "nothing tracked in this wallet" rather than
              "no transactions match these filters". */}
          <LedgerList
            testID="wallet-detail-ledger"
            transactions={transactions}
            wallets={wallets}
            categories={categories}
            // m1c Task 7: same rows, same destination as the Transactions tab.
            onSelect={(transaction) =>
              router.push({ pathname: "/transaction/[id]", params: { id: transaction.id } })
            }
            empty={
              <Text
                testID="wallet-detail-no-transactions"
                className="px-4 text-fg-2 dark:text-fg-2-dark"
              >
                Nothing tracked in this wallet yet.
              </Text>
            }
          />
        </View>
      </ScrollView>
    </View>
  );
}
