// mobile/lib/ai/__tests__/output_guard.test.ts
//
// The guard runs AFTER generation, on prose that already passed grounding. It
// is the second half of a pair: grounding says the numbers are real, the guard
// says the sentence is not advice and carries nothing that was fabricated by
// definition. Spec §4.4.
//
// THE SURVIVORS MATTER AS MUCH AS THE SUPPRESSIONS. A guard that fires on
// "Considering only this month" is a guard that suppresses honest answers, and
// the surface then degrades to a card for no reason the user can see. Every
// pattern here is word-boundary matched, and the imperative class is anchored
// to sentence position.
import { guard, guardAtLevel } from "../output_guard";

describe("prescriptive modals", () => {
  test.each([
    "You should move ₱500.00 into savings.",
    "I recommend keeping ₱2,400.00 aside.",
    "Try to keep Groceries under ₱3,000.00.",
    "Consider your Transport spending.",
    "You'd be better off paying the card first.",
    "You need to cut Groceries.",
    "I suggest a smaller limit.",
  ])("%s is suppressed", (prose) => {
    expect(guard(prose)).toEqual({ suppressed: true, reason: "prescriptive" });
  });
});

describe("the named survivors", () => {
  // Spec §4.4 names both of these explicitly. They are descriptive sentences
  // that contain a prescriptive word as a substring, and they must survive.
  test.each([
    "Considering only this month, Groceries is your largest category.",
    "Your Groceries limit is set to ₱3,000.",
  ])("%s survives", (prose) => {
    expect(guard(prose)).toEqual({ suppressed: false });
  });

  test("a plain factual answer survives", () => {
    expect(guard("You spent ₱2,400.00 on Groceries in March.")).toEqual({ suppressed: false });
  });

  test("a noun that shares a stem with an imperative survives", () => {
    // "Transfers" is a noun here and never sits at a sentence position aimed
    // at the user.
    expect(guard("Transfers to Savings totalled ₱1,200.00.")).toEqual({ suppressed: false });
  });
});

describe("imperatives aimed at the user", () => {
  test.each([
    "Call the bank now.",
    "Go to your account settings.",
    "Click the link below.",
    "Transfer ₱500.00 to the account.",
    "Sign up for the premium plan.",
    "Your balance is ₱18,320.00. Please call this number.",
  ])("%s is suppressed", (prose) => {
    expect(guard(prose)).toEqual({ suppressed: true, reason: "imperative" });
  });
});

describe("contact details are a hard discard", () => {
  // No tool result ever legitimately contains a URL or a phone number, so one
  // in an answer is fabricated BY DEFINITION. Spec §4.4: the most dangerous
  // injection payload a financial app can render is a phone number next to a
  // real balance.
  test.each([
    "See https://example.com/refund for details.",
    "Visit www.example.com.",
    "Details at example.com.",
    "Your balance is ₱18,320.00. Text 09171234567.",
    "Your balance is ₱18,320.00. Reach us at +63 917 123 4567.",
    "Your balance is ₱18,320.00. Hotline (02) 8888-1234.",
    "Landline 8888-1234 is on file.",
  ])("%s is suppressed", (prose) => {
    expect(guard(prose)).toEqual({ suppressed: true, reason: "contact" });
  });

  test("a formatted peso figure is not mistaken for a phone number", () => {
    expect(guard("You spent ₱1,234.56 and ₱8,888.00 this month.")).toEqual({ suppressed: false });
  });

  test("an ISO date is not mistaken for a phone number", () => {
    expect(guard("Your period ends 2026-03-31.")).toEqual({ suppressed: false });
  });
});

describe("the verdict carries the class that fired", () => {
  test("so the surface can log which guard degraded the answer", () => {
    const verdict = guard("You should call 09171234567.");
    expect(verdict.suppressed).toBe(true);
    // Contact is checked first: it is the hard discard, and it is the class a
    // reviewer most needs to see in the log.
    expect(verdict).toEqual({ suppressed: true, reason: "contact" });
  });
});

describe("the guard at each level (levels spec §5.1)", () => {
  test("level 5: non-money advice wording survives", () => {
    expect(guardAtLevel("You should bring an umbrella today.", { level: 5, question: "Will it rain?" })).toEqual({
      suppressed: false,
    });
  });

  test("level 5: advice wording about money is still suppressed, found in the answer", () => {
    expect(guardAtLevel("You should buy the cheaper phone.", { level: 5, question: "Which phone is nicer?" })).toEqual({
      suppressed: true,
      reason: "prescriptive",
    });
  });

  test("level 5: advice wording is suppressed when the question was about money", () => {
    expect(guardAtLevel("You should do it next month.", { level: 5, question: "When should I pay my loan?" })).toEqual({
      suppressed: true,
      reason: "prescriptive",
    });
  });

  test("level 5: contact details are suppressed whatever the topic", () => {
    expect(guardAtLevel("Visit example.com for the forecast.", { level: 5, question: "Will it rain?" })).toEqual({
      suppressed: true,
      reason: "contact",
    });
  });

  test("levels 1 to 4 keep the whole guard", () => {
    expect(guardAtLevel("You should bring an umbrella today.", { level: 4, question: "Will it rain?" })).toEqual({
      suppressed: true,
      reason: "prescriptive",
    });
  });
});
