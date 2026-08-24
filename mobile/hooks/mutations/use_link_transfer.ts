// hooks/mutations/use_link_transfer.ts — m1c plan Task 3.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { linkTransfer, type TransferLinkOrigin } from "@/lib/db/repos/transfer_links_repo";
import type { Centavos } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type LinkTransferVariables = {
  outTransactionId: string;
  inTransactionId: string;
  /** `outLeg.amount − inLeg.amount`; may be negative (a credited bonus). */
  feeAmount: Centavos;
  origin?: TransferLinkOrigin;
};

/**
 * Pairs two transactions as one internal movement, which takes both legs out of
 * every spend total. The repository writes the link row and stamps both legs in
 * one SQL transaction.
 *
 * Invalidates `transactions.all` and nothing else. Both legs' detail entries
 * and every ledger list change (the rows now render muted, labelled "not
 * counted as spending"), and the list keys are filter-parameterized so the
 * family root is the narrowest key reaching all of them. NO WALLET KEY: linking
 * moves no money — the balances were already correct before and after — and
 * invalidating them would make the Wallets tab refetch for nothing.
 */
export function useLinkTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: LinkTransferVariables) =>
      linkTransfer(
        variables.outTransactionId,
        variables.inTransactionId,
        variables.feeAmount,
        variables.origin,
      ),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.transactions.all]),
  });
}
