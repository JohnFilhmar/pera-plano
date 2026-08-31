// mobile/lib/ai/tools/__tests__/schemas.test.ts
//
// THESE SCHEMAS ARE THE GRAMMAR'S INPUT. Task 11 generates GBNF from them, and
// the spike measured what that means in practice: a POSITIVE grammar compels a
// format perfectly (0 malformed in 50 generations) while every attempt to write
// one that forbids a shape was defeated. So every constraint here has to be
// expressible as "the output looks like THIS" — an enum, a bounded integer —
// never as "the output is not that".
//
// The descriptions are load-bearing too: the model narrates from them, so a
// description that omits an exclusion produces a sentence that misstates what
// the number counts.
import { AI_PERIODS } from "../period_range";
import { LIMIT_MAX, LIMIT_MIN } from "../handlers/list_transactions";
import { TOOL_REGISTRY } from "../registry";
import { TOOL_SCHEMAS } from "../schemas";

const byName = new Map(TOOL_SCHEMAS.map((def) => [def.name, def]));

describe("the seven tools, and only the seven", () => {
  test("there are exactly seven", () => {
    expect(TOOL_SCHEMAS).toHaveLength(7);
  });

  test("every name is snake_case", () => {
    for (const def of TOOL_SCHEMAS) {
      expect(def.name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });

  test("names are unique", () => {
    expect(byName.size).toBe(TOOL_SCHEMAS.length);
  });

  test("the schemas and the registry describe the same seven tools", () => {
    // A tool in one and not the other is a tool the model can call and the
    // dispatcher cannot route, or vice versa.
    expect([...byName.keys()].sort()).toEqual(Object.keys(TOOL_REGISTRY).sort());
  });

  test("every registry entry carries its own definition", () => {
    for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
      expect(entry.def.name).toBe(name);
    }
  });
});

describe("period is the same four literals everywhere", () => {
  const withPeriod = TOOL_SCHEMAS.filter((def) => "period" in def.inputSchema.properties);

  test("at least one tool takes a period", () => {
    expect(withPeriod.length).toBeGreaterThan(0);
  });

  test.each(withPeriod.map((def) => [def.name, def] as const))(
    "%s declares period as an enum of exactly AI_PERIODS",
    (_name, def) => {
      // The grammar, the schema and resolvePeriod must agree. A period the
      // grammar permits but resolvePeriod cannot resolve is a crash on a path
      // the model can reach.
      expect(def.inputSchema.properties.period?.enum).toEqual([...AI_PERIODS]);
    },
  );
});

describe("list_transactions bounds its own arguments", () => {
  const def = byName.get("list_transactions");

  test("direction is an optional enum of in and out", () => {
    expect(def?.inputSchema.properties.direction?.enum).toEqual(["in", "out"]);
    expect(def?.inputSchema.required ?? []).not.toContain("direction");
  });

  test("limit is an integer clamped to the same range the handler clamps to", () => {
    // Clamped in BOTH places on purpose: the grammar is the first line and the
    // handler is the second, because a grammar protects the model's output and
    // not a caller who invokes the handler directly.
    const limit = def?.inputSchema.properties.limit;
    expect(limit?.type).toBe("integer");
    expect(limit?.minimum).toBe(LIMIT_MIN);
    expect(limit?.maximum).toBe(LIMIT_MAX);
  });
});

describe("descriptions state what the number leaves out", () => {
  test("every description is non-empty", () => {
    for (const def of TOOL_SCHEMAS) {
      expect(def.description.trim().length).toBeGreaterThan(0);
    }
  });

  test("balance descriptions name BOTH exclusions", () => {
    // The spec's table says "credit wallets excluded", which is half the rule
    // and names a column migration 014 dropped. The real exclusions are owed
    // balances and archived wallets, and the model narrates from this string.
    for (const name of ["get_balance_total", "get_wallets"]) {
      const description = byName.get(name)?.description ?? "";
      expect(description).toMatch(/owed/i);
      expect(description).toMatch(/archived/i);
    }
  });

  test("list_transactions says transfer legs are excluded", () => {
    // Moving money between your own wallets is not spending. A description
    // that omits this produces "you spent ₱5,000 on transfers".
    expect(byName.get("list_transactions")?.description ?? "").toMatch(/transfer/i);
  });

  test("get_spend_by_category says transfer legs are excluded", () => {
    expect(byName.get("get_spend_by_category")?.description ?? "").toMatch(/transfer/i);
  });

  test("no description promises advice", () => {
    // The assistant explains; it never advises (spec §0.1). A description
    // saying "recommends" or "should" invites exactly the sentence §3.6's
    // output guard then has to kill.
    for (const def of TOOL_SCHEMAS) {
      expect(def.description).not.toMatch(/\b(recommend|advise|you should)\b/i);
    }
  });
});

describe("every schema is expressible as a positive grammar", () => {
  test.each(TOOL_SCHEMAS.map((def) => [def.name, def] as const))(
    "%s constrains by shape, never by negation",
    (_name, def) => {
      // The spike proved GBNF cannot express "not that". Any schema keyword
      // that means exclusion has no grammar to generate.
      const serialised = JSON.stringify(def.inputSchema);
      expect(serialised).not.toMatch(/"(not|anyOf|oneOf|allOf)"/);
    },
  );

  test.each(TOOL_SCHEMAS.map((def) => [def.name, def] as const))(
    "%s declares object type and forbids extra properties",
    (_name, def) => {
      expect(def.inputSchema.type).toBe("object");
      // additionalProperties false is what lets the generator enumerate the
      // whole argument space, which is what makes a positive grammar possible.
      expect(def.inputSchema.additionalProperties).toBe(false);
    },
  );
});
