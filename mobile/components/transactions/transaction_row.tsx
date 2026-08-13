// components/transactions/transaction_row.tsx — m1c plan Task 6, rules 2 and 3.
//
// One row of the ledger: merchant or counterparty, a category chip, the wallet,
// and the signed amount.
//
// RULE 3 IS THE ONE THAT MATTERS. A TRANSFER LEG RENDERS MUTED, WITH A LINK
// GLYPH AND THE SENTENCE "Transfer — not counted as spending".
//
// Moving ₱5,000 from BPI to GCash is not spending — the money is still the
// user's, it just sits somewhere else. Every total in this app already knows
// that: `sumSpend` skips `transfer_link_id IS NOT NULL` rows, and invariant I2
// keeps them out of income too. The row has to say so as well, because a user
// who counts that ₱5,000 as spend will find their arithmetic and the app's
// permanently disagreeing, and will be right to trust neither.
//
// BOTH HALVES ARE REQUIRED, AND THEY DO DIFFERENT JOBS. The muting and the link
// glyph are a convention — fast to scan once learned, meaningless before that.
// The sentence is what teaches it, once, in words, on the first transfer the
// user ever sees. Ship one without the other and the row either explains
// nothing or explains it every time in a way that stops being read.
//
// PRESENTATIONAL. The category and the wallet arrive resolved, from the list
// that already holds both collections; a row that looked them up itself would
// mean one query per row (Global Constraints: components consume hooks, and
// this component consumes none at all).
import { ArrowLeftRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { registerIcon } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list_row";
import type { Category, Transaction, Wallet } from "@/types/domain";

/**
 * The exact sentence, exported so the tests and any future surface that shows a
 * transfer leg (the Review Queue's ambiguous-transfer card, the transaction
 * detail screen) use one string rather than three near-identical ones.
 *
 * The dash is U+2014 EM DASH, as the plan writes it.
 */
export const TRANSFER_LABEL = "Transfer — not counted as spending";

/** The link glyph (plan rule 3). Registered so `className` can tint it. */
const TransferGlyph = registerIcon(ArrowLeftRight);

/**
 * Shown when a row has no merchant and no counterparty and its category has not
 * loaded. Never blank: a money row the user cannot identify at all is worse
 * than one identified only by its category.
 */
const UNNAMED_CATEGORY = "Uncategorized";

export type TransactionRowProps = {
  transaction: Transaction;
  /** Resolved by `LedgerList` from the categories it already holds. */
  category?: Category;
  wallet?: Wallet;
  /**
   * Opens this row. m1c Task 7.
   *
   * REPORTS THE ROW, NAVIGATES NOTHING. Keeping `useRouter` out of this file is
   * what lets the same component render on the Transactions tab, the wallet
   * detail, and (later) the Review Queue's cards without any of them inheriting
   * a route the others do not want — and it keeps this file testable without a
   * router at all. Optional, so a caller with nowhere to send the user gets a
   * plain row rather than a tap that silently does nothing.
   */
  onPress?: () => void;
  testID?: string;
};

export function TransactionRow({
  transaction,
  category,
  wallet,
  onPress,
  testID,
}: TransactionRowProps) {
  // `transferLinkId !== null` is the whole definition of a transfer leg. Not
  // "the category is Transfers", not a merchant heuristic — the link row is the
  // only thing `sumSpend` consults, so it is the only thing the row may show.
  const isTransfer = transaction.transferLinkId !== null;
  const rowTestID = testID ?? `transaction-row-${transaction.id}`;
  const categoryName = category?.name ?? UNNAMED_CATEGORY;

  const content = (
    <>
      <ListRow
        // Rule 2's fallback chain, in order. The category name is the last
        // resort rather than a placeholder like "Transaction", because it is
        // the only one of the two that tells the user anything.
        title={transaction.merchant ?? transaction.counterparty ?? categoryName}
        subtitle={wallet?.name}
        left={
          isTransfer ? (
            // The testID sits on a wrapping View, not on the Svg —
            // react-native-svg's prop forwarding is not something a row should
            // depend on (same shape as components/wallets/wallet_type_icon.tsx).
            <View testID={`transaction-glyph-${transaction.id}`}>
              <TransferGlyph size={16} className="text-fg-2 dark:text-fg-2-dark" />
            </View>
          ) : undefined
        }
        right={
          <AmountText
            testID={`transaction-amount-${transaction.id}`}
            amount={transaction.amount}
            direction={transaction.direction}
            // The styling half of rule 3. `muted` is `fg-2` in both themes,
            // overriding the `in`/`out` colours — a transfer leg must read as
            // neither spending nor income, because it is neither.
            muted={isTransfer}
            size="md"
          />
        }
        // The press handler is on the WRAPPER below, not here. Nesting a
        // Pressable inside another one gives the row two touch targets with
        // different bounds, and the chip line — which is where a user's thumb
        // lands when they are reading the category — would not be one of them.
      />
      <View className="flex-row flex-wrap items-center gap-2 px-4 pb-3">
        <Chip testID={`transaction-category-${transaction.id}`} label={categoryName} />
        {isTransfer ? (
          <Text
            testID={`transaction-transfer-${transaction.id}`}
            className="text-xs text-fg-2 dark:text-fg-2-dark"
          >
            {TRANSFER_LABEL}
          </Text>
        ) : null}
      </View>
    </>
  );

  // Task 6 shipped this row INERT: app/transaction/[id].tsx did not exist, and
  // a dead tap on the most-tapped list in the app is worse than an obviously
  // static one. That route exists now — but a caller with nowhere to send the
  // user still gets the plain row rather than a tap that does nothing.
  if (!onPress) {
    return <View testID={rowTestID}>{content}</View>;
  }

  return (
    <Pressable
      testID={rowTestID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${transaction.merchant ?? transaction.counterparty ?? categoryName}, ${categoryName}`}
    >
      {content}
    </Pressable>
  );
}
