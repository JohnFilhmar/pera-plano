// components/goals/__tests__/allocation_sheet.test.tsx — m2b Task 4, rule 6.
//
// The sheet is the user's last chance to say "not that much" before the ledger
// records a movement. Every test here is about what it hands back on confirm —
// and about the fact that it hands back NOTHING until then.
//
// THE SHEET IS NOT A FormScreen (numeric-input-system Task 11). It renders
// inside BottomSheet, which is its own native Modal window; FormScreen is a
// screen-level wrapper and does not belong here, and this file's layout is
// otherwise untouched. What DOES change: the row amount fields now go through
// NumericField, and BottomSheet already mounts its own KeypadHost inside its
// Modal — see the "keypad draws above the sheet" test below.
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { Modal } from "react-native";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import type { AllocationProposal } from "@/lib/goals/goals_service";
import { clearAmount, closeKeypad, openKeypad, typeAmount } from "@/test_support/keypad";

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

// NumericField (inside each row's amount field) throws without a
// KeypadProvider above it — see test_support/keypad.ts's header. The root
// <KeypadHost /> here stands in for app/_layout.tsx's; BottomSheet mounts a
// second one itself, inside its Modal, whenever `visible` is true.
//
// ORDER IS LOAD-BEARING: <KeypadHost /> comes BEFORE <AllocationSheet />.
// React fires mount effects child-before-parent, sibling-in-order, so the
// FIRST child's whole subtree (including anything it nests) completes its
// effects before the SECOND child's. With AllocationSheet first, its
// sheet-nested host would register (and take its token) before this root
// one — the exact wrong order review caught in this file's first draft: it
// silently made the ROOT host active in every test, the one configuration
// keypad_host.tsx's header calls "behind" the sheet. This order instead
// mirrors app/_layout.tsx: the root host is mounted at app startup (first),
// and a sheet's own host only comes into being once the sheet is visible
// (second, here — and always, for a real sheet, since BottomSheet returns
// null while invisible), so it registers later and wins, same as the app.
function renderSheet(over: Partial<Parameters<typeof AllocationSheet>[0]> = {}) {
  const onConfirm = jest.fn();
  const onDismiss = jest.fn();
  render(
    <KeypadProvider>
      <KeypadHost />
      <AllocationSheet
        visible
        proposals={[EMERGENCY, TRAVEL]}
        paydayAmount={1850000}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
        {...over}
      />
    </KeypadProvider>,
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
  // ₱1,500 — the field defaults to EMERGENCY's seeded ₱2,000, so it is
  // cleared before retyping. Redundant since the first keystroke on a seeded
  // field started replacing rather than appending, but harmless, and it keeps
  // these assertions independent of that rule.
  clearAmount(`allocation-amount-${EMERGENCY.goalId}`);
  typeAmount(`allocation-amount-${EMERGENCY.goalId}`, "1500");

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

  clearAmount(`allocation-amount-${EMERGENCY.goalId}`);
  typeAmount(`allocation-amount-${EMERGENCY.goalId}`, "1500");
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

  // ₱1,000 — the old test typed "100000" as raw centavo digits.
  clearAmount(`allocation-amount-${EMERGENCY.goalId}`);
  typeAmount(`allocation-amount-${EMERGENCY.goalId}`, "1000");

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

  clearAmount(`allocation-amount-${TRAVEL.goalId}`);
  typeAmount(`allocation-amount-${TRAVEL.goalId}`, "0");
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

// Accessibility sweep (branch-review-design.md F5's gap, found again here):
// the toggle carried a role and a checked state but no label, so TalkBack fell
// back to reading the goal name Text and the Chip's own "Included"/"Skipped"
// label as one unstructured run-on rather than a single coherent name.
test("each allocation toggle is announced to TalkBack with the goal's own name, not left silent", () => {
  renderSheet();

  const toggle = screen.getByTestId(`allocation-toggle-${EMERGENCY.goalId}`);
  expect(toggle.props.accessibilityRole).toBe("checkbox");
  expect(toggle.props.accessibilityLabel).toBe("Include Emergency Fund");
});

// ---------------------------------------------------------------------------
// The keypad inside the sheet — numeric-input-system Task 11. BottomSheet is
// built on the platform Modal, its own native window, so a keypad hosted only
// at the root (renderSheet's own <KeypadHost />, standing in for
// app/_layout.tsx's) would paint BEHIND it. BottomSheet mounts a SECOND
// KeypadHost inside its own Modal for exactly this reason, and
// keypad_context.tsx's token registry hands the panel to the most recently
// mounted host — see renderSheet's own comment for why its mount ORDER is
// what makes that true here rather than merely asserted.
// ---------------------------------------------------------------------------
test("the keypad draws above the sheet, not behind it", () => {
  renderSheet();

  clearAmount(`allocation-amount-${EMERGENCY.goalId}`);
  openKeypad(`allocation-amount-${EMERGENCY.goalId}`);

  // Exactly one host is live (the other's `visible` is false and it renders
  // null — see keypad_host.tsx), and it is the one INSIDE the sheet's own
  // Modal, not renderSheet's root stand-in. Deleting BottomSheet's own
  // <KeypadHost /> (bottom_sheet.tsx) makes the `within` line below throw —
  // verified by mutation: the root host would then be the lone survivor,
  // found by getAllByTestId but not inside the Modal.
  expect(screen.getAllByTestId("keypad-host")).toHaveLength(1);
  within(screen.UNSAFE_getByType(Modal)).getByTestId("keypad-host");

  for (const key of "500") {
    fireEvent.press(screen.getByTestId(`keypad-key-${key}`));
  }
  closeKeypad();

  // "₱500" (no forced decimals) is the field's OWN live display — distinct
  // from the row's separate formatCentavos summary a line below, which would
  // read "₱500.00", so this is not an ambiguous match.
  expect(screen.getByText("₱500")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Every payday starts from its own proposals — GAP-084. The sheet is mounted
// once for the app's lifetime (app/_layout.tsx:178-189) with only `visible`
// toggling, and its rows are keyed by goal id, which does not change between
// paydays: a goal unchecked or edited down on one payday came back that way on
// the next, and the ledger recorded an amount chosen for a different payday.
// ---------------------------------------------------------------------------
function sheetTree(proposals: AllocationProposal[], onConfirm: jest.Mock) {
  // Same mount ORDER as renderSheet — see its comment; it is load-bearing.
  return (
    <KeypadProvider>
      <KeypadHost />
      <AllocationSheet
        visible
        proposals={proposals}
        paydayAmount={1850000}
        onConfirm={onConfirm}
        onDismiss={jest.fn()}
      />
    </KeypadProvider>
  );
}

test("A NEW PAYDAY'S PROPOSALS RESET THE SHEET, rather than carrying the last one's edits", () => {
  const onConfirm = jest.fn();
  const view = render(sheetTree([EMERGENCY, TRAVEL], onConfirm));

  // Last payday: Travel skipped, Emergency trimmed to ₱1,500.
  fireEvent.press(screen.getByTestId(`allocation-toggle-${TRAVEL.goalId}`));
  typeAmount(`allocation-amount-${EMERGENCY.goalId}`, "1500");

  // This payday: same goals, different figures.
  const nextEmergency: AllocationProposal = { ...EMERGENCY, amount: 250000, requested: 250000 };
  const nextTravel: AllocationProposal = { ...TRAVEL, amount: 120000, requested: 120000 };
  view.rerender(sheetTree([nextEmergency, nextTravel], onConfirm));

  expect(
    screen.getByTestId(`allocation-toggle-${TRAVEL.goalId}`).props.accessibilityState.checked,
  ).toBe(true);
  expect(screen.getByTestId("allocation-total").props.children).toBe("₱3,700.00 of ₱18,500.00");

  fireEvent.press(screen.getByTestId("allocation-confirm"));
  const accepted = onConfirm.mock.calls[0][0] as AllocationProposal[];
  expect(accepted.map((proposal) => [proposal.goalId, proposal.amount])).toEqual([
    [EMERGENCY.goalId, 250000],
    [TRAVEL.goalId, 120000],
  ]);
});

// The other half of the same rule: reseeding is keyed on what the proposals
// SAY, not on the array's identity, so a parent re-render mid-edit must not
// throw away what the user is in the middle of typing.
test("a re-render with the same proposals leaves the user's edits alone", () => {
  const onConfirm = jest.fn();
  const view = render(sheetTree([EMERGENCY, TRAVEL], onConfirm));

  typeAmount(`allocation-amount-${EMERGENCY.goalId}`, "1500");
  // A fresh array, same figures — what a parent hands down on any re-render.
  view.rerender(sheetTree([{ ...EMERGENCY }, { ...TRAVEL }], onConfirm));

  fireEvent.press(screen.getByTestId("allocation-confirm"));
  const accepted = onConfirm.mock.calls[0][0] as AllocationProposal[];
  expect(accepted.find((proposal) => proposal.goalId === EMERGENCY.goalId)?.amount).toBe(150000);
});
