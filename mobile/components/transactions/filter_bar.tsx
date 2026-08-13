// components/transactions/filter_bar.tsx — m1c plan Task 6, rule 4.
//
// Wallet, category, date range and direction — plus free-text search — and
// "filters compose (AND) and are reflected in the list header as removable
// chips".
//
// TWO PROPERTIES DECIDE WHETHER THIS BAR IS TRUSTWORTHY.
//
//   EVERY CHANGE MERGES INTO THE FILTER, NEVER REPLACES IT. Picking a category
//   while a wallet is selected has to narrow to the intersection. A bar that
//   emitted `{ categoryId }` instead of `{ walletId, categoryId }` would WIDEN
//   the list at the exact moment the user asked for something narrower, and
//   nothing on screen would say the wallet had been dropped.
//
//   REMOVING ONE CHIP REMOVES ONE FILTER. A chip whose tap resets the bar throws
//   away choices the user made deliberately and never asked to undo.
//
// `TxFilter` IS INTERFACE-CONTRACT §3 AND IS LAW: `walletId, categoryId, from,
// to, direction, excludeTransferLinked`. It has NO search field, so `search` is
// a separate prop here and the matching it drives happens client-side in
// ledger_list.tsx — see `searchTransactions` for the liability that carries and
// what will break it.
//
// PRESENTATIONAL: wallets, categories, the current filter and the clock all
// arrive as props (Global Constraints: no repository import inside a component).
import { ScrollView, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import type { Category, EpochMs, TxDirection, TxFilter, Wallet } from "@/types/domain";

/** Plain words, not the schema's `in`/`out`. Nobody filters for "out". */
const DIRECTION_LABELS: Record<TxDirection, string> = {
  in: "Money in",
  out: "Money out",
};

export type DateRangePreset = {
  id: string;
  label: string;
  /** Inclusive of today: 7 means today and the six days before it. */
  days: number;
};

/**
 * Preset windows instead of a date picker.
 *
 * A two-ended calendar picker is a whole flow of its own (and a native
 * dependency this milestone does not carry). Two presets cover the question
 * people actually ask a ledger — "what have I spent lately?" — and both compose
 * with every other filter, which a picker would too. A custom range set some
 * other way still renders as a removable chip, so nothing is stranded.
 */
export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
];

/**
 * The preset's `from` bound: MIDNIGHT LOCAL, `days - 1` days back.
 *
 * Midnight because `listTransactions` compares `occurred_at >= from`, and a
 * `from` of "now minus seven days" would silently drop this morning's
 * transactions from a window the user asked to include today in. Local because
 * the ledger groups by the local calendar day — a UTC boundary would put the
 * chip and the day headers on different days for every user in the Philippines.
 */
export function presetFrom(preset: DateRangePreset, now: EpochMs): EpochMs {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (preset.days - 1));
  return start.getTime();
}

/** Drops keys entirely rather than setting them to `undefined` — an
 * `undefined` member still changes the React Query key's structural hash. */
function without(filter: TxFilter, keys: readonly (keyof TxFilter)[]): TxFilter {
  const next: TxFilter = { ...filter };
  for (const key of keys) delete next[key];
  return next;
}

/** Set the value, or clear it when it is already the selected one. */
function toggled<K extends keyof TxFilter>(
  filter: TxFilter,
  key: K,
  value: NonNullable<TxFilter[K]>,
): TxFilter {
  if (filter[key] === value) return without(filter, [key]);
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
  now = Date.now(),
  testID = "filter-bar",
}: FilterBarProps) {
  // Archived wallets are hidden from the Wallets tab by default; offering one
  // here would resurrect it in a picker with nothing to explain where it came
  // from. Its rows stay in the ledger either way — this hides a CONTROL, never
  // data.
  const selectableWallets = wallets.filter((wallet) => !wallet.isArchived);

  const activeRangePreset = DATE_RANGE_PRESETS.find(
    (preset) => value.to === undefined && value.from === presetFrom(preset, now),
  );
  const hasRange = value.from !== undefined || value.to !== undefined;

  /** One entry per active filter, each removing only itself. */
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (value.walletId !== undefined) {
    const wallet = wallets.find((candidate) => candidate.id === value.walletId);
    chips.push({
      key: "walletId",
      label: wallet?.name ?? "Wallet",
      clear: () => onChange(without(value, ["walletId"])),
    });
  }
  if (value.categoryId !== undefined) {
    const category = categories.find((candidate) => candidate.id === value.categoryId);
    chips.push({
      key: "categoryId",
      label: category?.name ?? "Category",
      clear: () => onChange(without(value, ["categoryId"])),
    });
  }
  if (value.direction !== undefined) {
    chips.push({
      key: "direction",
      label: DIRECTION_LABELS[value.direction],
      clear: () => onChange(without(value, ["direction"])),
    });
  }
  if (hasRange) {
    chips.push({
      key: "range",
      label: activeRangePreset?.label ?? "Custom range",
      // BOTH ends. Clearing `from` alone leaves the list clamped by a `to` with
      // no chip on screen to explain why.
      clear: () => onChange(without(value, ["from", "to"])),
    });
  }

  const searchActive = search.trim() !== "";
  const anythingActive = chips.length > 0 || searchActive;

  // The divider is a hairline in `fg-2`, the same token matcher_picker's input
  // border uses. Deliberately not a `/20` opacity modifier: nothing else in the
  // app uses one, and a divider is not worth being the first place NativeWind's
  // handling of them gets exercised.
  return (
    <View testID={testID} className="border-b border-fg-2 pb-2 dark:border-fg-2-dark">
      <View className="px-4 pt-3">
        <TextInput
          testID="filter-search"
          value={search}
          onChangeText={onSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
          // The placeholder states the SCOPE. A bare "Search" invites the user
          // to type a category or an amount and read the empty result as
          // "I never spent that".
          placeholder="Search merchant or note"
          accessibilityLabel="Search transactions by merchant or note"
          className="rounded-lg border border-fg-2 px-3 py-2 text-fg dark:border-fg-2-dark dark:text-fg-dark"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-2"
        contentContainerClassName="gap-2 px-4"
      >
        {(Object.keys(DIRECTION_LABELS) as TxDirection[]).map((direction) => (
          <Chip
            key={direction}
            testID={`filter-direction-${direction}`}
            label={DIRECTION_LABELS[direction]}
            tone={value.direction === direction ? "brand" : "neutral"}
            onPress={() => onChange(toggled(value, "direction", direction))}
          />
        ))}
        {DATE_RANGE_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            testID={`filter-range-${preset.id}`}
            label={preset.label}
            tone={activeRangePreset?.id === preset.id ? "brand" : "neutral"}
            onPress={() =>
              onChange(
                activeRangePreset?.id === preset.id
                  ? without(value, ["from", "to"])
                  : { ...without(value, ["to"]), from: presetFrom(preset, now) },
              )
            }
          />
        ))}
        {selectableWallets.map((wallet) => (
          <Chip
            key={wallet.id}
            testID={`filter-wallet-${wallet.id}`}
            label={wallet.name}
            tone={value.walletId === wallet.id ? "brand" : "neutral"}
            onPress={() => onChange(toggled(value, "walletId", wallet.id))}
          />
        ))}
        {categories.map((category) => (
          <Chip
            key={category.id}
            testID={`filter-category-${category.id}`}
            label={category.name}
            tone={value.categoryId === category.id ? "brand" : "neutral"}
            onPress={() => onChange(toggled(value, "categoryId", category.id))}
          />
        ))}
      </ScrollView>

      {anythingActive ? (
        <View testID="filter-active" className="mt-2 flex-row flex-wrap items-center gap-2 px-4">
          <Text className="text-xs text-fg-2 dark:text-fg-2-dark">Showing</Text>
          {chips.map((chip) => (
            <Chip
              key={chip.key}
              testID={`filter-chip-${chip.key}`}
              // The multiplication sign, not a lowercase x: it is the glyph
              // every platform's "remove" affordance uses.
              label={`${chip.label} ✕`}
              tone="brand"
              onPress={chip.clear}
            />
          ))}
          <Button
            testID="filter-clear-all"
            title="Clear all"
            variant="ghost"
            onPress={() => {
              onChange({});
              // Search lives outside TxFilter, so "clear all" has to clear it
              // separately — otherwise the bar empties while the list stays
              // narrowed by a term nothing on screen still shows.
              onSearchChange("");
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
