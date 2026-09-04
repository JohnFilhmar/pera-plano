// components/support/__tests__/report_problem_form.test.tsx — the form's own
// rules: nothing is submitted half-filled, and what it hands up is trimmed.
//
// NO NETWORK ANYWHERE IN THIS FILE. The form is presentational — it has never
// heard of the outbox — which is exactly what makes these assertions about
// validation and payload shape, and not about sending.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { getDeviceHeaders } from "@/services/device_info";
import { supportReportParts } from "@/services/support_reports";
import type { SupportReport } from "@/types/support";

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

// ---------------------------------------------------------------------------
// The disclosure tells the truth about the wire — GAP-088. It used to name the
// four things the user typed or picked and then claim "nothing else from the
// app is included", while `supportReportParts` also carried a report id, the
// time the report was written and the send-attempt count, and `apiClient`'s
// request interceptor added four device headers on top. Harmless fields, a
// false sentence, on the one screen where the user consents to sending data.
//
// THE WIRE IS THE SOURCE OF TRUTH HERE, not a copy of the sentence: the test
// walks the real payload and the real headers, so a field added to either with
// no matching phrase fails this rather than shipping undisclosed.
// ---------------------------------------------------------------------------
const DISCLOSED: Record<string, RegExp> = {
  reportId: /a report id/i,
  title: /your title/i,
  description: /description/i,
  topic: /topic/i,
  createdAt: /when you wrote it/i,
  attemptCount: /how many send attempts it took/i,
  attachments: /any files you attached/i,
  "X-App-Version": /the app version/i,
  "X-Device-OS": /phone system/i,
  "X-Device-OS-Version": /system version/i,
  "X-Client-Type": /the mobile app/i,
};

const REPORT: SupportReport = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Transfers show up twice",
  description: "Sent money from GCash to BPI and both legs landed as spending.",
  topic: "wrong_amount_or_wallet",
  status: "queued",
  attemptCount: 2,
  nextAttemptAt: 0,
  lastError: null,
  createdAt: 0,
  updatedAt: 0,
  sentAt: null,
  ticketRef: null,
  attachments: [
    {
      id: "a-1",
      reportId: "11111111-2222-3333-4444-555555555555",
      fileUri: "file:///documents/support/shot.png",
      mimeType: "image/png",
      byteSize: 1024,
      createdAt: 0,
    },
  ],
};

test("the disclosure names EVERY field the report actually sends", async () => {
  render(<ReportProblemForm onSubmit={jest.fn()} />);
  const disclosure = String(screen.getByTestId("support-disclosure").props.children);

  const onTheWire = [
    ...new Set(supportReportParts(REPORT).map(([name]) => name)),
    ...Object.keys(await getDeviceHeaders()),
  ];

  for (const field of onTheWire) {
    const phrase = DISCLOSED[field];
    // A field with no entry above is a field nobody wrote a sentence for.
    expect(phrase).toBeDefined();
    expect(disclosure).toMatch(phrase);
  }
});

// The absolute claim is what made the old sentence false; it stays, and it is
// now true.
test("the disclosure still promises nothing else, and that nothing goes before Send", () => {
  render(<ReportProblemForm onSubmit={jest.fn()} />);
  const disclosure = String(screen.getByTestId("support-disclosure").props.children);

  expect(disclosure).toMatch(/Nothing else from the app is included/i);
  expect(disclosure).toMatch(/nothing is sent until you press Send/i);
});
