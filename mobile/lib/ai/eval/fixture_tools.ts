// mobile/lib/ai/eval/fixture_tools.ts
//
// THE SEVEN TOOLS, ANSWERED FROM THE FIXTURE LEDGER. Spec §5.5: the eval runs
// the registry "against a fixture-backed implementation of the handler
// interface", because "running an eval over someone's real finances to grade a
// chatbot is a processing event nobody asked for". Nothing here imports a repo
// or `@/lib/db`, and nothing checks the lock, because there is no ledger to
// lock. `__tests__/fixture_tools.test.ts` fails on the first such import.
//
// THE MODEL SEES WHAT PRODUCTION SENDS. Each handler returns its real
// counterpart's data type with the same display keys and kinds, formats money
// through `formatCentavos`, passes names through `safeText`, and computes
// through the same pure `lib/` functions the real handlers reach through their
// services. So `HOSTILE_MERCHANT` reaches the model exactly as a real merchant
// name would.
import { formatCentavos } from "@/components/ui/amount_text";
import type { BalanceTotalData } from "@/lib/ai/tools/handlers/get_balance_total";
import type { IncomeProfileData } from "@/lib/ai/tools/handlers/get_income_profile";
import type { LimitsData } from "@/lib/ai/tools/handlers/get_limits";
import type { SafeToSpendData } from "@/lib/ai/tools/handlers/get_safe_to_spend";
import type { SpendByCategoryData } from "@/lib/ai/tools/handlers/get_spend_by_category";
import type { WalletsData } from "@/lib/ai/tools/handlers/get_wallets";
import type { ListTransactionsData } from "@/lib/ai/tools/handlers/list_transactions";
import { clampLimit } from "@/lib/ai/tools/list_limit";
import { AI_PERIODS, resolvePeriod, type AiPeriod } from "@/lib/ai/tools/period_range";
import {
  empty,
  ok,
  safeText,
  unavailable,
  type DisplayField,
  type ToolHandler,
  type ToolResult,
} from "@/lib/ai/tools/types";
import { parseDateIso, toDateIso } from "@/lib/dates";
import { monthlyEquivalent } from "@/lib/income/income_math";
import { limitFilterLabel } from "@/lib/limits/limit_label";
import { categoryBreakdown } from "@/lib/reports/aggregate";
import { computeSafeToSpend } from "@/lib/safe_to_spend";
import {
  archivedWallets,
  splitByOwed,
  totalActiveBalance,
  totalActiveWalletCount,
} from "@/lib/wallets/summary";
import type { LimitUiState } from "@/types/control";
import type {
  Category,
  Centavos,
  EpochMs,
  LimitScope,
  Transaction,
  TxDirection,
  Wallet,
} from "@/types/domain";

import { FIXTURE_LEDGER } from "./fixture_ledger";

const WALLETS: Wallet[] = FIXTURE_LEDGER.wallets.map(
  (wallet): Wallet => ({
    id: wallet.id,
    name: wallet.name,
    balance: wallet.balance,
    currency: "PHP",
    isArchived: wallet.archived,
    owedBalance: wallet.owed,
    owedPinned: false,
    matcherCount: 0,
    driftDismissedTransactionId: null,
    createdAt: 0,
    updatedAt: 0,
  }),
);

const CATEGORIES: Category[] = FIXTURE_LEDGER.categories.map(
  (category): Category => ({
    id: category.id,
    name: category.name,
    parentId: null,
    icon: "circle",
    isSystem: false,
    isHidden: false,
    createdAt: 0,
    updatedAt: 0,
  }),
);

// Local midnight on the fixture's date, so `toDateIso` hands the same date back.
const TRANSACTIONS: Transaction[] = FIXTURE_LEDGER.transactions.map((transaction): Transaction => {
  const occurredAt = parseDateIso(transaction.date).getTime();
  return {
    id: transaction.id,
    walletId: transaction.walletId,
    categoryId: transaction.categoryId,
    amount: Math.abs(transaction.amount),
    direction: transaction.amount < 0 ? "out" : "in",
    occurredAt,
    merchant: transaction.merchant,
    counterparty: null,
    referenceNo: null,
    source: "manual",
    confidence: 1,
    rawNotificationId: null,
    // Any non-null link marks a transfer leg, which is all the exclusions read.
    transferLinkId: transaction.transfer ? `link_${transaction.id}` : null,
    note: null,
    balanceAfter: null,
    computedBalance: null,
    isAdjustment: false,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
});

/**
 * `FixtureLimit` carries no scope or basis. Its `spent` figures are exactly
 * March's spending in each category, so both limits are read as monthly, fixed
 * and without rollover, which makes each effective limit the authored `limit`.
 */
const LIMIT_SCOPE: LimitScope = "monthly";

/**
 * The spec's UX states table. Restated because `uiStateFor` is private to
 * `lib/limits/limit_service.ts`, which reads the database.
 */
function limitState(spent: Centavos, limit: Centavos): LimitUiState {
  const ratio = spent / limit;
  if (ratio >= 1) return "over";
  if (ratio >= 0.8) return "warning";
  if (ratio >= 0.5) return "caution";
  return "on_track";
}

function readPeriod(args: Record<string, unknown>): AiPeriod {
  return AI_PERIODS.find((period) => period === args.period) ?? "this_month";
}

async function getWallets(): Promise<ToolResult<WalletsData>> {
  const { held, owed } = splitByOwed(WALLETS);
  const archived = archivedWallets(WALLETS);

  const display: DisplayField[] = [
    { key: "total_held", value: formatCentavos(totalActiveBalance(WALLETS)), kind: "amount" },
    { key: "held_count", value: String(totalActiveWalletCount(WALLETS)), kind: "count" },
    { key: "owed_count", value: String(owed.length), kind: "count" },
  ];
  if (archived.length > 0) {
    display.push({ key: "archived_count", value: String(archived.length), kind: "count" });
  }

  return ok(
    "get_wallets",
    {
      held: held.map((wallet) => safeText(wallet.name)),
      owed: owed.map((wallet) => safeText(wallet.name)),
      archived: archived.map((wallet) => safeText(wallet.name)),
    },
    display,
  );
}

async function getBalanceTotal(): Promise<ToolResult<BalanceTotalData>> {
  return ok(
    "get_balance_total",
    {
      excludes: [
        "wallets whose balance is money owed rather than money held",
        "archived wallets",
      ],
    },
    [
      { key: "total", value: formatCentavos(totalActiveBalance(WALLETS)), kind: "amount" },
      { key: "wallet_count", value: String(totalActiveWalletCount(WALLETS)), kind: "count" },
    ],
  );
}

async function getSafeToSpend(
  _args: Record<string, unknown>,
  now: EpochMs,
): Promise<ToolResult<SafeToSpendData>> {
  const categoryNames = new Map(CATEGORIES.map((category) => [category.id, category.name]));
  const result = computeSafeToSpend({
    today: toDateIso(new Date(now)),
    limits: FIXTURE_LEDGER.limits.map((limit) => ({
      id: limit.id,
      scope: LIMIT_SCOPE,
      effectiveValue: limit.limit,
      spendInPeriod: limit.spent,
      filtered: true,
      filterLabel: limitFilterLabel(
        { scope: LIMIT_SCOPE, categoryFilter: [limit.categoryId], walletFilter: null },
        categoryNames,
      ),
      categoryIds: [limit.categoryId],
    })),
    // The fixture has no bills, goals or review queue.
    unpaidBills: [],
    plannedContributions: [],
    reviewQueueCount: 0,
  });

  const display: DisplayField[] = [
    { key: "per_day", value: formatCentavos(result.perDay), kind: "amount" },
    { key: "headroom", value: formatCentavos(result.headroom), kind: "amount" },
    { key: "days_remaining", value: String(result.daysRemaining), kind: "count" },
  ];
  if (result.overBy > 0) {
    display.push({ key: "over_by", value: formatCentavos(result.overBy), kind: "amount" });
  }
  if (result.periodEnd !== null) {
    display.push({ key: "period_end", value: result.periodEnd, kind: "date" });
  }

  return ok(
    "get_safe_to_spend",
    {
      state: result.state,
      drivingFilterLabel:
        result.drivingFilterLabel === null ? null : safeText(result.drivingFilterLabel),
    },
    display,
  );
}

async function getLimits(): Promise<ToolResult<LimitsData>> {
  const display: DisplayField[] = [
    { key: "limit_count", value: String(FIXTURE_LEDGER.limits.length), kind: "count" },
  ];
  FIXTURE_LEDGER.limits.forEach((limit, index) => {
    const prefix = `limit_${index + 1}`;
    display.push({ key: `${prefix}_spent`, value: formatCentavos(limit.spent), kind: "amount" });
    display.push({ key: `${prefix}_limit`, value: formatCentavos(limit.limit), kind: "amount" });
  });

  return ok(
    "get_limits",
    {
      limits: FIXTURE_LEDGER.limits.map((limit) => ({
        scope: LIMIT_SCOPE,
        basis: "fixed",
        state: limitState(limit.spent, limit.limit),
        filtered: true,
        paused: false,
      })),
    },
    display,
  );
}

/**
 * No `expected_next`: `getIncomeSummary` reports `expectedNextAt: null` on every
 * path today, so production never sends one, and the fixture's `expectedNext`
 * stays out to match. The fixture authors no detection status either, and
 * `confirmed` is the status of a detected income that limits can use.
 */
async function getIncomeProfile(): Promise<ToolResult<IncomeProfileData>> {
  const { cadence, averageAmount } = FIXTURE_LEDGER.income;
  const monthly = monthlyEquivalent(cadence, averageAmount);

  const display: DisplayField[] = [
    { key: "average_amount", value: formatCentavos(averageAmount), kind: "amount" },
  ];
  if (monthly !== null) {
    display.push({ key: "monthly_equivalent", value: formatCentavos(monthly), kind: "amount" });
  }

  return ok("get_income_profile", { cadence, status: "confirmed", isManualOverride: false }, display);
}

async function getSpendByCategory(
  args: Record<string, unknown>,
  now: EpochMs,
): Promise<ToolResult<SpendByCategoryData>> {
  const period = readPeriod(args);
  const { dates } = resolvePeriod(period, now);
  const rows = categoryBreakdown(TRANSACTIONS, CATEGORIES, dates);

  if (rows.length === 0) {
    return empty(
      "get_spend_by_category",
      `No spending was recorded in that period (${dates.from} to ${dates.to}).`,
    );
  }

  const display: DisplayField[] = [
    { key: "period_from", value: dates.from, kind: "date" },
    { key: "period_to", value: dates.to, kind: "date" },
  ];
  for (const row of rows) {
    const name = safeText(row.categoryName);
    display.push({ key: `${name} amount`, value: formatCentavos(row.total), kind: "amount" });
    display.push({ key: `${name} share`, value: `${Math.round(row.share * 100)}%`, kind: "percent" });
  }

  return ok(
    "get_spend_by_category",
    { period, categories: rows.map((row) => safeText(row.categoryName)) },
    display,
  );
}

async function listTransactions(
  args: Record<string, unknown>,
  now: EpochMs,
): Promise<ToolResult<ListTransactionsData>> {
  const period = readPeriod(args);
  const { epochs } = resolvePeriod(period, now);
  const direction: TxDirection | undefined =
    args.direction === "in" || args.direction === "out" ? args.direction : undefined;

  // The real repository's filter and order: half-open window, transfer legs
  // out, newest first.
  const matching = TRANSACTIONS.filter(
    (transaction) =>
      transaction.transferLinkId === null &&
      (direction === undefined || transaction.direction === direction) &&
      transaction.occurredAt >= epochs.from &&
      transaction.occurredAt < epochs.to,
  ).sort((left, right) => right.occurredAt - left.occurredAt);

  if (matching.length === 0) {
    return empty("list_transactions", "No transactions were recorded in that period.");
  }

  const rows = matching.slice(0, clampLimit(args.limit));
  const display: DisplayField[] = [];
  rows.forEach((transaction, index) => {
    const prefix = `entry_${index + 1}`;
    display.push({ key: `${prefix}_amount`, value: formatCentavos(transaction.amount), kind: "amount" });
    display.push({
      key: `${prefix}_date`,
      value: toDateIso(new Date(transaction.occurredAt)),
      kind: "date",
    });
  });

  return ok(
    "list_transactions",
    {
      period,
      entries: rows.map((transaction) => ({
        merchant: safeText(transaction.merchant ?? "Uncategorised"),
        direction: transaction.direction,
      })),
    },
    display,
  );
}

/**
 * The fixture-backed handler for every tool in `TOOL_REGISTRY`, keyed by the
 * same wire names. A `Map`, so a name like `constructor` finds nothing.
 */
export const FIXTURE_TOOLS: ReadonlyMap<string, ToolHandler> = new Map<string, ToolHandler>([
  ["get_wallets", getWallets],
  ["get_balance_total", getBalanceTotal],
  ["get_safe_to_spend", getSafeToSpend],
  ["get_limits", getLimits],
  ["get_income_profile", getIncomeProfile],
  ["get_spend_by_category", getSpendByCategory],
  ["list_transactions", listTransactions],
]);

/**
 * Runs one tool against the fixture ledger, with the contract of the assistant
 * screen's own `runTool`.
 *
 * @param name - The tool's wire name. An unknown name is refused, never thrown.
 * @param args - The model's arguments. Unknown keys are ignored and a missing
 *   or invalid period reads as `this_month`, as in production.
 * @param now - The instant relative periods resolve against. The eval passes
 *   the pinned `FIXTURE_NOW_ISO`, so "this month" is always March 2026.
 * @returns The tool's result, or an `unavailable` refusal for an unknown name.
 */
export async function runFixtureTool(
  name: string,
  args: Record<string, unknown>,
  now: EpochMs,
): Promise<ToolResult<unknown>> {
  const handler = FIXTURE_TOOLS.get(name);
  if (handler === undefined) return unavailable(name, "That information could not be read just now.");
  return handler(args, now);
}
