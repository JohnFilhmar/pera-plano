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
import { listCategories, listCategoryRefs } from "@/lib/db/repos/categories_repo";
import { listGoals } from "@/lib/db/repos/goals_repo";
import { countOpen } from "@/lib/db/repos/review_queue_repo";
import { addDaysIso, toDateIso } from "@/lib/dates";
import {
  getIncomeSummary,
  listPayEventsBetween,
  type IncomeSummary,
} from "@/lib/income/income_service";
import { expandCategoryIds } from "@/lib/limits/limit_engine";
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

  // The earliest candidate period start. Contributions are gathered from
  // there rather than from today, because rule 6 counts them "from the start
  // of the period" — pay that arrived on the 15th is still reserved on the
  // 20th, and the engine relies on seeing it to keep it reserved.
  //
  // No window END is needed any more: contributions now come from pay that has
  // ALREADY ARRIVED, so `today` is the far edge by construction.
  const starts = limits.map((limit) => periodForScope(limit.scope, today).start);
  const windowStart = starts.length > 0 ? starts.reduce((a, b) => (a < b ? a : b)) : today;

  const [unpaidBills, plannedContributions, reviewQueueCount] = await Promise.all([
    unresolvedBills(now, horizonDays),
    forecastContributions(windowStart, today, income),
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
  // The parent/child pairs `expandCategoryIds` walks. Read once here rather
  // than per limit — `candidateLimits` runs on every ledger commit.
  const categoryRefs = await listCategoryRefs();

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
      // EXPANDED with `expandCategoryIds`, the same call `limit_service.ts`
      // makes before handing the set to `sumSpend` (limits rule 4: picking a
      // parent includes its children). Passing the raw filter would let a bill
      // filed under a CHILD category slip past a limit that counts it, so the
      // engine would stop deducting a bill the limit will really pay.
      categoryIds:
        (status.limit.categoryFilter?.length ?? 0) > 0
          ? expandCategoryIds(status.limit.categoryFilter as string[], categoryRefs)
          : null,
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
      // What the payment will be filed under, so the engine can tell whether
      // this bill could consume a given limit's headroom (rule 5a).
      categoryId: status.bill.categoryId,
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
  today: IsoDate,
  income: IncomeSummary,
): Promise<PlannedContribution[]> {
  // Achieved goals are excluded: the spec's Reached card offers Complete, Raise
  // target or Keep as-is, and none of those is "keep reserving money for it".
  const goals = (await listGoals({ includeAchieved: false })).filter(
    (goal) => goal.contributionRule !== null,
  );
  if (goals.length === 0) return [];

  // THE PAY THAT ACTUALLY ARRIVED, not the paydays a cadence predicts.
  //
  // This used to project kinsenas/weekly anchors across the window and reserve
  // a contribution on each. That reserved money against dates nothing had
  // happened on: the owner's 2026-09-01 report was ₱2,500 held against a
  // payday that came and went with no pay, pinning Safe-to-Spend at ₱0.00 for
  // a week. Delayed salary is ordinary, not exceptional, and a rule that
  // assumes pay lands "spot on the date" is wrong for most of the people this
  // app is for.
  //
  // Reserving from the ARRIVAL also needs no expiry rule. Nothing is reserved
  // until money lands, so there is no stale reservation to time out — the case
  // an expiry heuristic existed to clean up simply never occurs.
  //
  // BOUNDED AT TODAY. A payday later this period has not happened yet, and
  // reserving against it would be the same guess in a shorter form.
  const payEvents = await listPayEventsBetween(
    Date.parse(`${windowStart}T00:00:00`),
    Date.parse(`${today}T23:59:59.999`),
  );
  if (payEvents.length === 0) return [];

  const contributions: PlannedContribution[] = [];
  for (const goal of goals) {
    const amount = contributionAmount(goal, income.averageAmount);
    if (amount <= 0) continue;
    for (const event of payEvents) {
      // Dated to the pay's own day, so `evaluate`'s "counted from the start of
      // the period" test lands on the day the money really arrived.
      contributions.push({ goalId: goal.id, amount, date: toDateIso(new Date(event.occurredAt)) });
    }
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

