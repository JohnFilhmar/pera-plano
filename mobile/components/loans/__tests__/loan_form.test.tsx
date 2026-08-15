// components/loans/__tests__/loan_form.test.tsx — m2b Task 8, rule 3.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { LoanForm } from "../loan_form";
import type { LoanFormValues } from "../loan_form";

function renderForm() {
  const onSubmit = jest.fn();
  render(<LoanForm onSubmit={onSubmit} />);
  return { onSubmit };
}

const submitted = (onSubmit: jest.Mock): LoanFormValues => onSubmit.mock.calls[0][0];

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
  fireEvent.changeText(screen.getByTestId("loan-principal"), "5000000");
  fireEvent.changeText(screen.getByTestId("loan-rate"), "12");
  fireEvent.changeText(screen.getByTestId("loan-term"), "12");

  screen.getByText("About ₱4,442.44 a month.");
});

test("the preview updates as the term changes", () => {
  renderForm();
  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  fireEvent.changeText(screen.getByTestId("loan-principal"), "5000000");
  fireEvent.changeText(screen.getByTestId("loan-rate"), "12");
  fireEvent.changeText(screen.getByTestId("loan-term"), "12");
  screen.getByText("About ₱4,442.44 a month.");

  fireEvent.changeText(screen.getByTestId("loan-term"), "24");

  expect(screen.queryByText("About ₱4,442.44 a month.")).toBeNull();
  screen.getByTestId("loan-payment-preview");
});

test("a zero-rate amortized loan previews without NaN", () => {
  // Family lending at no interest is the common case, not an edge one.
  renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  fireEvent.changeText(screen.getByTestId("loan-principal"), "1200000");
  fireEvent.changeText(screen.getByTestId("loan-term"), "12");

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
  fireEvent.changeText(screen.getByTestId("loan-principal"), "500000");
  fireEvent.press(screen.getByTestId("loan-save"));

  expect(submitted(onSubmit)).toMatchObject({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 500000,
    interestRate: null,
    schedule: null,
    nextDueDate: null,
  });
});

test("an amortized loan saves a MATERIALIZED schedule with its splits", () => {
  const { onSubmit } = renderForm();

  fireEvent.press(screen.getByTestId("loan-kind-amortized"));
  fireEvent.changeText(screen.getByTestId("loan-counterparty"), "GLoan");
  fireEvent.changeText(screen.getByTestId("loan-principal"), "5000000");
  fireEvent.changeText(screen.getByTestId("loan-rate"), "12");
  fireEvent.changeText(screen.getByTestId("loan-term"), "12");
  fireEvent.changeText(screen.getByTestId("loan-first-due"), "2026-09-15");
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
  fireEvent.changeText(screen.getByTestId("loan-principal"), "500000");
  fireEvent.changeText(screen.getByTestId("loan-installment"), "100000");
  fireEvent.changeText(screen.getByTestId("loan-count"), "6");
  fireEvent.changeText(screen.getByTestId("loan-interval"), "7");
  fireEvent.changeText(screen.getByTestId("loan-first-due"), "2026-08-22");
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
  fireEvent.changeText(screen.getByTestId("loan-principal"), "5000000");
  fireEvent.changeText(screen.getByTestId("loan-term"), "12");
  fireEvent.press(screen.getByTestId("loan-save"));

  expect(onSubmit).not.toHaveBeenCalled();
});
