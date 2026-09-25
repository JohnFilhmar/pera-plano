// mobile/lib/ai/__tests__/money_words.test.ts
//
// Assistant levels spec §3. Level 5 lets a "should I" question reach the model
// unless it is about money; this list decides "about money". Both known error
// directions are pinned so the accepted behaviour stays visible.
import { mentionsMoney } from "../money_words";

test.each([
  "Should I buy a new phone?",
  "Is it worth the price?",
  "Dapat ba akong mag-ipon?",
  "Magkano ang utang ko?",
  "Should I take that loan?",
  "It costs ₱500.00",
])("%s is about money", (text) => {
  expect(mentionsMoney(text)).toBe(true);
});

test.each(["Should I learn Python or Java?", "Should I bring an umbrella today?", "Who was José Rizal?"])(
  "%s is not about money",
  (text) => {
    expect(mentionsMoney(text)).toBe(false);
  },
);

test("false positives are the safe direction, and pinned so they stay visible", () => {
  // "Mahal kita" is "I love you". The level-5 redirect is the price of the word.
  expect(mentionsMoney("Should I tell her mahal kita?")).toBe(true);
  expect(mentionsMoney("Should I follow my interest in painting?")).toBe(true);
});

test("the accepted false negative: a purchase question with no money word", () => {
  // Accepted by the owner on 2026-09-25 (spec §3). The answer is still guarded
  // if it mentions a price, buying or affording.
  expect(mentionsMoney("Should I get the new iPhone?")).toBe(false);
});
