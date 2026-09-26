// mobile/lib/ai/tools/registry.ts
//
// THE ONE PLACE A TOOL IS ADDED. The registry-wide invariants in
// __tests__/handler_invariants.test.ts are parameterised over this object, so
// an eighth tool INHERITS every rule rather than remembering it — which is the
// enforcement mechanism for AI spec §3.6's "a refusal, never an empty result"
// and §5.2/7's "no handler emits raw centavos".
//
// Definition and handler live together on purpose: schemas.test.ts asserts the
// two describe the same seven tools, because a tool in one and not the other is
// either a tool the model can call and the dispatcher cannot route, or a tool
// the dispatcher will route and the model was never told about.
import { handleGetBalanceTotal } from "./handlers/get_balance_total";
import { handleGetIncomeProfile } from "./handlers/get_income_profile";
import { handleGetLimits } from "./handlers/get_limits";
import { handleGetSafeToSpend } from "./handlers/get_safe_to_spend";
import { handleGetSpendByCategory } from "./handlers/get_spend_by_category";
import { handleGetWallets } from "./handlers/get_wallets";
import { handleListTransactions } from "./handlers/list_transactions";
import { TOOL_DEFS_BY_NAME, type ToolDef } from "./schemas";
import type { ToolHandler } from "./types";

export type ToolEntry = {
  def: ToolDef;
  handler: ToolHandler;
  /**
   * TEST SCAFFOLDING THAT LIVES IN PRODUCTION CODE, DELIBERATELY. Task 5's
   * invariants are parameterised over this registry and must be able to invoke
   * every tool without a per-tool table — a table that would be updated
   * separately, and therefore eventually not at all.
   */
  exampleArgs: Record<string, unknown>;
};

function defFor(name: string): ToolDef {
  const def = TOOL_DEFS_BY_NAME.get(name);
  // Throwing at module load is the point: a registry entry with no schema is a
  // tool the model was never told about, and finding that out at import time is
  // better than finding it out when a user asks a question.
  if (!def) throw new Error(`registry: no schema for tool "${name}"`);
  return def;
}

export const TOOL_REGISTRY: Record<string, ToolEntry> = {
  get_wallets: {
    def: defFor("get_wallets"),
    handler: handleGetWallets,
    exampleArgs: {},
  },
  get_balance_total: {
    def: defFor("get_balance_total"),
    handler: handleGetBalanceTotal,
    exampleArgs: {},
  },
  get_safe_to_spend: {
    def: defFor("get_safe_to_spend"),
    handler: handleGetSafeToSpend,
    exampleArgs: {},
  },
  get_limits: {
    def: defFor("get_limits"),
    handler: handleGetLimits,
    exampleArgs: {},
  },
  get_income_profile: {
    def: defFor("get_income_profile"),
    handler: handleGetIncomeProfile,
    exampleArgs: {},
  },
  get_spend_by_category: {
    def: defFor("get_spend_by_category"),
    handler: handleGetSpendByCategory,
    exampleArgs: { period: "this_month" },
  },
  list_transactions: {
    def: defFor("list_transactions"),
    handler: handleListTransactions,
    exampleArgs: { period: "this_month", limit: 5 },
  },
};

export const TOOL_NAMES = Object.keys(TOOL_REGISTRY);
