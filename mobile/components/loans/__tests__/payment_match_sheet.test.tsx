// components/loans/__tests__/payment_match_sheet.test.tsx — task-3, D2.
//
// "NONE OF THESE" HAS TO REPORT WHAT IT REJECTED, AND ONLY WHEN IT MEANS IT.
// Before this, the button called `onDismiss` and nothing else, so a rejection
// the user typed with their thumb went nowhere and the loan kept advertising
// the same "N possible payments" on the next visit. The browse-everything
// list's own dismiss stays a plain close: those rows are a search result, not
// an offer, and rejecting fifty of them because the user gave up scrolling
// would silence the suggestions on the strength of a gesture that meant
// nothing of the kind.
import { fireEvent, render, screen } from "@testing-library/react-native";

import type { PaymentCandidate } from "@/lib/loans/loans_service";

import { PaymentMatchSheet } from "../payment_match_sheet";

function candidateFor(transactionId: string): PaymentCandidate {
  return {
    transactionId,
    amount: 444244,
    occurredAt: 1_786_000_000_000,
    merchant: "GLOAN PAYMENT",
    counterparty: null,
    score: 0.9,
    reasons: ["Matches the amount due"],
  };
}

test("'None of these' reports every row it was showing, then closes", () => {
  const onReject = jest.fn();
  const onDismiss = jest.fn();

  render(
    <PaymentMatchSheet
      visible
      candidates={[candidateFor("tx-1"), candidateFor("tx-2")]}
      counterparty="Kuya Ben"
      direction="i-owe"
      onDismiss={onDismiss}
      onConfirm={() => {}}
      onReject={onReject}
      onShowAll={() => {}}
    />,
  );

  fireEvent.press(screen.getByTestId("match-dismiss"));

  expect(onReject).toHaveBeenCalledWith(["tx-1", "tx-2"]);
  expect(onDismiss).toHaveBeenCalled();
});

// THE BROWSE LIST IS A SEARCH AND ITS BUTTON IS A PLAIN CLOSE. Rejecting fifty
// unfiltered rows because the user gave up scrolling would silence the
// suggested list on the strength of a gesture that meant nothing of the kind.
test("the browse list's Close rejects nothing", () => {
  const onReject = jest.fn();

  render(
    <PaymentMatchSheet
      visible
      showingAll
      candidates={[candidateFor("tx-1")]}
      counterparty="Kuya Ben"
      direction="i-owe"
      onDismiss={() => {}}
      onConfirm={() => {}}
      onReject={onReject}
    />,
  );

  fireEvent.press(screen.getByTestId("match-dismiss"));

  expect(onReject).not.toHaveBeenCalled();
});
