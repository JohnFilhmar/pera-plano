// app/(tabs)/transactions.tsx — the Transactions tab, the ledger (m1c plan
// Task 6; docs/06-information-architecture.md §3.2).
//
// THIS IS THE SCREEN THE WHOLE PRODUCT EXISTS TO PRODUCE. The notification
// listener, the nine pipeline stages, the dedupe gate, the encryption — all of
// it is machinery for putting correct rows on this list. Everything the user
// will ever believe about their money, they believe because of what is rendered
// here.
//
// The screen itself is thin on purpose. It owns two pieces of state and nothing
// else; the rules live where they can be tested without a database:
//   components/transactions/ledger_list.tsx   grouping, day nets, empty states
//   components/transactions/transaction_row.tsx  the transfer-leg row state
//   components/transactions/filter_bar.tsx    filter composition
//
// THE TWO PIECES OF STATE ARE NOT THE SAME KIND OF THING, AND THAT IS THE ONE
// SUBTLETY WORTH KNOWING HERE:
//
//   `filter` is a `TxFilter` (interface-contract §3). It goes to the repository
//   and is part of the React Query key, so each combination is its own cache
//   entry.
//
//   `search` is NOT. The contract has no search field and the contract is LAW,
//   so free text is matched client-side over the rows already loaded. That is
//   correct only while `listTransactions` returns the whole tier-clamped window
//   in one read — see `searchTransactions` in ledger_list.tsx for exactly what
//   paginating that query would silently break.
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { ReviewQueueEntry } from "@/components/review/review_queue_entry";
import { FilterBar } from "@/components/transactions/filter_bar";
import { LedgerList } from "@/components/transactions/ledger_list";
import { useCategories } from "@/hooks/queries/use_categories";
import { useReviewCount } from "@/hooks/queries/use_review_count";
import { useTransactions } from "@/hooks/queries/use_transactions";
import { useWallets } from "@/hooks/queries/use_wallets";
import type { TxFilter } from "@/types/domain";

export default function TransactionsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<TxFilter>({});
  const [search, setSearch] = useState("");

  const { data: transactions } = useTransactions(filter);
  const { data: wallets } = useWallets();
  const { data: categories } = useCategories();
  const { data: reviewCount } = useReviewCount();

  // What tells the two empty states apart. `Object.keys` rather than a
  // hand-maintained list of fields: a filter added to `TxFilter` later would
  // otherwise leave the screen claiming nothing was ever tracked while that new
  // filter is the only thing hiding the rows.
  const filtered = Object.keys(filter).length > 0;

  return (
    <View testID="transactions-screen" className="flex-1 bg-bg dark:bg-bg-dark">
      {/* Outside the scroller, so the controls stay reachable however far down
          the ledger the user has scrolled. */}
      <FilterBar
        value={filter}
        onChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        wallets={wallets}
        categories={categories}
      />
      <ScrollView>
        <View className="pb-8">
          {/* The queue, at the top of this tab (spec §UX states) and ONLY when
              something is waiting. It sits above the ledger rather than inside
              it because the two are independent: a fresh install whose first
              captures all landed in the queue has nothing in the list and
              everything to triage, and a row rendered inside `LedgerList` would
              disappear at exactly that moment. */}
          <ReviewQueueEntry count={reviewCount} onPress={() => router.push("/review")} />
          <LedgerList
            transactions={transactions}
            wallets={wallets}
            categories={categories}
            search={search}
            filtered={filtered}
            // m1c Task 7: the rows open the detail screen. Task 6 left them
            // inert because this route did not exist yet.
            onSelect={(transaction) =>
              router.push({ pathname: "/transaction/[id]", params: { id: transaction.id } })
            }
          />
        </View>
      </ScrollView>
    </View>
  );
}
