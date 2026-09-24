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
// NO CHECK CHIP — BUT THIS IS A MISSING QUERY, NOT AN IMPOSSIBLE STATE.
// task-4-brief.md Step 4 also asks for a `Chip label="CHECK"` beside the title
// "when a row is awaiting review". Corrected 2026-08-23 after review flagged
// the first version of this comment for over-claiming: it said "a row cannot
// be awaiting review," full stop, which is only true for two of the four
// `ReviewKind`s (types/domain.ts).
//
// For `low-confidence` and `possible-duplicate` the invariant holds exactly
// as originally stated: the item under review is HELD, not committed
// (docs/04-features/08-review-queue.md rule 1: "the Transaction is held
// uncommitted until triaged"; rule 4: "the twin is held uncommitted"), and
// `ReviewResolution`'s own comment names it directly — "queue items are never
// Transactions themselves — invariant I13" (types/domain.ts). No `Transaction`
// row exists yet for these two kinds, so no ledger row could ever need the chip.
//
// For `ambiguous-transfer` IT DOES NOT HOLD. Both legs are already-committed
// Transactions sitting in the ledger — docs/04-features/08-review-queue.md
// says so twice: "Both legs are already-committed Transactions; the card asks
// only whether to pair them" (Flow: resolve an ambiguous transfer, step 1) and
// "Both legs are committed; only the pairing is queued" (Rules & edge cases,
// rule 3). `components/review/review_card.tsx`'s `counterpartIdOf` resolves
// `transferCounterpartTransactionId` through `useTransaction(...)`, a live
// query against this same `transactions` table, which only works because the
// counterpart is a real row. So a `TransactionRow` CAN legitimately be sitting
// in this ledger, fully counted in spend, while the Review Queue holds an open
// question about it — the user has no way to learn that from the row itself,
// only by opening `/review` separately.
//
// THE CHIP IS STILL LEFT OUT, because the blocker is a missing lookup, not an
// architectural wall. `lib/db/repos/review_queue_repo.ts` exposes only
// `enqueue`/`listOpen`/`countOpen`/`resolve`/`purgeExpired` — nothing indexed
// by referenced transaction id — and `payload` is deliberately opaque
// (`Record<string, unknown>`), so this component has no query to ask "is this
// row's id anyone's `transferCounterpartTransactionId` right now?" without one
// being built first. Building that path (a payload-aware lookup, most likely a
// new repo function plus a hook this presentational row still would not call
// directly) is real, untested scope beyond a restyle. The next person picking
// this up should start at `review_queue_repo.ts`, not at "is this possible."
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
import type { Category, EpochMs, Transaction, Wallet } from "@/types/domain";

/**
 * The exact sentence, exported so the tests and any future surface that shows a
 * transfer leg (the Review Queue's ambiguous-transfer card, the transaction
 * detail screen) use one string rather than three near-identical ones.
 *
 * The dash is U+2014 EM DASH, as the plan writes it.
 */
export const TRANSFER_LABEL = "Transfer — not counted as spending";

/**
 * The adjustment equivalent (017_transaction_adjustments), phrased to the same
 * shape so the two read as one rule rather than two exceptions.
 *
 * It names WHAT THE ROW IS, not what the user did, because a starting balance
 * and a manual correction arrive at the same row through different sheets and
 * "Balance adjustment" is true of both.
 */
export const ADJUSTMENT_LABEL = "Balance adjustment — not counted as spending";

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

/**
 * Whether this row's stamp carries a time the app was actually told.
 *
 * A BACKDATED MANUAL ENTRY HAS NO TIME OF DAY. The user picked a day and
 * nothing more, and `occurredAtFor` (lib/transactions/manual_entry.ts) lands it
 * at the start of that local day — deliberately, because the ledger groups by
 * local calendar day. Rendering that as "12:00 AM" invents a moment: it reads
 * as a purchase made a minute after midnight, which is a fact about the user's
 * night the app never had.
 *
 * The one row this hides a REAL time from is a capture that landed at exactly
 * 00:00:00.000 local, to the millisecond. That is a stamp the pipeline writes
 * from `postedAt`, so it is possible rather than impossible — and losing the
 * time on it costs the user nothing the day header does not already say, where
 * a fabricated one is a statement about their money that is simply untrue.
 */
function hasTimeOfDay(at: EpochMs): boolean {
  const date = new Date(at);
  return (
    date.getHours() !== 0 ||
    date.getMinutes() !== 0 ||
    date.getSeconds() !== 0 ||
    date.getMilliseconds() !== 0
  );
}

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
  // Same standing as `isTransfer` on this row: a fact the repository stamped at
  // write time, not something inferred from the note or the category. The note
  // is what 017's backfill had to key on for rows written before the column
  // existed, and keying the UI on it too would put a display rule and a
  // migration heuristic in the same job.
  const isAdjustment = transaction.isAdjustment;
  const isUncounted = isTransfer || isAdjustment;
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
            // neither spending nor income, because it is neither. An adjustment
            // is muted for the identical reason: the owner's screenshot showed
            // a −₱4,964.60 correction in full expense red, which is the colour
            // the app uses to mean "this came out of your budget".
            muted={isUncounted}
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
          {hasTimeOfDay(transaction.occurredAt) ? (
            <>
              <Text className={DETAIL_TEXT_CLASS}>·</Text>
              <Text testID={`transaction-time-${transaction.id}`} className={DETAIL_TEXT_CLASS}>
                {formatTime(transaction.occurredAt)}
              </Text>
            </>
          ) : null}
        </View>
        {isTransfer ? (
          <Text
            testID={`transaction-transfer-${transaction.id}`}
            className="text-xs text-fg-2 dark:text-fg-2-dark"
          >
            {TRANSFER_LABEL}
          </Text>
        ) : null}
        {/* Not an `else` on the transfer arm by accident: the two are mutually
            exclusive by construction (a reconciliation hook never links a leg),
            and writing them as separate conditions means a row that somehow
            became both would say so rather than hide one fact behind the
            other. */}
        {isAdjustment ? (
          <Text
            testID={`transaction-adjustment-${transaction.id}`}
            className="text-xs text-fg-2 dark:text-fg-2-dark"
          >
            {ADJUSTMENT_LABEL}
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
