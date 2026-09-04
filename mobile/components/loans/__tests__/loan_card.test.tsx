// components/loans/__tests__/loan_card.test.tsx — m2b Task 8, rule 2.
import { render, screen } from "@testing-library/react-native";

import type { LoanStatus } from "@/lib/loans/loans_service";
import type { Installment, Loan } from "@/types/domain";

import { LoanCard } from "../loan_card";

const NOW = new Date(2026, 8, 15, 12, 0).getTime(); // Sep 15 2026

type LoanStatusOverride = Partial<Omit<LoanStatus, "loan">> & { loan?: Partial<Loan> };

function statusOf(over: LoanStatusOverride = {}): LoanStatus {
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
    reminderOffsets: [-3, 0, 3],
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...over.loan,
  };
  return {
    outstanding: 600000,
    nextDue: { dueDate: "2026-09-18", amount: 100000 },
    overdue: false,
    paidCount: 0,
    paidTotal: 0,
    ...over,
    // LAST, DELIBERATELY (same footgun as lib/loans/__tests__/loan_reminders.test.ts's
    // statusOf). `over.loan` is a PATCH merged into the defaults above, not a
    // full replacement — spreading `...over` first and `loan` after keeps
    // that merged value from being clobbered by a raw partial `over.loan`.
    // No test here passes `over.loan` today, so this was inert; the next
    // required field added to `Loan` would have made it bite exactly the way
    // it did next door.
    loan,
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

// ---------------------------------------------------------------------------
// F3: the "N of M paid" caption must not claim every installment is the same
// amount — buildAmortizationSchedule's final row deliberately absorbs
// rounding drift and is NOT the level payment every other row carries.
// ---------------------------------------------------------------------------
test("the per-installment caption is qualified with '~', since an amortized loan's final row absorbs rounding drift and is not the same amount as the rest", () => {
  // Only schedule[0] (what the caption reads) and the count matter here — the
  // caption never inspects the LAST row's actual amount, which is exactly the
  // bug: it asserted "each" without ever checking whether the schedule agreed.
  const schedule: Installment[] = [
    { dueDate: "2026-10-15", amountDue: 1065713 },
    { dueDate: "2026-11-15", amountDue: 1065713 },
    { dueDate: "2026-12-15", amountDue: 1065710 }, // final row: rounding drift absorbed
  ];
  render(
    <LoanCard
      status={statusOf({ paidCount: 1, loan: { schedule } })}
      now={NOW}
      testID="loan"
    />,
  );

  screen.getByText("1 of 3 paid · ~₱10,657.13 each");
});

test("a flat (non-interest) schedule's caption is still true — every installment really is the same figure — so the '~' costs it nothing", () => {
  const schedule: Installment[] = [
    { dueDate: "2026-10-15", amountDue: 500000 },
    { dueDate: "2026-11-15", amountDue: 500000 },
  ];
  render(
    <LoanCard
      status={statusOf({ paidCount: 0, loan: { schedule } })}
      now={NOW}
      testID="loan"
    />,
  );

  screen.getByText("0 of 2 paid · ~₱5,000.00 each");
});

// ---------------------------------------------------------------------------
// F6: the due-date caption and the overdue-promise banner must carry an
// explicit type-scale class (this app's eight-step fontSize scale), not fall
// back to the platform default.
// ---------------------------------------------------------------------------
test("the due-date caption and the overdue banner carry an explicit type-scale class, not the platform default", () => {
  render(
    <LoanCard
      status={statusOf({ overdue: true, nextDue: { dueDate: "2026-09-01", amount: 100000 } })}
      now={NOW}
      testID="loan"
    />,
  );

  const dueCaption = screen.getByText(/^Due .* paid$/);
  expect(String(dueCaption.props.className)).toContain("text-secondary");

  const bannerTitle = screen.getByText("Overdue promise");
  expect(String(bannerTitle.props.className)).toContain("text-row");

  const bannerBody = screen.getByText(/is waiting on this one\.$/);
  expect(String(bannerBody.props.className)).toContain("text-secondary");
});
