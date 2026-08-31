// mobile/lib/ai/tools/registry.ts
//
// THE ONE PLACE A TOOL IS ADDED. The registry-wide invariants in
// __tests__/handler_invariants.test.ts are parameterised over this object, so
// an eighth tool INHERITS every rule rather than remembering it — which is the
// enforcement mechanism for AI spec §3.6's "a refusal, never an empty result"
// and §5.2/7's "no handler emits raw centavos".
//
// `exampleArgs` exists for those tests: a set of arguments each handler will
// accept, so the suite can invoke every tool without knowing any of them
// individually.
import { handleGetBalanceTotal } from "./handlers/get_balance_total";
import { handleGetIncomeProfile } from "./handlers/get_income_profile";
import { handleGetLimits } from "./handlers/get_limits";
import { handleGetSafeToSpend } from "./handlers/get_safe_to_spend";
import { handleGetSpendByCategory } from "./handlers/get_spend_by_category";
import { handleGetWallets } from "./handlers/get_wallets";
import { handleListTransactions } from "./handlers/list_transactions";
import type { ToolHandler } from "./types";

export type ToolEntry = {
  handler: ToolHandler;
  /** A valid argument set, for registry-wide tests. */
  exampleArgs: Record<string, unknown>;
};

export const TOOL_REGISTRY: Record<string, ToolEntry> = {
  get_wallets: { handler: handleGetWallets, exampleArgs: {} },
  get_balance_total: { handler: handleGetBalanceTotal, exampleArgs: {} },
  get_safe_to_spend: { handler: handleGetSafeToSpend, exampleArgs: {} },
  get_limits: { handler: handleGetLimits, exampleArgs: {} },
  get_income_profile: { handler: handleGetIncomeProfile, exampleArgs: {} },
  get_spend_by_category: {
    handler: handleGetSpendByCategory,
    exampleArgs: { period: "this_month" },
  },
  list_transactions: {
    handler: handleListTransactions,
    exampleArgs: { period: "this_month", limit: 5 },
  },
};

export const TOOL_NAMES = Object.keys(TOOL_REGISTRY);
