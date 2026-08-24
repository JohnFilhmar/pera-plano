// hooks/mutations/use_create_loan.ts — m2b Task 8, rule 6.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { createLoan } from "@/lib/db/repos/loans_repo";
import type { NewLoan } from "@/lib/db/repos/loans_repo";
import type { Loan } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Creates a Loan.
 *
 * NO ENTITLEMENT CHECK HERE — `canCreateLoan` is a call-site gate (m2 Global
 * Constraint 10) and lives on the screen, which is the only place with an
 * upgrade sheet to open.
 */
export function useCreateLoan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewLoan): Promise<Loan> => createLoan(input),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.loans.all]),
  });
}
