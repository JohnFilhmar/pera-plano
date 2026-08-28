// hooks/queries/use_archived_plan_items.ts — the archived tail of each Plan
// tab, which nothing in the app could read.
//
// Owner's device report: "no way to see and unarchive archived goals and the
// same for other planned tabs". Every plan repository has kept its archived
// rows since the day archiving replaced deleting — `listBills`, `listLimits`
// and `listLoans` all take `includeArchived` — but the only caller that ever
// passed it was internal (the bill matcher, the loan claimant check). No screen
// asked, so from the outside the rows were gone.
//
// ARCHIVED ROWS, NOT STATUSES. `useBills`, `useLimitStatuses` and `useLoans`
// return DERIVED views: projected cycles, period spend against a threshold,
// running balances. None of that means anything for a retired entity — an
// archived bill has no next cycle by definition — and computing it would be
// both wasted work and a source of numbers the archived list would then have to
// explain. These hooks read the raw rows and the screens show a name and a
// Restore button, which is all "what did I archive?" actually asks.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listBills } from "@/lib/db/repos/bills_repo";
import { listGoals } from "@/lib/db/repos/goals_repo";
import { listLimits } from "@/lib/db/repos/limits_repo";
import { listLoans } from "@/lib/db/repos/loans_repo";
import type { Bill, Goal, Limit, Loan } from "@/types/domain";

/**
 * `enabled` is the point of the options bag, not a convenience: these lists sit
 * behind a "Show archived" toggle that starts closed, and a query that ran
 * anyway would read the table on every Plan tab mount to render nothing. The
 * hook still has to be CALLED unconditionally (rules of hooks), so the toggle
 * turns the fetch off rather than the hook.
 */
export type ArchivedQueryOptions = { enabled?: boolean };

export function useArchivedBills({ enabled = true }: ArchivedQueryOptions = {}) {
  return useQuery({
    queryKey: queryKeys.bills.archived(),
    // The repositories have no "archived only" list, and adding one would be a
    // third state for every caller of `includeArchived` to reason about. The
    // filter is one predicate over a list that is small by construction — a
    // user's retired bills, not a ledger.
    queryFn: async (): Promise<Bill[]> =>
      (await listBills({ includeArchived: true })).filter((bill) => bill.archivedAt !== null),
    enabled,
  });
}

export function useArchivedGoals({ enabled = true }: ArchivedQueryOptions = {}) {
  return useQuery({
    queryKey: queryKeys.goals.archived(),
    // `includeAchieved` is left at its default (true) on purpose: a goal the
    // user reached and then cleared away is exactly the one worth being able to
    // bring back, and filtering reached goals out of the DELETED list would
    // hide it for a reason that only makes sense on the live list.
    queryFn: async (): Promise<Goal[]> =>
      (await listGoals({ includeArchived: true })).filter((goal) => goal.archivedAt !== null),
    enabled,
  });
}

export function useArchivedLimits({ enabled = true }: ArchivedQueryOptions = {}) {
  return useQuery({
    queryKey: queryKeys.limits.archived(),
    queryFn: async (): Promise<Limit[]> =>
      (await listLimits({ includeArchived: true })).filter((limit) => limit.archivedAt !== null),
    enabled,
  });
}

export function useArchivedLoans({ enabled = true }: ArchivedQueryOptions = {}) {
  return useQuery({
    queryKey: queryKeys.loans.archived(),
    // `includeSettled` too: a loan that was paid off AND retired is exactly the
    // one a user is most likely to come looking for, and leaving it out would
    // make the archived list quietly incomplete in its most common case.
    queryFn: async (): Promise<Loan[]> =>
      (await listLoans({ includeArchived: true, includeSettled: true })).filter(
        (loan) => loan.archivedAt !== null,
      ),
    enabled,
  });
}
