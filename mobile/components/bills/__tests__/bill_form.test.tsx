// components/bills/__tests__/bill_form.test.tsx — m2c Task 5, rules 4 and 6.
//
// The form, and the preview that is the whole reason the picker exists: "the
// preview is what catches a misconfigured rule before it silently misfires for
// months."
//
// The amount field and every LabelledNumber inside DueRulePicker now go
// through the shared keypad (numeric-input-system Task 11) — peso mode for
// the amount, integer mode for day-of-month/interval counts. STATE STAYS
// INSIDE THE FORM: neither BillForm nor DueRulePicker auto-opens the panel,
// so this is a component swap, not a state rewrite.
import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { BillForm } from "@/components/bills/bill_form";
import { DueRulePicker } from "@/components/bills/due_rule_picker";
import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { typeAmount } from "@/test_support/keypad";
import type { DueRule } from "@/types/domain";

/** A Friday, so no weekday adjustment perturbs the previews. */
const TODAY = "2026-02-20";

// NumericField (inside BillForm's amount field and DueRulePicker's
// LabelledNumber) throws without a KeypadProvider above it, and the panel it
// opens has to be hosted somewhere — see test_support/keypad.ts's header.
function renderForm(ui: ReactElement) {
  return render(
    <KeypadProvider>
      {ui}
      <KeypadHost />
    </KeypadProvider>,
  );
}

function renderPicker(initial: DueRule) {
  const onChange = jest.fn();
  const view = renderForm(
    <DueRulePicker testID="picker" value={initial} onChange={onChange} today={TODAY} />,
  );
  return { onChange, view };
}

// ---------------------------------------------------------------------------
// The preview — rule 4
// ---------------------------------------------------------------------------
test("THE PICKER PREVIEWS THE NEXT THREE OCCURRENCES", () => {
  renderPicker({ kind: "day-of-month", day: 20 });

  screen.getByTestId("due-preview-2026-03-20");
  screen.getByTestId("due-preview-2026-04-20");
  screen.getByTestId("due-preview-2026-05-20");
});

test("THE PREVIEW SHOWS FEBRUARY CLAMPING, WHICH IS THE POINT", () => {
  // "Every 31st" looks right until February. Three real dates make it obvious
  // at the moment of choosing rather than eleven months later.
  renderPicker({ kind: "day-of-month", day: 31 });

  screen.getByTestId("due-preview-2026-02-28");
  screen.getByTestId("due-preview-2026-03-31");
  screen.getByTestId("due-preview-2026-04-30");
});

test("CHANGING THE RULE UPDATES THE PREVIEW", () => {
  const { onChange, view } = renderPicker({ kind: "day-of-month", day: 20 });

  fireEvent.press(screen.getByTestId("due-kind-last-day-of-month"));

  expect(onChange).toHaveBeenCalledWith({ kind: "last-day-of-month" });
  // The picker is controlled, so the caller feeds the new value back.
  view.rerender(
    <KeypadProvider>
      <DueRulePicker
        testID="picker"
        value={{ kind: "last-day-of-month" }}
        onChange={onChange}
        today={TODAY}
      />
      <KeypadHost />
    </KeypadProvider>,
  );
  screen.getByTestId("due-preview-2026-02-28");
  screen.getByTestId("due-preview-2026-03-31");
});

test("semi-monthly previews both of its dates", () => {
  renderPicker({ kind: "semi-monthly" });

  screen.getByTestId("due-preview-2026-02-28");
  screen.getByTestId("due-preview-2026-03-15");
  screen.getByTestId("due-preview-2026-03-31");
});

test("A WEEK-BASED RULE IS NOT OFFERED THE WEEKEND SHIFT", () => {
  // The spec scopes the adjustment to month-based rules, and offering it here
  // would ask the user to overrule the only thing a weekly rule says.
  const { view } = renderPicker({ kind: "day-of-month", day: 20 });
  screen.getByTestId("due-adjust-earlier");

  view.rerender(
    <KeypadProvider>
      <DueRulePicker
        testID="picker"
        value={{ kind: "every-n-weeks", n: 2, weekday: 5, anchorDate: TODAY }}
        onChange={jest.fn()}
        today={TODAY}
      />
      <KeypadHost />
    </KeypadProvider>,
  );

  expect(screen.queryByTestId("due-adjust-earlier")).toBeNull();
  // ...and the fields that rule DOES need are offered instead.
  screen.getByTestId("due-every-n-weeks");
  screen.getByTestId("due-weekday-5");
});

test("switching kinds always yields a VALID rule, never a half-built one", () => {
  // `every-n-weeks` needs an anchor and a weekday; a switch that emitted the
  // kind alone would produce a rule the engine cannot evaluate.
  const { onChange } = renderPicker({ kind: "day-of-month", day: 20 });

  fireEvent.press(screen.getByTestId("due-kind-every-n-weeks"));

  expect(onChange).toHaveBeenCalledWith({
    kind: "every-n-weeks",
    n: 2,
    weekday: 5, // 2026-02-20 is a Friday
    anchorDate: TODAY,
  });
});

test("THE DAY-OF-MONTH FIELD OPENS THE KEYPAD IN INTEGER MODE", () => {
  // A day has no fraction — the decimal key must be genuinely inert, not
  // merely dimmed (numeric_keypad.test.tsx proves the key itself; this proves
  // DueRulePicker actually threads `mode="integer"` through rather than
  // NumericField's own peso default).
  renderPicker({ kind: "day-of-month", day: 20 });

  fireEvent.press(screen.getByTestId("due-day"));

  expect(screen.getByTestId("keypad-key-.").props.accessibilityState.disabled).toBe(true);
});

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------
test("a bill saves from a name, an amount and the default rule", () => {
  const onSubmit = jest.fn();
  renderForm(<BillForm today={TODAY} onSubmit={onSubmit} />);

  fireEvent.changeText(screen.getByTestId("bill-name"), "Meralco");
  // ₱2,350 — the old test typed "235000" as raw centavo digits.
  typeAmount("bill-amount", "2350");
  fireEvent.press(screen.getByTestId("bill-save"));

  expect(onSubmit).toHaveBeenCalledWith({
    name: "Meralco",
    amount: 235000,
    amountMode: "estimated",
    dueRule: { kind: "day-of-month", day: 20 },
    reminderOffsets: [-3, 0],
  });
});

test("THE DEFAULT REMINDERS ARE THE SPEC'S, WITHOUT TOUCHING ANYTHING", () => {
  // Rule 10 and an acceptance criterion: "3 days before + on the due date" are
  // created without user configuration.
  const onSubmit = jest.fn();
  renderForm(<BillForm today={TODAY} onSubmit={onSubmit} />);

  expect(screen.getByTestId("bill-offset--3").props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId("bill-offset-0").props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId("bill-offset--7").props.accessibilityState.selected).toBe(false);
});

test("reminders can be turned off entirely, and the form says what that means", () => {
  // Rule 12 keeps the in-app card either way, so no notifications is a real
  // choice rather than a mistake to block.
  const onSubmit = jest.fn();
  renderForm(<BillForm today={TODAY} onSubmit={onSubmit} />);

  fireEvent.press(screen.getByTestId("bill-offset--3"));
  fireEvent.press(screen.getByTestId("bill-offset-0"));

  screen.getByText("No notifications. The bill still shows as due in the app.");
  fireEvent.changeText(screen.getByTestId("bill-name"), "Meralco");
  // ₱1,000 — the old test typed "100000" as raw centavo digits.
  typeAmount("bill-amount", "1000");
  fireEvent.press(screen.getByTestId("bill-save"));
  expect(onSubmit.mock.calls[0][0].reminderOffsets).toEqual([]);
});

test("choosing FIXED changes the question asked about the amount", () => {
  // A user who picks Fixed for Meralco will fight the app every month; one who
  // picks Estimated for rent sees a `~` on a figure that never moves. Asking
  // the question properly is the only place to prevent both.
  renderForm(<BillForm today={TODAY} onSubmit={jest.fn()} />);
  screen.getByText("Roughly how much?");

  fireEvent.press(screen.getByTestId("bill-mode-fixed"));

  screen.getByText("How much is it?");
  expect(screen.queryByText("A starting figure. It updates itself from what you actually pay.")).toBeNull();
});

test("the form refuses to save without a name or an amount", () => {
  const onSubmit = jest.fn();
  renderForm(<BillForm today={TODAY} onSubmit={onSubmit} />);

  fireEvent.press(screen.getByTestId("bill-save"));
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByTestId("bill-name"), "Meralco");
  fireEvent.press(screen.getByTestId("bill-save"));
  expect(onSubmit).not.toHaveBeenCalled();
});

test("THERE IS NO TIER GATE ON THIS FORM", () => {
  // Rule 6: "bills are core control, and a capped bill list would make Free-tier
  // Safe-to-Spend dishonest". An untracked bill is a missed payment.
  renderForm(<BillForm today={TODAY} onSubmit={jest.fn()} />);

  expect(screen.queryByText(/Plus/)).toBeNull();
  expect(screen.queryByText(/upgrade/i)).toBeNull();
});

// ---------------------------------------------------------------------------
// The behaviour change — numeric-input-system Task 11. Typed digits are now
// read as PESOS, not centavos: "2350.75" means ₱2,350.75, not the
// ₱23,507.50 the old centavo-digit reading would have produced.
// ---------------------------------------------------------------------------
test("a bill amount is entered in pesos, not centavos", () => {
  const onSubmit = jest.fn();
  renderForm(<BillForm today={TODAY} onSubmit={onSubmit} />);

  fireEvent.changeText(screen.getByTestId("bill-name"), "Meralco");
  typeAmount("bill-amount", "2350.75");
  // The preview and the field's own display both read "₱2,350.75" once the
  // panel closes — asserting the specific testID avoids an ambiguous match
  // between the two (m2 pre-flight defect #1's exact shape).
  expect(screen.getByTestId("bill-amount-preview").props.children).toBe("₱2,350.75");
  fireEvent.press(screen.getByTestId("bill-save"));

  expect(onSubmit.mock.calls[0][0].amount).toBe(235075);
});
