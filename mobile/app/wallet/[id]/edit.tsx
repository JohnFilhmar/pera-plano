// app/wallet/[id]/edit.tsx — rename, retype, and manage matchers (m1c plan
// Task 5; docs/04-features/02-wallets.md §Flow: edit a Wallet).
//
// NO ENTITLEMENT CHECK HERE. The cap is on CREATING a wallet, and editing one
// the user already has is never blocked — a gate that stopped someone renaming
// a wallet after a downgrade would be a gate on their own data
// (docs/05-monetization.md §3.1 principle 2: existing records keep working
// fully, including after a downgrade).
//
// NO ARCHIVE OR DELETE HERE EITHER. Archiving lives on the wallet's detail
// screen, where the spec puts it (§archive rule 1, "from the Wallet's overflow
// menu") and where the "what happens to its transactions?" question is asked.
// Delete is offered nowhere at all — see archive_wallet_sheet.tsx.
//
// TWO WRITES, AND THE MATCHERS GO SECOND. `setMatchers` can MOVE a pair off
// another wallet, which is the more consequential of the two; running it after
// the rename means a failed rename (a duplicate name) never silently
// reassigns a provider on the way to reporting the error.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/ui/empty_state";
import { WalletForm } from "@/components/wallets/wallet_form";
import type { WalletFormValues } from "@/components/wallets/wallet_form";
import { useSetWalletMatchers } from "@/hooks/mutations/use_set_wallet_matchers";
import { useUpdateWallet } from "@/hooks/mutations/use_update_wallet";
import { useAllWalletMatchers } from "@/hooks/queries/use_all_wallet_matchers";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useWallet } from "@/hooks/queries/use_wallet";
import { useWalletMatchers } from "@/hooks/queries/use_wallet_matchers";
import { useWallets } from "@/hooks/queries/use_wallets";
import { DuplicateNameError } from "@/lib/db/repos/wallets_repo";
import { ownersFrom } from "@/lib/wallets/matchers";

export default function EditWalletScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const walletId = id ?? "";
  // A full-screen route outside the tab navigator: nothing above it clears the
  // status bar or Android's navigation bar. See app/_layout.tsx's
  // SafeAreaProvider comment for why each surface pads its own edges.
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);

  const { data: wallet, isPending } = useWallet(walletId);
  const { data: ruleset } = useRuleset();
  const { data: ownMatchers } = useWalletMatchers(walletId);
  const { data: allMatchers } = useAllWalletMatchers();
  const { data: wallets } = useWallets({ includeArchived: true });
  const updateWallet = useUpdateWallet();
  const setMatchers = useSetWalletMatchers();

  if (isPending) {
    return <View testID="wallet-edit-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  if (!wallet) {
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          testID="wallet-edit-missing"
          title="Wallet not found"
          body="This wallet may have been removed. Go back and pick another one."
        />
      </View>
    );
  }

  function save(values: WalletFormValues): void {
    setError(null);
    updateWallet.mutate(
      { id: walletId, patch: { name: values.name, type: values.type } },
      {
        onSuccess: () => {
          setMatchers.mutate(
            { walletId, matchers: values.matchers },
            { onSuccess: () => router.back() },
          );
        },
        onError: (failure) => {
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
    <ScrollView
      testID="wallet-edit"
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <WalletForm
        // Remounts when the wallet's stored matchers arrive, so the form's
        // initial state is the real one. Without it the picker would seed from
        // an empty first frame and a save could wipe rows the user never saw.
        key={`${wallet.id}:${ownMatchers === undefined ? "loading" : "ready"}`}
        submitLabel="Save wallet"
        onSubmit={save}
        submitting={updateWallet.isPending || setMatchers.isPending}
        errorMessage={error}
        initial={{
          name: wallet.name,
          type: wallet.type,
          matchers: (ownMatchers ?? []).map((matcher) => ({
            packageName: matcher.packageName,
            hint: matcher.hint,
          })),
        }}
        providers={ruleset?.providers ?? []}
        owners={ownersFrom(allMatchers ?? [], wallets ?? [])}
        walletId={walletId}
      />
    </ScrollView>
  );
}
