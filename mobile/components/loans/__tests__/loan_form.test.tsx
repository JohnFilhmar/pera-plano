// components/loans/__tests__/loan_form.test.tsx — m2b Task 8, rule 3. Amount,
// rate, term and the three flat-loan fields now go through the shared keypad,
// and the first-due date through DateField's calendar picker
// (numeric-input-system Task 10) — this is the one form that exercises all
// three keypad modes (peso, rate, integer) at once.
//
// STATE STAYS INSIDE THE FORM. Unlike manual entry (Task 9), this screen
// never auto-opens the panel on mount, so there is no reason to lift any of
// its fields' text up to the route — this is a component swap, not a state
// rewrite.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { addMonthsClampedIso, toDateIso } from "@/lib/dates";
import { clearAmount, typeAmount } from "@/test_support/keypad";
import type { Loan } from "@/types/domain";

import { LoanForm, loanFormInitialFrom } from "../loan_form";
import type { LoanFormInitial, LoanFormValues } from "../loan_form";

// DateField (inside the amortized/flat branches) imports the native picker at
// module load regardless of which branch a test ever renders, matching
// components/ui/__tests__/date_field.test.tsx's own mock and
// manual_entry_form.test.tsx's. `mock`-prefixed so babel-plugin-jest-hoist
// allows the factory to close over it.
let mockPickedDate = new Date(2026, 7, 13);
// Captures the `minimumDate` the real DateTimePicker would have received, so
// a test can assert the bound is actually wired up (numeric-input-system
// Task 10 fix round — same pattern as manual_entry_form.test.tsx's own
// mockReceivedMaximumDate). The mock itself is deliberately permissive (it
// fires `onChange` with `mockPickedDate` regardless of this bound) the way
// the real OS dialog is NOT.
let mockReceivedMinimumDate: Date | undefined;

jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({
      onChange,
      minimumDate,
    }: {
      onChange: (event: { type: string }, date?: Date) => void;
      minimumDate?: Date;
    }) => {
      mockReceivedMinimumDate = minimumDate;
      return (
        <Pressable testID="date-picker-pick" onPress={() => onChange({ type: "set" }, mockPickedDate)}>
          <Text>pick</Text>
        </Pressable>
      );
    },
  };
});

// NumericField throws without a KeypadProvider above it, and the panel it
// opens has to be hosted somewhere — see test_support/keypad.ts's header.
function renderForm(initial?: LoanFormInitial) {
  const onSubmit = jest.fn();
  render(
    <KeypadProvider>
      <LoanForm onSubmit={onSubmit} initial={initial} />
      <KeypadHost />
    </KeypadProvider>,
  );
  return { onSubmit };
}

const submitted = (onSubmit: jest.Mock): LoanFormValues => onSubmit.mock.calls[0][0];

/** Opens the date field, mock-picks the given local day, and closes the dialog. */
function pickDate(testID: string, year: number, month: number, day: number): void {
  mockPickedDate = new Date(year, month - 1, day);
  fireEvent.press(screen.getByTestId(testID));
  fireEvent.press(screen.getByTestId("date-picker-pick"));
}

/**
 * A twelve-month bank loan whose first payment fell on 2026-03-15 — the shape
 * the EDIT screen hands this form through `loanFormInitialFrom`.
 *
 * The due dates are SPELLED OUT rather than generated, so the round-trip test
 * below asserts against dates this file states rather than against whatever
 * `buildAmortizationSchedule` happens to produce for the same inputs.
 */
const STORED_DUE_DATES = [
  "2026-03-15",
  "2026-04-15",
  "2026-05-15",
  "2026-06-15",
  "2026-07-15",
  "2026-08-15",
  "2026-09-15",
  "2026-10-15",
  "2026-11-15",
  "2026-12-15",
  "2027-01-15",
  "2027-02-15",
];

const inProgressLoan: Loan = {
  id: "loan-1",
  direction: "i-owe",
  counterparty: "GLoan",
  principal: 5_000_000,
  interestRate: 12,
  schedule: STORED_DUE_DATES.map((dueDate) => ({
    dueDate,
    amountDue: 444_244,
    principalPortion: 394_244,
    interestPortion: 50_000,
  })),
  linkedWalletId: null,
  nextDueDate: "2026-03-15",
  nextDueAmount: 444_244,
  reminderOffsets: [-3, 0, 3],
  archivedAt: null,
  createdAt: 1_000,
  updatedAt: 1_000,
};

test("THE FORM DEFAULTS TO FREE-FORM, and free-form asks for nothing extra", () => {
  // Rule 3: free-form "asks for nothing beyond principal and counterparty".
  // Most informal borrowing has no terms, so the default should not make the
  // user dismiss fields they will never fill in.
  renderForm();

  expect(screen.queryByTestId("loan-amortized-fields")).toBeNull();
  expect(screen.queryByTestId("loan-flat-fields")).toBeNull();
  expect(screen.queryByTestId("loan-first-due")).toBeNull();
});

test("RATE AND TERM APPEAR ONLY FOR AMORTIZED", () => {
  renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  screen.getByTestId("loan-rate");
  screen.getByTestId("loan-term");

  fireEvent.press(screen.getByTestId("loan-kind-flat"));
  expect(screen.queryByTestId("loan-rate")).toBeNull();
});

test("THE RATE FIELD STATES ITS UNIT, and keeps stating it once a rate is typed", () => {
  // Spec rule 3: the rate "is entered with an explicit per-month or per-annum
  // unit — ... a silently misread unit would corrupt every number
  // downstream". loan_math.ts reads it per annum (`rate / 100 / 12`), so the
  // copy has to say per year, and it has to keep saying it AFTER a value is
  // entered: NumericField shows the placeholder only while the field is
  // empty, so a unit that lives only there is gone exactly when the user is
  // reviewing what they typed.
  renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  screen.getByText("Annual rate and term");
  screen.getByText("The rate is per year. A lender quoting 2% a month means 24% here.");

  typeAmount("loan-rate", "12");

  // The placeholder is gone, as designed — the unit must not have gone with it.
  expect(screen.queryByText("Annual rate %, e.g. 12")).toBeNull();
  screen.getByText("The rate is per year. A lender quoting 2% a month means 24% here.");
  // And the unit a screen reader hears is the same one, not a bare "12%".
  expect(screen.getByTestId("loan-rate").props.accessibilityLabel).toBe("Annual rate, 12%");
});

test("A FLAT LOAN IS NEVER ASKED FOR A RATE", () => {
  // Spec rule 4: 5-6 "is modeled as flat or free-form only. The app never
  // derives or displays an interest rate for it." A rate field on this branch
  // would invite the user to enter one and the app to show it back.
  renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-flat"));

  screen.getByTestId("loan-installment");
  screen.getByTestId("loan-count");
  screen.getByTestId("loan-interval");
  expect(screen.queryByTestId("loan-rate")).toBeNull();
});

test("THE AMORTIZED FORM PREVIEWS THE MONTHLY PAYMENT LIVE", () => {
  // Rule 3. It is the only place the user sees what a rate and term actually
  // cost per month before committing to them — and it is the worked vector.
  renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  // ₱50,000 principal — the old test typed "5000000" as raw centavo digits;
  // under the new peso-first reading the same amount is "50000".
  typeAmount("loan-principal", "50000");
  typeAmount("loan-rate", "12");
  typeAmount("loan-term", "12");

  screen.getByText("About ₱4,442.44 a month.");
});

test("the preview updates as the term changes", () => {
  renderForm();
  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  typeAmount("loan-principal", "50000");
  typeAmount("loan-rate", "12");
  typeAmount("loan-term", "12");
  screen.getByText("About ₱4,442.44 a month.");

  // A field already holding "12" would APPEND "24" onto it rather than
  // replace it — clear first, the way backspacing the field would.
  clearAmount("loan-term");
  typeAmount("loan-term", "24");

  expect(screen.queryByText("About ₱4,442.44 a month.")).toBeNull();
  screen.getByTestId("loan-payment-preview");
});

test("a zero-rate amortized loan previews without NaN", () => {
  // Family lending at no interest is the common case, not an edge one.
  renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  // ₱12,000 — the old test typed "1200000" as raw centavo digits.
  typeAmount("loan-principal", "12000");
  typeAmount("loan-term", "12");

  screen.getByText("About ₱1,000.00 a month.");
});

test("CHOOSING 'OWED TO ME' RESETS THE SCHEDULE TO FREE-FORM", () => {
  // Rule 3: "Default to free-form for 'owed to me' — personal lending rarely
  // has terms." Applied on the switch, not only at first render: a user who
  // picks it after setting up an amortized loan is telling us this is personal.
  renderForm();
  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  screen.getByTestId("loan-amortized-fields");

  fireEvent.press(screen.getByTestId("loan-direction-owed-to-me"));

  expect(screen.queryByTestId("loan-amortized-fields")).toBeNull();
});

test("a free-form loan saves with no schedule and no rate", () => {
  const { onSubmit } = renderForm();

  fireEvent.changeText(screen.getByTestId("loan-counterparty"), "Aling Nena");
  // ₱5,000 — the old test typed "500000" as raw centavo digits.
  typeAmount("loan-principal", "5000");
  fireEvent.press(screen.getByTestId("loan-save"));

  expect(submitted(onSubmit)).toMatchObject({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 500000,
    interestRate: null,
    schedule: null,
    nextDueDate: null,
    // Rule 15's default three — a loan that specifies nothing keeps them.
    reminderOffsets: [-3, 0, 3],
  });
});

// ---------------------------------------------------------------------------
// Reminders — rule 15, migration 008. Same picker as bill_form.tsx.
// ---------------------------------------------------------------------------
test("THE REMINDER CONTROL RENDERS WITH THE SPEC'S THREE OFFSETS PRE-SELECTED", () => {
  renderForm();

  for (const testID of ["loan-offset--3", "loan-offset-0", "loan-offset-3"]) {
    expect(screen.getByTestId(testID).props.accessibilityState.selected).toBe(true);
  }
});

test("DESELECTING EVERY OFFSET SHOWS THE NO-NOTIFICATIONS COPY AND SUBMITS AN EMPTY ARRAY", () => {
  // Rule 15: "many 5-6 borrowers do not want a due-date reminder for a
  // collector who simply shows up" — turning reminders off is a real choice.
  const { onSubmit } = renderForm();

  fireEvent.press(screen.getByTestId("loan-offset--3"));
  fireEvent.press(screen.getByTestId("loan-offset-0"));
  fireEvent.press(screen.getByTestId("loan-offset-3"));
  screen.getByText("No notifications. The loan still shows its due date in the app.");

  fireEvent.changeText(screen.getByTestId("loan-counterparty"), "Aling Nena");
  typeAmount("loan-principal", "5000");
  fireEvent.press(screen.getByTestId("loan-save"));

  expect(submitted(onSubmit).reminderOffsets).toEqual([]);
});

test("TOGGLING TO A CUSTOM SUBSET SUBMITS EXACTLY THAT SUBSET", () => {
  const { onSubmit } = renderForm();

  fireEvent.press(screen.getByTestId("loan-offset-3")); // deselect "3 days after"
  fireEvent.changeText(screen.getByTestId("loan-counterparty"), "Aling Nena");
  typeAmount("loan-principal", "5000");
  fireEvent.press(screen.getByTestId("loan-save"));

  expect(submitted(onSubmit).reminderOffsets).toEqual([-3, 0]);
});

test("an amortized loan saves a MATERIALIZED schedule with its splits", () => {
  const { onSubmit } = renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  fireEvent.changeText(screen.getByTestId("loan-counterparty"), "GLoan");
  typeAmount("loan-principal", "50000");
  typeAmount("loan-rate", "12");
  typeAmount("loan-term", "12");
  pickDate("loan-first-due", 2026, 9, 15);
  fireEvent.press(screen.getByTestId("loan-save"));

  const values = submitted(onSubmit);
  expect(values.schedule).toHaveLength(12);
  expect(values.schedule?.[0]).toEqual({
    dueDate: "2026-09-15",
    amountDue: expect.any(Number),
    principalPortion: expect.any(Number),
    interestPortion: expect.any(Number),
  });
  expect(values.interestRate).toBe(12);
  expect(values.nextDueDate).toBe("2026-09-15");
});

test("A FLAT LOAN'S PRINCIPAL IS THE TOTAL REPAYABLE, not the cash borrowed", () => {
  // Spec rule 2: "Flat: total repayable minus the sum of paymentHistory[]."
  // Borrow ₱5,000 and repay ₱6,000 in six ₱1,000 instalments, and the app
  // tracks ₱6,000 down to zero — tracking the ₱5,000 instead would report the
  // loan settled while ₱1,000 was still owed.
  const { onSubmit } = renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-flat"));
  fireEvent.changeText(screen.getByTestId("loan-counterparty"), "Aling Nena");
  // The principal field itself is not what gets submitted for a flat loan
  // (installment * count is, below) — any positive amount just satisfies
  // canSave.
  typeAmount("loan-principal", "5000");
  // ₱1,000 each — the old test typed "100000" as raw centavo digits.
  typeAmount("loan-installment", "1000");
  typeAmount("loan-count", "6");
  // Already the field's own default; cleared and retyped so the test states
  // its dependency on interval=7 explicitly instead of leaning on that default.
  clearAmount("loan-interval");
  typeAmount("loan-interval", "7");
  pickDate("loan-first-due", 2026, 8, 22);
  screen.getByText("₱6,000.00 in total.");
  fireEvent.press(screen.getByTestId("loan-save"));

  const values = submitted(onSubmit);
  expect(values.principal).toBe(600000);
  expect(values.interestRate).toBeNull();
  expect(values.schedule).toHaveLength(6);
  // No split — the interest is already inside the stated installment.
  expect(values.schedule?.[0].interestPortion).toBeUndefined();
});

test("the form cannot be saved without a counterparty and an amount", () => {
  const { onSubmit } = renderForm();

  fireEvent.press(screen.getByTestId("loan-save"));
  fireEvent.changeText(screen.getByTestId("loan-counterparty"), "Aling Nena");
  fireEvent.press(screen.getByTestId("loan-save"));

  expect(onSubmit).not.toHaveBeenCalled();
});

test("a scheduled loan cannot be saved without a first due date", () => {
  const { onSubmit } = renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  fireEvent.changeText(screen.getByTestId("loan-counterparty"), "GLoan");
  typeAmount("loan-principal", "50000");
  typeAmount("loan-term", "12");
  fireEvent.press(screen.getByTestId("loan-save"));

  expect(onSubmit).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// A loan that started before it was entered.
//
// The first-due field used to carry `minimumDate={new Date()}`, on the theory
// that "a first payment is always in the future". It is not: a bank loan taken
// out in March and entered in September has its real first due in the past,
// and so does almost every loan reopened on the EDIT screen. The floor did not
// merely refuse those dates — the OS dialog opens CLAMPED to the floor, so
// tapping the field and confirming what it shows re-dated every installment
// the save rebuilds from it.
// ---------------------------------------------------------------------------
test("THE FIRST-DUE PICKER IMPOSES NO FLOOR, so a loan that already started can be entered", () => {
  renderForm();
  fireEvent.press(screen.getByTestId("loan-kind-amortized"));

  // A sentinel rather than a bare `toBeUndefined()`, so this asserts the
  // picker really rendered and wrote its bound back, not merely that nothing
  // in this file ever set the variable.
  mockReceivedMinimumDate = new Date(2000, 0, 1);
  fireEvent.press(screen.getByTestId("loan-first-due"));

  expect(mockReceivedMinimumDate).toBeUndefined();
});

test("A LOAN SIX MONTHS OLD SAVES ITS REAL FIRST DUE, and the form counts what is already due", () => {
  // Derived from the wall clock rather than hard-coded: this form reads
  // `new Date()` with no injected clock, and the count below is a claim about
  // "six months ago" that a literal date would stop making next year.
  const started = addMonthsClampedIso(toDateIso(new Date()), -6);
  const [year, month, day] = started.split("-").map(Number);

  const { onSubmit } = renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  fireEvent.changeText(screen.getByTestId("loan-counterparty"), "GLoan");
  typeAmount("loan-principal", "50000");
  typeAmount("loan-rate", "12");
  typeAmount("loan-term", "12");
  pickDate("loan-first-due", year, month, day);

  // Installments 1 through 7 — six months back, up to and including the one
  // falling this month — have come round. The eighth is a month out.
  screen.getByText("7 payments are already due.");

  fireEvent.press(screen.getByTestId("loan-save"));

  const values = submitted(onSubmit);
  expect(values.schedule).toHaveLength(12);
  expect(values.schedule?.[0].dueDate).toBe(started);
  expect(values.nextDueDate).toBe(started);
});

test("EDITING AN IN-PROGRESS LOAN LEAVES EVERY INSTALLMENT DATE AS STORED", () => {
  // The half of this that silently corrupts data. The edit screen seeds
  // `firstDue` from `schedule[0].dueDate` and the save REBUILDS the schedule
  // from it, so anything that moves that one date re-dates the whole repayment
  // plan — for someone who opened the screen to fix a typo in the lender's
  // name. Freeze the clock so "in progress" is a fact of the fixture rather
  // than of the day this suite happens to run.
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 7, 9, 0));
  try {
    const { onSubmit } = renderForm(loanFormInitialFrom(inProgressLoan));

    // Seeded with the stored date, and the picker is offered no floor above
    // it — a floor at today is what would clamp this to 2026-09-07 the moment
    // the user opened the dialog.
    expect(screen.getByTestId("loan-first-due").props.accessibilityLabel).toBe(
      "First payment due, 2026-03-15",
    );
    mockReceivedMinimumDate = new Date(2000, 0, 1);
    fireEvent.press(screen.getByTestId("loan-first-due"));
    expect(mockReceivedMinimumDate).toBeUndefined();
    // March through August fell before 2026-09-07; the September 15th one has not.
    screen.getByText("6 payments are already due.");

    // The whole edit: a typo in the lender's name.
    fireEvent.changeText(screen.getByTestId("loan-counterparty"), "GLoan PH");
    fireEvent.press(screen.getByTestId("loan-save"));

    const values = submitted(onSubmit);
    expect(values.counterparty).toBe("GLoan PH");
    expect(values.schedule?.map((row) => row.dueDate)).toEqual(STORED_DUE_DATES);
    expect(values.nextDueDate).toBe("2026-03-15");
    expect(values.interestRate).toBe(12);
  } finally {
    jest.useRealTimers();
  }
});

// ---------------------------------------------------------------------------
// The behaviour change — numeric-input-system Task 10. Typed digits are now
// read as PESOS, not centavos: "13437.72" means ₱13,437.72, not the
// ₱134,377.20 the old centavo-digit reading would have produced.
// ---------------------------------------------------------------------------
test("a P13,437.72 loan is entered as 13437.72", () => {
  renderForm();

  typeAmount("loan-principal", "13437.72");

  expect(screen.getByTestId("loan-principal-preview").props.children).toBe("₱13,437.72");
});
