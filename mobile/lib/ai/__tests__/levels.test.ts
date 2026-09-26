// mobile/lib/ai/__tests__/levels.test.ts
//
// Assistant levels spec §1 and §6: five levels, 4 and 5 gated, everyone starts
// on 2, and a free user with 4 or 5 stored runs as 3 without losing the value.
import { __setTierForTests } from "@/lib/entitlements";

import {
  ANSWER_LEVELS,
  DEFAULT_ANSWER_LEVEL,
  LEVEL_ORDER,
  describeLevel,
  effectiveAnswerLevel,
  isFreeChatLevel,
  parseAnswerLevel,
} from "../levels";

afterEach(() => {
  __setTierForTests(null);
});

test("everyone starts on level 2", () => {
  expect(DEFAULT_ANSWER_LEVEL).toBe(2);
});

test("the ladder, in order, with only 4 and 5 gated", () => {
  expect(LEVEL_ORDER.map((level) => [ANSWER_LEVELS[level].name, ANSWER_LEVELS[level].gated])).toEqual([
    ["Strict", false],
    ["Typed asks", false],
    ["Chat", false],
    ["Money talk", true],
    ["Anything", true],
  ]);
});

test.each([
  ["1", 1],
  ["2", 2],
  ["3", 3],
  ["4", 4],
  ["5", 5],
] as const)("stored %s reads back as level %s", (raw, level) => {
  expect(parseAnswerLevel(raw)).toBe(level);
});

test.each([null, "", "0", "6", "five"])("anything else stored (%s) reads as the default", (raw) => {
  expect(parseAnswerLevel(raw)).toBe(DEFAULT_ANSWER_LEVEL);
});

test("level 5's description names the model's knowledge limit", () => {
  expect(describeLevel(5, "April 2025")).toBe(
    "Answers any topic from the model's memory. It can be wrong, and it knows nothing after April 2025.",
  );
});

test("on Plus every level runs as stored", () => {
  __setTierForTests("plus");
  expect(LEVEL_ORDER.map((level) => effectiveAnswerLevel(level, true))).toEqual([1, 2, 3, 4, 5]);
});

test("on free, 4 and 5 run as 3", () => {
  __setTierForTests("free");
  expect(LEVEL_ORDER.map((level) => effectiveAnswerLevel(level, true))).toEqual([1, 2, 3, 3, 3]);
});

test("a model that cannot free-chat runs everything above 2 as 2, on either tier", () => {
  __setTierForTests("plus");
  expect(LEVEL_ORDER.map((level) => effectiveAnswerLevel(level, false))).toEqual([1, 2, 2, 2, 2]);
  __setTierForTests("free");
  expect(LEVEL_ORDER.map((level) => effectiveAnswerLevel(level, false))).toEqual([1, 2, 2, 2, 2]);
});

test("free chat starts at level 3", () => {
  expect(LEVEL_ORDER.filter(isFreeChatLevel)).toEqual([3, 4, 5]);
});
