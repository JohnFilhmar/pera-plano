// hooks/mutations/use_archive_loan.ts — owner's device report ("plan loans
// unarchivable, softdelete data, no hard delete").
//
// Unlike Bills, where the repository half already existed and only the UI was
// missing, Loans had NO retirement path at all — no column, no repository
// function, nothing. Migration 010 added the column; `archiveLoan` added the
// write; this is the app's way in.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { archiveLoan } from "@/lib/db/repos/loans_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Retires a Loan.
 *
 * NEVER A DELETE. `loan_payments` rows point at real ledger Transactions, so a
 * deleted loan would strand its own payment history with nothing to attribute
 * it to — the ledger would still show the money leaving, with no explanation
 * attached. Archiving keeps every one of those links readable.
 *
 * ARCHIVED IS NOT SETTLED. A settled loan reached a zero balance and the spec
 * keeps it in a visible settled list; an archived one is a loan the user is
 * finished tracking, whatever its balance. `listLoans` filters them separately.
 */
export function useArchiveLoan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<void> => archiveLoan(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.loans.all]),
  });
}
