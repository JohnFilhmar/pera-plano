// components/loans/payment_history.tsx — loans rules 7, 13 and 24.
//
// AN ADJUSTMENT IS NOT A PAYMENT, and rule 13 makes saying so a requirement
// rather than a nicety: an adjustment "appears in the loan's history clearly
// marked as an adjustment, not a payment". This file marks it three ways over,
// because each one alone fails somebody:
//
//   the label     "Adjustment" beside the amount, for the sighted reader
//                 scanning a column of rows
//   the words     the note itself, which is the only thing that says WHY —
//                 rule 13 requires it precisely so this line can exist
//   the sign      +/− on the amount, since an adjustment is the one row here
//                 that can move the balance UPWARDS
//
// A colour alone would not do it. Payments and reducing adjustments would be
// the same green, the distinction would vanish for anyone reading in
// monochrome, and TalkBack announces no colour at all — so the row's
// `accessibilityLabel` states the kind in words too.
//
// THE HISTORY OUTLIVES THE LEDGER (rule 24): "on the free tier, ledger history
// is 90 days, but Loan records and paymentHistory[] entries are not ledger
// history — a payment recorded 6 months ago still shows in the loan's history
// even when its underlying Transaction has aged out of the free ledger view."
// Nothing here filters on age, and nothing here should acquire one.
import { Text, View } from "react-native";

import { AmountText, formatCentavos } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { formatDate } from "@/lib/datetime";
import type { LoanHistoryEntry } from "@/lib/loans/loans_service";
import type { LoanDirection } from "@/types/domain";

export type PaymentHistoryProps = {
  entries: LoanHistoryEntry[];
  /** Which way the loan points — the empty copy says opposite things for each. */
  direction: LoanDirection;
  counterparty: string;
  testID?: string;
};

export function PaymentHistory({
  entries,
  direction,
  counterparty,
  testID = "loan-history",
}: PaymentHistoryProps) {
  const iOwe = direction === "i-owe";

  if (entries.length === 0) {
    return (
      <Card testID={testID}>
        <Text testID="loan-history-empty" className="text-fg-2 dark:text-fg-2-dark">
          {iOwe
            ? `Nothing recorded yet. Payments you make to ${counterparty} show up here — matched from your ledger, or recorded by hand for cash.`
            : `Nothing recorded yet. Repayments from ${counterparty} show up here — matched from your ledger, or recorded by hand for cash.`}
        </Text>
      </Card>
    );
  }

  return (
    <Card testID={testID}>
      <View className="gap-4">
        {entries.map((entry) =>
          entry.kind === "payment" ? (
            <View
              key={entry.id}
              testID={`loan-history-payment-${entry.id}`}
              accessibilityLabel={`Payment, ${formatCentavos(entry.amount)}, ${formatDate(
                entry.occurredAt,
              )}`}
              className="gap-1"
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-fg dark:text-fg-dark">
                  {iOwe ? "Payment" : `${counterparty} paid`}
                </Text>
                {/* The LEDGER's own direction, straight off the linked
                    transaction rather than re-derived from the loan: `out`
                    inks red and `in` inks green, which is the same thing the
                    transactions list shows for the very same row. Two screens
                    disagreeing about which way one transaction went is worse
                    than either being wrong on its own. */}
                <AmountText
                  testID={`loan-history-amount-${entry.id}`}
                  amount={entry.amount}
                  direction={entry.direction}
                />
              </View>
              <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
                {formatDate(entry.occurredAt)}
              </Text>
            </View>
          ) : (
            <View
              key={entry.id}
              testID={`loan-history-adjustment-${entry.id}`}
              accessibilityLabel={`Adjustment, not a payment. ${
                entry.amount >= 0 ? "Increased" : "Reduced"
              } the balance by ${formatCentavos(Math.abs(entry.amount))}. ${entry.note}`}
              className="gap-1"
            >
              <View className="flex-row items-center justify-between">
                {/* `warn`, not `brand` or `danger`. An adjustment is neither a
                    good thing nor a destructive one — it is a figure the app
                    did not witness and cannot check, and the tone that carries
                    "read this one yourself" is the same one the drift badge
                    uses for a balance the app cannot vouch for. */}
                <Chip label="Adjustment" tone="warn" fill="soft" />
                <Text
                  testID={`loan-history-amount-${entry.id}`}
                  style={{ fontVariant: ["tabular-nums"] }}
                  className={`text-secondary font-bold ${
                    entry.amount >= 0
                      ? "text-danger dark:text-danger-dark"
                      : "text-brand dark:text-brand-dark"
                  }`}
                >
                  {/* U+2212 MINUS SIGN, components/ui/amount_text.tsx's
                      convention. Danger for an adjustment that ADDS to the
                      balance — on either direction of loan that is the
                      unwelcome one, since it is money that appeared out of
                      nothing the user watched happen. */}
                  {`${entry.amount >= 0 ? "+" : "−"}${formatCentavos(Math.abs(entry.amount))}`}
                </Text>
              </View>
              {/* THE NOTE IS NOT OPTIONAL FURNITURE. It is the entire reason
                  rule 13 requires one, and a history row that showed only an
                  amount would be exactly the unexplained number the
                  requirement exists to prevent. */}
              <Text
                testID={`loan-history-note-${entry.id}`}
                className="text-fg-2 dark:text-fg-2-dark"
              >
                {entry.note}
              </Text>
              <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
                {`${formatDate(entry.occurredAt)} · Adjustment, not a payment`}
              </Text>
            </View>
          ),
        )}
      </View>
    </Card>
  );
}
