// mobile/lib/ai/__tests__/normalise.test.ts
//
// Every typed-text table (triage, small talk, the level-2 matcher, the money
// words) matches against this one function, so its three rules are pinned here.
import { normalise } from "../normalise";

test("lowercases, drops punctuation and collapses spaces", () => {
  expect(normalise("  Should I...   BUY this?! ")).toBe("should i buy this");
});

test("keeps the hyphen the Filipino rows are spelled with", () => {
  expect(normalise("Paano ako mag-ipon?")).toBe("paano ako mag-ipon");
});

test("drops the peso sign, which is why mentionsMoney checks for it first", () => {
  expect(normalise("₱500.00")).toBe("500 00");
});
