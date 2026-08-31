// mobile/lib/ai/tools/__tests__/grammar.test.ts
//
// TWO COMPLEMENTARY HALVES, because neither alone is enough (spec §5.2 item 3):
//
//   - GOLDEN SNAPSHOTS, one per tool, read by a human once. Cheap, catches
//     drift.
//   - PROPERTY ASSERTIONS on the emitted rule set. A snapshot records what the
//     compiler DID, not what it should have done, so the negative property —
//     no literal appears that is not in the schema — is the one that catches a
//     compiler bug the snapshots would happily bless.
//
// NEITHER HALF PROVES llama.cpp's GBNF parser agrees with our reading of the
// format. That is the spike's job and it is already done: the format compiled
// here is the one `D:\llama_probe\lib\grammar_fixture.ts` proved on the real
// decoder on 2026-08-31, 3/3 exact tool calls and 0 malformed in 50.
import { FORCED_ANSWER_GRAMMAR, compileGrammar } from "../grammar";
import { TOOL_SCHEMAS } from "../schemas";

const GRAMMAR = compileGrammar(TOOL_SCHEMAS);

/** Every JSON string that the grammar permits the model to emit. */
function jsonStringLiterals(grammar: string): string[] {
  return [...grammar.matchAll(/\\"([^"\\]*)\\"/g)].map((match) => match[1]);
}

describe("golden snapshots", () => {
  test.each(TOOL_SCHEMAS.map((def) => [def.name, def] as const))("%s", (_name, def) => {
    expect(compileGrammar([def])).toMatchSnapshot();
  });

  test("the whole registry", () => {
    expect(GRAMMAR).toMatchSnapshot();
  });
});

describe("every enum literal in the schema reaches the grammar", () => {
  const enumValues = TOOL_SCHEMAS.flatMap((def) =>
    Object.values(def.inputSchema.properties).flatMap((property) => property.enum ?? []),
  );

  test("there are some, so this suite is not vacuous", () => {
    expect(enumValues.length).toBeGreaterThan(0);
  });

  test.each([...new Set(enumValues)])("%s appears as an exact quoted alternative", (value) => {
    expect(GRAMMAR).toContain(`"\\"${value}\\""`);
  });

  test("every tool name appears exactly once", () => {
    for (const def of TOOL_SCHEMAS) {
      expect(GRAMMAR.split(`\\"${def.name}\\"`).length - 1).toBe(1);
    }
  });
});

describe("and NO literal appears that is not in the schema", () => {
  // This is the assertion that catches the failure that lets a model emit a
  // fifth period. A snapshot cannot: it would record the fifth period as the
  // expected output and go green forever.
  test("every JSON string the grammar permits is a tool name, a property name, or an enum value", () => {
    const permitted = new Set<string>(["tool", "args"]);
    for (const def of TOOL_SCHEMAS) {
      permitted.add(def.name);
      for (const [name, property] of Object.entries(def.inputSchema.properties)) {
        permitted.add(name);
        for (const value of property.enum ?? []) permitted.add(value);
      }
    }

    const emitted = jsonStringLiterals(GRAMMAR);
    expect(emitted.length).toBeGreaterThan(0);
    for (const literal of emitted) {
      expect(permitted.has(literal)).toBe(true);
    }
  });
});

describe("bounded integers are enumerated, never a digit class", () => {
  test("limit is an explicit 1-20 alternation", () => {
    expect(GRAMMAR).toContain('"1"');
    expect(GRAMMAR).toContain('"20"');
    expect(GRAMMAR).not.toContain('"0"');
    expect(GRAMMAR).not.toContain('"21"');
  });

  test("no digit character class anywhere", () => {
    // `[0-9]+` would let the model ask for 900 transactions, and the handler's
    // clamp would silently answer a different question than the one the model
    // thought it asked.
    expect(GRAMMAR).not.toContain("[0-9]");
    expect(GRAMMAR).not.toContain("\\d");
  });
});

describe("positive grammars only", () => {
  // THE SPIKE'S CENTRAL FINDING (2026-08-31): GBNF is excellent at compelling a
  // format and useless at forbidding one. Every attempt to express "anything
  // except a tool call" failed, and each fix revealed the next escape — brace,
  // then bracket, then carriage return, then a degenerate base64 alphabet. So
  // this compiler describes a TARGET SHAPE and never a complement.
  test("the root is a tool call and nothing else", () => {
    expect(GRAMMAR).toMatch(/^root\s+::=\s+tool-call\s*$/m);
  });

  test("there is no prose branch", () => {
    // The plan's original Task 11 asked for one. The spike refuted it: a prose
    // branch can only be written as a complement, and `prose ::= [^{] [^\n]*`
    // — the spec's own fixture — was defeated 3/3 by prefixing "(", a space, or
    // a ```json fence. The answer round runs UNCONSTRAINED instead; see
    // FORCED_ANSWER_GRAMMAR.
    expect(GRAMMAR).not.toContain("prose");
  });

  test("no negated character class anywhere", () => {
    expect(GRAMMAR).not.toContain("[^");
  });

  test("the forced-answer round carries no grammar at all", () => {
    expect(FORCED_ANSWER_GRAMMAR).toBeNull();
  });
});

describe("compiler failure modes are loud", () => {
  test("an empty tool list throws rather than emitting an unsatisfiable root", () => {
    expect(() => compileGrammar([])).toThrow();
  });

  test("an optional property with no required property throws", () => {
    // The comma placement in a JSON object is only decidable when at least one
    // member is always present. Emitting a grammar for this shape would produce
    // `{,"limit":3}`, so it fails loudly instead.
    expect(() =>
      compileGrammar([
        {
          name: "hypothetical",
          description: "",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "integer", description: "", minimum: 1, maximum: 2 },
            },
            required: [],
            additionalProperties: false,
          },
        },
      ]),
    ).toThrow();
  });
});
