// app/transaction/new.tsx — m1c plan Task 8's route.
//
// Owns every read and write; the form is presentational (Global Constraints:
// no repository import inside a component).
//
// RULE 4 LIVES HERE: A MANUAL ENTRY IS GROUND TRUTH. It is written straight
// through `useCreateTransaction` -> `insertTransaction`, and NEVER through
// `processCapture`. Not routed, not parsed, not deduped, not transfer-detected,
// not gated.
//
// The consequence that matters is the duplicate one: ₱100 typed twice within
// seconds leaves TWO rows. The DedupeGate exists to suppress a push/SMS twin
// describing ONE real event; two manual entries are two deliberate statements
// by a human, and merging them would tell the user they did not do something
// they just did — while quietly leaving money in a pocket they had already
// emptied.
import { useRouter } from "expo-router";

import { ManualEntryForm } from "@/components/transactions/manual_entry_form";
import { useCategories } from "@/hooks/queries/use_categories";
import { useCreateTransaction } from "@/hooks/mutations/use_create_transaction";
import { useTransactions } from "@/hooks/queries/use_transactions";
import { useWallets } from "@/hooks/queries/use_wallets";

import type { ManualEntryDraft } from "@/components/transactions/manual_entry_form";

export default function NewTransactionScreen() {
  const router = useRouter();
  const wallets = useWallets();
  const categories = useCategories();
  // The ledger drives two of rule 3's defaults — the last-used cash wallet and
  // the category this merchant last landed in.
  const transactions = useTransactions({});
  const createTransaction = useCreateTransaction();

  // Rendering the form before these resolve would default the wallet from an
  // empty ledger and the category from an empty history — the same class of bug
  // Task 5 hit, where the free-tier cap read an unloaded list as "no wallets".
  if (
    wallets.data === undefined ||
    categories.data === undefined ||
    transactions.data === undefined
  ) {
    return null;
  }

  function handleSubmit(draft: ManualEntryDraft): void {
    createTransaction.mutate(
      {
        walletId: draft.walletId,
        categoryId: draft.categoryId,
        amount: draft.amount,
        direction: draft.direction,
        occurredAt: draft.occurredAt,
        merchant: draft.merchant,
        note: draft.note,
        // Ground truth, not a parse the app happens to be certain of. There is
        // no notification behind this row, and inventing a reference would make
        // the detail screen's transparency panel lie about where it came from.
        source: "manual",
        confidence: 1,
      },
      // Closed only AFTER the write commits. A `back()` fired optimistically
      // would leave a failed write with nobody on screen to be told about it.
      { onSuccess: () => router.back() },
    );
  }

  return (
    <ManualEntryForm
      testID="manual-entry-form"
      wallets={wallets.data}
      categories={categories.data}
      transactions={transactions.data}
      now={Date.now()}
      onSubmit={handleSubmit}
      onCreateCashWallet={() => router.push("/wallet/new")}
    />
  );
}
