// mobile/lib/ai/levels.ts
//
// THE FIVE ANSWER LEVELS, AS DATA. docs/superpowers/specs/2026-09-25-assistant-
// levels-design.md, decided by the owner on 2026-09-25: 1 is today's strict
// assistant, 5 answers any topic from the model's memory. Levels 4 and 5 sit
// behind Plus and a read-and-accept notice; everyone starts on 2.
//
// ASYNCSTORAGE KEYS, NOT `app_settings`, for the disclaimer's reason
// (`lib/ai/disclaimer.ts`): they are UI preferences that must be readable
// before unlock. `lib/privacy/data_wipe.ts` clears both.
import { canUseAssistantLevel } from "@/lib/entitlements";

export type AnswerLevel = 1 | 2 | 3 | 4 | 5;

/** The levels where typed text can reach the model. */
export type FreeChatLevel = Extract<AnswerLevel, 3 | 4 | 5>;

export type AnswerLevelInfo = {
  level: AnswerLevel;
  name: string;
  /** Shown in the picker. `{month}` becomes the resident model's knowledge limit. */
  description: string;
  /** Plus plus the read-and-accept notice. */
  gated: boolean;
};

export const ANSWER_LEVELS: Record<AnswerLevel, AnswerLevelInfo> = {
  1: {
    level: 1,
    name: "Strict",
    description: "Tap a question to ask. Typed messages get a short reply from the app.",
    gated: false,
  },
  2: {
    level: 2,
    name: "Typed asks",
    description: "Type one of the questions in your own words, in English or Filipino.",
    gated: false,
  },
  3: {
    level: 3,
    name: "Chat",
    description: "Talk about your records. The model reads your words and a summary of your records.",
    gated: false,
  },
  4: {
    level: 4,
    name: "Money talk",
    description: "Also explains general money topics from the model's memory. It can be wrong.",
    gated: true,
  },
  5: {
    level: 5,
    name: "Anything",
    description: "Answers any topic from the model's memory. It can be wrong, and it knows nothing after {month}.",
    gated: true,
  },
};

export const LEVEL_ORDER: readonly AnswerLevel[] = [1, 2, 3, 4, 5];

export const DEFAULT_ANSWER_LEVEL: AnswerLevel = 2;

export const AI_ANSWER_LEVEL_STORAGE_KEY = "peraplano.ai_answer_level";

export const AI_LEVELS_ACCEPTED_STORAGE_KEY = "peraplano.ai_levels_accepted";

/**
 * A level's picker description, with the model's knowledge limit filled in.
 *
 * @param level - The level to describe.
 * @param knowledgeLimit - The resident model's release month, such as "April 2025".
 * @returns The description as the picker shows it.
 */
export function describeLevel(level: AnswerLevel, knowledgeLimit: string): string {
  return ANSWER_LEVELS[level].description.replace("{month}", knowledgeLimit);
}

/**
 * Reads a stored level back.
 *
 * @param raw - The AsyncStorage value, or null when nothing is stored.
 * @returns The stored level, or the default for anything that is not "1" to "5".
 */
export function parseAnswerLevel(raw: string | null): AnswerLevel {
  switch (raw) {
    case "1":
      return 1;
    case "2":
      return 2;
    case "3":
      return 3;
    case "4":
      return 4;
    case "5":
      return 5;
    default:
      return DEFAULT_ANSWER_LEVEL;
  }
}

/**
 * The level the assistant actually runs at. A free user with 4 or 5 stored runs
 * as 3, and the stored value is left alone: a downgrade never deletes anything.
 *
 * @param stored - The level the user chose.
 * @returns The stored level when the tier allows it, otherwise 3.
 */
export function effectiveAnswerLevel(stored: AnswerLevel): AnswerLevel {
  return canUseAssistantLevel(stored) ? stored : 3;
}

/**
 * Whether typed text can reach the model at this level.
 *
 * @param level - An answer level.
 * @returns True for 3, 4 and 5.
 */
export function isFreeChatLevel(level: AnswerLevel): level is FreeChatLevel {
  return level >= 3;
}
