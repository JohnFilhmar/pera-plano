// components/ai/__tests__/TranscriptMessage.test.tsx
//
// One message, by kind. The kinds added for the answer levels are pinned here;
// the older kinds are exercised end to end by chat_surface.test.tsx.
import { render, screen } from "@testing-library/react-native";

import { FREE_CHAT_REPLACED, TOO_LONG_REPLY, answeringLabel } from "../chat_copy";
import { TranscriptMessage } from "../TranscriptMessage";

test("an answer to a typed question is labelled with the question it answered", () => {
  render(
    <TranscriptMessage
      message={{ id: "m1", kind: "assistant", text: "You have ₱50.00 in total.", answering: "How much money do I have?" }}
    />,
  );
  expect(screen.getByTestId("ai-answering")).toHaveTextContent(answeringLabel("How much money do I have?"));
});

test("a free-chat answer shows its notice under the text", () => {
  render(
    <TranscriptMessage
      message={{ id: "m1", kind: "assistant", text: "An emergency fund is money set aside.", notice: "It can be wrong." }}
    />,
  );
  expect(screen.getByTestId("ai-answer-notice")).toHaveTextContent("It can be wrong.");
});

test("a plain answer carries neither label nor notice", () => {
  render(<TranscriptMessage message={{ id: "m1", kind: "assistant", text: "You have ₱50.00 in total." }} />);
  expect(screen.queryByTestId("ai-answering")).toBeNull();
  expect(screen.queryByTestId("ai-answer-notice")).toBeNull();
});

test.each(["ungrounded", "advice", "contact", "unreadable"] as const)("a %s answer is replaced by its line", (failure) => {
  render(<TranscriptMessage message={{ id: "m1", kind: "replaced", failure, language: "en" }} />);
  expect(screen.getByText(FREE_CHAT_REPLACED[failure].en)).toBeTruthy();
});

test("a too-long message gets its line in the message's language", () => {
  render(<TranscriptMessage message={{ id: "m1", kind: "too_long", language: "fil" }} />);
  expect(screen.getByText(TOO_LONG_REPLY.fil)).toBeTruthy();
});
