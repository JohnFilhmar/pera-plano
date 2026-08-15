// components/loans/loan_card.tsx — m2b Task 8, rule 2.
//
// Counterparty, outstanding balance, and a next-due chip. Presentational: the
// overdue verdict arrives from `listLoanStatuses`, which compares in local
// calendar days — a card that re-derived it would disagree with the list it
// sits in at exactly midnight.
import { Text, View } from "react-native";

import { AmountText, formatCentavos } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { ChipTone } from "@/components/ui/chip";
import { parseDateIso, startOfLocalDay } from "@/lib/dates";
import type { LoanStatus } from "@/lib/loans/loans_service";

export type LoanCardProps = {
  status: LoanStatus;
  /** Local instant, for the "due in 3d" countdown. */
  now: number;
  testID?: string;
};

const DAY_MS = 86_400_000;

/** Rule 2's chip: `due in 3d`, `due today`, `overdue`. */
function dueChip(status: LoanStatus, now: number): { label: string; tone: ChipTone } | null {
  if (status.outstanding <= 0) return { label: "Settled", tone: "brand" };
  if (status.nextDue === null) return null;
  if (status.overdue) return { label: "Overdue", tone: "danger" };

  const days = Math.round(
    (startOfLocalDay(parseDateIso(status.nextDue.dueDate).getTime()) - startOfLocalDay(now)) /
      DAY_MS,
  );

  // `warn`, not `danger`, for a due date that has not passed. Red is reserved
  // for something already wrong — spending it on "due in 3 days" leaves nothing
  // louder to say when the payment is actually late.
  if (days === 0) return { label: "Due today", tone: "warn" };
  return { label: `Due in ${days}d`, tone: days <= 3 ? "warn" : "neutral" };
}

export function LoanCard({ status, now, testID }: LoanCardProps) {
  const chip = dueChip(status, now);

  return (
    <Card testID={testID}>
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-semibold text-fg dark:text-fg-dark">
            {status.loan.counterparty}
          </Text>
          {chip === null ? null : (
            <View className="mt-2 flex-row">
              <Chip
                testID={testID === undefined ? undefined : `${testID}-due`}
                label={chip.label}
                tone={chip.tone}
              />
            </View>
          )}
        </View>

        <View className="items-end">
          <AmountText
            testID={testID === undefined ? undefined : `${testID}-outstanding`}
            amount={status.outstanding}
            size="lg"
          />
          {status.nextDue === null || status.outstanding <= 0 ? null : (
            <Text className="mt-1 text-xs text-fg-2 dark:text-fg-2-dark">
              {`Next: ${formatCentavos(status.nextDue.amount)}`}
            </Text>
          )}
        </View>
      </View>
    </Card>
  );
}
