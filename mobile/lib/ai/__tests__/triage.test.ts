// mobile/lib/ai/__tests__/triage.test.ts
//
// THIS IS CODE AND NOT A SYSTEM-PROMPT LINE for the reason spec §4.1 gives: a
// prompt saying "never give financial advice" holds roughly 80% of the time on
// the 4B and far less on the 0.6B, "and it fails in the direction that matters:
// the user asks a third time, and the model caves. A guardrail that weakens
// under persistence is not a guardrail; it is a speed bump in front of exactly
// the user who most wants to get past it."
//
// THE FILIPINO COLUMN IS NOT DECORATION. Users code-switch mid-sentence; a
// table that holds only in English holds for none of the questions that
// actually get typed.
import { TOOL_NAMES } from "../tools/registry";
import { ADVICE_ROWS, classify } from "../triage";

/** Spec §4.2's four classes, both language columns. */
const PRESCRIPTIVE: Array<[string, string]> = [
  // Permission-seeking
  ["permission", "Should I buy this jacket?"],
  ["permission", "Is it okay to eat out tonight?"],
  ["permission", "Dapat ba akong bumili ng bagong phone?"],
  ["permission", "Pwede ba akong mag-shopping this weekend?"],
  // Affordability
  ["affordability", "Can I afford a new laptop?"],
  ["affordability", "Do I have enough to go on this trip?"],
  ["affordability", "Kaya ko ba bumili ng sasakyan?"],
  // Worth / comparison
  ["worth", "Is it worth subscribing to Netflix?"],
  ["worth", "Which is better, Grab or a jeep?"],
  ["worth", "Sulit ba ang gym membership?"],
  // Open-ended direction
  ["direction", "What should I do with my savings?"],
  ["direction", "How do I save more money?"],
  ["direction", "Paano ako makaka-ipon ng pera?"],
];

/**
 * These MUST pass through. Every one contains a word that appears in the advice
 * table, and every one is a computation about the ledger.
 */
const EXPLANATORY: string[] = [
  // The spec names this one explicitly as the boundary case.
  "How much should I have left this month?",
  "What's the most I've spent on a single thing?",
  "Where did my money go last month?",
  "Saan napunta ang pera ko?",
  "Magkano na nagastos ko this month?",
  "How much did I spend on food?",
  "What is my biggest category?",
  "How much do I have altogether?",
  "Am I close to my limit?",
  "Ilan ang wallets ko?",
  // Contains "afford" only as part of a factual question about the past.
  "How much have I spent on transport in the last 7 days?",
];

describe("prescriptive input never reaches generation", () => {
  test.each(PRESCRIPTIVE)("[%s] %s", (_klass, input) => {
    expect(classify(input).kind).toBe("advice");
  });
});

describe("explanatory input passes through", () => {
  test.each(EXPLANATORY.map((input) => [input] as const))("%s", (input) => {
    expect(classify(input).kind).toBe("explanatory");
  });
});

describe("the redirect always carries data", () => {
  // Spec §4.3: "a refusal with no data attached is a failed redirect." The
  // check is parameterised over the whole table so a new row CANNOT be added
  // without one.
  test.each(ADVICE_ROWS.map((row) => [row.id, row] as const))(
    "%s names at least one tool to answer with",
    (_id, row) => {
      expect(row.redirectTools.length).toBeGreaterThan(0);
    },
  );

  test.each(PRESCRIPTIVE)("[%s] %s produces redirect tools", (_klass, input) => {
    const verdict = classify(input);
    if (verdict.kind !== "advice") throw new Error("expected an advice verdict");
    expect(verdict.redirectTools.length).toBeGreaterThan(0);
  });
});

describe("matching is insensitive to how people actually type", () => {
  test("case does not matter", () => {
    expect(classify("SHOULD I BUY THIS?").kind).toBe("advice");
    expect(classify("should i buy this").kind).toBe("advice");
  });

  test("punctuation does not matter", () => {
    expect(classify("Should I... buy this?!").kind).toBe("advice");
  });

  test("extra whitespace does not matter", () => {
    expect(classify("  Should   I    buy  this?  ").kind).toBe("advice");
  });

  test("an empty or blank input is explanatory, not advice", () => {
    // A blank input is the user pressing send by accident. Refusing it with a
    // lecture about financial advice would be absurd.
    expect(classify("").kind).toBe("explanatory");
    expect(classify("   ").kind).toBe("explanatory");
  });
});

describe("word boundaries, so a substring is not a match", () => {
  test("'shoulder' is not 'should'", () => {
    expect(classify("How much did I spend on shoulder surgery?").kind).toBe("explanatory");
  });

  test("'affordable' in a factual question is not 'can I afford'", () => {
    expect(classify("Which of my categories was the most affordable?").kind).toBe(
      "explanatory",
    );
  });

  test("'kayo' is not 'kaya ko ba'", () => {
    expect(classify("Magkano ang nagastos kayo last month?").kind).toBe("explanatory");
  });
});

describe("the table is data, and every row is well formed", () => {
  // §5.7: this table "is expected to grow forever and is structured for it".
  test("row ids are unique", () => {
    const ids = ADVICE_ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every row declares a language, so the Filipino column cannot rot", () => {
    const languages = new Set(ADVICE_ROWS.map((row) => row.language));
    expect(languages.has("en")).toBe(true);
    expect(languages.has("fil")).toBe(true);
  });

  test("every row names a real tool", () => {
    // A redirect naming a tool that does not exist is a refusal with no data
    // attached wearing a disguise — spec §4.3's failed redirect.
    for (const row of ADVICE_ROWS) {
      for (const tool of row.redirectTools) {
        expect(TOOL_NAMES).toContain(tool);
      }
    }
  });
});

describe("level 5 needs a money word before an advice row counts (levels spec §3)", () => {
  test("a non-money should-I goes on to the model at level 5", () => {
    expect(classify("Should I learn Python or Java?", 5)).toEqual({ kind: "explanatory" });
  });

  test("the same question is still an advice row below level 5", () => {
    expect(classify("Should I learn Python or Java?", 4).kind).toBe("advice");
  });

  test("a money should-I is still redirected at level 5", () => {
    expect(classify("Should I buy a new phone?", 5).kind).toBe("advice");
  });

  test("Filipino money advice is still redirected at level 5", () => {
    expect(classify("Dapat ba akong mag-ipon?", 5).kind).toBe("advice");
  });
});
