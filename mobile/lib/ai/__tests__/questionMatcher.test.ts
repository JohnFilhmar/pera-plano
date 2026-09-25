// mobile/lib/ai/__tests__/questionMatcher.test.ts
//
// Assistant levels spec §2. From level 2, typed text can ask one of the eight
// questions, and the app answers it exactly as if the chip were tapped. First
// match wins, so the order of the rows is part of what is tested here.
import { FIXED_QUESTIONS } from "../fixed_questions";
import { QUESTION_MATCH_ROWS, matchFixedQuestion } from "../questionMatcher";

const CASES: Array<[string, string]> = [
  ["How much money do I have?", "balance_total"],
  ["what's my balance", "balance_total"],
  ["Magkano pera ko?", "balance_total"],
  ["Magkano pa ang pera ko", "balance_total"],
  ["What wallets do I have?", "wallets"],
  ["Anong mga wallet ko?", "wallets"],
  ["How much can I spend?", "safe_to_spend"],
  ["Is it safe to spend today?", "safe_to_spend"],
  ["Magkano pwede kong gastusin?", "safe_to_spend"],
  ["How are my limits doing?", "limits"],
  ["Kumusta ang mga limit ko?", "limits"],
  ["Where did my money go?", "spend_this_month"],
  ["How much did I spend?", "spend_this_month"],
  ["Saan napunta ang pera ko?", "spend_this_month"],
  ["Magkano nagastos ko?", "spend_this_month"],
  ["Where did my money go last month?", "spend_last_month"],
  ["How much did I spend last month?", "spend_last_month"],
  ["Magkano nagastos ko noong nakaraang buwan?", "spend_last_month"],
  ["What have I spent on this month?", "transactions_this_month"],
  ["What did I buy?", "transactions_this_month"],
  ["Mga binili ko", "transactions_this_month"],
  ["What's my income?", "income"],
  ["How much do I earn?", "income"],
  ["Magkano ang sahod ko?", "income"],
  ["spending this month", "spend_this_month"],
  ["What did I buy last month?", "spend_last_month"],
];

test.each(CASES)("%s asks %s", (text, questionId) => {
  expect(matchFixedQuestion(text)?.id).toBe(questionId);
});

test.each([
  "What is bitcoin?",
  "Should I buy a new phone?",
  "hello",
  "My wallet is lost",
  // "nakita ko" is "I saw it": "kita ko" inside a longer word is not income.
  "Nakita ko siya kahapon",
  "Who was José Rizal?",
])("%s asks none of the questions", (text) => {
  expect(matchFixedQuestion(text)).toBeNull();
});

test("every row names a fixed question that exists", () => {
  const ids = new Set(FIXED_QUESTIONS.map((question) => question.id));
  for (const row of QUESTION_MATCH_ROWS) expect(ids.has(row.questionId)).toBe(true);
});

test("every fixed question can be typed in English and in Filipino", () => {
  for (const question of FIXED_QUESTIONS) {
    const languages = QUESTION_MATCH_ROWS.filter((row) => row.questionId === question.id).map((row) => row.language);
    expect(languages).toEqual(expect.arrayContaining(["en", "fil"]));
  }
});
