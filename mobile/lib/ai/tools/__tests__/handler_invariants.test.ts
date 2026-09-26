// mobile/lib/ai/tools/__tests__/handler_invariants.test.ts
//
// PARAMETERISED OVER THE REGISTRY ON PURPOSE. Every assertion here is a
// property of the tool layer, not of one handler, and an eighth tool must
// inherit it or this file fails. That is the enforcement mechanism for AI
// spec §3.6's "a refusal, never an empty result" and §5.2/7's "no handler
// emits raw centavos".
import { formatCentavos } from "@/components/ui/amount_text";
import { closeDatabase } from "@/lib/db/database";
import { FIXTURE_NOW, HOSTILE_MERCHANT, lockForTest, seedAiFixture } from "@/test_support/ai_fixture";
import { TOOL_REGISTRY } from "../registry";
import { FREE_TEXT_MAX } from "../types";

const NOW = FIXTURE_NOW;
const ENTRIES = Object.entries(TOOL_REGISTRY);

afterEach(async () => {
  await closeDatabase();
});

/** Collects every string anywhere in a nested value. */
function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, into));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, into));
  }
  return into;
}

describe("no tool returns data while the app is locked", () => {
  test.each(ENTRIES)("%s refuses rather than returning empty", async (name, entry) => {
    await seedAiFixture();
    await lockForTest();
    const result = await entry.handler(entry.exampleArgs, NOW);

    expect(result).toEqual(
      expect.objectContaining({ ok: false, tool: name, reason: "locked" }),
    );
    // The sharp half: a locked tool must NOT look like an empty ledger.
    expect(result.ok).toBe(false);
  });

  test.each(ENTRIES)("%s never states a figure while locked", async (_name, entry) => {
    await seedAiFixture();
    await lockForTest();
    const result = await entry.handler(entry.exampleArgs, NOW);

    if (result.ok) throw new Error("expected a refusal");
    // A refusal message reaches the model. "You have ₱0.00" would be a lie it
    // would happily relay to a user whose ledger is merely locked.
    expect(result.message).not.toMatch(/₱/);
  });
});

describe("money lives only in display, only via formatCentavos", () => {
  test.each(ENTRIES)("%s puts no number in data", async (name, entry) => {
    await seedAiFixture();
    const result = await entry.handler(entry.exampleArgs, NOW);
    if (!result.ok) return;

    const walk = (value: unknown): void => {
      if (typeof value === "number") {
        throw new Error(`${name}: numeric field in data — money must live in display[]`);
      }
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(result.data);
  });

  test.each(ENTRIES)("%s formats every amount with formatCentavos", async (_name, entry) => {
    await seedAiFixture();
    const result = await entry.handler(entry.exampleArgs, NOW);
    if (!result.ok) return;

    for (const field of result.display.filter((f) => f.kind === "amount")) {
      // formatCentavos always emits two decimals and a peso mark. The rounding
      // formatPeso in lib/alerts/alert_copy.ts emits "P8,400" with no decimals;
      // if one of those ever reached a display field, grounding would admit a
      // figure that is not the ledger's figure.
      expect(field.value).toMatch(/^-?₱[\d,]+\.\d{2}$/);
    }
  });

  test("a negative amount uses the ASCII hyphen formatCentavos emits", () => {
    // AmountText prefixes U+2212 MINUS for directional amounts; formatCentavos
    // uses U+002D. Grounding is VERBATIM, so the corpus must come from
    // formatCentavos and never from rendered component text.
    expect(formatCentavos(-240000)).toBe("-₱2,400.00");
    expect(formatCentavos(-240000)).not.toContain("−");
  });
});

describe("free text is a poor injection carrier", () => {
  test.each(ENTRIES)("%s truncates free text to 64 chars, no newlines", async (_name, entry) => {
    await seedAiFixture({ hostileMerchantName: true });
    const result = await entry.handler(entry.exampleArgs, NOW);
    if (!result.ok) return;

    for (const text of collectStrings(result.data)) {
      expect(text.length).toBeLessThanOrEqual(FREE_TEXT_MAX);
      expect(text).not.toContain("\n");
    }
  });

  test("TRUNCATION DOES NOT STOP THE SPEC'S OWN EXAMPLE INJECTION", async () => {
    // Measured 2026-08-31, and it is the point of this test rather than an
    // inconvenience: the injection string AI spec §5.8 chose to illustrate the
    // 64-character mitigation is 62 characters long. It FITS. `safeText`
    // collapses its whitespace and passes it through whole.
    //
    // So "an injection needs room to work; a single-line 64-character field is
    // a poor carrier" is optimistic for exactly the payload the spec names. A
    // complete instruction — verb, object and a fabricated figure — fits in 62
    // characters with room to spare.
    //
    // The tool layer is therefore NOT the defence against injection, and this
    // test exists to stop anyone believing it is. §3.5's grounding check and
    // §3.6's output guard are the defence: the fabricated ₱1,000,000.00 below
    // appears in no display[] field, so grounding rejects any prose repeating
    // it, whatever the merchant name talked the model into.
    expect(HOSTILE_MERCHANT.length).toBeLessThanOrEqual(FREE_TEXT_MAX);

    await seedAiFixture({ hostileMerchantName: true });
    const result = await TOOL_REGISTRY.list_transactions.handler(
      { period: "this_month", limit: 20 },
      NOW,
    );
    if (!result.ok) throw new Error("expected a successful result");

    // What truncation DOES guarantee: one line, and no longer than the cap.
    for (const text of collectStrings(result.data)) {
      expect(text.length).toBeLessThanOrEqual(FREE_TEXT_MAX);
      expect(text).not.toContain("\n");
    }

    // What the tool layer guarantees INSTEAD, and what actually matters: the
    // fabricated figure is nowhere in the grounding corpus.
    const corpus = result.display.map((field) => field.value);
    expect(corpus).not.toContain("₱1,000,000.00");
    expect(corpus.join(" ")).not.toMatch(/1,000,000/);
  });
});

describe("every tool answers with its own name", () => {
  test.each(ENTRIES)("%s reports tool: %s", async (name, entry) => {
    await seedAiFixture();
    const result = await entry.handler(entry.exampleArgs, NOW);
    // The dispatcher routes on this. A handler reporting someone else's name
    // would attribute one tool's figures to another tool's question.
    expect(result.tool).toBe(name);
  });
});
