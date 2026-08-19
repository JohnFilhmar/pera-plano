// components/onboarding/__tests__/income_quick_form.test.tsx — the onboarding
// income step's amount field.
//
// THIS FILE'S PREMISE WAS DELIBERATELY INVERTED BY numeric-input-system Task
// 12, and it is the one file in that migration whose EXPECTED VALUES had to
// move. The original bug (task-5-brief) was that the field took raw digits
// read as CENTAVOS behind a placeholder reading "Amount, e.g. 18500" — which
// says eighteen thousand five hundred pesos and produced ₱185.00. Task 5
// treated the symptom by swapping the placeholder for AmountNumpad, whose
// live read-out at least stopped the field CLAIMING one thing while doing
// another; the field still read 18500 as ₱185.00. W1 removes the cause: keyed
// text is PESOS, so 18500 is ₱18,500.00 — the figure the original reporter
// meant on their very first attempt. The assertions below therefore assert
// the OPPOSITE amount from the ones they replace, on purpose.
//
// The panel is the shared one (components/ui/keypad_host.tsx), driven only
// through test_support/keypad.ts — AmountNumpad and its `numpad-key-*` ids
// are gone from this screen entirely.
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { TextInput } from "react-native";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { typeAmount } from "@/test_support/keypad";

import { IncomeQuickForm } from "../income_quick_form";

/** The host goes in FIRST: mount effects commit in completion order and
 * keypad_context.tsx hands the panel to the highest live token, so a root
 * stand-in registered first leaves the higher tokens to anything the subject
 * mounts later. */
function renderForm(ui: ReactElement) {
  return render(
    <KeypadProvider>
      <KeypadHost />
      {ui}
    </KeypadProvider>,
  );
}

describe("the amount field", () => {
  test("TYPING 18500 NOW MEANS ₱18,500.00 — the amount the old placeholder implied", () => {
    const onSubmit = jest.fn();
    renderForm(<IncomeQuickForm wallets={[]} onSubmit={onSubmit} />);

    // THE EXAMPLE IS BACK, AND IT IS NOW TRUE. Task 5 had to delete
    // "Amount, e.g. 18500" because the field turned those digits into
    // ₱185.00 and no wording could fix an arithmetic lie. The empty field
    // carries it again because the two finally agree — which is the whole
    // claim this test makes, in the same breath as the typing below.
    expect(screen.getByTestId("income-quick-amount")).toHaveTextContent(/e\.g\.\s*18500/i);

    typeAmount("income-quick-amount", "18500");

    // Under the OLD rule this same keystroke sequence read ₱185.00. That is
    // the behaviour change, stated as an expectation rather than hidden
    // behind a retyped input.
    expect(screen.getByTestId("income-quick-amount")).toHaveTextContent("₱18,500");

    fireEvent.press(screen.getByTestId("income-quick-save"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ averageAmount: 1_850_000 }),
    );
  });

  test("what the field shows is what gets committed, centavos and all", () => {
    const onSubmit = jest.fn();
    renderForm(<IncomeQuickForm wallets={[]} onSubmit={onSubmit} />);

    // A fraction now exists only because the user asked for one — the whole
    // point of lib/money/peso_input.ts holding the typed string rather than a
    // number derived from it.
    typeAmount("income-quick-amount", "17500.50");
    expect(screen.getByTestId("income-quick-amount")).toHaveTextContent("₱17,500.50");

    fireEvent.press(screen.getByTestId("income-quick-save"));

    // Never a re-derivation that could disagree with what the user just read.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ averageAmount: 1_750_050 }),
    );
  });

  test("the step raises no system keyboard at all", () => {
    renderForm(<IncomeQuickForm wallets={[]} onSubmit={jest.fn()} />);

    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  });
});
