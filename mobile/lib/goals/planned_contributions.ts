// lib/goals/planned_contributions.ts: goals rules 13-15 (GAP-056): the
// planned contribution each payday creates, and where it stands.
//
// DERIVED, NOT STORED. Safe-to-spend rule 6b builds a contribution from pay
// that ARRIVED, one per goal per payday, and this module keeps it that way.
// What rule 14 adds is a lifecycle, and three of its exits are facts the
// ledger already holds or the user has stated:
//
//   completed  money moved into the goal's wallet from the payday through the
//              third day after it covers the plan (rule 14a), or the user
//              recorded it (14b, contribution_decisions);
//   skipped    the user said so (14c, contribution_decisions);
//   pending    anything else.
//
// NOTHING EXPIRES, AND THE 31 DAYS BELONG TO THE PROMPT ALONE. The owner ruled
// on 2026-09-24 that an unmatched contribution's RESERVATION never ends: the
// reservation is built from pay that already arrived (safe-to-spend rule 6b), so
// there is no stale reservation to time out, and goals rule 14 now has no expired
// state at all. What the 31 days do is stop the CARD from asking: only the latest
// payday's contribution is offered, and not once a pay period has passed.
//
// WHAT SAFE-TO-SPEND HOLDS BACK (`reservedFor`). A pending or completed
// contribution reserves its whole plan: a completed one is a transfer, which
// never consumed a limit's headroom (rule 6a), so releasing it would hand saved
// money back as spendable. A skipped one keeps only what had already moved
// (goals rule 15: skipping "removes the remaining amount from the term").
import { listContributionDecisions } from "@/lib/db/repos/contribution_decisions_repo";
import { listGoals } from "@/lib/db/repos/goals_repo";
import { listFullLedgerBetween } from "@/lib/db/repos/transactions_repo";
import { addDaysIso, parseDateIso, toDateIso } from "@/lib/dates";
import { hasPaydayAutoAllocation } from "@/lib/entitlements";
import { listPayEventsBetween } from "@/lib/income/income_service";
import { collapsePaydays } from "@/lib/income/paydays";
import type { Centavos, EpochMs, Goal, IsoDate } from "@/types/domain";

/** Rule 14a's window: the payday itself and the three days after it. */
const MATCH_WINDOW_DAYS = 4;

/** The longest pay period the app knows, monthly: a prompt older than this is over. */
const PAY_PERIOD_DAYS = 31;

export type PaydayContributionStatus = "pending" | "completed" | "skipped";

/** One goal's planned contribution from one payday (goals rule 14). */
export type PaydayContribution = {
  goalId: string;
  paydayDate: IsoDate;
  /** What the goal's rule plans out of this payday (rule 13). */
  amount: Centavos;
  /** What moved into the goal's wallet inside rule 14a's window, capped at `amount`. */
  matched: Centavos;
  status: PaydayContributionStatus;
};

/** A contribution still waiting on the user: the spec's "Pending allocation" goal card state. */
export type PendingContribution = {
  goalId: string;
  paydayDate: IsoDate;
  amount: Centavos;
  /** `amount` less what already moved (rule 14: "partial inflows reduce the outstanding prompt amount"). */
  outstanding: Centavos;
};

/**
 * What Safe-to-Spend holds back for one contribution (safe-to-spend rule 6,
 * goals rule 15): all of it unless the user skipped it, and then only what
 * had already moved.
 *
 * @param contribution - One payday's contribution to one goal.
 * @returns Centavos to reserve. Never more than the plan.
 */
export function reservedFor(contribution: PaydayContribution): Centavos {
  return contribution.status === "skipped" ? contribution.matched : contribution.amount;
}

/**
 * What a goal's rule plans out of one payday (goals rule 13): a fixed rule's
 * own amount, or a percent rule's share of the pay that landed, never of the
 * profile average. `percent` is a plain percentage, so 10 means 10%, unlike
 * `Limit.value`, which types/domain.ts documents as percent × 100.
 *
 * @param goal - The goal. No rule plans nothing.
 * @param paydayAmount - The day's combined pay, in centavos.
 * @returns Centavos, rounded to the nearest one.
 */
export function plannedAmountFor(goal: Goal, paydayAmount: Centavos): Centavos {
  const rule = goal.contributionRule;
  if (rule === null) return 0;
  if (rule.kind === "fixed") return rule.amount;
  return Math.round((paydayAmount * rule.percent) / 100);
}

/**
 * Every planned contribution from pay that landed between two local days,
 * with where each one stands. Goal by goal, oldest payday first.
 *
 * PLUS ONLY, the question `proposePaydayAllocations` asks too: on the free
 * tier the rule is kept and nothing is planned (docs/05 §3.2). A reached goal,
 * or one without a rule, plans nothing.
 *
 * @param range.from - The first local day whose pay counts.
 * @param range.to - The last local day whose pay counts.
 * @returns One entry per goal per payday. Empty on the free tier.
 */
export async function listPaydayContributions(range: {
  from: IsoDate;
  to: IsoDate;
}): Promise<PaydayContribution[]> {
  if (!hasPaydayAutoAllocation()) return [];

  const goals = (await listGoals({ includeAchieved: false })).filter(
    (goal) => goal.contributionRule !== null,
  );
  if (goals.length === 0) return [];

  // The pay that ARRIVED (safe-to-spend rule 6b), collapsed to one payday per
  // local day: the unit rule 14 creates a contribution for, and the same
  // collapse the payday prompt runs, so the two cannot describe different days.
  const paydays = collapsePaydays(
    await listPayEventsBetween(
      parseDateIso(range.from).getTime(),
      parseDateIso(addDaysIso(range.to, 1)).getTime(),
    ),
  );
  if (paydays.length === 0) return [];

  const decisions = new Map(
    (await listContributionDecisions(range.from, range.to)).map((row) => [
      `${row.goalId}|${row.paydayDate}`,
      row.decision,
    ]),
  );

  // ONE READ covering every payday's match window. ponytail: it is the whole
  // window's ledger, beside the read listPayEventsBetween already makes, and an
  // annual limit's window is the year to date; narrow it to inflows into the
  // goals' wallets if Safe-to-Spend's recompute cost ever shows.
  const ledger = await listFullLedgerBetween({
    from: parseDateIso(paydays[0].date).getTime(),
    to: parseDateIso(addDaysIso(paydays[paydays.length - 1].date, MATCH_WINDOW_DAYS)).getTime(),
  });

  const contributions: PaydayContribution[] = [];
  for (const goal of goals) {
    for (const payday of paydays) {
      const amount = plannedAmountFor(goal, payday.amount);
      if (amount <= 0) continue;

      const windowStart = parseDateIso(payday.date).getTime();
      const windowEnd = parseDateIso(addDaysIso(payday.date, MATCH_WINDOW_DAYS)).getTime();
      // The pay itself is not a contribution, even when a goal sits on the
      // wallet it lands in.
      const payIds = new Set(payday.credits.map((credit) => credit.transactionId));
      const moved = ledger
        .filter(
          (transaction) =>
            transaction.walletId === goal.linkedWalletId &&
            transaction.direction === "in" &&
            transaction.occurredAt >= windowStart &&
            transaction.occurredAt < windowEnd &&
            !payIds.has(transaction.id),
        )
        .reduce((total, transaction) => total + transaction.amount, 0);
      const matched = Math.min(moved, amount);

      const decision = decisions.get(`${goal.id}|${payday.date}`);
      const status: PaydayContributionStatus =
        decision === "skipped"
          ? "skipped"
          : decision === "recorded" || matched >= amount
            ? "completed"
            : "pending";

      contributions.push({ goalId: goal.id, paydayDate: payday.date, amount, matched, status });
    }
  }
  return contributions;
}

/**
 * The contributions still waiting on the user, at most one per goal: the
 * latest payday's, while nothing has settled it and its pay period has not run
 * out. The window silences the CARD only; see the file header.
 *
 * @param now - The instant the pay period is measured back from.
 * @returns What is still outstanding for each such goal. Empty on the free tier.
 */
export async function listPendingContributions(now: EpochMs): Promise<PendingContribution[]> {
  const today = toDateIso(new Date(now));
  const contributions = await listPaydayContributions({
    from: addDaysIso(today, -PAY_PERIOD_DAYS),
    to: today,
  });
  const latest = contributions.reduce<IsoDate | null>(
    (newest, contribution) =>
      newest === null || contribution.paydayDate > newest ? contribution.paydayDate : newest,
    null,
  );

  // A goal cannot be waiting on pay that landed before it existed: one created
  // today must not ask about last week's payday.
  const createdOn = new Map(
    (await listGoals({ includeAchieved: false })).map((goal) => [
      goal.id,
      toDateIso(new Date(goal.createdAt)),
    ]),
  );

  return contributions
    .filter(
      (contribution) =>
        contribution.paydayDate === latest &&
        contribution.status === "pending" &&
        contribution.paydayDate >= (createdOn.get(contribution.goalId) ?? contribution.paydayDate),
    )
    .map((contribution) => ({
      goalId: contribution.goalId,
      paydayDate: contribution.paydayDate,
      amount: contribution.amount,
      outstanding: contribution.amount - contribution.matched,
    }));
}
