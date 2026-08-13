// app/wallet/new.tsx — "Add wallet" (m1c plan Task 5, rules 1–3).
//
// THE FREE-TIER CAP IS CHECKED HERE, AT THE CALL SITE, and nowhere lower down.
// `canCreateWallet` is a question, not a guard: repositories take no entitlement
// opinion (see wallets_repo's header), so the screen that creates is the screen
// that asks. docs/04-features/02-wallets.md §Free vs Plus: "Entitlements is
// checked at this call-site".
//
// AND IT DELETES NOTHING. Hitting the cap opens the upgrade sheet and leaves
// every existing wallet exactly where it was — balances, matchers, transactions
// and all. A user who lapses from Plus with four wallets keeps all four and
// simply cannot add a fifth. The gate is about breadth, never about data
// (docs/05-monetization.md §3.1).
//
// TWO WRITES, IN ORDER: the wallet, then its matchers. `setMatchers` needs an
// id, so they cannot be one call — and doing the matchers first would mean
// binding a provider to a wallet that might fail to save on a duplicate name.
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { UpgradeSheet } from "@/components/gates/upgrade_sheet";
import { WalletForm } from "@/components/wallets/wallet_form";
import type { WalletFormValues } from "@/components/wallets/wallet_form";
import { useCreateWallet } from "@/hooks/mutations/use_create_wallet";
import { useSetWalletMatchers } from "@/hooks/mutations/use_set_wallet_matchers";
import { useAllWalletMatchers } from "@/hooks/queries/use_all_wallet_matchers";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useWallets } from "@/hooks/queries/use_wallets";
import { DuplicateNameError } from "@/lib/db/repos/wallets_repo";
import { canCreateWallet } from "@/lib/entitlements";
import { ownersFrom } from "@/lib/wallets/matchers";

export default function NewWalletScreen() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);

  // Archived wallets are included so a pair held by one can still be NAMED in
  // the picker's move warning; the cap below counts only the active ones.
  const { data: wallets } = useWallets({ includeArchived: true });
  const { data: ruleset } = useRuleset();
  const { data: matchers } = useAllWalletMatchers();
  const createWallet = useCreateWallet();
  const setMatchers = useSetWalletMatchers();

  // NOTHING RENDERS UNTIL THE WALLET LIST HAS LOADED, because the cap is
  // counted off it. An undefined list reads as zero wallets, which would let a
  // Free user who taps fast enough create a fourth — a gate passing by
  // accident, which is worse than no gate at all.
  if (!wallets) {
    return <View testID="wallet-new-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  // ACTIVE wallets only — which is what makes archiving an old wallet free a
  // slot rather than forcing a deletion (spec §Free vs Plus).
  const activeWallets = wallets.filter((wallet) => !wallet.isArchived);

  function save(values: WalletFormValues): void {
    if (!canCreateWallet(activeWallets.length)) {
      setCapped(true);
      return;
    }

    setError(null);
    createWallet.mutate(
      { name: values.name, type: values.type, openingBalance: values.openingBalance },
      {
        onSuccess: (wallet) => {
          if (values.matchers.length === 0) {
            router.back();
            return;
          }
          setMatchers.mutate(
            { walletId: wallet.id, matchers: values.matchers },
            { onSuccess: () => router.back() },
          );
        },
        onError: (failure) => {
          // Named, not generic. The form has to tell the user WHICH name it
          // refused, or the only way to find out is to guess.
          setError(
            failure instanceof DuplicateNameError
              ? `You already have a wallet called "${failure.walletName}". Pick another name.`
              : "That wallet could not be saved. Try again.",
          );
        },
      },
    );
  }

  return (
    <ScrollView testID="wallet-new" className="flex-1 bg-bg dark:bg-bg-dark">
      <WalletForm
        submitLabel="Add wallet"
        onSubmit={save}
        submitting={createWallet.isPending || setMatchers.isPending}
        errorMessage={error}
        providers={ruleset?.providers ?? []}
        owners={ownersFrom(matchers ?? [], wallets)}
        showOpeningBalance
      />
      <UpgradeSheet visible={capped} onClose={() => setCapped(false)} capability="wallets" />
    </ScrollView>
  );
}
