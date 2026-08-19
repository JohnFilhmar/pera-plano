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
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UpgradeSheet } from "@/components/gates/upgrade_sheet";
import { FormScreen } from "@/components/ui/form_screen";
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
  // A full-screen route outside the tab navigator: nothing above it clears the
  // status bar or Android's navigation bar. See app/_layout.tsx's
  // SafeAreaProvider comment for why each surface pads its own edges.
  const insets = useSafeAreaInsets();
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
    // DEVICE-TESTING FIX (2026-08-18, Task 2): the insets used to sit on the
    // scroll view's `style` prop, which is its OUTER FRAME, not its scrolling
    // content — so "Add wallet" could render under Android's navigation bar.
    // Matches `app/review/index.tsx`'s shape (insets on a padding-free outer
    // View wrapping the scroll view), the same house pattern
    // `components/onboarding/onboarding_frame.tsx` uses, rather than inventing
    // a third: the outer View reserves both system-bar edges first, so the
    // scroll view's own viewport never extends into either one.
    //
    // THE PATTERN IS KEPT; ONLY THE SCROLL VIEW CHANGED (numeric-input-system
    // Task 13). What that outer View protects is the VIEWPORT BOUNDARY, and it
    // protects it whatever scrolls inside — so it stays exactly as it was,
    // still the only holder of insets, still padding-free elsewhere. What
    // could not stay is the inner plain `ScrollView`: FormScreen IS a
    // (keyboard-avoiding) scroll view, and nesting one inside another leaves
    // the OUTER one — which knows nothing about the keypad — holding all the
    // scroll range, so FormScreen's avoidance and its
    // `paddingBottom: keypadHeight + 24` become silent no-ops. That is the
    // defect Task 10 hit on the loans route. FormScreen therefore REPLACES the
    // ScrollView in place rather than wrapping or being wrapped by it: same
    // slot inside the inset-bearing View, still no padding of its own for
    // either system bar.
    //
    // The removed `className="flex-1"` was redundant, not lost: React Native
    // composes `{ flexGrow: 1, flexShrink: 1 }` under every ScrollView's own
    // `style` (ScrollView.js's `baseVertical`), so the surface still fills and
    // shrinks to the safe region this View defines. FormScreen exposes no
    // className, and it does not need one.
    //
    // The UpgradeSheet moves OUT of it in the same edit — it is a Modal, its
    // own native window, and never was scrolling content.
    <View
      testID="wallet-new"
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <FormScreen testID="wallet-new-scroll">
        <WalletForm
          submitLabel="Add wallet"
          onSubmit={save}
          submitting={createWallet.isPending || setMatchers.isPending}
          errorMessage={error}
          providers={ruleset?.providers ?? []}
          owners={ownersFrom(matchers ?? [], wallets)}
          showOpeningBalance
        />
      </FormScreen>
      <UpgradeSheet visible={capped} onClose={() => setCapped(false)} capability="wallets" />
    </View>
  );
}
