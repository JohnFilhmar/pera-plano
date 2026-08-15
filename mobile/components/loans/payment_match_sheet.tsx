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
import { Pressable, Text, View } from "react-native";

import { AmountText, formatCentavos } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/datetime";
import type { PaymentCandidate } from "@/lib/loans/loans_service";

export type PaymentMatchSheetProps = {
  visible: boolean;
  candidates: PaymentCandidate[];
  counterparty: string;
  onDismiss: () => void;
  onConfirm: (transactionId: string) => void;
  busy?: boolean;
};

export function PaymentMatchSheet({
  visible,
  candidates,
  counterparty,
  onDismiss,
  onConfirm,
  busy = false,
}: PaymentMatchSheetProps) {
  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Is this a payment?">
      <View testID="match-sheet" className="gap-4">
        <Text className="text-fg-2 dark:text-fg-2-dark">
          {`These transactions look like payments on your ${counterparty} loan. Confirm any that are.`}
        </Text>

        {candidates.map((candidate) => (
          <View
            key={candidate.transactionId}
            testID={`match-candidate-${candidate.transactionId}`}
            className="gap-2 rounded-2xl bg-surface p-4 dark:bg-surface-dark"
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-fg dark:text-fg-dark">
                {candidate.merchant ?? "Unknown"}
              </Text>
              <AmountText amount={candidate.amount} />
            </View>
            <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
              {formatDate(candidate.occurredAt)}
            </Text>

            {/* Rule 5's "why". One line per signal that actually fired, so the
                user can check the app's reasoning against what they remember. */}
            <View testID={`match-reasons-${candidate.transactionId}`}>
              {candidate.reasons.map((reason) => (
                <Text key={reason} className="text-xs text-fg-2 dark:text-fg-2-dark">
                  {`· ${reason}`}
                </Text>
              ))}
            </View>

            <Pressable
              testID={`match-confirm-${candidate.transactionId}`}
              disabled={busy}
              onPress={() => onConfirm(candidate.transactionId)}
              className="mt-1 self-start rounded-full bg-brand px-4 py-2 dark:bg-brand-dark"
            >
              <Text className="text-surface dark:text-surface-dark">
                {`Yes, this paid ${formatCentavos(candidate.amount)}`}
              </Text>
            </Pressable>
          </View>
        ))}

        {/* Rejecting is just dismissing. Rule 10: "Rejecting a suggestion never
            creates a negative UserRule automatically." */}
        <Button title="None of these" variant="ghost" testID="match-dismiss" onPress={onDismiss} />
      </View>
    </BottomSheet>
  );
}
