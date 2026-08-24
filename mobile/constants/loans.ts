// constants/loans.ts — loan defaults shared by the form and the repository.
//
// HERE RATHER THAN IN `lib/db/repos/loans_repo.ts`, for the same reason
// constants/bills.ts exists separately from bills_repo.ts: a component
// importing a repository module pulls `getDatabase` into the UI layer, and the
// MVP release gate greps `components/` for exactly that import. A form that
// only wants this one default array must not be the thing that makes a
// database import possible from a screen.
//
// This is a spec default, not a storage detail: docs/04-features/06-loans.md
// rule 15 states it directly ("3 days before nextDueDate, on the due date, and
// 3 days after if still unpaid") as a product fact that outlives whatever
// column happens to write it.

/**
 * Spec rule 15's default offsets: 3 days before, on the due date, and 3 days
 * after (if still unpaid — enforced by `scheduleLoanReminders` cancelling
 * everything the moment a loan settles, not by a per-offset condition).
 * Negative = before, positive = after, matching types/domain.ts's convention.
 */
export const DEFAULT_LOAN_REMINDER_OFFSETS = [-3, 0, 3];
