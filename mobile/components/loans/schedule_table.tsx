// components/loans/schedule_table.tsx — m2b Task 8, rule 4.
//
// PLUS-GATED, per contract §7 and the spec's states table: Free sees "Balance,
// next due, payment history, reminders, record-payment action"; Plus adds "the
// full amortization schedule table ... each installment's date, amount,
// principal/interest split (amortized type), and paid/unpaid status".
//
// FREE SEES A PREVIEW, NOT AN EMPTY SCREEN (rule 4). `PlusGate` renders its
// children in normal colours with a badge and intercepts the press — so the
// user can see exactly what they would get, which is the difference between a
// paywall and a dead end.
import { Text, View } from "react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { formatCentavos } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/datetime";
import { parseDateIso } from "@/lib/dates";
import type { ScheduleRow } from "@/lib/loans/loan_math";

export type ScheduleTableProps = {
  rows: ScheduleRow[];
  /** How much has been paid, so each row can be marked paid or unpaid. */
  totalPaid: number;
  testID?: string;
};

export function ScheduleTable({ rows, totalPaid, testID }: ScheduleTableProps) {
  if (rows.length === 0) {
    return (
      <Card testID={testID}>
        {/* Spec rule 1: free-form loans have no schedule at all. Saying so is
            better than an empty table, which reads as a loading failure. */}
        <Text testID="schedule-none" className="text-fg-2 dark:text-fg-2-dark">
          This loan has no fixed schedule — its balance is whatever is left after payments.
        </Text>
      </Card>
    );
  }

  // Paid/unpaid is CUMULATIVE, not per row: payments cover the schedule in
  // order, so the boundary is wherever the running total runs out.
  let covered = totalPaid;
  const withStatus = rows.map((row) => {
    const paid = covered >= row.payment;
    covered = Math.max(0, covered - row.payment);
    return { row, paid };
  });

  const hasInterest = rows.some((row) => row.interest > 0);

  return (
    <PlusGate capability="amortization">
      <Card testID={testID}>
        <View className="flex-row border-b border-brand-soft pb-2 dark:border-brand-soft-dark">
          <Text className="flex-1 text-xs text-fg-2 dark:text-fg-2-dark">Due</Text>
          <Text className="w-24 text-right text-xs text-fg-2 dark:text-fg-2-dark">Payment</Text>
          {/* The split is shown only when there IS one. A flat schedule has no
              interest column because spec rule 4 forbids deriving a rate for
              5-6 lending — an all-zero column would imply one exists and is
              zero, which is a different claim. */}
          {hasInterest ? (
            <Text className="w-24 text-right text-xs text-fg-2 dark:text-fg-2-dark">Interest</Text>
          ) : null}
          <Text className="w-24 text-right text-xs text-fg-2 dark:text-fg-2-dark">Balance</Text>
        </View>

        {withStatus.map(({ row, paid }) => (
          <View
            key={row.index}
            testID={`schedule-row-${row.index}`}
            className="flex-row items-center py-2"
          >
            <Text
              className={`flex-1 text-xs ${
                paid ? "text-fg-2 line-through dark:text-fg-2-dark" : "text-fg dark:text-fg-dark"
              }`}
            >
              {formatDate(parseDateIso(row.dueDate).getTime())}
            </Text>
            <Text className="w-24 text-right text-xs text-fg dark:text-fg-dark">
              {formatCentavos(row.payment)}
            </Text>
            {hasInterest ? (
              <Text className="w-24 text-right text-xs text-fg-2 dark:text-fg-2-dark">
                {formatCentavos(row.interest)}
              </Text>
            ) : null}
            <Text className="w-24 text-right text-xs text-fg-2 dark:text-fg-2-dark">
              {formatCentavos(row.balanceAfter)}
            </Text>
          </View>
        ))}
      </Card>
    </PlusGate>
  );
}
