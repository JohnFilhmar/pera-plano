// components/review/one_sided_transfer_body.tsx — money-transfers spec Task
// 12; docs/03-ingest-pipeline.md §7 rule 6 and task-10-brief.md.
//
// WHAT THE USER IS ACTUALLY DECIDING is where the other half of a movement
// went. Confirming this card MINTS a second ledger row on whichever wallet is
// chosen here (`confirmOneSidedTransfer`, lib/review/resolve_actions.ts), so
// the wallet is a CHOICE the user makes, never a guess the app commits on
// their behalf. `payload.counterpartWalletId` — a `mark-transfer` rule's
// match, or nothing — is only ever a PREFILL: `ReviewCard` seeds the
// selection from it, but every row here stays tappable, exactly like
// `correct_sheet.tsx`'s own wallet picker treats the parser's own guess as a
// starting point rather than a decision.
//
// CASH WALLETS ARE OFFERED, DELIBERATELY. `transfer_detector.ts` can never
// auto-link a cash leg — a cash leg posts no notification, so there is no
// second event to match against in the first place — which is exactly why
// this card exists: an ATM withdrawal (a bank debit notification, and no
// cash notification at all) is the single most common transfer this whole
// feature was built to catch. Excluding cash wallets here would silently
// refuse the main case.
import { Pressable, Text, View } from "react-native";

import { NumericField } from "@/components/ui/numeric_field";
import type { ReviewQueueItem, TxDirection, Wallet } from "@/types/domain";

export type OneSidedTransferBodyProps = {
  item: ReviewQueueItem;
  wallets: readonly Wallet[];
  /** The captured leg's own wallet — never offered as its own counterpart. */
  capturedWalletId: string | null;
  selectedWalletId: string | null;
  onSelectWallet: (walletId: string) => void;
  /** Peso-input text, same shape `correct_sheet.tsx`'s amount field holds — see `centavosFrom`. */
  feeText: string;
  onChangeFeeText: (text: string) => void;
};

function directionOf(item: ReviewQueueItem): TxDirection {
  return item.payload.direction === "in" ? "in" : "out";
}

export function OneSidedTransferBody({
  item,
  wallets,
  capturedWalletId,
  selectedWalletId,
  onSelectWallet,
  feeText,
  onChangeFeeText,
}: OneSidedTransferBodyProps) {
  // EVERY UNARCHIVED WALLET BUT THE CAPTURED LEG'S OWN — never narrowed to
  // "wallets of a plausible type", because the one type this card exists to
  // let through (cash) is exactly the one a type filter would be tempted to
  // drop.
  const candidates = wallets.filter(
    (wallet) => !wallet.isArchived && wallet.id !== capturedWalletId,
  );
  const prompt =
    directionOf(item) === "in" ? "Where did this money come from?" : "Where did this money go?";

  return (
    <View testID="one-sided-transfer-body" className="gap-2">
      <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">{prompt}</Text>
      <View className="gap-2">
        {candidates.map((wallet) => (
          <Pressable
            key={wallet.id}
            testID={`one-sided-wallet-${wallet.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: wallet.id === selectedWalletId }}
            accessibilityLabel={wallet.name}
            onPress={() => onSelectWallet(wallet.id)}
            className={`min-h-[44px] justify-center rounded-xl px-4 py-3 ${
              wallet.id === selectedWalletId
                ? "bg-brand-soft dark:bg-brand-soft-dark"
                : "bg-bg dark:bg-bg-dark"
            }`}
          >
            <Text className="text-fg dark:text-fg-dark">{wallet.name}</Text>
          </Pressable>
        ))}
      </View>
      <NumericField
        testID="one-sided-fee"
        label="Fee (optional)"
        value={feeText}
        onChangeText={onChangeFeeText}
        placeholder="₱0"
      />
    </View>
  );
}
