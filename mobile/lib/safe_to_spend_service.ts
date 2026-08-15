// lib/safe_to_spend_service.ts — assembling the Safe-to-Spend input (M3
// Part 2 Task 2; docs/04-features/09-safe-to-spend.md rules 1-6, 10, 12).
//
// THIS MODULE DOES NO ARITHMETIC (plan rule 1). Every term is gathered here and
// every calculation stays in `computeSafeToSpend` — recompute one figure here
// "for convenience" and Task 1's worked-example tests stop protecting the
// number users actually see, because the number they see would no longer come
// from the code those tests cover.
//
// NO NOTIFICATION IMPORTS. `listBillStatuses` is the bills SERVICE, not
// `bill_reminders`, so nothing here reaches expo-notifications and this file
// mocks nothing in its tests.
import { listBillStatuses } from "@/lib/bills/bills_service";
import { listCategories } from "@/lib/db/repos/categories_repo";
import { listGoals } from "@/lib/db/repos/goals_repo";
import { countOpen } from "@/lib/db/repos/review_queue_repo";
import { addDaysIso, toDateIso } from "@/lib/dates";
import { getIncomeSummary, type IncomeSummary } from "@/lib/income/income_service";
import { kinsenasAnchorsBetween } from "@/lib/income/cadence_detector";
import { getLimitStatuses } from "@/lib/limits/limit_service";
import { limitFilterLabel } from "@/lib/limits/limit_label";
import { daysBetweenInclusive, periodForScope } from "@/lib/period";
import {
  computeSafeToSpend,
  type CandidateLimit,
  type PlannedContribution,
  type SafeToSpendInput,
  type SafeToSpendResult,
  type UpcomingBill,
} from "@/lib/safe_to_spend";
import type { Centavos, Goal, IsoDate } from "@/types/domain";

/**
 * Assembles every term the engine needs.
 *
 * TOLERATES AN EMPTY APP (rule 6). No limits, no bills, no goals is the state
 * every user starts in, and it must produce a valid input yielding `no_limit`
 * rather than a throw on the first screen they ever see.
 */
export async function buildSafeToSpendInput(
  today: IsoDate,
  now: number,
): Promise<SafeToSpendInput> {
  // Income comes FIRST because two later steps need it: `getLimitStatuses`
  // resolves a percent-of-income limit against the monthly equivalent (rule 4),
  // and the contribution forecast needs the payday cadence (rule 6). One read
  // rather than two, so the limit and the forecast cannot disagree about what
  // the user earns.
  const income = await getIncomeSummary(now);
  const limits = await candidateLimits(now, income.monthlyEquivalent);

  // Bills are gathered to the FURTHEST candidate period end, not the driving
  // one — which limit drives is the engine's decision and is not known yet.
  // The engine then filters per limit, so over-gathering costs a few rows and
  // under-gathering would silently drop a bill from an annual limit's window.
  const horizonDays = Math.max(
    0,
    ...limits.map((limit) => daysBetweenInclusive(today, periodForScope(limit.scope, today).end)),
  );

  // The widest candidate window, as dates. Contributions are forecast across
  // ALL of it rather than from today, because rule 6 counts them "from the
  // start of the period" — an allocation on the 15th is still reserved on the
  // 20th, and the engine relies on seeing it to keep it reserved.
  const starts = limits.map((limit) => periodForScope(limit.scope, today).start);
  const windowStart = starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : today;
  const windowEnd = addDaysIso(today, horizonDays);

  const [unpaidBills, plannedContributions, reviewQueueCount] = await Promise.all([
    unresolvedBills(now, horizonDays),
    forecastContributions(windowStart, windowEnd, income),
    countOpen(),
  ]);

  return { today, limits, unpaidBills, plannedContributions, reviewQueueCount };
}

/** The engine, over the assembled input. The only entry point a screen needs. */
export async function getSafeToSpend(
  today: IsoDate,
  now: number,
): Promise<SafeToSpendResult> {
  return computeSafeToSpend(await buildSafeToSpendInput(today, now));
}

// ---------------------------------------------------------------------------
// Limits — rules 1, 3, 4, 10
// ---------------------------------------------------------------------------
async function candidateLimits(
  now: number,
  monthlyIncome: Centavos | null,
): Promise<CandidateLimit[]> {
  const statuses = await getLimitStatuses({ now, monthlyIncome });
  // Hidden categories included: a limit can outlive the visibility of the
  // category it filters on, and naming it is still better than "1 category".
  const categoryNames = new Map(
    (await listCategories({ includeHidden: true })).map((category) => [category.id, category.name]),
  );

  return statuses
    .filter((status) => {
      // Rule 10: a percent-of-income limit with no usable IncomeProfile is
      // excluded from candidates entirely, and the prompt to fix it appears on
      // the limit itself. `effectiveLimit` is null in exactly that case.
      //
      // A PAUSED limit is excluded for the same reason (plan rule 2): the user
      // has switched it off, so it has no business driving the headline — and
      // a paused limit that still capped spending would be a switch that does
      // not switch anything.
      if (status.paused) return false;
      return status.effectiveLimit !== null;
    })
    .map((status) => ({
      id: status.limit.id,
      scope: status.limit.scope,
      // Non-null by the filter above; the engine never sees a null value.
      effectiveValue: status.effectiveLimit as Centavos,
      // `spend` already excludes transfer-linked rows and honours the limit's
      // own filters (rule 4, rule 8) — recomputing it here is exactly the
      // duplication rule 1 forbids.
      spendInPeriod: status.spend,
      filtered:
        (status.limit.categoryFilter?.length ?? 0) > 0 ||
        (status.limit.walletFilter?.length ?? 0) > 0,
      filterLabel: limitFilterLabel(status.limit, categoryNames),
    }));
}

// ---------------------------------------------------------------------------
// Bills — rule 5
// ---------------------------------------------------------------------------
async function unresolvedBills(now: number, horizonDays: number): Promise<UpcomingBill[]> {
  const statuses = await listBillStatuses(now, horizonDays);

  return statuses
    .filter(
      (status) =>
        status.state === "overdue" || status.state === "due_today" || status.state === "upcoming",
    )
    .map((status) => ({
      id: `${status.bill.id}|${status.dueDate}`,
      name: status.bill.name,
      // The CURRENT estimate for an estimated bill, its fixed amount otherwise
      // (rule 5). `listBillStatuses` has already resolved which.
      amount: status.estimate.amount,
      dueDate: status.dueDate,
    }));
}

// ---------------------------------------------------------------------------
// Goal contributions — rule 6
// ---------------------------------------------------------------------------
/**
 * Scheduled contributions falling inside the window.
 *
 * A FORECAST OF SCHEDULED RULES ONLY. Rule 6: "Manual, unscheduled Goal
 * contributions are not forecast; they simply appear as spend/transfers when
 * they happen." So a goal with no `contributionRule` contributes nothing, and
 * neither does one whose cadence the app cannot project — guessing a date would
 * reserve money on a day the user was never going to move it.
 */
async function forecastContributions(
  windowStart: IsoDate,
  windowEnd: IsoDate,
  income: IncomeSummary,
): Promise<PlannedContribution[]> {
  // Achieved goals are excluded: the spec's Reached card offers Complete, Raise
  // target or Keep as-is, and none of those is "keep reserving money for it".
  const goals = (await listGoals({ includeAchieved: false })).filter(
    (goal) => goal.contributionRule !== null,
  );
  if (goals.length === 0) return [];

  const dates = contributionDates(windowStart, windowEnd, income.cadence, income.expectedNextAt);
  if (dates.length === 0) return [];

  const contributions: PlannedContribution[] = [];
  for (const goal of goals) {
    const amount = contributionAmount(goal, income.averageAmount);
    if (amount <= 0) continue;
    for (const date of dates) contributions.push({ goalId: goal.id, amount, date });
  }
  return contributions;
}

/** A fixed rule's own amount, or a percent rule's share of average pay. */
function contributionAmount(goal: Goal, averageAmount: Centavos | null): Centavos {
  const rule = goal.contributionRule;
  if (rule === null) return 0;
  if (rule.kind === "fixed") return rule.amount;
  // Percent OF ONE PAY PACKET, not of monthly income — the rule fires on a
  // payday and takes its cut of what arrived, which is what `averageAmount` is.
  return Math.round(((averageAmount ?? 0) * rule.percent) / 100);
}

/**
 * The paydays a contribution rule would fire on, between two dates.
 *
 * Returns nothing for an irregular or unknown cadence, which is the honest
 * answer: a gig worker's next payday is not predictable, and inventing one
 * would reserve money against a date the app made up.
 */
function contributionDates(
  windowStart: IsoDate,
  to: IsoDate,
  cadence: string | null,
  expectedNextAt: number | null,
): IsoDate[] {
  if (cadence === "kinsenas") {
    return kinsenasAnchorsBetween(
      new Date(`${windowStart}T00:00:00`).getTime(),
      new Date(`${to}T23:59:59`).getTime(),
    ).map((at) => toDateIso(new Date(at)));
  }

  if ((cadence === "weekly" || cadence === "monthly") && expectedNextAt !== null) {
    const step = cadence === "weekly" ? 7 : 30;
    const dates: IsoDate[] = [];
    let cursor = toDateIso(new Date(expectedNextAt));
    // Walk back to the window, then forward across it — an expected date in the
    // future would otherwise skip a payday that already happened this period.
    while (cursor > windowStart) cursor = addDaysIso(cursor, -step);
    while (cursor <= to) {
      if (cursor >= windowStart) dates.push(cursor);
      cursor = addDaysIso(cursor, step);
    }
    return dates;
  }

  return [];
}
