// mobile/lib/ai/__tests__/small_talk.test.ts
//
// Through `classify`, not `matchSmallTalk` alone, so the normalisation a real
// message goes through is part of every case.
import { guessLanguage } from "../small_talk";
import { classify } from "../triage";

test.each([
  ["hello", "greeting", "en"],
  ["Hi!", "greeting", "en"],
  ["Good morning po", "greeting", "en"],
  ["Kumusta?", "greeting", "fil"],
  ["Magandang gabi po", "greeting", "fil"],
  ["Thank you!", "thanks", "en"],
  ["Maraming salamat po", "thanks", "fil"],
  ["What can you do?", "help", "en"],
  ["Ano kaya mo?", "help", "fil"],
  ["bye", "goodbye", "en"],
  ["Paalam", "goodbye", "fil"],
])("%j is small talk: %s, answered in %s", (input, talk, language) => {
  expect(classify(input)).toEqual({ kind: "smalltalk", talk, language });
});

test.each([
  "hi, how much money do I have",
  "hello what are my limits",
  "thanks, and my wallets?",
  "Kumusta ang gastos ko?",
])("%j carries a real question, so it is not small talk", (input) => {
  expect(classify(input).kind).not.toBe("smalltalk");
});

test("advice still wins over nothing: small talk never swallows a should-I question", () => {
  expect(classify("Should I buy a new phone?").kind).toBe("advice");
});

test.each([
  ["Magkano pera ko?", "fil"],
  ["Pakita mo yung gastos ko", "fil"],
  ["How much money do I have?", "en"],
  ["What's the weather tomorrow?", "en"],
])("%j is answered in %s", (input, language) => {
  expect(guessLanguage(input)).toBe(language);
});
