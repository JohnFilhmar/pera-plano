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
import { countOpen } from "@/lib/db/repos/review_queue_repo";
import { addDaysIso } from "@/lib/dates";
import { listPaydayContributions, reservedFor } from "@/lib/goals/planned_contributions";
import { getIncomeSummary } from "@/lib/income/income_service";
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
import type { Centavos, IsoDate } from "@/types/domain";

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
  // Income comes FIRST because `getLimitStatuses` resolves a percent-of-income
  // limit against the monthly equivalent (rule 4). The contribution forecast
  // takes NOTHING from the profile: since rule 6b it reserves from the credits
  // that actually landed, so it reads the ledger rather than the average.
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
    forecastContributions(windowStart, today),
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
 * The goal contributions term's rows: every planned contribution from pay that
 * landed inside the window, at what it still reserves.
 *
 * WHICH CONTRIBUTIONS EXIST, AND WHAT EACH ONE HOLDS BACK, ARE THE GOALS
 * FEATURE'S TO SAY (lib/goals/planned_contributions.ts), because the payday
 * prompt asks the user to make exactly these transfers and the two must agree.
 * A contribution is built from pay that ARRIVED (rule 6b), never projected; it
 * is Plus only; and a skipped one leaves the term except for what had already
 * moved (rule 6, goals rule 15). This function only reshapes them for the
 * engine, and drops a row that reserves nothing.
 */
async function forecastContributions(
  windowStart: IsoDate,
  today: IsoDate,
): Promise<PlannedContribution[]> {
  const contributions = await listPaydayContributions({ from: windowStart, to: today });
  return contributions
    .map((contribution) => ({
      goalId: contribution.goalId,
      amount: reservedFor(contribution),
      date: contribution.paydayDate,
    }))
    .filter((contribution) => contribution.amount > 0);
}
