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
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/ui/empty_state";
import { FormScreen } from "@/components/ui/form_screen";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
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
    return (
      <View testID="wallet-edit-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={4} />
      </View>
    );
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
    // DEVICE-TESTING FIX (2026-08-18, Task 2): the insets used to sit on the
    // scroll view's `style` prop, which is its OUTER FRAME, not its scrolling
    // content — so "Save wallet" rendered under Android's navigation bar (this
    // is the screen from the owner's report: "Which notifications land here?"
    // above a buried "Save wallet"). Matches `app/review/index.tsx`'s shape
    // (insets on a padding-free outer View wrapping the scroll view), the same
    // house pattern `components/onboarding/onboarding_frame.tsx` and this
    // task's other two screens (`app/wallet/[id].tsx`, `app/wallet/new.tsx`)
    // use, rather than inventing a fourth: the outer View reserves both
    // system-bar edges first, so the scroll view's own viewport never extends
    // into either one.
    //
    // THE PATTERN IS KEPT; ONLY THE SCROLL VIEW CHANGED (numeric-input-system
    // Task 13) — see app/wallet/new.tsx for the full reasoning. In short: the
    // outer View protects the VIEWPORT BOUNDARY and does that whatever
    // scrolls inside, so it is untouched; the inner plain ScrollView could not
    // stay, because FormScreen IS a keyboard-aware scroll view and nesting one
    // inside another leaves the outer one holding every bit of scroll range.
    // FormScreen replaces it IN PLACE — same slot inside the inset-bearing
    // View, still no system-bar padding of its own. The dropped
    // `className="flex-1"` was redundant: React Native composes
    // `{ flexGrow: 1, flexShrink: 1 }` under every ScrollView's `style`.
    //
    // THIS ROUTE HAS NO AMOUNT FIELD AT ALL (the opening balance is
    // create-only — wallet_form.tsx:10-14), and it still gets FormScreen: the
    // form is long, its Save button is the thing that was buried, and its name
    // field raises the SYSTEM keyboard, which is the half FormScreen handles
    // with no configuration. A route left on a plain ScrollView because "there
    // is no keypad here" would keep exactly the bug the owner reported.
    <View
      testID="wallet-edit"
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <FormScreen testID="wallet-edit-scroll">
        <WalletForm
          // Remounts when the wallet's stored matchers arrive, so the form's
          // initial state is the real one. Without it the picker would seed
          // from an empty first frame and a save could wipe rows the user
          // never saw.
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
      </FormScreen>
    </View>
  );
}
