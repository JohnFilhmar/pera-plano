// components/review/wallet_kind_body.tsx — the body of the one card that asks
// about a WALLET rather than a transaction.
//
// WHAT THE USER IS ACTUALLY DECIDING is whether a balance is money they have or
// money they owe. The app assumes "have" until it has reason to think otherwise
// (lib/wallets/classification.ts), and an owed balance is kept out of the
// Wallets-tab total and out of Safe-to-Spend — so getting this wrong either
// hides real money or inflates the user's total by the size of a debt. It is
// the one question the app cannot work out on its own AND cannot afford to
// guess, which is why it is the only part of the old onboarding wallet-type
// step that survived.
//
// NO BUTTONS HERE. The answers are the CARD's own action pair
// (`REVIEW_ACTIONS["wallet-kind-unclear"]`), like every other kind in the
// queue — a second pair inside the body would give the user four controls for
// a two-way question. This component is the question; the card is the answer.
//
// NO PICKER, NO VOCABULARY, NO THIRD OPTION. The old onboarding step made
// people choose between "bank", "e-wallet", "savings", "credit" and "cash"
// before they had entered a single transaction. There is deliberately no "not
// sure" either: the app is ALREADY running on "money you have", so a card the
// user leaves alone has simply left that assumption standing, and an explicit
// third button would only ask them to confirm the state they are already in.
import { Text, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import type { Centavos, ReviewQueueItem } from "@/types/domain";

export type WalletKindBodyProps = {
  item: ReviewQueueItem;
  /** Live wallet name and balance, so the card cannot quote a stale figure. */
  walletName: string | null;
  balance: Centavos | null;
};

/**
 * The wallet's name, preferring the one the caller resolved from the live
 * wallets list over the copy frozen into the payload when the item was raised.
 *
 * THE PAYLOAD'S COPY IS A FALLBACK, NOT THE SOURCE. A wallet renamed between
 * the question being raised and answered would otherwise be asked about under
 * a name the user no longer recognises — and this card can sit in the queue for
 * as long as the user likes.
 */
function nameFor(item: ReviewQueueItem, walletName: string | null): string {
  if (walletName !== null && walletName !== "") return walletName;
  const stored = item.payload.walletName;
  return typeof stored === "string" && stored !== "" ? stored : "this wallet";
}

function balanceFor(item: ReviewQueueItem, balance: Centavos | null): Centavos | null {
  if (balance !== null) return balance;
  const stored = item.payload.balance;
  return typeof stored === "number" ? stored : null;
}

export function WalletKindBody({ item, walletName, balance }: WalletKindBodyProps) {
  const name = nameFor(item, walletName);
  const amount = balanceFor(item, balance);

  return (
    <View className="gap-2" testID={`wallet-kind-body-${item.id}`}>
      <Text
        testID={`wallet-kind-question-${item.id}`}
        className="text-row text-fg dark:text-fg-dark"
      >
        {amount === null
          ? `Is the balance in ${name} money you have, or money you owe?`
          : `Is the ${formatCentavos(amount)} in ${name} money you have, or money you owe?`}
      </Text>

      <Text className="text-micro font-medium text-fg-2 dark:text-fg-2-dark">
        Money you owe is kept out of your total, so your safe-to-spend stays honest.
      </Text>
    </View>
  );
}
