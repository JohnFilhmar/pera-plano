// components/loans/__tests__/loan_card.test.tsx — m2b Task 8, rule 2.
import { render, screen } from "@testing-library/react-native";

import type { LoanStatus } from "@/lib/loans/loans_service";
import type { Loan } from "@/types/domain";

import { LoanCard } from "../loan_card";

const NOW = new Date(2026, 8, 15, 12, 0).getTime(); // Sep 15 2026

function statusOf(over: Partial<LoanStatus> = {}): LoanStatus {
  const loan: Loan = {
    id: "l1",
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 600000,
    interestRate: null,
    schedule: null,
    linkedWalletId: null,
    nextDueDate: "2026-09-18",
    nextDueAmount: 100000,
    createdAt: 0,
    updatedAt: 0,
    ...over.loan,
  };
  return {
    loan,
    outstanding: 600000,
    nextDue: { dueDate: "2026-09-18", amount: 100000 },
    overdue: false,
    paidCount: 0,
    ...over,
  };
}

test("shows the counterparty and the outstanding balance", () => {
  render(<LoanCard status={statusOf()} now={NOW} testID="loan" />);

  screen.getByText("Aling Nena");
  expect(screen.getByTestId("loan-outstanding").props.children).toContain("₱6,000.00");
});

test("a due date three days out reads 'Due in 3d'", () => {
  render(<LoanCard status={statusOf()} now={NOW} testID="loan" />);

  screen.getByText("Due in 3d");
});

test("A LOAN DUE TODAY READS 'Due today'", () => {
  render(
    <LoanCard
      status={statusOf({ nextDue: { dueDate: "2026-09-15", amount: 100000 } })}
      now={NOW}
      testID="loan"
    />,
  );

  screen.getByText("Due today");
});

test("AN OVERDUE LOAN CARRIES THE DANGER CHIP", () => {
  // Rule 2 reserves danger for this. The overdue verdict comes from
  // `listLoanStatuses`, which compares in local calendar days — a card that
  // re-derived it would disagree with the list it sits in at midnight.
  render(
    <LoanCard
      status={statusOf({ overdue: true, nextDue: { dueDate: "2026-09-01", amount: 100000 } })}
      now={NOW}
      testID="loan"
    />,
  );

  screen.getByText("Overdue");
});

test("a distant due date is NEUTRAL, not a warning", () => {
  // Red and amber are for something wrong or imminent. Spending a warning
  // colour on "due in three weeks" leaves nothing louder for the day it is
  // actually late.
  render(
    <LoanCard
      status={statusOf({ nextDue: { dueDate: "2026-10-15", amount: 100000 } })}
      now={NOW}
      testID="loan"
    />,
  );

  screen.getByText("Due in 30d");
});

test("a settled loan says so and shows no next payment", () => {
  render(<LoanCard status={statusOf({ outstanding: 0 })} now={NOW} testID="loan" />);

  screen.getByText("Settled");
  expect(screen.queryByText(/^Next:/)).toBeNull();
});

test("a loan with NO due date shows no chip at all", () => {
  // Spec rule 1: a free-form loan's due date is optional and user-managed.
  // Inventing a chip for one that has none would imply a commitment.
  render(<LoanCard status={statusOf({ nextDue: null })} now={NOW} testID="loan" />);

  expect(screen.queryByTestId("loan-due")).toBeNull();
  screen.getByText("Aling Nena");
});

test("the next payment amount is shown alongside the balance", () => {
  render(<LoanCard status={statusOf()} now={NOW} testID="loan" />);

  screen.getByText("Next: ₱1,000.00");
});
