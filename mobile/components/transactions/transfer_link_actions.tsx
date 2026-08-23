// components/transactions/transfer_link_actions.tsx — m1c plan Task 7, rule 5;
// docs/03-ingest-pipeline.md §7.
//
// "Link as transfer" for an unlinked row, "Unlink" for a linked one. Exactly
// one of the two is ever offered: a leg already inside a link cannot join a
// second one, and a second link over one leg is a state `sumSpend` cannot
// express and the user cannot undo in a single action.
//
// WHAT THIS SCREEN IS ACTUALLY DOING when the user taps either action is moving
// money in and out of every total in the app. Linking stamps both legs and
// `sumSpend`, Safe-to-Spend, Limits and every report stop counting them
// (invariant I2). Unlinking puts them back. Nothing else in the UI has that
// reach from one tap.
//
// THE CANDIDATE FILTER IS THE DETECTOR'S RULE 1, AND NOT ONE CONDITION MORE.
// §7 rule 1: one `out` leg and one `in` leg, in DIFFERENT wallets. Offering a
// same-wallet or same-direction row invites the user to create a link the
// detector would never have proposed — and two `out` legs linked together take
// two real expenses out of every total at once, which is money the user can see
// in the ledger and cannot find in any total.
//
// THE AMOUNT AND THE WINDOW ARE DELIBERATELY *NOT* FILTERS. §7 rules 2 and 3
// (the 15-minute window, the fee tolerance) are AUTO-LINK thresholds — the
// conditions under which the app is confident enough to act alone. A manual
// link is exempt from them by design (domain §3.3 invariant 4), and it has to
// be: the cash leg of an over-the-counter cash-in is typed in hours later and
// rounded differently, and that is precisely the pairing no detector can make
// and a human can. Candidates are ORDERED by nearness instead, so the plan's
// "nearby" rows are the ones under the user's thumb.
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list_row";
import { formatDateTime } from "@/lib/datetime";
import type { Transaction, Wallet } from "@/types/domain";

/** How many candidates the sheet shows. Beyond this the list stops being a
 * choice and becomes a search problem, which this sheet is not. */
const MAX_CANDIDATES = 25;

/**
 * The rows that could be this transaction's counterpart, nearest in time first.
 *
 * Three conditions, all of them §7 rule 1 or a direct consequence of it:
 *   - OPPOSITE direction. Two outs are not a transfer.
 *   - A DIFFERENT wallet. Money that never left the wallet did not move
 *     between wallets, and the detector requires "both Wallets known and
 *     distinct".
 *   - NOT ALREADY LINKED. A leg inside a link is spoken for; pairing it again
 *     would silently rewrite an existing link's membership.
 *
 * Self-exclusion falls out of the direction test, but is stated anyway: a row
 * linked to itself would be excluded from spend twice over, and the arithmetic
 * would be unrecoverable.
 */
export function transferCandidates(
  subject: Transaction,
  transactions: readonly Transaction[],
): Transaction[] {
  return transactions
    .filter(
      (candidate) =>
        candidate.id !== subject.id &&
        candidate.direction !== subject.direction &&
        candidate.walletId !== subject.walletId &&
        candidate.transferLinkId === null,
    )
    .sort(
      (a, b) =>
        Math.abs(a.occurredAt - subject.occurredAt) - Math.abs(b.occurredAt - subject.occurredAt),
    )
    .slice(0, MAX_CANDIDATES);
}

/**
 * `outLeg.amount − inLeg.amount`, the fee the rail deducted.
 *
 * Computed HERE because only the caller holds both legs, and signed rather than
 * clamped: domain §3.3 reads a negative fee as a credited bonus (a cash-in
 * promo), and flooring it at zero would erase money the user actually gained.
 */
export function transferFee(subject: Transaction, counterpart: Transaction): number {
  const outLeg = subject.direction === "out" ? subject : counterpart;
  const inLeg = subject.direction === "out" ? counterpart : subject;
  return outLeg.amount - inLeg.amount;
}

export type TransferLinkActionsProps = {
  transaction: Transaction;
  /** Every candidate row the screen has loaded; filtered here. */
  transactions: readonly Transaction[];
  wallets: readonly Wallet[];
  /** True while the picker sheet is open — owned by the screen. */
  picking: boolean;
  onOpenPicker: () => void;
  onDismissPicker: () => void;
  onLink: (counterpart: Transaction) => void;
  onUnlink: () => void;
};

export function TransferLinkActions({
  transaction,
  transactions,
  wallets,
  picking,
  onOpenPicker,
  onDismissPicker,
  onLink,
  onUnlink,
}: TransferLinkActionsProps) {
  const linked = transaction.transferLinkId !== null;
  const walletsById = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  const candidates = transferCandidates(transaction, transactions);

  return (
    <View testID="transfer-link-actions" className="px-4 pt-3">
      {linked ? (
        <>
          <Text className="pb-2 text-sm text-fg-2 dark:text-fg-2-dark">
            Linked as a transfer — this row is not counted as spending.
          </Text>
          <Button
            testID="transfer-unlink"
            title="Unlink"
            variant="secondary"
            onPress={onUnlink}
          />
        </>
      ) : (
        <Button
          testID="transfer-link-open"
          title="Link as transfer"
          variant="secondary"
          onPress={onOpenPicker}
        />
      )}

      <BottomSheet visible={picking} onDismiss={onDismissPicker} title="Link as transfer">
        <View testID="transfer-candidate-picker">
          {candidates.length === 0 ? (
            <Text
              testID="transfer-candidate-empty"
              className="py-4 text-sm text-fg-2 dark:text-fg-2-dark"
            >
              {/* Says WHY there is nothing, not just that there is nothing. A
                  bare "no candidates" reads as a bug on a ledger the user can
                  see is full of rows. */}
              No matching transaction yet. The other half of a transfer is a
              {transaction.direction === "out" ? " money-in " : " money-out "}
              row in a different wallet.
            </Text>
          ) : (
            candidates.map((candidate) => (
              <ListRow
                key={candidate.id}
                testID={`transfer-candidate-${candidate.id}`}
                title={candidate.merchant ?? candidate.counterparty ?? "Transaction"}
                subtitle={`${walletsById.get(candidate.walletId)?.name ?? "Unknown wallet"} · ${formatDateTime(candidate.occurredAt)}`}
                // Wallet name has no length ceiling (wallet_form.tsx), and
                // `formatDateTime` alone already runs ~20+ characters — the
                // combined string can clip past one line for a realistic
                // custom wallet name, dropping the date that disambiguates
                // same-wallet candidates. app-wide sweep for
                // branch-review-correctness.md F2's defect class; two lines
                // covers the realistic range without over-fitting to an
                // unbounded string.
                subtitleLines={2}
                right={
                  <AmountText
                    amount={candidate.amount}
                    direction={candidate.direction}
                    size="sm"
                  />
                }
                onPress={() => onLink(candidate)}
              />
            ))
          )}
        </View>
      </BottomSheet>
    </View>
  );
}
