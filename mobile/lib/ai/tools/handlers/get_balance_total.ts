// mobile/lib/ai/tools/handlers/get_balance_total.ts
//
// TWO EXCLUSIONS, NOT ONE. The design spec's table says "credit wallets
// excluded — money owed is not money held", which is half the rule and names a
// column that no longer exists:
//
//   - There is NO `credit` wallet type. Migration 014 dropped `wallets.type`
//     entirely. The exclusion is `owedBalance`, added by 013 and INFERRED from
//     behaviour rather than asked for.
//   - `totalActiveBalance` ALSO excludes archived wallets, and
//     lib/wallets/summary.ts calls both exclusions one-way.
//
// Both are stated in `data` because the model writes the sentence that explains
// the number, and a user whose credit card is missing from their total deserves
// to be told why rather than left to wonder.
import { formatCentavos } from "@/components/ui/amount_text";
import { listWallets } from "@/lib/db/repos/wallets_repo";
import { isDatabaseUnlocked } from "@/lib/db/database";
import { totalActiveBalance, totalActiveWalletCount } from "@/lib/wallets/summary";
import type { EpochMs } from "@/types/domain";
import { locked, ok, type DisplayField, type ToolResult } from "../types";

const TOOL = "get_balance_total";

export type BalanceTotalData = {
  /** Why the headline figure is not the sum of every row on the Wallets tab. */
  excludes: string[];
};

export async function handleGetBalanceTotal(
  _args: Record<string, unknown>,
  _now: EpochMs,
): Promise<ToolResult<BalanceTotalData>> {
  if (!isDatabaseUnlocked()) return locked(TOOL);

  // Archived wallets are fetched so the count of what was left out is honest;
  // `totalActiveBalance` does the excluding, not this filter.
  const wallets = await listWallets({ includeArchived: true });

  const display: DisplayField[] = [
    { key: "total", value: formatCentavos(totalActiveBalance(wallets)), kind: "amount" },
    { key: "wallet_count", value: String(totalActiveWalletCount(wallets)), kind: "count" },
  ];

  return ok(
    TOOL,
    {
      excludes: [
        "wallets whose balance is money owed rather than money held",
        "archived wallets",
      ],
    },
    display,
  );
}
