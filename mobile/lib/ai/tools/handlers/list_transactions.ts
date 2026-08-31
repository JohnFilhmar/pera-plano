// mobile/lib/ai/tools/handlers/list_transactions.ts
//
// CLAMPS AT BOTH ENDS. The grammar is the first line of defence and this is the
// second, because §5.2/7 requires the clamp as a unit test rather than as a
// grammar rule alone — a grammar protects the model's output, not a caller who
// invokes the handler directly.
//
// `excludeTransferLinked` IS NOT THE DEFAULT and must be passed. The spec's
// "(transfer-linked excluded)" is achievable but not automatic: moving money
// between your own wallets is not spending, and listing both legs tells the
// user they spent twice.
//
// MERCHANT NAMES ARE THE INJECTION SURFACE. They arrive from notifications and
// anyone can send the user a notification, so every one goes through
// `safeText` — one line, 64 characters, whitespace collapsed.
import { formatCentavos } from "@/components/ui/amount_text";
import { toDateIso } from "@/lib/dates";
import { isDatabaseUnlocked } from "@/lib/db/database";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import type { EpochMs, TxDirection } from "@/types/domain";
import { AI_PERIODS, resolvePeriod, type AiPeriod } from "../period_range";
import { empty, locked, ok, safeText, type DisplayField, type ToolResult } from "../types";

const TOOL = "list_transactions";

export const LIMIT_MIN = 1;
export const LIMIT_MAX = 20;
const LIMIT_DEFAULT = 5;

export type ListTransactionsData = {
  period: string;
  entries: Array<{ merchant: string; direction: TxDirection }>;
};

function readPeriod(args: Record<string, unknown>): AiPeriod {
  const raw = args.period;
  return (AI_PERIODS as readonly string[]).includes(raw as string)
    ? (raw as AiPeriod)
    : "this_month";
}

/** Clamps into 1..20. A non-number, a NaN and an out-of-range value all land inside. */
export function clampLimit(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return LIMIT_DEFAULT;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.floor(parsed)));
}

function readDirection(args: Record<string, unknown>): TxDirection | undefined {
  return args.direction === "in" || args.direction === "out"
    ? (args.direction as TxDirection)
    : undefined;
}

export async function handleListTransactions(
  args: Record<string, unknown>,
  now: EpochMs,
): Promise<ToolResult<ListTransactionsData>> {
  if (!isDatabaseUnlocked()) return locked(TOOL);

  const period = readPeriod(args);
  const limit = clampLimit(args.limit);
  const { epochs } = resolvePeriod(period, now);

  const transactions = await listTransactions({
    from: epochs.from,
    to: epochs.to,
    direction: readDirection(args),
    excludeTransferLinked: true,
  });

  if (transactions.length === 0) {
    return empty(TOOL, "No transactions were recorded in that period.");
  }

  const rows = transactions.slice(0, limit);
  const display: DisplayField[] = [];

  rows.forEach((transaction, index) => {
    const prefix = `entry_${index + 1}`;
    display.push({
      key: `${prefix}_amount`,
      value: formatCentavos(transaction.amount),
      kind: "amount",
    });
    display.push({
      key: `${prefix}_date`,
      value: toDateIso(new Date(transaction.occurredAt)),
      kind: "date",
    });
  });

  return ok(
    TOOL,
    {
      period,
      entries: rows.map((transaction) => ({
        // A null merchant is normal — manual entries and cash have none.
        merchant: safeText(transaction.merchant ?? "Uncategorised"),
        direction: transaction.direction,
      })),
    },
    display,
  );
}
