// components/limits/__tests__/limit_card.test.tsx — m2 Task 8.
//
// One card per limit, one row per state in the limits spec's UX states table.
// The card RENDERS a state it is given; it does not decide one. `uiState` comes
// from `getLimitStatuses` (lib/limits/limit_service.ts), which is where the
// 50/80/100 boundaries are already tested — a card that recomputed them would
// be a second opinion about whether the user is over their limit.
import { render, screen } from "@testing-library/react-native";

import { LimitCard } from "../limit_card";

const BASE = {
  name: "Food & Dining",
  spend: 0,
  effectiveLimit: 1000000 as number | null,
  daysLeft: 9,
  uiState: "on_track" as const,
};

test("on track: names the limit, the remainder and the days left", () => {
  render(<LimitCard {...BASE} spend={200000} />);

  screen.getByText("Food & Dining");
  screen.getByText("₱8,000.00 left, 9 days to go");
});

test("caution and warning still show the remainder — only the colour changes", () => {
  render(<LimitCard {...BASE} spend={800000} uiState="warning" />);

  screen.getByText("₱2,000.00 left, 9 days to go");
});

test("over: the overage line REPLACES the remainder", () => {
  // Spec UX table: "'Over by ₱X' replaces the remaining amount".
  render(<LimitCard {...BASE} spend={1150000} uiState="over" />);

  screen.getByText("Over by ₱1,500.00");
  expect(screen.queryByText(/left,/)).toBeNull();
});

test("exactly at the limit reads ₱0.00 left, never 'Over by ₱0.00'", () => {
  // `uiState` is already "over" at exactly 100% (rule 19 fires 100 at-or-above),
  // so the colour is right — but the sentence must key on the actual overage.
  // The m2 plan branches the copy on the state and prints "Over by ₱0.00".
  render(<LimitCard {...BASE} spend={1000000} uiState="over" />);

  screen.getByText("₱0.00 left, 9 days to go");
  expect(screen.queryByText(/Over by/)).toBeNull();
});

test("one day left is singular", () => {
  render(<LimitCard {...BASE} spend={200000} daysLeft={1} />);

  screen.getByText("₱8,000.00 left, 1 day to go");
});

test("paused: explains what to do and shows no figure at all", () => {
  // Spec UX table: "Grayed card, 'Paused — declare your income to activate'".
  // Rule 12: income is never silently treated as ₱0.00, so no amount, no bar.
  render(<LimitCard {...BASE} uiState="paused" effectiveLimit={null} spend={0} />);

  screen.getByText("Food & Dining");
  screen.getByText("Paused — declare your income to activate");
  expect(screen.queryByText(/left,/)).toBeNull();
  expect(screen.queryByText(/₱/)).toBeNull();
  expect(screen.queryByTestId("limit-card-progress")).toBeNull();
});

test("inactive: keeps the card, tags it, and states no progress", () => {
  // Spec UX table: "Card kept, shown dimmed with an 'inactive' tag and an
  // activate/swap action". An inactive limit is not measuring anything, so a
  // live-looking progress bar on it would be a lie.
  render(<LimitCard {...BASE} uiState="inactive" effectiveLimit={null} spend={0} />);

  screen.getByText("Food & Dining");
  screen.getByText("Inactive");
  expect(screen.queryByTestId("limit-card-progress")).toBeNull();
});

test("the progress bar never runs past its track", () => {
  // A 300%-spent limit must not render a bar three times the card's width.
  render(<LimitCard {...BASE} spend={3000000} uiState="over" testID="limit-card" />);

  const fill = screen.getByTestId("limit-card-progress-fill");
  expect(fill.props.style).toEqual(expect.objectContaining({ width: "100%" }));
});

test("the bar reflects the ratio below 100%", () => {
  render(<LimitCard {...BASE} spend={250000} testID="limit-card" />);

  const fill = screen.getByTestId("limit-card-progress-fill");
  expect(fill.props.style).toEqual(expect.objectContaining({ width: "25%" }));
});
