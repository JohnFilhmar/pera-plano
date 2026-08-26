// components/loans/payment_match_sheet.tsx — m2b Task 8, rule 5.
//
// EVERY CANDIDATE SHOWS ITS REASONS. Rule 5: each is listed "with its amount,
// date, and why it matched". A score would ask the user to trust a number they
// cannot check, on a decision that moves their loan balance and pulls a
// transaction out of income detection.
//
// CONFIRMING IS THE ONLY WRITE. Spec rule 9 permits auto-matching for exactly
// one signal that is not modelled yet, so nothing reaches the ledger until a
// tap here — and rejecting is silent, because rule 10 forbids the app inventing
// a negative rule from a single "no".
import { Text, View } from "react-native";

import { AmountText, formatCentavos } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/datetime";
import type { PaymentCandidate } from "@/lib/loans/loans_service";
import type { LoanDirection } from "@/types/domain";

export type PaymentMatchSheetProps = {
  visible: boolean;
  candidates: PaymentCandidate[];
  counterparty: string;
  /** Which way the loan points — the sheet's copy says opposite things for each. */
  direction: LoanDirection;
  onDismiss: () => void;
  onConfirm: (transactionId: string) => void;
  busy?: boolean;
  /**
   * Whether this is the browse-everything list rather than the scored
   * suggestions — it changes what the sheet is CLAIMING. "These look like
   * payments" is a statement the app has to have earned; over an unfiltered
   * list it is simply false, and a user who trusts it once and confirms the
   * wrong row has corrupted both a loan balance and their income detection.
   */
  showingAll?: boolean;
  /** Opens the unfiltered list. Absent when it is already open. */
  onShowAll?: () => void;
};

export function PaymentMatchSheet({
  visible,
  candidates,
  counterparty,
  direction,
  onDismiss,
  onConfirm,
  busy = false,
  showingAll = false,
  onShowAll,
}: PaymentMatchSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={showingAll ? "Pick the payment" : "Is this a payment?"}
    >
      <View testID="match-sheet" className="gap-4">
        <Text className="text-fg-2 dark:text-fg-2-dark">
          {showingAll
            ? `Every transaction that could pay your ${counterparty} loan and isn't already matched. Pick the one that is.`
            : `These transactions look like payments on your ${counterparty} loan. Confirm any that are.`}
        </Text>

        {showingAll && candidates.length === 0 ? (
          <Text testID="match-empty" className="text-fg-2 dark:text-fg-2-dark">
            {direction === "i-owe"
              ? "Nothing in the last 60 days could pay this loan. A payment has to be money going out of a wallet the app tracks."
              : "Nothing in the last 60 days could repay this loan. A repayment has to be money coming in to a wallet the app tracks."}
          </Text>
        ) : null}

        {candidates.map((candidate) => (
          <Card key={candidate.transactionId} testID={`match-candidate-${candidate.transactionId}`}>
            <View className="gap-2">
              <View className="flex-row items-center justify-between">
                {/* The parsed counterparty backs the merchant up: a receive
                    template captures a sender and no merchant, so an
                    owed-to-me repayment has its name in the second field or
                    nowhere. */}
                <Text className="text-fg dark:text-fg-dark">
                  {candidate.merchant ?? candidate.counterparty ?? "Unknown"}
                </Text>
                <AmountText amount={candidate.amount} />
              </View>
              <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
                {formatDate(candidate.occurredAt)}
              </Text>

              {/* Rule 5's "why". One line per signal that actually fired, so
                  the user can check the app's reasoning against what they
                  remember. */}
              <View testID={`match-reasons-${candidate.transactionId}`}>
                {candidate.reasons.map((reason) => (
                  <Text key={reason} className="text-xs text-fg-2 dark:text-fg-2-dark">
                    {`· ${reason}`}
                  </Text>
                ))}
              </View>

              {/* "this paid" is the borrower's sentence, not the lender's —
                  on an owed-to-me loan the money came IN, and confirming a
                  row that claims otherwise is how the two directions blur. */}
              <Button
                testID={`match-confirm-${candidate.transactionId}`}
                title={
                  direction === "i-owe"
                    ? `Yes, this paid ${formatCentavos(candidate.amount)}`
                    : `Yes, ${counterparty} paid ${formatCentavos(candidate.amount)}`
                }
                disabled={busy}
                onPress={() => onConfirm(candidate.transactionId)}
              />
            </View>
          </Card>
        ))}

        {/* THE WAY OUT WHEN SCORING MISSES. A partial repayment from a person
            on a free-form utang fires no strong signal — no installment to
            match, often no due date, and a provider name that is not the name
            the user wrote down. Without this the user's only option is to
            create a second transaction for money that already moved. */}
        {showingAll || onShowAll === undefined ? null : (
          <Button
            title="Show every transaction"
            variant="secondary"
            testID="match-show-all"
            onPress={onShowAll}
          />
        )}

        {/* Rejecting is just dismissing. Rule 10: "Rejecting a suggestion never
            creates a negative UserRule automatically." */}
        <Button
          title={showingAll ? "Close" : "None of these"}
          variant="ghost"
          testID="match-dismiss"
          onPress={onDismiss}
        />
      </View>
    </BottomSheet>
  );
}
