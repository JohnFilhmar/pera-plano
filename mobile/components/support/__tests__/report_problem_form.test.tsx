// components/support/__tests__/report_problem_form.test.tsx — the form's own
// rules: nothing is submitted half-filled, and what it hands up is trimmed.
//
// NO NETWORK ANYWHERE IN THIS FILE. The form is presentational — it has never
// heard of the outbox — which is exactly what makes these assertions about
// validation and payload shape, and not about sending.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { ReportProblemForm } from "../report_problem_form";

function fillValid(): void {
  fireEvent.press(screen.getByTestId("support-topic-app_crash_or_freeze"));
  fireEvent.changeText(screen.getByTestId("support-title"), "  App closes on the Wallets tab  ");
  fireEvent.changeText(
    screen.getByTestId("support-description"),
    "  Opening Wallets closes the app every time since this morning.  ",
  );
}

test("nothing is submitted until every required field is answered", () => {
  const onSubmit = jest.fn();
  render(<ReportProblemForm onSubmit={onSubmit} />);

  fireEvent.press(screen.getByTestId("support-submit"));

  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByTestId("support-topic-error")).toBeTruthy();
  expect(screen.getByTestId("support-title-error")).toBeTruthy();
  expect(screen.getByTestId("support-description-error")).toBeTruthy();
});

// A form that scolds you before you have reached the field is a form people
// abandon — and this one is reached by people already annoyed.
test("errors stay hidden until the first send attempt", () => {
  render(<ReportProblemForm onSubmit={jest.fn()} />);

  expect(screen.queryByTestId("support-title-error")).toBeNull();
  expect(screen.queryByTestId("support-topic-error")).toBeNull();
});

test("a one-word description is not enough to send", () => {
  const onSubmit = jest.fn();
  render(<ReportProblemForm onSubmit={onSubmit} />);

  fireEvent.press(screen.getByTestId("support-topic-other"));
  fireEvent.changeText(screen.getByTestId("support-title"), "Broken");
  fireEvent.changeText(screen.getByTestId("support-description"), "bad");
  fireEvent.press(screen.getByTestId("support-submit"));

  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByTestId("support-description-error")).toBeTruthy();
});

test("a complete report is handed up trimmed, with the topic the user picked", () => {
  const onSubmit = jest.fn();
  render(<ReportProblemForm onSubmit={onSubmit} />);

  fillValid();
  fireEvent.press(screen.getByTestId("support-submit"));

  expect(onSubmit).toHaveBeenCalledWith({
    title: "App closes on the Wallets tab",
    description: "Opening Wallets closes the app every time since this morning.",
    topic: "app_crash_or_freeze",
  });
});

// No pre-selected chip: a default topic is the answer most people leave in
// place, which turns the routing field into noise.
test("no topic is selected until the user picks one", () => {
  const onSubmit = jest.fn();
  render(<ReportProblemForm onSubmit={onSubmit} />);

  fireEvent.changeText(screen.getByTestId("support-title"), "Something broke");
  fireEvent.changeText(
    screen.getByTestId("support-description"),
    "It broke while I was adding a wallet.",
  );
  fireEvent.press(screen.getByTestId("support-submit"));

  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByTestId("support-topic-error")).toBeTruthy();
});

// The sentence is the feature's only disclosure of what leaves the phone, and
// it is shown BEFORE Send, not after.
test("the form states what will be shared, before anything is sent", () => {
  render(<ReportProblemForm onSubmit={jest.fn()} />);

  expect(
    screen.getByText(/shares your title, description, topic and any files you attached/i),
  ).toBeTruthy();
});
