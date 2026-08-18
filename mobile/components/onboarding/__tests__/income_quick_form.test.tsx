// components/onboarding/__tests__/income_quick_form.test.tsx — task-5-brief:
// the amount field takes raw DIGITS through `centavosFromDigits` (so typing is
// in centavos), but it used to sit behind a placeholder reading
// "Amount, e.g. 18500" — which reads as eighteen thousand five hundred pesos
// and actually produces ₱185.00. The reporter typed 1750000 to reach the
// ₱17,500.00 they meant.
//
// THE FIX IS AmountNumpad, NOT A REWORDED PLACEHOLDER. A static "e.g." string
// is a claim nobody checks against the code the moment either one changes;
// AmountNumpad instead renders the peso string FROM the digits, live, on every
// keystroke (its own header: "the peso string is rendered FROM those digits
// and never parsed back"), so the field cannot say one thing and do another —
// there is no separate claim left to drift from the behaviour.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { IncomeQuickForm } from "../income_quick_form";

/** Presses one numpad key per digit, in order — the numpad's own interaction,
 * not a `changeText` shortcut a bare TextInput would have accepted. */
function typeDigits(digits: string): void {
  for (const digit of digits) {
    fireEvent.press(screen.getByTestId(`numpad-key-${digit}`));
  }
}

describe("the amount field", () => {
  test("typing the placeholder's own example produces the amount it implies", () => {
    render(<IncomeQuickForm wallets={[]} onSubmit={jest.fn()} />);

    // The OLD placeholder ("Amount, e.g. 18500") is gone outright — there is no
    // static text left on screen for the field's actual behaviour to
    // contradict.
    expect(screen.queryByText(/e\.g\.\s*18500/i)).toBeNull();

    // What replaced it says, live, exactly what those same five digits mean:
    // ₱185.00 under this field's own centavos-by-digit rule — not a value a
    // static example silently promised and never delivered.
    typeDigits("18500");

    expect(screen.getByTestId("numpad-amount")).toHaveTextContent("₱185.00");
  });

  test("the preview matches the committed value", () => {
    const onSubmit = jest.fn();
    render(<IncomeQuickForm wallets={[]} onSubmit={onSubmit} />);

    // The real repro: typing 1750000 to reach ₱17,500.00.
    typeDigits("1750000");
    expect(screen.getByTestId("numpad-amount")).toHaveTextContent("₱17,500.00");

    fireEvent.press(screen.getByTestId("income-quick-save"));

    // What got committed is exactly what the preview showed before the tap —
    // never a re-derivation that could disagree with what the user just read.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ averageAmount: 1_750_000 }));
  });
});
