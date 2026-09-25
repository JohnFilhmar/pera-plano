// mobile/lib/ai/__tests__/fixed_questions.test.ts
//
// Every chip must reach a real tool with arguments that tool accepts, because
// under spec §7.4 nothing downstream gets a second chance to pick again.
import { FIXED_QUESTIONS } from "../fixed_questions";
import { AI_PERIODS } from "../tools/period_range";
import { TOOL_NAMES } from "../tools/registry";

test.each(FIXED_QUESTIONS.map((question) => [question.id, question] as const))(
  "%s names a registered tool",
  (_id, question) => {
    expect(TOOL_NAMES).toContain(question.tool);
  },
);

test.each(FIXED_QUESTIONS.map((question) => [question.id, question] as const))(
  "%s passes only a period the tools resolve",
  (_id, question) => {
    if (question.args.period !== undefined) {
      expect(AI_PERIODS).toContain(question.args.period);
    }
  },
);

test("ids and labels are unique, so a tapped chip means exactly one question", () => {
  const ids = FIXED_QUESTIONS.map((question) => question.id);
  const labels = FIXED_QUESTIONS.map((question) => question.label);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(labels).size).toBe(labels.length);
});

test("every tool in the registry has at least one question", () => {
  // A tool nobody can reach from a chip is a tool the assistant can no longer
  // answer about at all.
  const reached = new Set(FIXED_QUESTIONS.map((question) => question.tool));
  expect([...reached].sort()).toEqual([...TOOL_NAMES].sort());
});
