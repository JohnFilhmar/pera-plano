// components/home/__tests__/utang_strip.test.tsx — owner request, 2026-08-31.
//
// "I owe" money on the Home tab. It is deliberately NOT folded into "Coming
// up": that strip's own header says it names "the bills already subtracted
// from the hero number", and loans are not in Safe-to-Spend's bills term
// (lib/safe_to_spend_service.ts's `unresolvedBills` reads bill cycles only).
// Putting utang rows there would list money the hero never deducted, directly
// under the hero — the same class of quiet contradiction as the set-aside bug.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { UtangStrip } from "../utang_strip";
import type { LoanStatus } from "@/lib/loans/loans_service";
import type { Loan } from "@/types/domain";

/** 2026-08-31 12:00 local — the reported device's day. */
const NOW = new Date(2026, 7, 31, 12, 0).getTime();

function loan(over: Partial<Loan> = {}): Loan {
  return {
    id: "loan-1",
    direction: "i-owe",
    counterparty: "Kuya Ben",
    principal: 500_000,
    interestRate: null,
    schedule: null,
    linkedWalletId: null,
    nextDueDate: "2026-09-05",
    nextDueAmount: 100_000,
    reminderOffsets: [-3, 0, 3],
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function status(over: Partial<LoanStatus> = {}, loanOver: Partial<Loan> = {}): LoanStatus {
  return {
    loan: loan(loanOver),
    outstanding: 400_000,
    nextDue: { dueDate: "2026-09-05", amount: 100_000 },
    overdue: false,
    paidCount: 1,
    paidTotal: 200_000,
    ...over,
  };
}

const BASE = {
  now: NOW,
  onOpen: () => {},
  onSeeAll: () => {},
};

test("renders an I-owe loan under its own Utang heading", () => {
  render(<UtangStrip {...BASE} statuses={[status()]} />);

  screen.getByText("Utang");
  screen.getByTestId("utang-row-loan-1");
  screen.getByText("Kuya Ben");
});

test("OWED-TO-ME LOANS ARE EXCLUDED — the section is what YOU owe", () => {
  // Mixing the two directions in one total is how a debt tracker tells someone
  // they owe money they are actually owed.
  render(
    <UtangStrip
      {...BASE}
      statuses={[status({}, { id: "loan-them", direction: "owed-to-me", counterparty: "Ate Mia" })]}
    />,
  );

  expect(screen.queryByTestId("home-utang")).toBeNull();
  expect(screen.queryByText("Ate Mia")).toBeNull();
});

test("a fully repaid loan drops off — Home is not a filing cabinet", () => {
  // `listLoans` keeps settled loans visible in the Utang tab's own list on
  // purpose; a Home summary showing "₱0.00 outstanding" is just noise.
  render(<UtangStrip {...BASE} statuses={[status({ outstanding: 0 })]} />);
  expect(screen.queryByTestId("home-utang")).toBeNull();
});

test("nothing to owe renders nothing at all, not an empty heading", () => {
  render(<UtangStrip {...BASE} statuses={[]} />);
  expect(screen.queryByTestId("home-utang")).toBeNull();
});

test("still renders nothing while the query is loading", () => {
  render(<UtangStrip {...BASE} statuses={undefined} />);
  expect(screen.queryByTestId("home-utang")).toBeNull();
});

test("OVERDUE SORTS FIRST, then by due date, then the undated", () => {
  // The one row the user can still act on goes to the top — the same ordering
  // rule `UpcomingBillsStrip` inherits from `listBillStatuses`.
  render(
    <UtangStrip
      {...BASE}
      limit={4}
      statuses={[
        status({ nextDue: { dueDate: "2026-09-20", amount: 5000 } }, { id: "late-sept" }),
        status({ nextDue: null }, { id: "freeform", nextDueDate: null, nextDueAmount: null }),
        status({ overdue: true, nextDue: { dueDate: "2026-08-20", amount: 5000 } }, { id: "past" }),
        status({ nextDue: { dueDate: "2026-09-02", amount: 5000 } }, { id: "early-sept" }),
      ]}
    />,
  );

  const order = screen
    .getAllByTestId(/^utang-row-/)
    .map((node) => String(node.props.testID).replace("utang-row-", ""));

  expect(order).toEqual(["past", "early-sept", "late-sept", "freeform"]);
});

test("shows at most `limit` rows and offers See all when there are more", () => {
  render(
    <UtangStrip
      {...BASE}
      limit={2}
      statuses={[
        status({}, { id: "a" }),
        status({}, { id: "b" }),
        status({}, { id: "c" }),
      ]}
    />,
  );

  expect(screen.getAllByTestId(/^utang-row-/)).toHaveLength(2);
  screen.getByTestId("section-header-action");
});

test("tapping a row opens that loan", () => {
  const opened: string[] = [];
  render(
    <UtangStrip {...BASE} onOpen={(id) => opened.push(id)} statuses={[status({}, { id: "loan-9" })]} />,
  );

  fireEvent.press(screen.getByTestId("utang-row-loan-9"));
  expect(opened).toEqual(["loan-9"]);
});

test("the heading totals only what is still outstanding", () => {
  // ₱4,000 + ₱1,500, not the two principals — the user wants what is left to
  // pay, which is the figure the rows themselves are showing.
  render(
    <UtangStrip
      {...BASE}
      statuses={[
        status({ outstanding: 400_000 }, { id: "a" }),
        status({ outstanding: 150_000 }, { id: "b" }),
      ]}
    />,
  );

  // Regex: the line reads "₱5,500.00 still to pay", and an exact match would
  // fail on the caption the line is supposed to carry.
  expect(screen.getByTestId("home-utang-total")).toHaveTextContent(/₱5,500\.00 still to pay/);
});
