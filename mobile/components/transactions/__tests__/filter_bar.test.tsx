// components/transactions/__tests__/filter_bar.test.tsx — m1c plan Task 6,
// rule 4; rewritten for task-4-brief.md's chip-row restyle (mobile UI revamp
// Part 2, Task 4).
//
// NOT IN TASK 4'S LISTED FILE SET, REWRITTEN ANYWAY. task-4-brief.md Step 3
// replaced filter_bar.tsx's controls wholesale (direction chips, two
// date-range presets, and a whole second row of removable "active filter"
// chips are gone, replaced by one row: All, a Review shortcut, wallet chips,
// category chips) but only listed `app/__tests__/transactions_screen.test.tsx`
// as a test file to update. This file's old assertions pinned exactly the
// controls Step 3 retires — `filter-direction-in`, `filter-range-7d`,
// `filter-chip-walletId`, `filter-clear-all`, and the `DATE_RANGE_PRESETS` /
// `presetFrom` exports among them — and Task 4's own required verification
// command runs this whole directory. Leaving it as-is would mean either the
// restyle doesn't ship or this file fails outright; see task-4-report.md for
// the full account. `DATE_RANGE_PRESETS` and `presetFrom` had no importer
// outside this pair of files (checked before deleting them), so nothing else
// in the app depends on what this rewrite removes.
//
// THE TWO RULES THAT STILL MATTER, UNCHANGED BY THE RESTYLE:
//
//   FILTERS COMPOSE. Picking a wallet and then a category must narrow to the
//   intersection, never replace one choice with the other.
//
//   A SELECTED CONTROL TOGGLES OFF. There is no separate removal affordance in
//   the new design, so pressing an already-selected wallet or category chip is
//   the only way to clear that filter.
//
// PRESENTATIONAL: the wallets, the categories, the current filter and the
// review count all arrive as props. `TxFilter` is interface-contract §3 and is
// LAW — it has no search field, which is why `search` is a separate prop here.
import { fireEvent, render, screen } from "@testing-library/react-native";

import type { Category, TxFilter, Wallet } from "@/types/domain";

import { FilterBar } from "../filter_bar";

const WALLETS: Wallet[] = [
  {
    id: "w1",
    name: "GCash",
    balance: 100_000,
    currency: "PHP",
    isArchived: false,
    driftDismissedTransactionId: null,
    owedBalance: false,
    owedPinned: false,
    matcherCount: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  {
    id: "w2",
    name: "BPI",
    balance: 500_000,
    currency: "PHP",
    isArchived: false,
    driftDismissedTransactionId: null,
    owedBalance: false,
    owedPinned: false,
    matcherCount: 1,
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

/**
 * Space-separated `className` tokens, exact, never a raw substring.
 *
 * `toContain` on the unsplit string would let a check meant for `bg-brand`
 * pass against `bg-brand-dark` — the same trap task-4-brief.md calls out for
 * `text-brand`/`text-brand-ink` and `bg-danger`/`bg-danger-dark`.
 */
function classesOf(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? "").split(/\s+/);
}

function renderBar(
  value: TxFilter = {},
  search = "",
  extra: { reviewCount?: number; onOpenReview?: () => void } = {},
) {
  const onChange = jest.fn();
  const onSearchChange = jest.fn();
  const onOpenReview = extra.onOpenReview ?? jest.fn();
  render(
    <FilterBar
      value={value}
      onChange={onChange}
      search={search}
      onSearchChange={onSearchChange}
      wallets={WALLETS}
      categories={CATEGORIES}
      reviewCount={extra.reviewCount}
      onOpenReview={onOpenReview}
    />,
  );
  return { onChange, onSearchChange, onOpenReview };
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

    fireEvent.press(screen.getByTestId("filter-chip-category-cat_food_dining"));

    expect(onChange).toHaveBeenCalledWith({ walletId: "w1", categoryId: "cat_food_dining" });
  });

  test("picking a different wallet REPLACES the wallet, it does not add a second", () => {
    // TxFilter (contract §3) holds one walletId. Two wallets at once is not a
    // filter this repository can express, and pretending otherwise would show a
    // chip the query does not honour.
    const { onChange } = renderBar({ walletId: "w1" });

    fireEvent.press(screen.getByTestId("filter-chip-wallet-w2"));

    expect(onChange).toHaveBeenCalledWith({ walletId: "w2" });
  });

  test("tapping an already-selected wallet chip toggles it OFF", () => {
    const { onChange } = renderBar({ walletId: "w1", categoryId: "cat_food_dining" });

    fireEvent.press(screen.getByTestId("filter-chip-wallet-w1"));

    expect(onChange).toHaveBeenCalledWith({ categoryId: "cat_food_dining" });
  });

  test("tapping an already-selected category chip toggles it OFF, keeping the wallet", () => {
    const { onChange } = renderBar({ walletId: "w1", categoryId: "cat_food_dining" });

    fireEvent.press(screen.getByTestId("filter-chip-category-cat_food_dining"));

    expect(onChange).toHaveBeenCalledWith({ walletId: "w1" });
  });
});

// ---------------------------------------------------------------------------
// The All chip
// ---------------------------------------------------------------------------

describe("the All chip", () => {
  test("reads as selected when nothing is filtered", () => {
    renderBar({});
    expect(classesOf("filter-chip-all")).toContain("bg-brand");
  });

  test("reads as unselected the moment any filter is active", () => {
    renderBar({ walletId: "w1" });
    expect(classesOf("filter-chip-all")).not.toContain("bg-brand");
  });

  test("pressing it clears every filter", () => {
    const { onChange } = renderBar({ walletId: "w1", categoryId: "cat_food_dining" });

    fireEvent.press(screen.getByTestId("filter-chip-all"));

    expect(onChange).toHaveBeenCalledWith({});
  });
});

// ---------------------------------------------------------------------------
// The Review chip — a route, not a filter
// ---------------------------------------------------------------------------

describe("the Review chip", () => {
  test("is absent while the queue is empty", () => {
    renderBar({}, "", { reviewCount: 0 });
    expect(screen.queryByTestId("filter-chip-review")).toBeNull();
  });

  test("is absent while the count is still loading", () => {
    renderBar({}, "", { reviewCount: undefined });
    expect(screen.queryByTestId("filter-chip-review")).toBeNull();
  });

  test("names the open count", () => {
    renderBar({}, "", { reviewCount: 5 });
    expect(screen.getByTestId("filter-chip-review")).toHaveTextContent("Review 5");
  });

  test("opens the queue and never touches the filter itself", () => {
    const { onChange, onOpenReview } = renderBar({ walletId: "w1" }, "", { reviewCount: 2 });

    fireEvent.press(screen.getByTestId("filter-chip-review"));

    expect(onOpenReview).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The search field
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
// The wallet and category chips
// ---------------------------------------------------------------------------

describe("the wallet and category chips", () => {
  test("offers one chip per wallet and one per category", () => {
    renderBar();

    expect(screen.getByTestId("filter-chip-wallet-w1")).toBeTruthy();
    expect(screen.getByTestId("filter-chip-wallet-w2")).toBeTruthy();
    expect(screen.getByTestId("filter-chip-category-cat_food_dining")).toBeTruthy();
    expect(screen.getByTestId("filter-chip-category-cat_transport")).toBeTruthy();
  });

  test("a selected wallet chip reads as filled, an unselected one as outlined", () => {
    renderBar({ walletId: "w1" });

    expect(classesOf("filter-chip-wallet-w1")).toContain("bg-brand");
    expect(classesOf("filter-chip-wallet-w2")).not.toContain("bg-brand");
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
      />,
    );

    expect(screen.queryByTestId("filter-chip-wallet-w3")).toBeNull();
  });
});
