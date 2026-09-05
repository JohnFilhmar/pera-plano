// lib/ingest/__tests__/ruleset_schema.test.ts — the validation boundary for a
// ruleset that arrives from outside the app.
//
// The cases here are written as ATTACKS, not as shapes: each one is something
// a hostile `GET /v1/parser_rules` host (or anyone able to intercept TLS to
// it) could send that the pre-schema check — "every `match` compiles" —
// accepted and stored verbatim. Well-typed and catastrophic is the whole
// problem: `autoCommitThreshold: 0` is a perfectly ordinary number.
import seedJson from "@/assets/parser_rules/seed.json";
import {
  MAX_PATTERN_CHARS,
  MAX_TEMPLATES_PER_BUNDLE,
  PATTERN_PROBE_BUDGET_MS,
  inspectPattern,
  parseRulesetBundle,
  probePatternCost,
  rulesetBundleSchema,
} from "@/lib/ingest/ruleset_schema";
import type { ProviderRuleset, ProviderTemplate } from "@/lib/ingest/ruleset_types";

function template(overrides: Partial<ProviderTemplate> = {}): ProviderTemplate {
  return {
    id: "t1",
    match: "(?<amount>(?:₱|PHP\\s?)[\\d,]+\\.\\d{2})",
    direction: "out",
    confidence: 1,
    ...overrides,
  };
}

function provider(overrides: Partial<ProviderRuleset> = {}): ProviderRuleset {
  return {
    providerKey: "test_provider",
    packageNames: ["com.example.test"],
    version: 1,
    channel: "push",
    templates: [template()],
    ...overrides,
  };
}

function bundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 2, providers: [provider()], ...overrides };
}

/** The reason string, or a failure the caller can read when a bundle wrongly passed. */
function rejectionReason(input: unknown): string {
  const result = parseRulesetBundle(input);
  return result.ok ? "ACCEPTED" : result.reason;
}

// ---------------------------------------------------------------------------
// The shipped seed. If this ever goes red the schema has been tightened past
// what the app itself ships, and every device would refuse its own catalogue.
// ---------------------------------------------------------------------------

test("the bundled seed parses", () => {
  expect(parseRulesetBundle(seedJson).ok).toBe(true);
});

test("every pattern in the bundled seed passes the structural check", () => {
  const seed = seedJson as unknown as { providers: ProviderRuleset[] };
  const rejected = seed.providers.flatMap((p) =>
    p.templates.filter((t) => inspectPattern(t.match) !== null).map((t) => `${p.providerKey}/${t.id}`),
  );

  expect(rejected).toEqual([]);
});

test("every pattern in the bundled seed runs well inside the probe budget", () => {
  const seed = seedJson as unknown as { providers: ProviderRuleset[] };
  const worst = Math.max(
    ...seed.providers.flatMap((p) => p.templates.map((t) => probePatternCost(t.match))),
  );

  expect(worst).toBeLessThan(PATTERN_PROBE_BUDGET_MS);
});

test("the seed's `_note` keys are stripped rather than rejected", () => {
  const result = parseRulesetBundle(seedJson);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.bundle).not.toHaveProperty("_note");
  expect(result.bundle.providers).toHaveLength(13);
});

// ---------------------------------------------------------------------------
// Shape. Every payload below compiles as a regex and would have been stored.
// ---------------------------------------------------------------------------

test("a provider whose fields are the wrong types is rejected", () => {
  const wrongShape = {
    version: 2,
    providers: [
      {
        providerKey: 42,
        packageNames: "com.example.test",
        version: "one",
        channel: "carrier_pigeon",
        templates: [{ id: null, match: "ok", confidence: "high" }],
      },
    ],
  };

  expect(rejectionReason(wrongShape)).not.toBe("ACCEPTED");
});

test("a bundle that is not an object at all is rejected", () => {
  expect(rejectionReason("providers")).not.toBe("ACCEPTED");
  expect(rejectionReason(null)).not.toBe("ACCEPTED");
  expect(rejectionReason([provider()])).not.toBe("ACCEPTED");
});

test("a fractional or unsafe bundle version is rejected", () => {
  expect(rejectionReason(bundle({ version: 2.5 }))).not.toBe("ACCEPTED");
  expect(rejectionReason(bundle({ version: 1e21 }))).not.toBe("ACCEPTED");
  expect(rejectionReason(bundle({ version: 0 }))).not.toBe("ACCEPTED");
});

test("unknown keys are stripped, not rejected and not kept", () => {
  const result = parseRulesetBundle(bundle({ payload: "x".repeat(1000), _note: "hello" }));

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(Object.keys(result.bundle).sort()).toEqual(["providers", "version"]);
});

// ---------------------------------------------------------------------------
// Tunable ranges. THE POINT OF THE SCHEMA: each of these is well-typed.
// ---------------------------------------------------------------------------

test("an autoCommitThreshold of 0 is rejected", () => {
  expect(rejectionReason(bundle({ tunables: { autoCommitThreshold: 0 } }))).not.toBe("ACCEPTED");
});

test("thresholds out of order are rejected even when each is in range", () => {
  const reason = rejectionReason(
    bundle({ tunables: { autoCommitThreshold: 0.6, prefilledThreshold: 0.8 } }),
  );

  expect(reason).toContain("thresholds out of order");
});

test("a lowered autoCommitThreshold is checked against the defaults it will merge over", () => {
  // 0.55 is inside its own range but lands under the DEFAULT prefilledThreshold
  // of 0.60, which is the value it will actually run beside.
  expect(rejectionReason(bundle({ tunables: { autoCommitThreshold: 0.55 } }))).toContain(
    "thresholds out of order",
  );
  expect(rejectionReason(bundle({ tunables: { autoCommitThreshold: 0.75 } }))).toBe("ACCEPTED");
});

test("a non-finite or non-numeric tunable is rejected", () => {
  expect(rejectionReason(bundle({ tunables: { transferFeeRate: Number.NaN } }))).not.toBe("ACCEPTED");
  expect(rejectionReason(bundle({ tunables: { dedupeStrongWindowMs: Infinity } }))).not.toBe("ACCEPTED");
  expect(rejectionReason(bundle({ tunables: { prefilledThreshold: "0.7" } }))).not.toBe("ACCEPTED");
});

test("a dedupe window wide enough to swallow real transactions is rejected", () => {
  const tenYears = 10 * 365 * 24 * 60 * 60 * 1000;

  expect(rejectionReason(bundle({ tunables: { dedupeStrongWindowMs: tenYears } }))).not.toBe(
    "ACCEPTED",
  );
});

test("a penalty outside 0..1 is rejected", () => {
  expect(rejectionReason(bundle({ tunables: { penalties: { weakDirection: 5 } } }))).not.toBe(
    "ACCEPTED",
  );
});

test("a half-stated walletTraits block is rejected rather than merged", () => {
  // `withDefaultTunables` spreads walletTraits whole, so the two absent fields
  // would come out `undefined` and every comparison against them false.
  expect(rejectionReason(bundle({ tunables: { walletTraits: { owedSampleFloor: 5 } } }))).not.toBe(
    "ACCEPTED",
  );
});

test("an owedSampleFloor of 0 is rejected", () => {
  const tunables = { walletTraits: { owedMarginThreshold: 300, owedSampleFloor: 0, priorWeight: 100 } };

  expect(rejectionReason(bundle({ tunables }))).not.toBe("ACCEPTED");
});

// ---------------------------------------------------------------------------
// Pattern cost.
// ---------------------------------------------------------------------------

test("inspectPattern names the reason a pattern is refused", () => {
  expect(inspectPattern("(unterminated")).toBe("pattern_uncompilable");
  expect(inspectPattern("a".repeat(MAX_PATTERN_CHARS + 1))).toBe("pattern_too_long");
  expect(inspectPattern("^(a+)+$")).toBe("pattern_nested_quantifier");
  expect(inspectPattern("^(a|a)*$")).toBe("pattern_nested_quantifier");
  expect(inspectPattern("(?:\\w+\\s?){2,}")).toBe("pattern_nested_quantifier");
  expect(inspectPattern("a*".repeat(13))).toBe("pattern_too_many_quantifiers");
});

test("inspectPattern reads escapes and character classes as literals", () => {
  expect(inspectPattern("\\(a\\+\\)\\+")).toBeNull();
  expect(inspectPattern("[(+*)]+")).toBeNull();
  // `(...)?` tries a group once and cannot enumerate splits — the form the
  // seed uses on almost every optional clause.
  expect(inspectPattern("(?:[\\s\\S]*?\\bRef\\b)?")).toBeNull();
});

test("a bundle carrying a catastrophic pattern is rejected", () => {
  const hostile = bundle({
    providers: [provider({ templates: [template({ match: "^(a+)+$" })] })],
  });

  expect(rejectionReason(hostile)).toContain("pattern_nested_quantifier");
});

test("the timing probe alone separates a catastrophic pattern from a shipped one", () => {
  // The structural check catches `(a+)+$` first, so probe it directly: this is
  // the layer that has to hold when a pattern wears an innocent shape.
  expect(probePatternCost("^(a+)+$")).toBeGreaterThan(PATTERN_PROBE_BUDGET_MS);
  expect(probePatternCost("(?<amount>(?:₱|PHP\\s?)[\\d,]+\\.\\d{2})")).toBeLessThan(
    PATTERN_PROBE_BUDGET_MS,
  );
});

test("an over-long pattern is rejected by the schema, not just by inspectPattern", () => {
  const long = bundle({
    providers: [provider({ templates: [template({ match: "a".repeat(MAX_PATTERN_CHARS + 1) })] })],
  });

  expect(rejectionReason(long)).not.toBe("ACCEPTED");
});

// ---------------------------------------------------------------------------
// Volume.
// ---------------------------------------------------------------------------

test("more templates than the per-bundle cap is rejected", () => {
  const templates = Array.from({ length: 33 }, (_, i) => template({ id: `t${i}` }));
  const providers = Array.from({ length: 20 }, (_, i) =>
    provider({ providerKey: `p${i}`, templates }),
  );

  expect(rejectionReason(bundle({ providers }))).toContain(
    `more than ${MAX_TEMPLATES_PER_BUNDLE} templates`,
  );
});

test("an empty providers array is rejected", () => {
  expect(rejectionReason(bundle({ providers: [] }))).not.toBe("ACCEPTED");
});

test("a trait signal with a hostile weight or an unbounded phrase is rejected", () => {
  const signals = (patch: Record<string, unknown>) => [
    { pattern: "statement balance", trait: "owed", weight: 200, ...patch },
  ];

  expect(rejectionReason(bundle({ traitSignals: signals({ weight: 1e9 }) }))).not.toBe("ACCEPTED");
  expect(rejectionReason(bundle({ traitSignals: signals({ trait: "maybe" }) }))).not.toBe("ACCEPTED");
  expect(rejectionReason(bundle({ traitSignals: signals({ pattern: "x".repeat(300) }) }))).not.toBe(
    "ACCEPTED",
  );
  expect(rejectionReason(bundle({ traitSignals: signals({}) }))).toBe("ACCEPTED");
});

test("the schema is reachable on its own for callers that only want the shape", () => {
  expect(rulesetBundleSchema.safeParse(bundle()).success).toBe(true);
});
