// components/transactions/transaction_row.tsx — m1c plan Task 6, rules 2 and 3;
// restyled by task-4-brief.md (mobile UI revamp Part 2, Task 4).
//
// One row of the ledger: a category-icon medallion, merchant or counterparty,
// a "Category · Wallet · time" detail line, and the signed amount.
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
// THE DETAIL LINE IS THREE TEXT NODES, NOT ONE STRING. task-4-brief.md's
// design draws "Category · Wallet · HH:mm" as a single subtitle, which reads
// naturally as `ListRow`'s own `subtitle` slot — but that slot is typed as a
// plain `string`, and components/transactions/__tests__/ledger_list.test.tsx
// (outside this task's file list, and pinned in Task 4's own verification
// command) queries the wallet name as its OWN exact text node
// (`screen.getByText("GCash")`) and the category name through a dedicated
// `transaction-category-${id}` testID. A single combined string would satisfy
// neither query once it stopped being the wallet name alone. Three adjacent
// `Text` nodes read as one line to a sighted user and keep both pinned queries
// resolvable independently — the same trade `AmountText`'s own file warns
// against making the other way (never let styling swallow structure).
//
// A ROW CANNOT BE "AWAITING REVIEW". task-4-brief.md Step 4 also asks for a
// `Chip label="CHECK"` beside the title "when a row is awaiting review". No
// field on `Transaction` (types/domain.ts) carries that state, and
// review_queue_entry.tsx's own header comment is explicit about why: "review-
// queue items are not Transactions... they never get smuggled into the ledger
// to make the two agree." A committed row has therefore always already
// cleared review by construction — there is no reachable state this chip
// could ever render for, so it is left out rather than wired to a threshold
// this file would have to invent (e.g. a `confidence` cutoff nothing else in
// the app treats as a review signal).
//
// PRESENTATIONAL. The category and the wallet arrive resolved, from the list
// that already holds both collections; a row that looked them up itself would
// mean one query per row (Global Constraints: components consume hooks, and
// this component consumes none at all).
import { ArrowLeftRight, Tag } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { registerIcon } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list_row";
import { formatTime } from "@/lib/datetime";
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
 * The medallion's default glyph for an ordinary (non-transfer) row.
 *
 * A GENERIC mark, not one resolved from `category.icon`. `Category.icon`
 * (types/domain.ts) is a lucide icon name held as a plain string, and nothing
 * in this codebase yet maps an arbitrary icon-name string back to its lucide
 * component — category_picker.tsx renders every category as plain text for
 * exactly that reason. Building that resolver (with a safe fallback for a
 * name the running lucide version does not export) is a real, untested
 * subsystem this restyle task does not own; `Tag` fills the medallion so the
 * row is never missing its leading glyph while that resolver stays a
 * follow-up.
 */
const CategoryGlyph = registerIcon(Tag);

/**
 * Shown when a row has no merchant and no counterparty and its category has not
 * loaded. Never blank: a money row the user cannot identify at all is worse
 * than one identified only by its category.
 */
const UNNAMED_CATEGORY = "Uncategorized";

/** The detail line's shared styling — task-4-brief.md's exact subtitle pair. */
const DETAIL_TEXT_CLASS = "text-secondary font-medium text-fg-2 dark:text-fg-2-dark";

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

  const medallion = (
    <View className="h-7 w-7 items-center justify-center rounded-full bg-chip dark:bg-chip-dark">
      {isTransfer ? (
        // The testID sits on a wrapping View, not on the Svg —
        // react-native-svg's prop forwarding is not something a row should
        // depend on (same shape as components/wallets/wallet_type_icon.tsx).
        <View testID={`transaction-glyph-${transaction.id}`}>
          <TransferGlyph size={14} className="text-fg-2 dark:text-fg-2-dark" />
        </View>
      ) : (
        <CategoryGlyph size={14} className="text-fg-2 dark:text-fg-2-dark" />
      )}
    </View>
  );

  const content = (
    <>
      <ListRow
        // Rule 2's fallback chain, in order. The category name is the last
        // resort rather than a placeholder like "Transaction", because it is
        // the only one of the two that tells the user anything.
        title={transaction.merchant ?? transaction.counterparty ?? categoryName}
        left={medallion}
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
        // different bounds, and the detail line — where a user's thumb lands
        // reading the category — would not be one of them.
      />
      <View className="gap-1 px-4 pb-3">
        <View className="flex-row flex-wrap items-center gap-x-1">
          <Text testID={`transaction-category-${transaction.id}`} className={DETAIL_TEXT_CLASS}>
            {categoryName}
          </Text>
          {wallet ? (
            <>
              <Text className={DETAIL_TEXT_CLASS}>·</Text>
              <Text className={DETAIL_TEXT_CLASS}>{wallet.name}</Text>
            </>
          ) : null}
          <Text className={DETAIL_TEXT_CLASS}>·</Text>
          <Text className={DETAIL_TEXT_CLASS}>{formatTime(transaction.occurredAt)}</Text>
        </View>
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
