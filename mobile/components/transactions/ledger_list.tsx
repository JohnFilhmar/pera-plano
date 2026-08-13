// components/transactions/ledger_list.tsx — m1c plan Task 6, rules 1, 5 and 6.
//
// THE ONE LEDGER IMPLEMENTATION IN THE APP. The Transactions tab renders it and
// so does the wallet detail screen, which until this task carried a deliberately
// plain list of its own with a comment pointing here. Two of them was never a
// styling problem: it is how a transfer leg ends up muted on one screen and
// counted as spending on the other, with nothing on either screen admitting
// they disagree.
//
// WHAT THIS FILE DECIDES, AND WHY EACH ONE IS LOAD-BEARING:
//
//   GROUPING AND ORDER. Newest day first, newest row first inside a day, sorted
//   HERE rather than trusted from the caller. `listTransactions` does order its
//   rows, but a list that merely preserves whatever order it was handed is one
//   caller away from rendering the user's ledger upside down.
//
//   THE DAY'S NET. Signed, and transfer legs excluded — see day_group_header.tsx.
//
//   THE TWO EMPTY STATES, WHICH MUST NEVER BE CONFLATED. "Nothing tracked yet"
//   shown while a filter is active tells a user with a full ledger that the app
//   recorded nothing. That is the most alarming false statement a money app can
//   make, and it is one `if` away at all times, which is why the two live as
//   named constants with their own assertions.
//
//   THE FREE-TIER BOUNDARY ROW (rule 5; docs/05-monetization.md §3.2). Free sees
//   90 days — a VISIBILITY window, never a retention one — so the row has to say
//   the older records still exist and are safe, not merely advertise Plus.
//
// SEARCH IS CLIENT-SIDE, AND THAT IS A LIABILITY WITH A SHELF LIFE — see
// `searchTransactions` below.
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";
import { historyWindowDays } from "@/lib/entitlements";
import type { Category, Centavos, EpochMs, IsoDate, Transaction, Wallet } from "@/types/domain";

import { DayGroupHeader, localDateKey } from "./day_group_header";
import { TransactionRow } from "./transaction_row";

// The day key is defined beside the header that formats it, and re-exported
// here because `groupByDay` is the reason it exists — a caller reasoning about
// grouping should not have to know which of the two files owns the calendar.
export { localDateKey };

/**
 * Rule 6's first empty state, split across a title and a body.
 *
 * THE COPY IS THE SPEC'S, NOT THE PLAN'S. docs/06-information-architecture.md §5
 * gives the Transactions tab "Nothing tracked yet. Your transactions will appear
 * here automatically."; the plan writes "Nothing tracked yet — grant
 * notification access to start". Global Constraints settle it: "Where this plan
 * and a spec disagree, the spec wins" — and the spec is right on the substance
 * too. The same section makes Home "the listener status surface", so a
 * Transactions empty state that assumes access is missing would be wrong for
 * every user who granted it and simply has not spent anything yet.
 *
 * There is no action button. The spec's primary action is "Add manual
 * Transaction", which is m1c Task 8's `app/transaction/new.tsx` — a button that
 * opens nothing is worse than no button (the same call Task 4 made on the
 * Wallets tab's empty state).
 */
export const LEDGER_EMPTY_TITLE = "Nothing tracked yet";
export const LEDGER_EMPTY_BODY = "Your transactions will appear here automatically.";

/**
 * Rule 6's second empty state. Deliberately says NOTHING about tracking: the
 * ledger is fine, the query missed. The distinctness of these two strings is
 * asserted directly, because the failure mode is them converging over time.
 */
export const LEDGER_FILTERED_EMPTY_TITLE = "No transactions match these filters";
export const LEDGER_FILTERED_EMPTY_BODY =
  "Try clearing a filter, widening the dates, or searching for something else.";

export type DayGroup = {
  date: IsoDate;
  transactions: Transaction[];
  /** Signed, transfer legs excluded. */
  net: Centavos;
};

/**
 * The day's net: `in` adds, `out` subtracts, TRANSFER LEGS COUNT FOR NOTHING.
 *
 * The exclusion is invariant I2 and it is the same one `sumSpend` applies in
 * SQL. Both halves have to hold or the header contradicts the row beneath it —
 * a ₱5,000 leg labelled "not counted as spending" sitting under a header that
 * counted it is a screen arguing with itself.
 */
export function dayNet(transactions: readonly Transaction[]): Centavos {
  return transactions
    .filter((transaction) => transaction.transferLinkId === null)
    .reduce(
      (total, transaction) =>
        total + (transaction.direction === "in" ? transaction.amount : -transaction.amount),
      0,
    );
}

/**
 * Rows → day groups, newest day first, newest row first inside each day.
 *
 * SORTS ITS OWN INPUT, on a copy. The repository already returns
 * `ORDER BY occurred_at DESC, created_at DESC`, so relying on it would pass
 * every test written against the repository's output and reverse the ledger the
 * first time anything else feeds this — a filtered client-side subset, a
 * cache-restored array, an optimistic insert.
 *
 * `createdAt` breaks an `occurredAt` tie, newest first: two notifications for
 * the same instant put the one that arrived second on top, which is the one the
 * user just watched happen.
 */
export function groupByDay(transactions: readonly Transaction[]): DayGroup[] {
  const sorted = [...transactions].sort(
    (a, b) => b.occurredAt - a.occurredAt || b.createdAt - a.createdAt,
  );

  const groups: DayGroup[] = [];
  const byDate = new Map<IsoDate, DayGroup>();

  for (const transaction of sorted) {
    const date = localDateKey(transaction.occurredAt);
    let group = byDate.get(date);
    if (!group) {
      group = { date, transactions: [], net: 0 };
      byDate.set(date, group);
      // Push in encounter order: `sorted` is already newest-first, so the
      // groups come out newest-day-first without a second sort.
      groups.push(group);
    }
    group.transactions.push(transaction);
  }

  for (const group of groups) {
    group.net = dayNet(group.transactions);
  }
  return groups;
}

/**
 * Does this row match the free-text query?
 *
 * MERCHANT, NOTE **AND** COUNTERPARTY. The plan names the first two; the third
 * is included because it can be the row's own TITLE (`merchant ?? counterparty
 * ?? category`) — a search that cannot find the words printed on the row is the
 * worst version of this feature, since the user reads the empty result as
 * evidence rather than as a limitation.
 *
 * Case-insensitive substring, query trimmed. An empty query matches everything
 * rather than nothing, so an empty search box is not a filter.
 */
export function matchesSearch(transaction: Transaction, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;

  return [transaction.merchant, transaction.counterparty, transaction.note].some(
    (field) => field !== null && field.toLowerCase().includes(needle),
  );
}

/**
 * Free-text search, applied CLIENT-SIDE over the rows already loaded.
 *
 * ⚠️ PAGINATION WILL SILENTLY BREAK THIS. `TxFilter` is interface-contract §3 —
 * `walletId, categoryId, from, to, direction, excludeTransferLinked` — and it
 * has no search field. The contract is LAW, so this cannot become a WHERE
 * clause without changing a pinned interface, and it is CORRECT TODAY only
 * because `listTransactions` returns the whole (tier-clamped) window in one go:
 * the rows on screen are all the rows there are.
 *
 * The day someone adds LIMIT/OFFSET or an infinite scroll to that query, this
 * function starts searching one page and reporting the result as if it had
 * searched the ledger. Nothing throws, nothing looks wrong, and the user reads
 * "no results" as "I never spent that" — the app quietly denying a transaction
 * it is holding two screens away.
 *
 * WHOEVER PAGINATES `listTransactions` OWNS THIS FUNCTION. The fix is a
 * contract amendment adding a search field to `TxFilter` (so SQLite does the
 * matching over the full table), not a bigger page size. Until then, a change
 * here is a change to the whole of search.
 */
export function searchTransactions(
  transactions: readonly Transaction[],
  query: string,
): Transaction[] {
  if (query.trim() === "") return [...transactions];
  return transactions.filter((transaction) => matchesSearch(transaction, query));
}

export type LedgerListProps = {
  /** `undefined` = the first read has not resolved. Renders no empty state. */
  transactions: readonly Transaction[] | undefined;
  categories?: readonly Category[];
  wallets?: readonly Wallet[];
  /** Free text, applied client-side — see `searchTransactions`. */
  search?: string;
  /**
   * True when a REPOSITORY-level filter narrowed `transactions`. It decides
   * which empty state the user sees, so the caller owning the filter has to
   * pass it; the list cannot tell an empty ledger from an empty result.
   */
  filtered?: boolean;
  /** Clock for the "Today"/"Yesterday" headers. */
  now?: EpochMs;
  /**
   * Replaces the default "nothing tracked yet" state. The wallet detail screen
   * uses it to keep saying "Nothing tracked in this wallet yet" — a wallet with
   * no rows is a narrower and more useful statement than the tab-wide one.
   */
  empty?: ReactNode;
  testID?: string;
};

export function LedgerList({
  transactions,
  categories = [],
  wallets = [],
  search = "",
  filtered = false,
  now = Date.now(),
  empty,
  testID = "ledger-list",
}: LedgerListProps) {
  // Nothing at all until the first read resolves. An empty state that flashes
  // on every cold start reads as data loss on the one screen whose entire job
  // is to be trusted about money.
  if (transactions === undefined) {
    return <View testID={`${testID}-loading`} />;
  }

  const visible = searchTransactions(transactions, search);

  if (visible.length === 0) {
    // A search term is a filter even though it never reaches `TxFilter`. Its
    // empty result is "the query missed", never "nothing was tracked".
    if (filtered || search.trim() !== "") {
      return (
        <EmptyState
          testID="ledger-empty-filtered"
          title={LEDGER_FILTERED_EMPTY_TITLE}
          body={LEDGER_FILTERED_EMPTY_BODY}
        />
      );
    }
    if (empty !== undefined) return <>{empty}</>;
    return <EmptyState testID="ledger-empty" title={LEDGER_EMPTY_TITLE} body={LEDGER_EMPTY_BODY} />;
  }

  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const walletsById = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  const groups = groupByDay(visible);

  return (
    <View testID={testID}>
      {groups.map((group) => (
        <View key={group.date}>
          <DayGroupHeader date={group.date} net={group.net} now={now} />
          {group.transactions.map((transaction) => (
            <TransactionRow
              key={transaction.id}
              transaction={transaction}
              category={categoriesById.get(transaction.categoryId)}
              wallet={walletsById.get(transaction.walletId)}
            />
          ))}
        </View>
      ))}
      <HistoryBoundaryRow />
    </View>
  );
}

/**
 * The free tier's end-of-history row (rule 5; docs/05-monetization.md §3.2:
 * "older records exist, are safe, and unlock with Plus").
 *
 * THREE THINGS IT DOES DELIBERATELY.
 *
 *   IT READS `historyWindowDays()`, never a literal 90. `lib/entitlements.ts` is
 *   the only place in the app that knows about tiers, and the window is stated
 *   in one place so the row cannot promise a boundary the repository does not
 *   enforce (`listTransactions` clamps to the same function).
 *
 *   IT SAYS THE DATA IS STILL SAVED. The gate hides, it never deletes
 *   (docs/05 §3.3). A row that only advertised Plus would read as "your history
 *   was thrown away", which is both alarming and false.
 *
 *   IT RENDERS ONLY UNDER ROWS, never on an empty ledger.
 *   docs/06-information-architecture.md §5: empty states are "calm, not salesy
 *   — no upgrade prompts in any empty state". It is also nonsense to mark the
 *   end of a history that has not started.
 *
 * Not a `PlusGate`, and it opens no upgrade sheet: this is a BOUNDARY MARKER,
 * not a locked capability, and `PlusCapability` has no history row to show.
 */
function HistoryBoundaryRow() {
  const days = historyWindowDays();
  if (days === null) return null;

  return (
    <View className="px-4 pb-4 pt-2">
      <Card variant="flat">
        <View testID="ledger-history-cutoff" className="gap-1">
          <Text className="text-base font-semibold text-fg dark:text-fg-dark">
            See your full history with Plus
          </Text>
          <Text className="text-sm text-fg-2 dark:text-fg-2-dark">
            {`Free shows the last ${days} days. Anything older is still saved — Plus makes it visible again.`}
          </Text>
        </View>
      </Card>
    </View>
  );
}
