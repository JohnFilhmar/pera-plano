// mobile/lib/ai/tools/handlers/get_wallets.ts
//
// `groupWalletsByType` DOES NOT EXIST, and neither does the wallet type it
// would have grouped by — migration 014 dropped `wallets.type`. The real
// grouping in lib/wallets/summary.ts is `splitByOwed`: money held on one side,
// money owed on the other, which is the distinction that actually changes what
// a number means.
//
// WALLET NAMES ARE USER-AUTHORED FREE TEXT and go through `safeText` (rule 4).
// They are less attacker-reachable than merchant names, but the rule is a
// property of the tool layer rather than of one field, and an exception here
// would be one the next handler copies.
import { formatCentavos } from "@/components/ui/amount_text";
import { isDatabaseUnlocked } from "@/lib/db/database";
import { listWallets } from "@/lib/db/repos/wallets_repo";
import {
  archivedWallets,
  splitByOwed,
  totalActiveBalance,
  totalActiveWalletCount,
} from "@/lib/wallets/summary";
import type { EpochMs } from "@/types/domain";
import { locked, ok, safeText, type DisplayField, type ToolResult } from "../types";

const TOOL = "get_wallets";

export type WalletsData = {
  /** Names only. Balances live in display[], per rule 3. */
  held: string[];
  owed: string[];
  archived: string[];
};

export async function handleGetWallets(
  _args: Record<string, unknown>,
  _now: EpochMs,
): Promise<ToolResult<WalletsData>> {
  if (!isDatabaseUnlocked()) return locked(TOOL);

  const wallets = await listWallets({ includeArchived: true });
  const live = wallets.filter((wallet) => !wallet.isArchived);
  const { held, owed } = splitByOwed(live);

  const display: DisplayField[] = [
    { key: "total_held", value: formatCentavos(totalActiveBalance(wallets)), kind: "amount" },
    { key: "held_count", value: String(totalActiveWalletCount(wallets)), kind: "count" },
    { key: "owed_count", value: String(owed.length), kind: "count" },
  ];

  const archived = archivedWallets(wallets);
  if (archived.length > 0) {
    display.push({ key: "archived_count", value: String(archived.length), kind: "count" });
  }

  return ok(
    TOOL,
    {
      held: held.map((wallet) => safeText(wallet.name)),
      owed: owed.map((wallet) => safeText(wallet.name)),
      archived: archived.map((wallet) => safeText(wallet.name)),
    },
    display,
  );
}
