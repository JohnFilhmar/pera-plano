// app/transaction/new.tsx — m1c plan Task 8's route.
//
// Owns every read and write; the form is presentational (Global Constraints:
// no repository import inside a component). THE AMOUNT LIVES HERE TOO
// (numeric-input-system W1 Task 9): the mount effect below hands the shared
// keypad a field to open before ManualEntryForm's own NumericField has ever
// been pressed, so the screen lands with the amount already up — see that
// component's header for the other half of this handoff.
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
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";

import { ManualEntryForm } from "@/components/transactions/manual_entry_form";
import { FormScreen } from "@/components/ui/form_screen";
import { queryKeys } from "@/constants/query_keys";
import { useKeypad } from "@/contexts/keypad_context";
import { invalidateKeys } from "@/hooks/mutations/invalidate_keys";
import { useCategories } from "@/hooks/queries/use_categories";
import { useCreateTransaction } from "@/hooks/mutations/use_create_transaction";
import { useTransactions } from "@/hooks/queries/use_transactions";
import { useWallets } from "@/hooks/queries/use_wallets";
import { recordTransfer, TransferValidationError } from "@/lib/transfers/transfer_service";

import type { ManualEntryDraft } from "@/components/transactions/manual_entry_form";

/**
 * What to put on screen when `recordTransfer` rejects.
 *
 * IT ALWAYS SAYS NOTHING WAS RECORDED, and that claim is one the service
 * guarantees rather than one this screen hopes for: `validate` throws before a
 * single row is written, and the three inserts and the link run inside one
 * `withUnitOfWork`. The user's real question after a failed Save is "did some
 * of my money move?", and any wording that leaves that open is worse than the
 * failure.
 *
 * The two named reasons are the ones a user can actually reach by racing the
 * form — a wallet archived on another screen while this sheet was open, and a
 * draft whose wallets collapsed to one — because those are the two they can do
 * something about. Everything else (a SQLite fault, a `TransferValidationError`
 * the form's own checks should have caught first) gets the generic sentence:
 * naming a reason the user cannot act on is noise dressed as help.
 */
function transferErrorMessage(error: unknown): string {
  if (error instanceof TransferValidationError) {
    if (error.reason === "archived_wallet") {
      return "One of those wallets was archived. Nothing was recorded — pick another wallet and try again.";
    }
    if (error.reason === "unknown_wallet") {
      return "One of those wallets is no longer there. Nothing was recorded — pick another wallet and try again.";
    }
  }

  return "That transfer wasn't saved. Nothing was recorded — try again.";
}

export default function NewTransactionScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const wallets = useWallets();
  const categories = useCategories();
  // The ledger drives two of rule 3's defaults — the last-used cash wallet and
  // the category this merchant last landed in.
  const transactions = useTransactions({});
  const createTransaction = useCreateTransaction();

  const [amount, setAmount] = useState("");
  // The transfer path's only failure surface. `useCreateTransaction` has React
  // Query's own error state behind it; `recordTransfer` is a bare promise this
  // screen calls itself, so the screen has to hold what went wrong.
  const [transferError, setTransferError] = useState<string | null>(null);
  const { open } = useKeypad();

  // The amount is deliberately the first and only thing on screen (m1c rule
  // 1), so the panel is already up when the screen appears. Same landing
  // state as the inline numpad this replaces, one code path instead of two,
  // and it inherits FormScreen's avoidance so Save stops hiding.
  useEffect(() => {
    open({ fieldId: "manual-amount", label: "How much?", mode: "peso", text: amount, onChangeText: setAmount });
    // NO CLEANUP HERE ANY MORE. This effect used to end `return () => close()`
    // so the panel did not outlive a router.back()/router.push() off this
    // screen. components/ui/numeric_field.tsx now owns that for every migrated
    // screen, and owns it BETTER: the field checks that the request still
    // names it before closing, where this route's cleanup was unconditional
    // and would have taken down a panel some other screen had opened by then.
    // The field that this open() targets — manual_entry_form.tsx's
    // "manual-amount" — is mounted for as long as this route renders a form,
    // so it is the one that closes the panel on the way out.
    //
    // Mount only: re-opening on every amount change would fight a user who
    // dismissed the panel to reach the category picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // A transfer moves money between the user's own wallets — two legs plus
    // an optional fee row, written atomically by recordTransfer. It is NEVER
    // routed through createTransaction/insertTransaction: that path writes
    // exactly one row with no transfer_links stamp, which here would leave
    // the money debited from fromWalletId with no counterpart anywhere —
    // an internal movement silently counted as real spend.
    if (draft.kind === "transfer") {
      // Cleared on every attempt, so a message from the previous try cannot
      // sit under a Save that has just succeeded.
      setTransferError(null);
      recordTransfer(
        {
          fromWalletId: draft.fromWalletId,
          toWalletId: draft.toWalletId,
          amount: draft.amount,
          feeAmount: draft.feeAmount,
          occurredAt: draft.occurredAt,
          note: draft.note,
        },
        Date.now(),
      ).then(() =>
        // Same key set useCreateTransaction invalidates, minus reviewQueue
        // (recordTransfer never raises a loan match) and swapped to BOTH
        // wallets that moved instead of one, since a transfer's two legs
        // land in two different wallets rather than the entry path's single
        // walletId.
        invalidateKeys(queryClient, [
          queryKeys.transactions.all,
          queryKeys.wallets.detail(draft.fromWalletId),
          queryKeys.wallets.detail(draft.toWalletId),
          queryKeys.wallets.lists(),
        ]),
      )
        .then(() => router.back())
        // THE SCREEN STAYS OPEN, AND SAYS WHY. Without this the rejection is an
        // unhandled promise: no `back()`, no message, Save still live — a sheet
        // that neither closed nor complained, leaving the user with no way to
        // tell whether three rows landed or none did. This is the path that
        // writes THREE rows, so "did my money move?" is the one question the
        // screen must never leave unanswered. Save is enabled off the typed
        // amount alone, so it is already live for the retry.
        .catch((error: unknown) => setTransferError(transferErrorMessage(error)));
      // Closed only AFTER the write commits — same reasoning as the entry
      // path's onSuccess below: a `back()` fired before the two legs land
      // would leave a failed transfer with nobody on screen to be told.
      return;
    }

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
    <FormScreen>
      <ManualEntryForm
        testID="manual-entry-form"
        wallets={wallets.data}
        categories={categories.data}
        transactions={transactions.data}
        now={Date.now()}
        amount={amount}
        onAmountChange={setAmount}
        onSubmit={handleSubmit}
        submitError={transferError}
        onCreateCashWallet={() => router.push("/wallet/new")}
        onClose={() => router.back()}
      />
    </FormScreen>
  );
}
