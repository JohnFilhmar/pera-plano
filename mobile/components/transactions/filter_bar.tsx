// components/transactions/filter_bar.tsx — m1c plan Task 6, rule 4; restyled by
// task-4-brief.md (mobile UI revamp Part 2, Task 4).
//
// task-4-brief.md Step 3 replaced this bar's controls wholesale. The old bar
// offered direction chips, two date-range presets, and a second row of
// removable "active filter" chips; the new one is a single horizontally
// scrolling row: All, an optional Review shortcut, one chip per wallet, one
// chip per category. `TxFilter` (interface-contract §3: `walletId, categoryId,
// from, to, direction, excludeTransferLinked`) still carries every one of
// those fields for `listTransactions` — nothing was removed from the
// repository's filtering capability, only from what this particular bar
// exposes a control for.
//
// EVERY CHANGE STILL MERGES INTO THE FILTER, NEVER REPLACES IT. Picking a
// category while a wallet is selected has to narrow to the intersection — a
// bar that emitted `{ categoryId }` instead of `{ walletId, categoryId }`
// would WIDEN the list at the exact moment the user asked for something
// narrower, with nothing on screen saying the wallet had been dropped. This
// is the one property the restyle must not spend for a nicer chip row.
//
// A SELECTED CHIP IS ITS OWN REMOVAL AFFORDANCE. There is no second "active
// filters" row any more, so pressing an already-selected wallet or category
// chip is the only way to clear that filter — see `toggled` below.
//
// THE REVIEW CHIP IS A SHORTCUT, NOT A FILTER. It never touches `value`; it
// only calls `onOpenReview`. Folding it into `TxFilter` would imply the
// ledger itself could be narrowed to "awaiting review" rows, which is not a
// thing a committed Transaction ever is (review_queue_entry.tsx's header:
// review-queue items are never smuggled into the ledger).
//
// PRESENTATIONAL: wallets, categories, the current filter and the review
// count all arrive as props (Global Constraints: no repository import inside
// a component). `FilterBar` still has no search field of its own — `search`
// stays a separate prop, matched client-side in ledger_list.tsx.
import { Search } from "lucide-react-native";
import { ScrollView, TextInput, View } from "react-native";

import { registerIcon } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import type { Category, EpochMs, TxFilter, Wallet } from "@/types/domain";

const SearchGlyph = registerIcon(Search);

/**
 * Set the value, or clear it when it is already the selected one.
 *
 * Drops the key entirely rather than setting it to `undefined` — an
 * `undefined` member still changes the React Query key's structural hash, so
 * a "cleared" filter that still carried `walletId: undefined` would read as a
 * different cache entry than one that never had the field at all.
 */
function toggled<K extends keyof TxFilter>(
  filter: TxFilter,
  key: K,
  value: NonNullable<TxFilter[K]>,
): TxFilter {
  if (filter[key] === value) {
    const next: TxFilter = { ...filter };
    delete next[key];
    return next;
  }
  return { ...filter, [key]: value };
}

export type FilterBarProps = {
  value: TxFilter;
  onChange: (next: TxFilter) => void;
  /** Free text. NOT part of `TxFilter` — see the file header. */
  search: string;
  onSearchChange: (next: string) => void;
  wallets?: readonly Wallet[];
  categories?: readonly Category[];
  /**
   * The open Review Queue count, for the "Review N" shortcut chip.
   * `app/(tabs)/transactions.tsx` already holds this from its own
   * `useReviewCount()` — see that screen's header comment on why a second
   * subscription in here would be one too many. `undefined` (still loading)
   * and `0` (queue clear) both render no chip, the same rule
   * `review_queue_entry.tsx`'s banner uses right above this bar.
   */
  reviewCount?: number;
  /** Opens the Review Queue. The chip renders inert (no press handler) if this is left off while `reviewCount` is somehow positive. */
  onOpenReview?: () => void;
  now?: EpochMs;
  testID?: string;
};

export function FilterBar({
  value,
  onChange,
  search,
  onSearchChange,
  wallets = [],
  categories = [],
  reviewCount,
  onOpenReview,
  testID = "filter-bar",
}: FilterBarProps) {
  // Archived wallets are hidden from the Wallets tab by default; offering one
  // here would resurrect it in a picker with nothing to explain where it came
  // from. Its rows stay in the ledger either way — this hides a CONTROL, never
  // data.
  const selectableWallets = wallets.filter((wallet) => !wallet.isArchived);
  const allSelected = Object.keys(value).length === 0;

  return (
    <View testID={testID} className="border-b border-fg-2 pb-2 dark:border-fg-2-dark">
      <View className="px-4 pt-3">
        <View className="min-h-[44px] flex-row items-center gap-2 rounded-full bg-chip px-4 dark:bg-chip-dark">
          <SearchGlyph size={16} className="text-fg-2 dark:text-fg-2-dark" />
          <TextInput
            testID="filter-search"
            value={search}
            onChangeText={onSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
            // The placeholder states the SCOPE. A bare "Search" invites the
            // user to type a category or an amount and read the empty result
            // as "I never spent that".
            placeholder="Search merchant or note"
            accessibilityLabel="Search transactions by merchant or note"
            className="flex-1 text-fg dark:text-fg-dark"
          />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-2"
        contentContainerClassName="gap-2 px-4"
      >
        <Chip
          testID="filter-chip-all"
          label="All"
          tone={allSelected ? "brand" : "neutral"}
          fill={allSelected ? "solid" : "outline"}
          selected={allSelected}
          onPress={() => onChange({})}
        />
        {reviewCount !== undefined && reviewCount > 0 ? (
          <Chip
            testID="filter-chip-review"
            label={`Review ${reviewCount}`}
            tone="danger"
            fill="soft"
            onPress={onOpenReview}
          />
        ) : null}
        {selectableWallets.map((wallet) => (
          <Chip
            key={wallet.id}
            testID={`filter-chip-wallet-${wallet.id}`}
            label={wallet.name}
            // `brand`/`neutral` here (not the plain `neutral` task-4-brief.md
            // names) so a selected chip reads as MORE prominent than an
            // unselected one. Chip's `neutral` + `solid` paints
            // `bg-bg`/`bg-bg-dark` — the screen's own background colour — by
            // design (chip.tsx: "leaves solid grey reserved for `soon`
            // alone"), which is invisible against this bar's own `bg-bg`
            // ground. A literal `tone="neutral"` selected chip would look
            // LESS filled than its unselected `outline` sibling, the exact
            // opposite of what "selected" has to communicate. `brand`/
            // `neutral` is the same pairing the All chip above already uses.
            tone={value.walletId === wallet.id ? "brand" : "neutral"}
            fill={value.walletId === wallet.id ? "solid" : "outline"}
            selected={value.walletId === wallet.id}
            onPress={() => onChange(toggled(value, "walletId", wallet.id))}
          />
        ))}
        {categories.map((category) => (
          <Chip
            key={category.id}
            testID={`filter-chip-category-${category.id}`}
            label={category.name}
            tone={value.categoryId === category.id ? "brand" : "neutral"}
            fill={value.categoryId === category.id ? "solid" : "outline"}
            selected={value.categoryId === category.id}
            onPress={() => onChange(toggled(value, "categoryId", category.id))}
          />
        ))}
      </ScrollView>
    </View>
  );
}
