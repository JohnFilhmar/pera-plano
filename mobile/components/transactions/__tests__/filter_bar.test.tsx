// components/transactions/__tests__/filter_bar.test.tsx — m1c plan Task 6, rule 4.
//
// "Filters compose (AND) and are reflected in the list header as removable
// chips." Two of the assertions below are the ones worth having:
//
//   FILTERS COMPOSE. Picking a wallet and then a category must narrow to the
//   intersection. A bar that drops the first choice when the second is made
//   WIDENS the list instead of narrowing it — the user asked two questions and
//   got the answer to one, with nothing on screen saying which.
//
//   CLEARING ONE CHIP CLEARS ONE FILTER. A chip whose X resets the whole bar
//   silently discards choices the user made deliberately and never asked to
//   undo.
//
// PRESENTATIONAL: the wallets, the categories, the current filter and the clock
// all arrive as props. `TxFilter` is interface-contract §3 and is LAW — note
// that it has NO search field, which is why `search` is a separate prop here
// and why the filtering it drives happens client-side in LedgerList.
import { fireEvent, render, screen } from "@testing-library/react-native";

import type { Category, TxFilter, Wallet } from "@/types/domain";

import { DATE_RANGE_PRESETS, FilterBar, presetFrom } from "../filter_bar";

const NOW = new Date(2026, 7, 13, 21, 0).getTime();

const WALLETS: Wallet[] = [
  {
    id: "w1",
    name: "GCash",
    type: "e-wallet",
    balance: 100_000,
    currency: "PHP",
    isArchived: false,
    driftDismissedTransactionId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  {
    id: "w2",
    name: "BPI",
    type: "bank",
    balance: 500_000,
    currency: "PHP",
    isArchived: false,
    driftDismissedTransactionId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
];

const CATEGORIES: Category[] = [
  {
    id: "cat_food_dining",
    name: "Food & Dining",
    parentId: null,
    icon: "utensils",
    isSystem: true,
    isHidden: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  {
    id: "cat_transport",
    name: "Transport",
    parentId: null,
    icon: "bus",
    isSystem: true,
    isHidden: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
];

function renderBar(value: TxFilter = {}, search = "") {
  const onChange = jest.fn();
  const onSearchChange = jest.fn();
  render(
    <FilterBar
      value={value}
      onChange={onChange}
      search={search}
      onSearchChange={onSearchChange}
      wallets={WALLETS}
      categories={CATEGORIES}
      now={NOW}
    />,
  );
  return { onChange, onSearchChange };
}

// ---------------------------------------------------------------------------
// Composition — the rule that decides whether a filter narrows or widens
// ---------------------------------------------------------------------------

describe("filters compose (AND)", () => {
  test("choosing a category while a wallet is already chosen KEEPS the wallet", () => {
    // The whole point. An implementation that replaces the filter object
    // instead of merging into it passes every single-filter test in this file
    // and fails only here.
    const { onChange } = renderBar({ walletId: "w1" });

    fireEvent.press(screen.getByTestId("filter-category-cat_food_dining"));

    expect(onChange).toHaveBeenCalledWith({ walletId: "w1", categoryId: "cat_food_dining" });
  });

  test("choosing a direction keeps both of the others", () => {
    const { onChange } = renderBar({ walletId: "w1", categoryId: "cat_food_dining" });

    fireEvent.press(screen.getByTestId("filter-direction-out"));

    expect(onChange).toHaveBeenCalledWith({
      walletId: "w1",
      categoryId: "cat_food_dining",
      direction: "out",
    });
  });

  test("a date range keeps everything else and sets `from`", () => {
    const { onChange } = renderBar({ walletId: "w1" });

    fireEvent.press(screen.getByTestId("filter-range-7d"));

    expect(onChange).toHaveBeenCalledWith({
      walletId: "w1",
      from: presetFrom(DATE_RANGE_PRESETS[0], NOW),
    });
  });

  test("picking a different wallet REPLACES the wallet, it does not add a second", () => {
    // TxFilter (contract §3) holds one walletId. Two wallets at once is not a
    // filter this repository can express, and pretending otherwise would show a
    // chip the query does not honour.
    const { onChange } = renderBar({ walletId: "w1" });

    fireEvent.press(screen.getByTestId("filter-wallet-w2"));

    expect(onChange).toHaveBeenCalledWith({ walletId: "w2" });
  });
});

// ---------------------------------------------------------------------------
// Removable chips
// ---------------------------------------------------------------------------

describe("the active-filter chips", () => {
  test("one chip per active filter, naming the choice in words", () => {
    renderBar({ walletId: "w1", categoryId: "cat_food_dining", direction: "out" });

    // Regexes: a chip label also carries its own remove affordance, and
    // `toHaveTextContent` matches a plain string exactly.
    expect(screen.getByTestId("filter-chip-walletId")).toHaveTextContent(/^GCash/);
    expect(screen.getByTestId("filter-chip-categoryId")).toHaveTextContent(/^Food & Dining/);
    expect(screen.getByTestId("filter-chip-direction")).toHaveTextContent(/^Money out/);
  });

  test("no active filters renders no chips at all", () => {
    renderBar({});

    expect(screen.queryByTestId("filter-chip-walletId")).toBeNull();
    expect(screen.queryByTestId("filter-active")).toBeNull();
  });

  test("clearing one chip removes THAT filter only", () => {
    // A chip whose X resets the bar discards choices the user never asked to
    // undo — and the list widens with no visible cause.
    const { onChange } = renderBar({
      walletId: "w1",
      categoryId: "cat_food_dining",
      direction: "out",
    });

    fireEvent.press(screen.getByTestId("filter-chip-categoryId"));

    expect(onChange).toHaveBeenCalledWith({ walletId: "w1", direction: "out" });
  });

  test("clearing the wallet chip leaves the category and the direction alone", () => {
    const { onChange } = renderBar({
      walletId: "w1",
      categoryId: "cat_food_dining",
      direction: "out",
    });

    fireEvent.press(screen.getByTestId("filter-chip-walletId"));

    expect(onChange).toHaveBeenCalledWith({ categoryId: "cat_food_dining", direction: "out" });
  });

  test("clearing the date-range chip drops BOTH ends of the window", () => {
    // `from` without `to` is a half-cleared range: the list would stay clamped
    // with no chip on screen explaining why.
    const { onChange } = renderBar({ walletId: "w1", from: 1_000, to: 2_000 });

    fireEvent.press(screen.getByTestId("filter-chip-range"));

    expect(onChange).toHaveBeenCalledWith({ walletId: "w1" });
  });

  test("tapping an already-selected control toggles it OFF", () => {
    const { onChange } = renderBar({ walletId: "w1", categoryId: "cat_food_dining" });

    fireEvent.press(screen.getByTestId("filter-wallet-w1"));

    expect(onChange).toHaveBeenCalledWith({ categoryId: "cat_food_dining" });
  });

  test("clear-all really does clear everything", () => {
    const { onChange, onSearchChange } = renderBar(
      { walletId: "w1", categoryId: "cat_food_dining", direction: "in", from: 1_000 },
      "jollibee",
    );

    fireEvent.press(screen.getByTestId("filter-clear-all"));

    expect(onChange).toHaveBeenCalledWith({});
    // Search is not part of TxFilter, so "clear all" has to clear it separately
    // or the list stays narrowed with an empty filter bar above it.
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  test("clear-all is offered only when something is active", () => {
    renderBar({});
    expect(screen.queryByTestId("filter-clear-all")).toBeNull();
  });

  test("a search term alone counts as active", () => {
    renderBar({}, "jollibee");
    expect(screen.getByTestId("filter-clear-all")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Search — a separate prop, because TxFilter has no field for it
// ---------------------------------------------------------------------------

describe("the search field", () => {
  test("reports what the user typed", () => {
    const { onSearchChange, onChange } = renderBar();

    fireEvent.changeText(screen.getByTestId("filter-search"), "jollibee");

    expect(onSearchChange).toHaveBeenCalledWith("jollibee");
    // And never leaks into the repository filter — contract §3 has no search
    // field and adding one would change a pinned interface.
    expect(onChange).not.toHaveBeenCalled();
  });

  test("shows the current term", () => {
    renderBar({}, "meralco");
    expect(screen.getByTestId("filter-search").props.value).toBe("meralco");
  });

  test("says plainly which fields it searches", () => {
    // A search box with no scope stated invites the user to search a category
    // or an amount and read the empty result as "I never spent that".
    renderBar();
    expect(screen.getByTestId("filter-search").props.placeholder).toMatch(/merchant/i);
    expect(screen.getByTestId("filter-search").props.placeholder).toMatch(/note/i);
  });
});

// ---------------------------------------------------------------------------
// The controls themselves
// ---------------------------------------------------------------------------

describe("the controls", () => {
  test("offers one chip per wallet and one per category", () => {
    renderBar();

    expect(screen.getByTestId("filter-wallet-w1")).toBeTruthy();
    expect(screen.getByTestId("filter-wallet-w2")).toBeTruthy();
    expect(screen.getByTestId("filter-category-cat_food_dining")).toBeTruthy();
    expect(screen.getByTestId("filter-category-cat_transport")).toBeTruthy();
  });

  test("offers both directions in plain words, not `in` and `out`", () => {
    renderBar();

    expect(screen.getByTestId("filter-direction-in")).toHaveTextContent("Money in");
    expect(screen.getByTestId("filter-direction-out")).toHaveTextContent("Money out");
  });

  test("a selected control reads as selected, not as an unpicked option", () => {
    renderBar({ walletId: "w1" });

    const selected = String(screen.getByTestId("filter-wallet-w1").props.className ?? "");
    const unselected = String(screen.getByTestId("filter-wallet-w2").props.className ?? "");
    expect(selected).not.toBe(unselected);
    expect(selected).toContain("bg-brand");
  });

  test("an archived wallet is not offered as a filter", () => {
    // Its rows are still in the ledger, but the Wallets tab hides it by
    // default; offering it here would resurrect it in a picker the user cannot
    // explain.
    render(
      <FilterBar
        value={{}}
        onChange={jest.fn()}
        search=""
        onSearchChange={jest.fn()}
        wallets={[...WALLETS, { ...WALLETS[0], id: "w3", name: "Old", isArchived: true }]}
        categories={CATEGORIES}
        now={NOW}
      />,
    );

    expect(screen.queryByTestId("filter-wallet-w3")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// presetFrom
// ---------------------------------------------------------------------------

describe("presetFrom", () => {
  test("starts at midnight LOCAL, so 'last 7 days' includes all of today", () => {
    const from = presetFrom(DATE_RANGE_PRESETS[0], NOW);
    const start = new Date(from);

    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    // 7 days INCLUSIVE of today: 13th back to the 7th, not to the 6th.
    expect(start.getDate()).toBe(7);
    expect(start.getMonth()).toBe(7);
  });

  test("30 days reaches back further than 7", () => {
    expect(presetFrom(DATE_RANGE_PRESETS[1], NOW)).toBeLessThan(
      presetFrom(DATE_RANGE_PRESETS[0], NOW),
    );
  });
});
