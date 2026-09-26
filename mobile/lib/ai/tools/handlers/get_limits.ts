// mobile/lib/ai/tools/handlers/get_limits.ts
//
// `getLimitStatuses` NEEDS `monthlyIncome`, WHICH THE SPEC'S TABLE OMITS.
// Passing null instead does not fail loudly — it silently excludes every
// percent-of-income limit from the answer, and the user is told they have
// fewer limits than they set.
//
// It is sourced from `getIncomeSummary(now).monthlyEquivalent`, the same way
// lib/safe_to_spend_service.ts:47-48 does and for the reason its comment
// gives: "one read rather than two, so the limit and the forecast cannot
// disagree about what the user earns."
//
// LIMITS HAVE NO NAME. `Limit` carries scope, basis and filters — there is no
// label field — so the model is given the scope and the filter shape and left
// to describe them, rather than being handed an id it would read aloud.
import { formatCentavos } from "@/components/ui/amount_text";
import { isDatabaseUnlocked } from "@/lib/db/database";
import { getIncomeSummary } from "@/lib/income/income_service";
import { getLimitStatuses } from "@/lib/limits/limit_service";
import type { EpochMs } from "@/types/domain";
import { locked, ok, type DisplayField, type ToolResult } from "../types";

const TOOL = "get_limits";

export type LimitsData = {
  limits: Array<{
    scope: string;
    basis: string;
    state: string;
    /** Whether this limit watches only some categories or wallets. */
    filtered: boolean;
    paused: boolean;
  }>;
};

export async function handleGetLimits(
  _args: Record<string, unknown>,
  now: EpochMs,
): Promise<ToolResult<LimitsData>> {
  if (!isDatabaseUnlocked()) return locked(TOOL);

  const income = await getIncomeSummary(now);
  const statuses = await getLimitStatuses({ now, monthlyIncome: income.monthlyEquivalent });

  const display: DisplayField[] = [
    { key: "limit_count", value: String(statuses.length), kind: "count" },
  ];

  statuses.forEach((status, index) => {
    const prefix = `limit_${index + 1}`;
    display.push({
      key: `${prefix}_spent`,
      value: formatCentavos(status.spend),
      kind: "amount",
    });
    // `effectiveLimit` is null for a percent-of-income limit with no detected
    // income. Emitting formatCentavos(null) would render ₱NaN.NaN and ground
    // against nothing, so the field is simply absent.
    if (status.effectiveLimit !== null) {
      display.push({
        key: `${prefix}_limit`,
        value: formatCentavos(status.effectiveLimit),
        kind: "amount",
      });
    }
  });

  return ok(
    TOOL,
    {
      limits: statuses.map((status) => ({
        scope: status.limit.scope,
        basis: status.limit.basis,
        state: status.uiState,
        filtered:
          status.limit.categoryFilter !== null || status.limit.walletFilter !== null,
        paused: status.paused,
      })),
    },
    display,
  );
}
