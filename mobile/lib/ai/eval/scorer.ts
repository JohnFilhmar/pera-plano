// mobile/lib/ai/eval/scorer.ts
//
// THE MEASURING INSTRUMENT IS DETERMINISTIC EVEN THOUGH WHAT IT MEASURES IS
// NOT. Spec §5.2 item 11. What the eval grades varies run to run; the verdict
// on a recorded transcript must not, or §5.5's tier-cut decision is reading its
// own noise back to itself.
//
// NO PARTIAL CREDIT. A question scores 1 only if the FIRST tool call of the
// turn has the expected name AND its arguments match after enum normalisation.
// Right tool with the wrong period is a wrong answer to the user — they asked
// about last month and were told about this one, in a sentence full of real
// figures — so it is a wrong answer to the score.
//
// THE TWO SUB-COUNTERS ARE DIAGNOSTICS, NEVER CREDIT. `nameCorrect` and
// `argsCorrect` exist to say WHY a tier's number is low: a tier that picks the
// right tool and fumbles the period needs different work than one that reaches
// for the wrong tool entirely. The headline number stays the strict one.

export type ToolCallRecord = { name: string; args: Record<string, unknown> };

export type RecordedTurn = {
  /** In the order the model made them. Only the first is scored. */
  toolCalls: ToolCallRecord[];
  /** How many times the model was consulted. Zero is the pass for advice. */
  inferenceCalls: number;
};

export type Expectation =
  | { kind: "tool"; name: string; args: Record<string, unknown> }
  /** Out of scope. A stated inability is correct; picking any tool is a failure. */
  | { kind: "no_tool" }
  /** Advice. The pass condition is that the model was never consulted at all. */
  | { kind: "advice" };

export type Verdict = { score: 0 | 1; nameCorrect: boolean; argsCorrect: boolean };

export type RunSummary = {
  total: number;
  scored: number;
  nameCorrect: number;
  argsCorrect: number;
};

/**
 * Normalisation is for SPELLING, never for meaning.
 *
 * Case and surrounding whitespace are noise: `" LAST_MONTH "` names the period
 * `last_month`. A different period is a different answer and is never
 * normalised into a match — that would be the partial credit this scorer exists
 * to refuse. An absent optional argument and an explicitly `undefined` one are
 * the same call.
 */
function normaliseArgs(args: Record<string, unknown>): Record<string, unknown> {
  const normalised: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    normalised[key] = typeof value === "string" ? value.trim().toLowerCase() : value;
  }
  return normalised;
}

function argsMatch(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  const left = normaliseArgs(expected);
  const right = normaliseArgs(actual);
  const keys = Object.keys(left);
  // An EXTRA argument fails: `limit: 5` answers a different question than the
  // one asked, and the user is not told the list was cut short.
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}

export function scoreQuestion(expected: Expectation, recorded: RecordedTurn): Verdict {
  if (expected.kind === "advice") {
    // "An advice question never reaches the model" is a structural claim, so
    // the score is about inference calls and not about what came back.
    const clean = recorded.inferenceCalls === 0;
    return { score: clean ? 1 : 0, nameCorrect: clean, argsCorrect: clean };
  }

  const first = recorded.toolCalls[0];

  if (expected.kind === "no_tool") {
    const clean = first === undefined;
    return { score: clean ? 1 : 0, nameCorrect: clean, argsCorrect: clean };
  }

  if (first === undefined) return { score: 0, nameCorrect: false, argsCorrect: false };

  const nameCorrect = first.name === expected.name;
  const argsCorrect = nameCorrect && argsMatch(expected.args, first.args);
  return { score: nameCorrect && argsCorrect ? 1 : 0, nameCorrect, argsCorrect };
}

export function scoreRun(
  items: readonly { expected: Expectation; recorded: RecordedTurn }[],
): RunSummary {
  const summary: RunSummary = { total: items.length, scored: 0, nameCorrect: 0, argsCorrect: 0 };
  for (const item of items) {
    const verdict = scoreQuestion(item.expected, item.recorded);
    summary.scored += verdict.score;
    if (verdict.nameCorrect) summary.nameCorrect += 1;
    if (verdict.argsCorrect) summary.argsCorrect += 1;
  }
  return summary;
}
