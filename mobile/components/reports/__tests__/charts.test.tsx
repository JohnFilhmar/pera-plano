// components/reports/__tests__/charts.test.tsx — M3b Task 3, rules 1-5.
//
// Pure prop-driven rendering: every figure here is a fixture, not a database
// read — lib/reports/aggregate.ts's own tests already pin the arithmetic that
// produces CategoryTotal/MerchantTotal/TrendPoint/PeriodSummary. This file is
// about what the CHARTS do with numbers they are handed: draw the right
// shapes, color deterministically, order correctly, and gate the right row.
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { __setTierForTests } from "@/lib/entitlements";
import type {
  CategoryTotal,
  MerchantTotal,
  PeriodSummary,
  TrendPoint,
} from "@/lib/reports/aggregate";
import type { AvailableScopes, ReportScope } from "@/lib/reports/reports_service";

import { categoryColor, DonutChart } from "../donut_chart";
import { RangePicker } from "../range_picker";
import { RankedBars } from "../ranked_bars";
import { SummaryTiles } from "../summary_tiles";
import { TrendLine } from "../trend_line";

function withTheme(ui: ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  __setTierForTests(null);
});

// ---------------------------------------------------------------------------
// DonutChart — rules 2 and 3
// ---------------------------------------------------------------------------
const CATEGORIES: CategoryTotal[] = [
  { categoryId: "cat-food", categoryName: "Food & Dining", total: 300000, share: 0.6 },
  { categoryId: "cat-transport", categoryName: "Transport", total: 200000, share: 0.4 },
];

test("THE DONUT RENDERS ONE ARC PER CATEGORY AND A LEGEND WITH VALUES", () => {
  withTheme(<DonutChart categories={CATEGORIES} />);

  for (const category of CATEGORIES) {
    screen.getByTestId(`donut-arc-${category.categoryId}`);
    screen.getByTestId(`donut-legend-${category.categoryId}`);
    screen.getByText(category.categoryName);
  }
  // Rule 3: the legend carries the actual pesos, not just a shape — a
  // screen reader gets exactly what a sighted user reads off the ring.
  screen.getByText("₱3,000.00");
  screen.getByText("₱2,000.00");
});

test("CATEGORY COLORS ARE STABLE ACROSS RENDERS FOR THE SAME ID", () => {
  // Rule 2: same id, same color, every time — hashed from the id itself, not
  // from array position or object/Map iteration order, either of which would
  // reshuffle the moment a category is added.
  const first = categoryColor("cat-food", false);
  const second = categoryColor("cat-food", false);
  expect(first).toBe(second);

  // And the component itself draws the same id the same color across two
  // independent renders — not just the pure function in isolation.
  // react-native-svg normalizes `stroke` into its own internal color object
  // rather than keeping the hex string verbatim (the same normalization
  // components/goals/__tests__/goal_card.test.tsx documents for
  // `strokeDasharray`), so this compares two renders to each other rather
  // than to the raw hex from `categoryColor`.
  const renderA = withTheme(<DonutChart categories={CATEGORIES} />);
  const strokeA = renderA.getByTestId("donut-arc-cat-food").props.stroke;
  renderA.unmount();

  const renderB = withTheme(<DonutChart categories={CATEGORIES} />);
  const strokeB = renderB.getByTestId("donut-arc-cat-food").props.stroke;
  renderB.unmount();

  expect(strokeA).toEqual(strokeB);
});

// ---------------------------------------------------------------------------
// RankedBars — rule 1
// ---------------------------------------------------------------------------
test("RANKED BARS ORDER BY TOTAL DESCENDING", () => {
  const merchants: MerchantTotal[] = [
    { merchant: "Grab", total: 20000, count: 2 },
    { merchant: "Jollibee", total: 80000, count: 5 },
    { merchant: "7-Eleven", total: 50000, count: 3 },
  ];

  withTheme(<RankedBars merchants={merchants} />);

  const bars = screen.getAllByTestId(/^ranked-bar-/);
  expect(bars.map((bar) => bar.props.testID)).toEqual([
    "ranked-bar-Jollibee",
    "ranked-bar-7-Eleven",
    "ranked-bar-Grab",
  ]);
});

// ---------------------------------------------------------------------------
// TrendLine — rule 1
// ---------------------------------------------------------------------------
test("THE TREND LINE RENDERS ONE POINT PER PERIOD", () => {
  const points: TrendPoint[] = [
    { label: "2026-03-01", range: { from: "2026-03-01", to: "2026-03-31" }, spend: 100000, income: 150000 },
    { label: "2026-04-01", range: { from: "2026-04-01", to: "2026-04-30" }, spend: 200000, income: 150000 },
    { label: "2026-05-01", range: { from: "2026-05-01", to: "2026-05-31" }, spend: 50000, income: 150000 },
  ];

  withTheme(<TrendLine points={points} />);

  expect(screen.getAllByTestId(/^trend-point-/)).toHaveLength(points.length);
  expect(screen.getAllByTestId(/^trend-legend-/)).toHaveLength(points.length);
});

test("fewer than two periods shows an explanation instead of a broken line", () => {
  withTheme(<TrendLine points={[{ label: "2026-03-01", range: { from: "2026-03-01", to: "2026-03-31" }, spend: 100000, income: 0 }]} />);

  expect(screen.queryByTestId("trend-path")).toBeNull();
  screen.getByText("Not enough periods yet to show a trend.");
});

// ---------------------------------------------------------------------------
// SummaryTiles — rule 4
// ---------------------------------------------------------------------------
function summaryOf(over: Partial<PeriodSummary> = {}): PeriodSummary {
  return {
    range: { from: "2026-08-01", to: "2026-08-31" },
    spend: 500000,
    income: 800000,
    net: 300000,
    transactionCount: 12,
    ...over,
  };
}

test("SUMMARY TILES COLOR NET BY SIGN", () => {
  const positive = withTheme(<SummaryTiles summary={summaryOf({ net: 300000 })} />);
  expect(positive.getByTestId("summary-net").props.className).toMatch(/text-brand/);
  positive.unmount();

  const negative = withTheme(<SummaryTiles summary={summaryOf({ net: -150000 })} />);
  expect(negative.getByTestId("summary-net").props.className).toMatch(/text-danger/);
  negative.unmount();
});

// ---------------------------------------------------------------------------
// RangePicker — rule 5
// ---------------------------------------------------------------------------
const FREE_SCOPES: AvailableScopes = { months: ["2026-08"], customAllowed: false };
const PLUS_SCOPES: AvailableScopes = { months: ["2026-06", "2026-07", "2026-08"], customAllowed: true };
const MONTH_SCOPE: ReportScope = { kind: "month", month: "2026-08" };

test("THE RANGE PICKER SHOWS THE PLUS ROW ON FREE", () => {
  __setTierForTests("free");

  withTheme(
    <RangePicker
      scope={MONTH_SCOPE}
      availableScopes={FREE_SCOPES}
      onSelectMonth={jest.fn()}
      onSelectCustom={jest.fn()}
    />,
  );

  screen.getByTestId("range-picker-current-month");
  // PlusGate's own testIDs — this component asks lib/entitlements.ts nothing
  // itself; it just wraps the row and lets PlusGate decide.
  screen.getByTestId("plus-gate");
  screen.getByTestId("plus-badge");
  // Free has nothing to page through — no month pills at all.
  expect(screen.queryByTestId("range-picker-months")).toBeNull();
});

test("THE RANGE PICKER OFFERS CUSTOM ON PLUS", () => {
  __setTierForTests("plus");
  const onSelectCustom = jest.fn();

  withTheme(
    <RangePicker
      scope={MONTH_SCOPE}
      availableScopes={PLUS_SCOPES}
      onSelectMonth={jest.fn()}
      onSelectCustom={onSelectCustom}
    />,
  );

  expect(screen.queryByTestId("plus-badge")).toBeNull();
  screen.getByTestId("range-picker-months");

  fireEvent.press(screen.getByTestId("range-picker-custom-toggle"));
  fireEvent.changeText(screen.getByTestId("range-picker-custom-from"), "2026-07-01");
  fireEvent.changeText(screen.getByTestId("range-picker-custom-to"), "2026-07-15");
  fireEvent.press(screen.getByTestId("range-picker-custom-apply"));

  expect(onSelectCustom).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-07-15" });
});
