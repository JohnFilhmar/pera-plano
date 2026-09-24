// app/transaction/[id]/edit.tsx — the rectification surface docs/07 promises
// (GAP-061). A full route rather than a sheet, matching app/wallet/[id]/edit.tsx:
// editing an entity is a route in this app, and the detail screen keeps the
// affordances that are about ONE field (category picker, note) inline.
//
// THE REPOSITORY ALREADY DID THE HARD HALF. `updateTransaction` settles the
// wallet balances an edit moves, inside its own unit of work, and its
// `settleBalance` helper is written reverse-then-apply precisely so an amount
// change, a direction flip and a wallet move are all correct at once. Nothing
// here recomputes a balance; this route only says what changed.
//
// A LINKED TRANSFER LEG IS REFUSED, BY THE OWNER'S RULING (2026-09-18). The two
// legs of a transfer are one movement described twice, and `transfer_link_id` is
// the schema's only expression of "not spending, not income" (GAP-080). Editing
// one leg's amount, direction or wallet would leave the pair describing two
// different movements, with nothing anywhere to detect it — both legs stay out
// of spend and income, so no screen would ever show the contradiction. Rejected
// alternatives: editing both legs together, which founders on transfers that
// carry a FEE (the legs legitimately differ, so "keep them equal" is wrong and
// the form would have to ask which number is being corrected); and editing one
// leg silently, which is the mismatch above. The user unlinks first, which is
// an action the detail screen already offers, edits, and relinks.
//
// THE GUARD IS HERE AS WELL AS ON THE DETAIL SCREEN because this path is
// addressable: `/transaction/<id>/edit` can be reached directly, and a check
// that lives only on the button that usually opens it is not a check.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TransactionEditForm } from "@/components/transactions/transaction_edit_form";
import type { TransactionEditPatch } from "@/components/transactions/transaction_edit_form";
import { EmptyState } from "@/components/ui/empty_state";
import { FormScreen } from "@/components/ui/form_screen";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useUpdateTransaction } from "@/hooks/mutations/use_update_transaction";
import { useTransaction } from "@/hooks/queries/use_transaction";
import { useWallets } from "@/hooks/queries/use_wallets";

export default function EditTransactionScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const transactionId = id ?? "";
  // A full-screen route outside the tab navigator: nothing above it clears the
  // status bar or Android's navigation bar. Same reason app/wallet/[id]/edit.tsx
  // pads its own edges.
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  // A ref AND a piece of state, the pair app/wallet/new.tsx documents (GAP-060,
  // GAP-079): `isPending` alone leaves a window between the tap and the
  // mutation being marked in flight, and a second tap inside that window runs
  // the write twice. On this screen that would settle the same balance delta
  // twice over.
  const saveInFlight = useRef(false);
  const [saving, setSaving] = useState(false);

  const { data: transaction, isPending } = useTransaction(transactionId);
  // Archived included: the row being edited may sit on an archived wallet, and
  // the form has to be able to show and keep it.
  const { data: wallets } = useWallets({ includeArchived: true });
  const updateTransaction = useUpdateTransaction();

  if (isPending) {
    return (
      <View testID="transaction-edit-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={4} />
      </View>
    );
  }

  if (!transaction) {
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          testID="transaction-edit-missing"
          title="Transaction not found"
          body="This transaction may have been deleted. Go back and pick another one."
        />
      </View>
    );
  }

  if (transaction.transferLinkId !== null) {
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          testID="transaction-edit-transfer-blocked"
          title="This is part of a transfer"
          body="Both sides of a transfer describe one movement, so they have to be changed together. Unlink it on the transaction's own screen first, then edit it."
        />
      </View>
    );
  }

  function save(patch: TransactionEditPatch): void {
    if (saveInFlight.current || updateTransaction.isPending) return;
    // Nothing changed. Leaving without a write is not a shortcut: an empty
    // patch would still settle a balance to the same number and bump
    // `updated_at`, making an opened-and-closed form look like an edit.
    if (Object.keys(patch).length === 0) {
      router.back();
      return;
    }
    setError(null);
    saveInFlight.current = true;
    setSaving(true);
    updateTransaction.mutate(
      { id: transactionId, patch },
      {
        onSuccess: () => {
          saveInFlight.current = false;
          setSaving(false);
          router.back();
        },
        onError: () => {
          saveInFlight.current = false;
          setSaving(false);
          setError("That didn't save. Check the amount and try again.");
        },
      },
    );
  }

  return (
    <View
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <FormScreen testID="transaction-edit-screen">
        <TransactionEditForm
          transaction={transaction}
          wallets={wallets ?? []}
          onSave={save}
          onCancel={() => router.back()}
          saving={saving}
          errorMessage={error}
        />
      </FormScreen>
    </View>
  );
}
