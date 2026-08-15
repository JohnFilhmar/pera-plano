// components/bills/__tests__/due_chip.test.tsx — m2c Task 5, rules 2 and 3.
//
// The chip and the estimate rendering: two small components that carry two
// promises the rest of the feature relies on — that red means already late, and
// that an estimate never looks like a bill you have received.
import { render, screen } from "@testing-library/react-native";

import { DueChip } from "@/components/bills/due_chip";
import { EstimateText, estimateLabel } from "@/components/bills/estimate_text";
import type { BillCycleState } from "@/lib/bills/bills_service";
import type { AmountEstimate } from "@/lib/bills/amount_estimator";

function estimate(over: Partial<AmountEstimate> = {}): AmountEstimate {
  return { amount: 235000, basis: "history", sampleSize: 3, spread: 0, ...over };
}

// ---------------------------------------------------------------------------
// The chip — rule 2
// ---------------------------------------------------------------------------
const CASES: readonly [BillCycleState, number, string][] = [
  ["overdue", -3, "3 days late"],
  ["due_today", 0, "Due today"],
  ["upcoming", 9, "Due in 9d"],
  ["paid", -1, "Paid"],
];

test.each(CASES)("the %s chip reads %s", (state, daysUntil, label) => {
  render(<DueChip state={state} daysUntil={daysUntil} testID="chip" />);

  screen.getByText(label);
});

test("DANGER IS RESERVED FOR ALREADY LATE", () => {
  // Red on "due in 3 days" leaves nothing louder for the day the payment is
  // genuinely overdue, and a user who sees red every week stops reading it.
  // Asserted through the FILL, which is where `Chip` puts the tone — the text
  // colour only inverts against that fill and says nothing about severity.
  render(
    <>
      <DueChip state="overdue" daysUntil={-1} testID="late" />
      <DueChip state="upcoming" daysUntil={3} testID="soon" />
      <DueChip state="upcoming" daysUntil={20} testID="far" />
    </>,
  );

  expect(screen.getByTestId("late").props.className).toMatch(/bg-danger/);
  expect(screen.getByTestId("soon").props.className).toMatch(/bg-warn/);
  expect(screen.getByTestId("far").props.className).not.toMatch(/bg-danger|bg-warn/);
});

test("a cycle settled outside the tracked wallets reads differently from paid", () => {
  // Both are resolved, but only one has a transaction behind it — and the
  // estimator learned nothing from the other.
  render(<DueChip state="resolved_external" daysUntil={-2} />);

  screen.getByText("Settled elsewhere");
});

// ---------------------------------------------------------------------------
// The estimate — rule 3
// ---------------------------------------------------------------------------
test("A WIDE SPREAD RENDERS AS A RANGE WITH 'USUALLY'", () => {
  // Meralco is never the same twice. A single "~₱2,350.00" invites the user to
  // plan against a figure the app has no business being that confident about.
  render(
    <EstimateText testID="estimate" estimate={estimate({ amount: 235000, spread: 120000 })} />,
  );

  expect(screen.getByTestId("estimate").props.children).toMatch(/^Usually /);
  screen.getByText("Usually ₱1,750.00 – ₱2,950.00");
});

test("A TIGHT SPREAD RENDERS A SINGLE FIGURE, STILL PREFIXED", () => {
  // Spec rule 7: the `~` travels with the number wherever the number goes.
  render(<EstimateText testID="estimate" estimate={estimate({ spread: 2000 })} />);

  screen.getByText("~₱2,350.00");
});

test("A FIXED AMOUNT IS A FACT AND CARRIES NO TILDE", () => {
  render(
    <EstimateText testID="estimate" estimate={estimate({ basis: "fixed", sampleSize: 0 })} />,
  );

  screen.getByText("₱2,350.00");
  expect(screen.queryByText("~₱2,350.00")).toBeNull();
});

test("a seed is still an estimate, and says so", () => {
  // No payments yet means the figure is the user's own guess — presenting it
  // bare would give a number they invented the authority of one the app
  // observed.
  expect(estimateLabel(estimate({ basis: "seed", sampleSize: 0 }))).toBe("~₱2,350.00");
});

test("ONE PAYMENT NEVER RENDERS AS A RANGE", () => {
  // A single observation has a spread of zero by definition; presenting it as
  // "usually X to X" would dress one data point as a pattern.
  expect(estimateLabel(estimate({ sampleSize: 1, spread: 0 }))).toBe("~₱2,350.00");
});
