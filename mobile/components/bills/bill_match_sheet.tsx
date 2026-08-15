// components/bills/bill_match_sheet.tsx — m2c Task 5.
//
// "Did ₱2,412.36 to MERALCO pay your Meralco bill?" — the spec's one-tap
// confirmation, with the same discipline as the loan match sheet: every
// candidate shows its amount, its date, and WHY it matched. A score alone asks
// the user to trust a number they cannot check, on a decision that marks a bill
// paid and pulls a transaction out of every other match list.
//
// REJECTING IS A FIRST-CLASS ACTION, not a dismissal. The spec's "No" branch
// excludes the offending keyword and resets the auto-match ladder — closing the
// sheet must not be mistaken for it, or the app would keep proposing the same
// wrong transaction while believing the user never objected.
import { Pressable, Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Card } from "@/components/ui/card";
import type { BillPaymentCandidate } from "@/lib/bills/bills_service";
import { formatDate } from "@/lib/datetime";

export type BillMatchSheetProps = {
  visible: boolean;
  candidates: BillPaymentCandidate[];
  billName: string;
  busy?: boolean;
  onDismiss: () => void;
  onConfirm: (transactionId: string) => void;
  onReject: (transactionId: string) => void;
};

export function BillMatchSheet({
  visible,
  candidates,
  billName,
  busy = false,
  onDismiss,
  onConfirm,
  onReject,
}: BillMatchSheetProps) {
  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Did one of these pay it?">
      <View testID="bill-match-sheet" className="gap-3">
        <Text className="text-fg-2 dark:text-fg-2-dark">
          {`These look like payments on your ${billName} bill. Nothing is recorded until you choose one.`}
        </Text>
        {candidates.map((candidate) => (
          <Card key={candidate.transactionId}>
            <View className="flex-row items-start justify-between">
              <View className="flex-1 pr-3">
                <Text className="font-semibold text-fg dark:text-fg-dark">
                  {candidate.merchant ?? "Unnamed transaction"}
                </Text>
                <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
                  {formatDate(candidate.occurredAt)}
                </Text>
                {candidate.reasons.map((reason) => (
                  <Text key={reason} className="mt-1 text-xs text-fg-2 dark:text-fg-2-dark">
                    · {reason}
                  </Text>
                ))}
              </View>
              <AmountText amount={candidate.amount} direction="out" />
            </View>

            <View className="mt-3 flex-row gap-2">
              <Pressable
                testID={`bill-match-confirm-${candidate.transactionId}`}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onConfirm(candidate.transactionId)}
                className="flex-1 rounded-lg bg-brand px-3 py-2 dark:bg-brand-dark"
              >
                <Text className="text-center font-semibold text-surface dark:text-surface-dark">
                  Yes, it did
                </Text>
              </Pressable>
              <Pressable
                testID={`bill-match-reject-${candidate.transactionId}`}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onReject(candidate.transactionId)}
                className="flex-1 rounded-lg bg-surface px-3 py-2 dark:bg-surface-dark"
              >
                <Text className="text-center font-semibold text-fg dark:text-fg-dark">No</Text>
              </Pressable>
            </View>
          </Card>
        ))}
      </View>
    </BottomSheet>
  );
}
