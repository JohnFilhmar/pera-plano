// components/reports/__tests__/charts.test.tsx — M3b Task 3, rules 1-5.
//
// Pure prop-driven rendering: every figure here is a fixture, not a database
// read — lib/reports/aggregate.ts's own tests already pin the arithmetic that
// produces CategoryTotal/MerchantTotal/TrendPoint/PeriodSummary. This file is
// about what the CHARTS do with numbers they are handed: draw the right
// shapes, color deterministically, order correctly, and gate the right row.
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { palette } from "@/constants/colors";
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

// RangePicker's custom range is two DateFields (numeric-input-system Task
// 14), and a DateField mounts the platform dialog. The bounds they hand it
// are asserted in range_picker.test.tsx; here the mock only has to make a day
// pickable so the custom-range flow below still reaches Apply.
let mockPickedDate = new Date(2026, 6, 1);

jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ onChange }: { onChange: (event: { type: string }, date?: Date) => void }) => (
      <Pressable testID="date-picker-pick" onPress={() => onChange({ type: "set" }, mockPickedDate)}>
        <Text>pick</Text>
      </Pressable>
    ),
  };
});

function withTheme(ui: ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

/** Opens a date field, mock-picks the given local day, and closes the dialog. */
function pickDate(testID: string, year: number, month: number, day: number): void {
  mockPickedDate = new Date(year, month - 1, day);
  fireEvent.press(screen.getByTestId(testID));
  fireEvent.press(screen.getByTestId("date-picker-pick"));
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

// A fixed, arbitrary set of distinct ids — large enough that a well-spread
// djb2-family hash (see donut_chart.tsx's own header) visits all 8 ramp
// slots. Fixed strings, not random ones, so this stays a deterministic,
// non-flaky assertion rather than a coin flip on rerun.
const SAMPLE_CATEGORY_IDS = Array.from({ length: 200 }, (_, index) => `sample-category-${index}`);

test("THE RAMP HAS ALL EIGHT CHART SLOTS REACHABLE, NOT THE OLD SIX-COLOUR CEILING", () => {
  // Owner-approved chart ramp (2026-08-16): `chart-1`..`chart-8` replaced
  // hashing into 6 borrowed semantic tokens, which left ~5 usable colors
  // against 15 seeded categories. 200 distinct ids sampled through the same
  // hash the component uses should land in every one of the 8 slots.
  const lightColors = new Set(SAMPLE_CATEGORY_IDS.map((id) => categoryColor(id, false)));
  const darkColors = new Set(SAMPLE_CATEGORY_IDS.map((id) => categoryColor(id, true)));
  expect(lightColors.size).toBe(8);
  expect(darkColors.size).toBe(8);
});

test("A CHART COLOUR IS NEVER ONE OF THE SEMANTIC TOKENS", () => {
  // Guards constants/colors.ts's own rule: the chart ramp is a SEPARATE
  // block from `brand`/`danger`/`warn`/`ph-*`, which each carry a status
  // meaning a chart slice must not borrow. If a future edit folds the two
  // groups back together (e.g. reusing `danger` as a chart slot again), this
  // fails.
  const semanticValues = new Set<string>([
    palette.brand,
    palette["brand-dark"],
    palette["brand-soft"],
    palette["brand-soft-dark"],
    palette.danger,
    palette["danger-dark"],
    palette.warn,
    palette["warn-dark"],
    palette["ph-blue"],
    palette["ph-blue-dark"],
    palette["ph-red"],
    palette["ph-red-dark"],
    palette["ph-yellow"],
    palette["ph-yellow-dark"],
  ]);

  for (const id of SAMPLE_CATEGORY_IDS) {
    expect(semanticValues.has(categoryColor(id, false))).toBe(false);
    expect(semanticValues.has(categoryColor(id, true))).toBe(false);
  }
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

  // `/^ranked-bar-/` also matches the `Nx` count Chip mobile-ui-revamp Part 3
  // Task 4 added beside each row (`ranked-bar-${merchant}-count`) and that
  // Chip's own internal label (`...-count-label`, from components/ui/chip.tsx's
  // `${testID}-label`) — both share the row's prefix. Filtering those two
  // suffixes out keeps this assertion about row order, not about how many
  // testIDs a row happens to contain.
  const bars = screen
    .getAllByTestId(/^ranked-bar-/)
    .filter((bar) => !/-count(-label)?$/.test(bar.props.testID));
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

// The negative half of this used to query `trend-path`, an id NO COMPONENT HAS
// EVER EMITTED — a leftover from the SVG polyline this chart replaced with
// bars. `queryByTestId` on an id that cannot exist returns null against every
// possible implementation, so the assertion was true even of a TrendLine that
// drew a full chart off one point. The ids asserted now are the ones the
// passing test directly above proves the component really renders, which is
// what makes their absence here mean something.
test("fewer than two periods shows an explanation instead of a broken line", () => {
  withTheme(<TrendLine points={[{ label: "2026-03-01", range: { from: "2026-03-01", to: "2026-03-31" }, spend: 100000, income: 0 }]} />);

  expect(screen.queryAllByTestId(/^trend-point-/)).toHaveLength(0);
  expect(screen.queryAllByTestId(/^trend-legend-/)).toHaveLength(0);
  expect(screen.queryByTestId("trend-legend")).toBeNull();
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
  // `summary-net` is now StatTile's OUTER `flex-1` wrapper (components/ui/
  // stat_tile.tsx) — the tone class lives one level deeper, on
  // `summary-net-amount`, which is where StatTile itself paints
  // `TONE_CLASS[tone]`. Split on whitespace and check for the exact token,
  // not `toMatch`/`toContain` on the raw string — `text-brand` as a substring
  // would also match a hypothetical `text-brand-ink`, the same trap this
  // project's own house rules warn about elsewhere.
  const positive = withTheme(<SummaryTiles summary={summaryOf({ net: 300000 })} />);
  const positiveClasses = positive.getByTestId("summary-net-amount").props.className.split(/\s+/);
  expect(positiveClasses).toContain("text-brand");
  positive.unmount();

  const negative = withTheme(<SummaryTiles summary={summaryOf({ net: -150000 })} />);
  const negativeClasses = negative.getByTestId("summary-net-amount").props.className.split(/\s+/);
  expect(negativeClasses).toContain("text-danger");
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
  // Free has nothing to pick between — no period field to open a sheet with.
  expect(screen.queryByTestId("range-picker-month-trigger")).toBeNull();
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

  // Unlocked, not gated: the informational badge shows, but nothing
  // intercepts the press the way the free-tier `plus-gate` Pressable does —
  // proven for real below, when the custom-range flow actually completes.
  screen.getByTestId("plus-badge");
  expect(screen.queryByTestId("plus-gate")).toBeNull();
  // The month strip is a sheet now (components/reports/month_picker.tsx) —
  // closed until the period field is pressed.
  screen.getByTestId("range-picker-month-trigger");
  expect(screen.queryByTestId("range-picker-months")).toBeNull();

  fireEvent.press(screen.getByTestId("range-picker-custom-toggle"));
  pickDate("range-picker-custom-from", 2026, 7, 1);
  pickDate("range-picker-custom-to", 2026, 7, 15);
  fireEvent.press(screen.getByTestId("range-picker-custom-apply"));

  expect(onSelectCustom).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-07-15" });
});
