// mobile/lib/ai/tools/handlers/get_spend_by_category.ts
//
// `categoryBreakdown` TAKES FOUR ARGUMENTS, including `Category[]`, which the
// spec's one-line table omits. It also needs the two range shapes to go to
// different places: `epochs` to `listTransactions`, `dates` to
// `categoryBreakdown`. That is what lib/ai/tools/period_range.ts exists for.
//
// CATEGORIES ARE FETCHED WITH `includeHidden: true`, matching
// safe_to_spend_service.ts:95-97 and its reasoning: "a limit can outlive the
// visibility of the category it filters on, and naming it is still better than
// '1 category'." A hidden category still holds spending the user made.
//
// `share` COMES BACK UNROUNDED 0..1 and is rounded here, because aggregate.ts
// says explicitly that rounding for display is the caller's job.
import { formatCentavos } from "@/components/ui/amount_text";
import { isDatabaseUnlocked } from "@/lib/db/database";
import { listCategories } from "@/lib/db/repos/categories_repo";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import { categoryBreakdown } from "@/lib/reports/aggregate";
import type { EpochMs } from "@/types/domain";
import { AI_PERIODS, resolvePeriod, type AiPeriod } from "../period_range";
import { empty, locked, ok, safeText, type DisplayField, type ToolResult } from "../types";

const TOOL = "get_spend_by_category";

/** How many rows the model is given. Beyond this it is reciting, not answering. */
const MAX_ROWS = 8;

export type SpendByCategoryData = {
  period: string;
  categories: string[];
};

function readPeriod(args: Record<string, unknown>): AiPeriod {
  const raw = args.period;
  return (AI_PERIODS as readonly string[]).includes(raw as string)
    ? (raw as AiPeriod)
    : "this_month";
}

export async function handleGetSpendByCategory(
  args: Record<string, unknown>,
  now: EpochMs,
): Promise<ToolResult<SpendByCategoryData>> {
  if (!isDatabaseUnlocked()) return locked(TOOL);

  const period = readPeriod(args);
  const { dates, epochs } = resolvePeriod(period, now);

  const transactions = await listTransactions({
    from: epochs.from,
    to: epochs.to,
    direction: "out",
    // Not the default, and must be passed: a transfer between the user's own
    // wallets is not spending, and counting it inflates every category.
    excludeTransferLinked: true,
  });
  const categories = await listCategories({ includeHidden: true });
  const rows = categoryBreakdown(transactions, categories, dates).slice(0, MAX_ROWS);

  if (rows.length === 0) {
    // A genuinely empty window is NOT a refusal in the locked sense — the
    // ledger was readable and there was nothing in it. Saying so is honest,
    // and it is a different sentence from "the ledger is locked".
    return empty(TOOL, `No spending was recorded in that period (${dates.from} to ${dates.to}).`);
  }

  const display: DisplayField[] = [
    { key: "period_from", value: dates.from, kind: "date" },
    { key: "period_to", value: dates.to, kind: "date" },
  ];

  rows.forEach((row) => {
    const name = safeText(row.categoryName);
    display.push({ key: `${name} amount`, value: formatCentavos(row.total), kind: "amount" });
    display.push({
      key: `${name} share`,
      value: `${Math.round(row.share * 100)}%`,
      kind: "percent",
    });
  });

  return ok(
    TOOL,
    { period, categories: rows.map((row) => safeText(row.categoryName)) },
    display,
  );
}
