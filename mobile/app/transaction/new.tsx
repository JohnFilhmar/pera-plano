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
import { useEffect, useRef, useState } from "react";
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
      return "One of those wallets was deleted. Nothing was recorded — pick another wallet and try again.";
    }
    if (error.reason === "unknown_wallet") {
      return "One of those wallets is no longer there. Nothing was recorded — pick another wallet and try again.";
    }
  }

  return "That transfer wasn't saved. Nothing was recorded — try again.";
}

/**
 * The OPPOSITE claim to every sentence above, for the failures that happen
 * after `recordTransfer` has already committed — the invalidation, or the
 * `router.back()` that closes this screen.
 *
 * IT MUST NOT OFFER A RETRY. `recordTransfer` is not idempotent: pressing Save
 * again writes the two legs and the fee a SECOND time, so the wording that is
 * correct three lines up is the most expensive thing this screen could say
 * here. Closing the sheet by hand is the entire remedy — the rows are in the
 * ledger and the balances already moved.
 */
const TRANSFER_COMMITTED_MESSAGE =
  "Your transfer was recorded, but this screen didn't close on its own. Close it and check your wallets — don't save it again.";

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
  // The in-flight flag Save is disabled by — see ManualEntryForm's `submitting`
  // prop for why a second tap inside the write window is a second set of rows
  // rather than a no-op.
  //
  // BOTH PATHS, AND A REF, which is the part that actually stops a same-tick
  // double tap. `createTransaction.isPending` cannot do it alone: React Query
  // notifies its observers on a microtask, so two presses inside ONE JS tick
  // both read `isPending: false` and both commit.
  //
  // A `useState` flag cannot do it either, which is what this comment used to
  // claim. Calling the setter does not change the value the CURRENT render's
  // closure is holding, so the second press in that tick reads the same stale
  // `false` the first one did. GAP-079 proved it on the loan sheet: the state
  // flag was in place and one collector visit still wrote two payments. Only a
  // ref mutates in time for a handler already running in this tick.
  //
  // The state below exists purely to re-render the button into its spinner;
  // the ref is the guard. `isPending` is still ORed in for the button, because
  // it stays true through the invalidation `onSuccess` awaits, a window the
  // ref has already been cleared in.
  const writeInFlightRef = useRef(false);
  const [writeInFlight, setWriteInFlight] = useState(false);

  function beginWrite(): boolean {
    if (writeInFlightRef.current) return false;
    writeInFlightRef.current = true;
    setWriteInFlight(true);
    return true;
  }

  function endWrite(): void {
    writeInFlightRef.current = false;
    setWriteInFlight(false);
  }
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
      if (!beginWrite()) return;
      // WHICH SIDE OF `recordTransfer` THE FAILURE FELL ON IS THE WHOLE POINT
      // OF THIS FLAG, and of the `await` sequence rather than the `.then()`
      // chain this used to be. Every message transferErrorMessage() can produce
      // ends in "Nothing was recorded" — a promise the SERVICE makes and only
      // the service can keep: validate() throws before a row is written, and
      // the three inserts and the link run inside one withUnitOfWork. The two
      // steps AFTER it, the invalidation and the `back()`, run on a ledger that
      // has ALREADY committed. One catch spanning all three therefore printed
      // "Nothing was recorded" on a screen where three rows had just landed —
      // the one lie this path exists to prevent, told by the code written to
      // prevent it.
      //
      // THE SCREEN STILL STAYS OPEN AND STILL SAYS WHY in both cases. Without
      // that the rejection is an unhandled promise: no `back()`, no message,
      // Save still live — a sheet that neither closed nor complained, leaving
      // the user with no way to tell whether three rows landed or none did.
      // This is the path that writes THREE rows, so "did my money move?" is the
      // one question the screen must never leave unanswered. All that changes
      // below is which of the two true answers it gives.
      void (async () => {
        let committed = false;
        try {
          await recordTransfer(
            {
              fromWalletId: draft.fromWalletId,
              toWalletId: draft.toWalletId,
              amount: draft.amount,
              feeAmount: draft.feeAmount,
              occurredAt: draft.occurredAt,
              note: draft.note,
            },
            Date.now(),
          );
          committed = true;
          // Same key set useCreateTransaction invalidates, minus reviewQueue
          // (recordTransfer never raises a loan match) and swapped to BOTH
          // wallets that moved instead of one, since a transfer's two legs
          // land in two different wallets rather than the entry path's single
          // walletId.
          await invalidateKeys(queryClient, [
            queryKeys.transactions.all,
            queryKeys.wallets.detail(draft.fromWalletId),
            queryKeys.wallets.detail(draft.toWalletId),
            queryKeys.wallets.lists(),
          ]);
          // Closed only AFTER the write commits — same reasoning as the entry
          // path's onSuccess below: a `back()` fired before the two legs land
          // would leave a failed transfer with nobody on screen to be told.
          router.back();
        } catch (error: unknown) {
          setTransferError(
            // The money moved, and the screen failing to close is the only
            // symptom the user can see. So this names the one thing left to do
            // rather than offering a retry that would write the transfer twice.
            committed ? TRANSFER_COMMITTED_MESSAGE : transferErrorMessage(error),
          );
        } finally {
          // IN `finally`, NOT ON THE SUCCESS ARM. A rejected transfer leaves
          // this screen open, and a flag cleared only where the write commits
          // would leave the user reading "try again" under a Save that never
          // comes back.
          endWrite();
        }
      })();
      return;
    }

    if (!beginWrite()) return;
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
      //
      // `onSettled`, not `onSuccess`, for the flag — the transfer path's
      // `finally` for the same reason: a write that failed leaves this screen
      // open, and Save has to come back for the retry.
      { onSuccess: () => router.back(), onSettled: endWrite },
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
        submitting={createTransaction.isPending || writeInFlight}
        onCreateCashWallet={() => router.push("/wallet/new")}
        onClose={() => router.back()}
      />
    </FormScreen>
  );
}
