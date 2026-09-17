// components/wallets/archive_wallet_sheet.tsx — m1c plan Task 5, rule 4:
// "Archive, never orphan".
//
// Archiving is what a user does when they close a bank account, and the whole
// point is that their history keeps making sense afterwards. So this sheet asks
// one question and DEFAULTS TO THE ANSWER THAT CHANGES NOTHING: the transactions
// stay attached to the archived wallet (spec §archive rule 2, "its Transactions
// remain fully visible in history and reports"). Defaulting to MOVING would
// relocate years of history into whichever wallet happened to be listed first,
// on a single confirm tap — and a mis-tap is not consent to that.
//
// DELETE IS THE LABEL; ARCHIVE IS THE ACT (owner, 2026-08-28: "replace the
// misleading button text from archive to 'delete'"). This sheet's confirm button
// says "Delete wallet" and sets `isArchived`. NOTHING IS REMOVED: invariant 4
// forbids orphan Transactions, the schema's NO ACTION foreign key on
// `transactions.wallet_id` blocks a real DELETE outright, and `wallets_repo`
// deliberately exports no `deleteWallet` to call.
//
// The word is the one people reach for when they want something gone, and the
// promise behind it is kept by the wallet staying restorable under "Show
// deleted" on the Wallets tab. Every Plan tab does the same through
// components/plan/archived_section.tsx, so this file is not the odd one out.
// The header used to read "DELETE IS NOT ON OFFER, ANYWHERE", which predates
// that ruling and was the only false sentence in the file (GAP-022).
//
// It also states the two consequences a user cannot see coming — the matchers
// stop catching, and the balance leaves the wallets total — because both are
// things they would otherwise discover as a mystery a week later.
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list_row";
import type { Wallet } from "@/types/domain";

import { WalletIcon } from "./wallet_icon";

/**
 * What still reads this wallet, for the archive confirmation to name.
 *
 * GATHERED BY THE SCREEN, not by this sheet. The sheet is presentational and
 * already takes `transactionCount` and `otherWallets` the same way, and the
 * three sources here (`useGoals`, `useLoans`, `useIncomeSummary`) are queries
 * the screen can hold open instead of a sheet mounting three of its own the
 * moment it becomes visible.
 *
 * NAMES RATHER THAN ROWS, because naming them is the whole job (spec archive
 * flow step 4: "the confirmation lists these links"). Passing `Goal[]` and
 * `Loan[]` would hand this file two domain shapes it would only read one field
 * from each.
 */
export type WalletLinks = {
  /** Names of live goals whose `linkedWalletId` is this wallet. */
  goals: readonly string[];
  /** Counterparties of active loans linked to this wallet. */
  loans: readonly string[];
  /** Whether the wallet is in `IncomeProfile.sourceWalletIds[]`. */
  isIncomeSource: boolean;
};

export type ArchiveWalletSheetProps = {
  wallet: Wallet;
  visible: boolean;
  onDismiss: () => void;
  /** Active wallets the transactions could move to; the subject is filtered out. */
  otherWallets: readonly Wallet[];
  transactionCount: number;
  /**
   * Goals, loans and income sources still pointing at this wallet. Omitted
   * means "nothing does", so a caller that has not wired the queries yet keeps
   * today's sheet rather than rendering an empty accusation.
   */
  links?: WalletLinks | null;
  /** `null` means "leave them attached to the archived wallet" — the default. */
  onArchive: (moveTransactionsTo: string | null) => void;
  /**
   * An archive this sheet has already handed to the screen and that has not
   * settled yet. Confirm is inert and spinning for exactly that long.
   *
   * OWNED BY THE SCREEN (`app/wallet/[id].tsx`), like `errorMessage` below and
   * for the same reason: the write lives there, so only it knows when the
   * write stops being in flight. That screen keeps this sheet open for the
   * whole of it — it closes on the archive landing, not on the tap — so a
   * second tap inside that window is a SECOND archive, re-running
   * `reassignWalletTransactions` over a ledger the first one is still moving.
   * Same prop `payment_match_sheet.tsx` already takes for the same job.
   *
   * Defaults to `false`, so a caller with no write behind it keeps today's
   * behaviour.
   */
  busy?: boolean;
  /**
   * What went wrong with the archive the screen just ran, rendered under the
   * choices. Also owned by the screen, and `null` whenever nothing has failed.
   */
  errorMessage?: string | null;
  testID?: string;
};

type Choice = "keep" | "move";

export function ArchiveWalletSheet({
  wallet,
  visible,
  onDismiss,
  otherWallets,
  transactionCount,
  links = null,
  onArchive,
  busy = false,
  errorMessage = null,
  testID = "archive-wallet-sheet",
}: ArchiveWalletSheetProps) {
  const [choice, setChoice] = useState<Choice>("keep");
  const [target, setTarget] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);

  // EVERY OPENING ASKS THE QUESTION AGAIN (GAP-079). The detail screen keeps
  // this sheet in the tree and toggles `visible`, so a "Move them to BPI" the
  // user backed out of last time was still selected — and still one confirm
  // tap from relocating years of history — the next time the sheet opened.
  // The default that changes nothing is only a default if it is restored.
  useEffect(() => {
    if (!visible) return;
    setChoice("keep");
    setTarget(null);
    setShowError(false);
  }, [visible]);

  // ONE FLAT LIST, because naming them is the job and grouping three goals
  // under a "Goals" subheading buys a heading per kind for no extra meaning.
  // The kind prefix carries it, and an empty list renders nothing at all.
  const linkLines = [
    ...(links?.goals ?? []).map((name) => `Goal: ${name}`),
    ...(links?.loans ?? []).map((who) => `Utang: ${who}`),
    ...(links?.isIncomeSource === true ? ["Income: one of your pay sources"] : []),
  ];

  const hasTransactions = transactionCount > 0;
  const destinations = otherWallets.filter(
    (candidate) => candidate.id !== wallet.id && !candidate.isArchived,
  );

  function choose(next: Choice): void {
    setChoice(next);
    setShowError(false);
    // Switching back to "keep" clears the destination, so a stale selection
    // cannot be submitted by a later confirm.
    if (next === "keep") setTarget(null);
  }

  function confirm(): void {
    // Ahead of the destination check, because an archive already in flight
    // outranks every other reason to accept or refuse this tap. `Button` drops
    // its own handler while `loading`, so this is the belt to that braces —
    // the refusal has to survive a press that gets past the responder.
    if (busy) return;
    if (choice === "move" && target === null) {
      // "Move them" with no destination is not an instruction. Quietly falling
      // back to "keep" would be smoother and would tell the user their move
      // worked.
      setShowError(true);
      return;
    }
    onArchive(choice === "move" ? target : null);
  }

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title={`Delete ${wallet.name}`}>
      <View testID={testID} className="gap-3">
        {/* Same sheet rhythm as cash_reconcile_sheet.tsx / balance_correction_sheet.tsx
            (task-5b) — `text-body` for the explanatory prose. Content is
            untouched: components/wallets/__tests__/archive_wallet_sheet.test.tsx
            regex-matches "histor", "nothing is deleted", "Review Queue" and
            "total" against this sheet's own testID, not any one paragraph. */}
        <Text className="text-body text-fg-2 dark:text-fg-2-dark">
          This retires the wallet. Its history stays in your reports, and you can restore it from
          the Wallets tab under &ldquo;Show deleted&rdquo;.
        </Text>
        <Text className="text-body text-fg-2 dark:text-fg-2-dark">
          Its balance leaves the total on your Wallets tab, and it stops catching notifications —
          anything that would have landed here goes to your Review Queue instead, so nothing is
          lost.
        </Text>

        {/* GAP-036. Spec archive flow step 4 and rule 21: a wallet backing a
            goal, an active loan or income detection has to say so here, and ask
            the user to relink or accept the pause. Without it a goal linked to
            a retired wallet just stops moving, and the user learns why a week
            later, if ever.

            ABOVE THE TRANSACTIONS QUESTION, deliberately. This is a
            consequence to read before choosing anything; the question below is
            the choice itself. */}
        {linkLines.length > 0 ? (
          <View testID="archive-wallet-links" className="gap-1">
            <Text className="text-row font-semibold text-fg dark:text-fg-dark">
              Still using this wallet
            </Text>
            {linkLines.map((line) => (
              <Text key={line} className="text-body text-fg-2 dark:text-fg-2-dark">
                {line}
              </Text>
            ))}
            <Text className="text-body text-fg-2 dark:text-fg-2-dark">
              Their automation pauses until you point them at another wallet. Nothing you set up
              is deleted.
            </Text>
          </View>
        ) : null}

        {hasTransactions ? (
          <View className="gap-1">
            <Text className="text-row font-semibold text-fg dark:text-fg-dark">
              {`What happens to its ${transactionCount} transactions?`}
            </Text>
            <ListRow
              testID="archive-keep-transactions"
              title="Keep them here"
              subtitle="They stay in your history and reports, attached to this wallet."
              // 63 characters, no left icon, a conditional Chip on the right
              // — branch-review-correctness.md F2's defect class (list_row.tsx
              // subtitles defaulting to one line), found by the app-wide
              // sweep. `Math.ceil(63 / 22)`; see app/(tabs)/more/index.tsx's
              // header for where 22 chars/line comes from.
              subtitleLines={3}
              onPress={() => choose("keep")}
              right={choice === "keep" ? <Chip label="Selected" tone="brand" /> : undefined}
            />
            <ListRow
              testID="archive-move-transactions"
              title="Move them to another wallet"
              subtitle="Their amounts and details are unchanged. Transfers between these two wallets stay put."
              // 85 characters, `Math.ceil(85 / 22)`; same sweep finding as the
              // row above. It grew when GAP-080 added the transfer caveat, and
              // "only the wallet moves" came out to pay for it: that clause is
              // the imprecise one now, since a leg paired with the destination
              // deliberately does not move at all.
              subtitleLines={4}
              onPress={() => choose("move")}
              right={choice === "move" ? <Chip label="Selected" tone="brand" /> : undefined}
            />
          </View>
        ) : null}

        {hasTransactions && choice === "move" ? (
          <View className="gap-1">
            {destinations.map((candidate) => (
              <ListRow
                key={candidate.id}
                testID={`archive-target-${candidate.id}`}
                title={candidate.name}
                left={<WalletIcon wallet={candidate} />}
                onPress={() => {
                  setTarget(candidate.id);
                  setShowError(false);
                }}
                right={target === candidate.id ? <Chip label="Selected" tone="brand" /> : undefined}
              />
            ))}
            {showError ? (
              <Text
                testID="archive-target-error"
                className="text-sm text-danger dark:text-danger-dark"
              >
                Pick where these transactions should go.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* IN PLACE, OVER THE BUTTON THAT FAILED (GAP-079). The global failure
            toast (GAP-013) says something failed; only this sheet can say that
            the wallet is still live, that nothing moved, and that the choice
            above is still the one that will be sent. */}
        {errorMessage ? (
          <Text testID="archive-error" className="text-sm text-danger dark:text-danger-dark">
            {errorMessage}
          </Text>
        ) : null}

        {/* Cancel + confirm side by side, the same rhythm the other two
            sheets in this task now use. `outline-destructive` (task-5b):
            surface fill, danger border and ink — a destructive action the
            user reads calmly before committing, not one already confirmed
            (button.tsx's own distinction between `destructive`, the filled
            variant for something already agreed to, and this one). */}
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button testID="archive-cancel" title="Cancel" variant="secondary" onPress={onDismiss} />
          </View>
          <View className="flex-1">
            <Button
              testID="archive-confirm"
              title="Delete wallet"
              variant="outline-destructive"
              loading={busy}
              onPress={confirm}
            />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
