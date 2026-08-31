// mobile/lib/ai/tools/schemas.ts
//
// MCP-SHAPED, DISPATCHED IN PROCESS. AI spec §8.1 keeps the schema shape so the
// tools stay portable to a real MCP server later, and deliberately does NOT
// keep the transport: "a localhost HTTP server is reachable by every other app
// installed on the phone", and Android provides no per-app loopback isolation.
// Do not add one. Do not add a "just for debugging" one.
//
// THESE SCHEMAS ARE THE GRAMMAR'S INPUT. The spike measured that GBNF compels a
// format perfectly and cannot forbid one, so every constraint here is positive:
// an enum of literals, a bounded integer, `additionalProperties: false`. There
// is no keyword here meaning "not that", because there is no grammar to
// generate from one.
//
// THE DESCRIPTIONS ARE LOAD-BEARING. The model narrates from them. A
// description that omits an exclusion produces a sentence that misstates what
// the number counts, and the user has no way to tell.
import { AI_PERIODS } from "./period_range";
import { LIMIT_MAX, LIMIT_MIN } from "./handlers/list_transactions";

export type JsonSchemaProperty = {
  type: "string" | "integer";
  description: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
};

export type JsonSchema = {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  /** Lets the generator enumerate the whole argument space — see the header. */
  additionalProperties: false;
};

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

const PERIOD_PROPERTY: JsonSchemaProperty = {
  type: "string",
  description: "Which window to report on.",
  enum: [...AI_PERIODS],
};

const NO_ARGS: JsonSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
};

export const TOOL_SCHEMAS: readonly ToolDef[] = [
  {
    name: "get_wallets",
    description:
      "Lists the user's wallets, split into money held and money owed. The held total excludes " +
      "wallets whose balance is money owed rather than money held, and excludes archived wallets.",
    inputSchema: NO_ARGS,
  },
  {
    name: "get_balance_total",
    description:
      "The total money the user actually holds across all wallets. Excludes wallets whose balance " +
      "is money owed rather than money held, and excludes archived wallets. Both exclusions are " +
      "one-way: those balances never count towards this figure.",
    inputSchema: NO_ARGS,
  },
  {
    name: "get_safe_to_spend",
    description:
      "How much the user can spend per day for the rest of the current limit period, with the " +
      "headroom left and the days remaining. When the user is over, the amount over is the " +
      "whole-period shortfall, not a daily figure.",
    inputSchema: NO_ARGS,
  },
  {
    name: "get_limits",
    description:
      "The user's spending limits with how much of each has been used so far in its period, and " +
      "whether each is on track, in caution, warning, over, paused or inactive.",
    inputSchema: NO_ARGS,
  },
  {
    name: "get_income_profile",
    description:
      "The user's detected income: how often it arrives, the typical amount, and the monthly " +
      "equivalent. Reports that none has been detected yet when that is the case.",
    inputSchema: NO_ARGS,
  },
  {
    name: "get_spend_by_category",
    description:
      "Spending broken down by category for a period, largest first, with each category's share " +
      "of the total. Counts money going out only, and excludes transfers between the user's own " +
      "wallets, which are not spending.",
    inputSchema: {
      type: "object",
      properties: { period: PERIOD_PROPERTY },
      required: ["period"],
      additionalProperties: false,
    },
  },
  {
    name: "list_transactions",
    description:
      "Individual transactions in a period, most recent first. Excludes transfers between the " +
      "user's own wallets, since moving money is not spending and listing both legs would count " +
      "it twice.",
    inputSchema: {
      type: "object",
      properties: {
        period: PERIOD_PROPERTY,
        direction: {
          type: "string",
          description: "Money out, or money in. Omit for both.",
          enum: ["in", "out"],
        },
        limit: {
          type: "integer",
          description: "How many transactions to return.",
          minimum: LIMIT_MIN,
          maximum: LIMIT_MAX,
        },
      },
      required: ["period"],
      additionalProperties: false,
    },
  },
];

export const TOOL_DEFS_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(
  TOOL_SCHEMAS.map((def) => [def.name, def]),
);
