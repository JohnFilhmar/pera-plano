// mobile/lib/ai/tools/grammar.ts
//
// JSON SCHEMA → GBNF. Positive grammars only.
//
// WHY THERE IS NO PROSE BRANCH, AND NO PROSE-ONLY GRAMMAR.
//
// The implementation plan's Task 11 asked for both: a `prose` alternative at
// the root, and a `compileProseOnlyGrammar()` for spec §3.4's forced-answer
// round. The spike measured both on the real decoder on 2026-08-31 and they do
// not work. Findings doc:
// `docs/superpowers/specs/2026-08-31-llama-rn-spike-findings.md`, question 2.
//
//   GBNF is excellent at compelling a format and useless at forbidding one.
//
//   - `prose ::= [^{] [^\n]*` (the spec's own fixture) constrains only the
//     FIRST character. The model emitted a complete, valid tool call 3/3 by
//     prefixing "(", a space, or a ```json fence — and the leading-space one
//     parses as a tool call after trimming.
//   - `[^{\n]+` removed the brace and the model switched to a bracket-style
//     call, then degenerated into 60+ carriage returns at 6.2-6.8 s against
//     1.4 s for a real answer.
//   - `[a-zA-Z0-9 ,.'!?%$-]+` removed every escape and produced base64
//     garbage, not prose. When the tokens a model wants are masked it does not
//     fall back gracefully; it falls into a degenerate region of a mangled
//     distribution.
//
// A negated class forbids only what its author thought of, and the author is
// competing against a decoder that will take any surviving path. So: this
// compiler emits a TARGET SHAPE and never a complement, the tool rounds carry
// that grammar, and the forced-answer round carries NO GRAMMAR while
// `dispatch.ts` refuses to act on a tool call in that round. Unconstrained
// generation with a good system prompt answered correctly in 1.4 s — the
// spike's own recommendation.
//
// `dispatch.ts` must parse the RAW model output, never a `.trim()`ed copy: a
// leading space in front of a tool call is invisible after trimming and turns a
// forbidden round into a dispatched one.
//
// THE FORMAT BELOW IS THE ONE THE DECODER ALREADY ACCEPTED — 3/3 exact tool
// calls, 0 malformed in 50 — not a fresh reading of the GBNF documentation.
import type { JsonSchema, JsonSchemaProperty, ToolDef } from "./schemas";

/**
 * The forced-answer round runs unconstrained. This is a named constant rather
 * than a bare `null` at the call site so that the reason travels with it.
 */
export const FORCED_ANSWER_GRAMMAR: string | null = null;

/**
 * The escape hatch a constrained round needs, and the reason the tool grammar
 * does not trap the model.
 *
 * A grammar of tool calls ALONE would compel a tool call for "who is the
 * president of the Philippines" — there would be no other string the decoder
 * could produce. This is a POSITIVE literal, not a complement, so it is exactly
 * the kind of thing GBNF is good at: one fixed token the model may emit to
 * decline.
 *
 * It is also honestly measured rather than hoped for. The spike's tool grammar
 * carried this branch, and tier 1 still called a ledger tool for out-of-scope
 * questions in 3/3 and 2/3 runs: "a grammar cannot fix this: the CANNOT_ANSWER
 * branch is available and the model declines to take it." Tier 2 never made the
 * mistake. The branch is necessary and it is not sufficient — which is why
 * grounding and the output guard still sit behind it.
 */
export const CANNOT_ANSWER = "CANNOT_ANSWER";

/** A JSON string, escaped for a GBNF double-quoted literal. */
function jsonString(value: string): string {
  return `\\"${value}\\"`;
}

function ruleName(toolName: string): string {
  return toolName.replace(/_/g, "-");
}

function valueRule(rule: string, property: string): string {
  return `${rule}-${property.replace(/_/g, "-")}`;
}

/**
 * A bounded integer is ENUMERATED, never `[0-9]+`. A digit class lets the model
 * ask for 900 transactions; the handler's clamp would then silently answer a
 * different question than the model thought it asked, and the prose would
 * describe the question it asked rather than the one that ran.
 */
function integerAlternatives(property: JsonSchemaProperty, name: string): string {
  const { minimum, maximum } = property;
  if (minimum === undefined || maximum === undefined) {
    throw new Error(`grammar: integer property "${name}" has no minimum/maximum to enumerate`);
  }
  if (maximum < minimum) {
    throw new Error(`grammar: integer property "${name}" has maximum below minimum`);
  }
  const values: string[] = [];
  for (let value = minimum; value <= maximum; value += 1) values.push(`"${value}"`);
  return values.join(" | ");
}

function propertyAlternatives(property: JsonSchemaProperty, name: string): string {
  if (property.type === "integer") return integerAlternatives(property, name);
  if (!property.enum || property.enum.length === 0) {
    // An unbounded string can only be written as a character class, which is a
    // complement in disguise — see the header. Fail loudly instead.
    throw new Error(`grammar: string property "${name}" has no enum to constrain it`);
  }
  return property.enum.map((value) => `"${jsonString(value)}"`).join(" | ");
}

type CompiledTool = { rule: string; lines: string[] };

function compileTool(def: ToolDef): CompiledTool {
  const rule = ruleName(def.name);
  const schema: JsonSchema = def.inputSchema;
  const names = Object.keys(schema.properties);

  const head = `"{${jsonString("tool")}:${jsonString(def.name)},${jsonString("args")}:{`;

  if (names.length === 0) {
    return { rule, lines: [`${rule} ::= ${head}}}"`] };
  }

  const required = schema.required.filter((name) => names.includes(name));
  const optional = names.filter((name) => !schema.required.includes(name));

  if (required.length === 0) {
    // Comma placement in a JSON object is only decidable when at least one
    // member is always present; otherwise the grammar happily emits
    // `{,"limit":3}`.
    throw new Error(`grammar: tool "${def.name}" has optional properties but none required`);
  }

  const parts: string[] = [];
  required.forEach((name, index) => {
    // The first key is FUSED into the head rather than emitted as an adjacent
    // terminal. Juxtaposed terminals are legal GBNF, but the decoder has only
    // ever been shown the fused form — the spike's fixture is
    // `"{\"tool\":\"…\",\"args\":{\"period\":" period "}}"` — and this is not
    // the place to spend a shape the parser has not already accepted.
    parts.push(
      index === 0
        ? `${head}${jsonString(name)}:" ${valueRule(rule, name)}`
        : `",${jsonString(name)}:" ${valueRule(rule, name)}`,
    );
  });
  for (const name of optional) {
    parts.push(`( ",${jsonString(name)}:" ${valueRule(rule, name)} )?`);
  }

  const body = [...parts, `"}}"`].join(" ");
  const lines = [`${rule} ::= ${body}`];
  for (const name of names) {
    const property = schema.properties[name];
    lines.push(`${valueRule(rule, name)} ::= ${propertyAlternatives(property, name)}`);
  }
  return { rule, lines };
}

/**
 * The grammar for a constrained tool round: a call to one of `tools`, or
 * `CANNOT_ANSWER`, and nothing else.
 *
 * It is deliberately unable to express an ANSWER, only a call or a decline. The
 * dispatch loop therefore drops the grammar for every round where an answer is
 * wanted — see `dispatch.ts`. A grammar cannot both compel a tool call and
 * permit free prose, because the second half of that is a complement and cannot
 * be written; the round policy is where the two are reconciled.
 */
export function compileGrammar(tools: readonly ToolDef[]): string {
  if (tools.length === 0) {
    // A root with no alternatives is unsatisfiable, and an unsatisfiable
    // grammar is a model that emits nothing at all.
    throw new Error("grammar: no tools to compile");
  }

  const compiled = tools.map(compileTool);
  const lines = [
    "root ::= tool-call | cannot-answer",
    `tool-call ::= ${compiled.map((tool) => tool.rule).join(" | ")}`,
    `cannot-answer ::= "${CANNOT_ANSWER}"`,
    ...compiled.flatMap((tool) => tool.lines),
  ];
  return `${lines.join("\n")}\n`;
}
