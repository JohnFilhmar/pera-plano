// components/ai/__tests__/chat_copy.test.ts
import { MONEY_TALK_NOTICE, answerNotice } from "../chat_copy";

test("a free-chat answer carries no notice at level 3", () => {
  expect(answerNotice(3, "April 2025")).toBeUndefined();
});

test("level 4 says the answer is general knowledge that can be wrong", () => {
  expect(answerNotice(4, "April 2025")).toBe(MONEY_TALK_NOTICE);
});

test("level 5 names the month the model's knowledge stops", () => {
  expect(answerNotice(5, "April 2025")).toBe(
    "From the model's memory. It can be wrong, and it knows nothing after April 2025.",
  );
});
