// components/goals/__tests__/allocation_sheet.test.tsx — m2b Task 4, rule 6.
//
// The sheet is the user's last chance to say "not that much" before the ledger
// records a movement. Every test here is about what it hands back on confirm —
// and about the fact that it hands back NOTHING until then.
import { fireEvent, render, screen } from "@testing-library/react-native";

import type { AllocationProposal } from "@/lib/goals/goals_service";

import { AllocationSheet } from "../allocation_sheet";

const EMERGENCY: AllocationProposal = {
  goalId: "g-emergency",
  goalName: "Emergency Fund",
  amount: 200000,
  requested: 200000,
  fromWalletId: "w-payroll",
  toWalletId: "w-gsave",
};

const TRAVEL: AllocationProposal = {
  goalId: "g-travel",
  goalName: "Travel",
  amount: 100000,
  requested: 300000, // trimmed by rule 3's cap
  fromWalletId: "w-payroll",
  toWalletId: "w-seabank",
};

function renderSheet(over: Partial<Parameters<typeof AllocationSheet>[0]> = {}) {
  const onConfirm = jest.fn();
  const onDismiss = jest.fn();
  render(
    <AllocationSheet
      visible
      proposals={[EMERGENCY, TRAVEL]}
      paydayAmount={1850000}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
      {...over}
    />,
  );
  return { onConfirm, onDismiss };
}

test("lists every proposal and totals them against the payday", () => {
  renderSheet();

  screen.getByText("Emergency Fund");
  screen.getByText("Travel");
  // ₱2,000 + ₱1,000 of an ₱18,500 payday.
  expect(screen.getByTestId("allocation-total").props.children).toBe(
    "₱3,000.00 of ₱18,500.00",
  );
});

test("NOTHING IS COMMITTED UNTIL CONFIRM", () => {
  // Rule 6: "It never pre-commits." Toggling and editing are local state; the
  // ledger hears nothing until the button.
  const { onConfirm } = renderSheet();

  fireEvent.press(screen.getByTestId(`allocation-toggle-${TRAVEL.goalId}`));
  fireEvent.changeText(screen.getByTestId(`allocation-amount-${EMERGENCY.goalId}`), "150000");

  expect(onConfirm).not.toHaveBeenCalled();
});

test("confirm hands back only the CHECKED proposals", () => {
  const { onConfirm } = renderSheet();

  fireEvent.press(screen.getByTestId(`allocation-toggle-${TRAVEL.goalId}`)); // uncheck
  fireEvent.press(screen.getByTestId("allocation-confirm"));

  expect(onConfirm).toHaveBeenCalledTimes(1);
  const accepted = onConfirm.mock.calls[0][0] as AllocationProposal[];
  expect(accepted.map((proposal) => proposal.goalId)).toEqual([EMERGENCY.goalId]);
});

test("an EDITED amount is what gets committed", () => {
  // The proposal is a suggestion about money the user is about to move by hand.
  // If they move ₱1,500 instead of ₱2,000, the ledger has to record ₱1,500 or
  // it is simply wrong.
  const { onConfirm } = renderSheet();

  fireEvent.changeText(screen.getByTestId(`allocation-amount-${EMERGENCY.goalId}`), "150000");
  fireEvent.press(screen.getByTestId("allocation-confirm"));

  const accepted = onConfirm.mock.calls[0][0] as AllocationProposal[];
  expect(accepted.find((p) => p.goalId === EMERGENCY.goalId)?.amount).toBe(150000);
  // The other fields travel unchanged — the wallets are not the user's to edit.
  expect(accepted[0].fromWalletId).toBe("w-payroll");
  expect(accepted[0].toWalletId).toBe("w-gsave");
});

test("unchecking updates the running total", () => {
  renderSheet();

  fireEvent.press(screen.getByTestId(`allocation-toggle-${TRAVEL.goalId}`));

  expect(screen.getByTestId("allocation-total").props.children).toBe(
    "₱2,000.00 of ₱18,500.00",
  );
});

test("THE SHEET WARNS WHEN THE TOTAL EXCEEDS THE PAYDAY, and blocks confirm", () => {
  const { onConfirm } = renderSheet({ paydayAmount: 250000 });

  screen.getByTestId("allocation-over-warning");
  fireEvent.press(screen.getByTestId("allocation-confirm"));

  // Recording more moved than actually arrived would put the payroll wallet
  // into a balance the bank never showed.
  expect(onConfirm).not.toHaveBeenCalled();
});

test("editing back under the payday clears the warning", () => {
  renderSheet({ paydayAmount: 250000 });
  screen.getByTestId("allocation-over-warning");

  fireEvent.changeText(screen.getByTestId(`allocation-amount-${EMERGENCY.goalId}`), "100000");

  expect(screen.queryByTestId("allocation-over-warning")).toBeNull();
});

test("a TRIMMED proposal says what was planned", () => {
  // Rule 3 caps "in goal-priority order ... and mark the shortfall". Showing
  // only the smaller number would leave the user thinking their rule changed.
  renderSheet();

  const shortfall = screen.getByTestId(`allocation-shortfall-${TRAVEL.goalId}`);
  expect(String(shortfall.props.children)).toContain("₱3,000.00 planned");
  expect(String(shortfall.props.children)).toContain("₱1,000.00");
  // The untrimmed one says nothing — there is no shortfall to explain.
  expect(screen.queryByTestId(`allocation-shortfall-${EMERGENCY.goalId}`)).toBeNull();
});

test("unchecking everything disables confirm", () => {
  const { onConfirm } = renderSheet();

  fireEvent.press(screen.getByTestId(`allocation-toggle-${EMERGENCY.goalId}`));
  fireEvent.press(screen.getByTestId(`allocation-toggle-${TRAVEL.goalId}`));
  fireEvent.press(screen.getByTestId("allocation-confirm"));

  expect(onConfirm).not.toHaveBeenCalled();
});

test("an amount edited to zero drops that row rather than committing ₱0.00", () => {
  const { onConfirm } = renderSheet();

  fireEvent.changeText(screen.getByTestId(`allocation-amount-${TRAVEL.goalId}`), "0");
  fireEvent.press(screen.getByTestId("allocation-confirm"));

  const accepted = onConfirm.mock.calls[0][0] as AllocationProposal[];
  expect(accepted.map((p) => p.goalId)).toEqual([EMERGENCY.goalId]);
});

test("Not now dismisses without committing anything", () => {
  const { onConfirm, onDismiss } = renderSheet();

  fireEvent.press(screen.getByTestId("allocation-skip"));

  expect(onDismiss).toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});

test("an invisible sheet renders nothing", () => {
  renderSheet({ visible: false });

  expect(screen.queryByTestId("allocation-sheet")).toBeNull();
});
