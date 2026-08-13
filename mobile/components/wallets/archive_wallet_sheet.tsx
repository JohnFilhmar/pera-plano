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
// DELETE IS NOT ON OFFER, ANYWHERE. Invariant 4 forbids orphan Transactions, the
// schema's NO ACTION foreign key on `transactions.wallet_id` blocks the DELETE
// outright, and `wallets_repo` deliberately exports no `deleteWallet`. A delete
// button here could only mislead or throw.
//
// It also states the two consequences a user cannot see coming — the matchers
// stop catching, and the balance leaves the wallets total — because both are
// things they would otherwise discover as a mystery a week later.
import { useState } from "react";
import { Text, View } from "react-native";

import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list_row";
import type { Wallet } from "@/types/domain";

import { WalletTypeIcon } from "./wallet_type_icon";

export type ArchiveWalletSheetProps = {
  wallet: Wallet;
  visible: boolean;
  onDismiss: () => void;
  /** Active wallets the transactions could move to; the subject is filtered out. */
  otherWallets: readonly Wallet[];
  transactionCount: number;
  /** `null` means "leave them attached to the archived wallet" — the default. */
  onArchive: (moveTransactionsTo: string | null) => void;
  testID?: string;
};

type Choice = "keep" | "move";

export function ArchiveWalletSheet({
  wallet,
  visible,
  onDismiss,
  otherWallets,
  transactionCount,
  onArchive,
  testID = "archive-wallet-sheet",
}: ArchiveWalletSheetProps) {
  const [choice, setChoice] = useState<Choice>("keep");
  const [target, setTarget] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);

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
    <BottomSheet visible={visible} onDismiss={onDismiss} title={`Archive ${wallet.name}`}>
      <View testID={testID} className="gap-3">
        <Text className="text-fg-2 dark:text-fg-2-dark">
          Archiving retires this wallet. Nothing is deleted: its history stays in your reports, and
          you can bring it back later.
        </Text>
        <Text className="text-fg-2 dark:text-fg-2-dark">
          Its balance leaves the total on your Wallets tab, and it stops catching notifications —
          anything that would have landed here goes to your Review Queue instead, so nothing is
          lost.
        </Text>

        {hasTransactions ? (
          <View className="gap-1">
            <Text className="font-medium text-fg dark:text-fg-dark">
              {`What happens to its ${transactionCount} transactions?`}
            </Text>
            <ListRow
              testID="archive-keep-transactions"
              title="Keep them here"
              subtitle="They stay in your history and reports, attached to this wallet."
              onPress={() => choose("keep")}
              right={choice === "keep" ? <Chip label="Selected" tone="brand" /> : undefined}
            />
            <ListRow
              testID="archive-move-transactions"
              title="Move them to another wallet"
              subtitle="Their amounts and details are unchanged; only the wallet moves."
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
                left={<WalletTypeIcon type={candidate.type} />}
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

        <Button testID="archive-confirm" title="Archive wallet" onPress={confirm} />
      </View>
    </BottomSheet>
  );
}
