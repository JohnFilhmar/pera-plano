// components/bills/__tests__/bill_rules_card.test.tsx — GAP-085.
//
// THE SENTENCES HAVE TO REACH THE SCREEN, not just exist. `rule_summary.test.ts`
// next door proves the words are right; this proves they are rendered, which is
// the failure mode that would let "the rows are there" be true of the module
// and false of the app.
import { render, screen } from "@testing-library/react-native";

import { BillRulesCard } from "@/components/bills/bill_rules_card";
import type { AmountEstimate } from "@/lib/bills/amount_estimator";
import type { Bill } from "@/types/domain";

const HISTORY: AmountEstimate = { amount: 235000, basis: "history", sampleSize: 3, spread: 40000 };

function bill(over: Partial<Bill> = {}): Bill {
  return {
    id: "bill_1",
    name: "Meralco",
    amount: 235000,
    amountMode: "estimated",
    dueRule: { kind: "day-of-month", day: 20 },
    reminderOffsets: [-3, 0],
    autoMatchRule: { merchantPattern: "MERALCO", dateWindowDays: 7 },
    categoryId: "cat_bills_utilities",
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

test("THE THREE SPEC ROWS ARE ON SCREEN", () => {
  // docs/04-features/07-bills.md's Bill detail: "Due rule in plain words ...,
  // reminder schedule, ..., auto-match rule summary". None of the three
  // rendered anywhere in the app before this card.
  render(<BillRulesCard bill={bill()} estimate={HISTORY} dueDate="2026-02-20" />);

  expect(screen.getByTestId("bill-rule-due").props.children).toBe("Every 20th");
  expect(screen.getByTestId("bill-rule-reminders").props.children).toBe(
    "3 days before and on the due date.",
  );
  expect(screen.getByTestId("bill-rule-automatch").props.children).toBe(
    'Looks for "MERALCO" in what you spend.',
  );
});

test("THE TOLERANCE AND WINDOW ARE THE MATCHER'S OWN, IN PESOS", () => {
  // Rule 13 defines the rule as "merchant keyword set + amount tolerance +
  // date window", and rule 14 makes an estimated bill's band 30% — ₱705.00 of
  // ₱2,350.00. A user asking "why did it match that?" has no other answer.
  render(<BillRulesCard bill={bill()} estimate={HISTORY} dueDate="2026-02-20" />);

  expect(screen.getByTestId("bill-rule-tolerance").props.children).toBe(
    "Amounts within ₱705.00 of the expected figure.",
  );
  expect(screen.getByTestId("bill-rule-window").props.children).toBe(
    "From 7 days before the due date to 15 days after — 30 days once it is overdue.",
  );
});

test("A FIXED BILL SHOWS THE OTHER BAND", () => {
  // ₱70.50, the 3% that beats the ₱30.00 floor at this amount — and a tenth of
  // the estimated band above, so the two fixtures cannot be confused.
  const fixed: AmountEstimate = { amount: 235000, basis: "fixed", sampleSize: 0, spread: 0 };
  render(
    <BillRulesCard bill={bill({ amountMode: "fixed" })} estimate={fixed} dueDate="2026-02-20" />,
  );

  expect(screen.getByTestId("bill-rule-tolerance").props.children).toBe(
    "Amounts within ₱70.50 of the expected figure.",
  );
});

test("THE LADDER'S POSITION IS SPELLED OUT BOTH WAYS", () => {
  // Rule 13: the same bill behaves differently before and after the third
  // consecutive confirmation, and nothing else in the app says which.
  render(<BillRulesCard bill={bill()} estimate={HISTORY} dueDate="2026-02-20" />);
  expect(screen.getByTestId("bill-rule-ladder").props.children).toBe(
    "You confirm each match. 3 more confirmations and they happen on their own.",
  );

  screen.rerender(
    <BillRulesCard
      bill={bill({
        autoMatchRule: { merchantPattern: "MERALCO", dateWindowDays: 7, confirmedStreak: 4 },
      })}
      estimate={HISTORY}
      dueDate="2026-02-20"
    />,
  );
  expect(screen.getByTestId("bill-rule-ladder").props.children).toBe(
    "Matches are marked paid for you now, with an undo here — unless the amount jumps by more than 30%.",
  );
});

test("matching off says so instead of leaving a blank row", () => {
  render(
    <BillRulesCard bill={bill({ autoMatchRule: null })} estimate={HISTORY} dueDate="2026-02-20" />,
  );

  expect(screen.getByTestId("bill-rule-automatch").props.children).toBe(
    "Off — you decide which payment settles this bill.",
  );
  expect(screen.queryByTestId("bill-rule-tolerance")).toBeNull();
  expect(screen.queryByTestId("bill-rule-ladder")).toBeNull();
});

// ---------------------------------------------------------------------------
// Rule 3's unadjusted date
// ---------------------------------------------------------------------------
test("A SHIFTED CYCLE SHOWS THE DATE IT WOULD HAVE FALLEN ON", () => {
  // "Weekday adjustment moves the due date at most 2 days; the UNADJUSTED date
  // is still shown in the bill detail for transparency." 2026-02-21 is a
  // Saturday, so an "earlier" rule stores the Friday and this line is the only
  // place the 21st is ever named.
  render(
    <BillRulesCard
      bill={bill({ dueRule: { kind: "day-of-month", day: 21, weekdayAdjust: "earlier" } })}
      estimate={HISTORY}
      dueDate="2026-02-20"
    />,
  );

  expect(screen.getByTestId("bill-rule-due").props.children).toBe(
    "Every 21st; moves to the Friday before if it lands on a weekend",
  );
  expect(screen.getByTestId("bill-rule-shift").props.children).toBe(
    "This one fell on a weekend: Feb 21, 2026 moved to Feb 20, 2026.",
  );
});

test("A CYCLE THAT NEVER MOVED SHOWS NO SHIFT LINE", () => {
  // The rule can shift and this occurrence still not have: 2026-02-20 is a
  // Friday. Printing the line anyway would say "moved from the 20th to the
  // 20th", which teaches the user to stop reading it.
  render(
    <BillRulesCard
      bill={bill({ dueRule: { kind: "day-of-month", day: 20, weekdayAdjust: "earlier" } })}
      estimate={HISTORY}
      dueDate="2026-02-20"
    />,
  );

  expect(screen.queryByTestId("bill-rule-shift")).toBeNull();
});
