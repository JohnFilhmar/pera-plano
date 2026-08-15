// app/(tabs)/plan/bills/[id].tsx — bill detail (m2c Task 5, rule 5).
//
// Scoped to ONE CYCLE, taken from the route params. Rule 25 has two cycles of
// the same bill open at once with different candidates and different windows,
// so a screen that showed "the bill" without saying which occurrence would have
// to guess which one the user tapped.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { BillMatchSheet } from "@/components/bills/bill_match_sheet";
import { BillRow } from "@/components/bills/bill_row";
import { estimateLabel } from "@/components/bills/estimate_text";
import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";
import { SectionHeader } from "@/components/ui/section_header";
import { useBillCandidates } from "@/hooks/queries/use_bill_candidates";
import { useBills } from "@/hooks/queries/use_bills";
import {
  useRecordBillPayment,
  useRejectBillMatch,
} from "@/hooks/mutations/use_record_bill_payment";
import { useSkipBillCycle } from "@/hooks/mutations/use_skip_bill_cycle";
import { parseDateIso } from "@/lib/dates";
import { formatDate } from "@/lib/datetime";

export default function BillDetailScreen() {
  const { id, dueDate } = useLocalSearchParams<{ id: string; dueDate?: string }>();
  const router = useRouter();
  const { data: statuses } = useBills();
  const [sheetOpen, setSheetOpen] = useState(false);

  const record = useRecordBillPayment();
  const reject = useRejectBillMatch();
  const skip = useSkipBillCycle();

  const forBill = (statuses ?? []).filter((status) => status.bill.id === id);
  // Without a `dueDate` param, the soonest UNRESOLVED cycle is the one the user
  // most likely means; falling back to the first row would open a paid cycle.
  const status =
    forBill.find((candidate) => candidate.dueDate === dueDate) ??
    forBill.find((candidate) => candidate.state !== "paid" && candidate.state !== "skipped") ??
    forBill[0];

  const { data: candidates } = useBillCandidates(id, status?.dueDate);

  if (statuses === undefined) {
    return <View testID="bill-detail-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  if (status === undefined) {
    return (
      <View testID="bill-detail-missing" className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          title="This bill is gone"
          body="It was archived or deleted. Any payments you recorded are still in your ledger."
          action={{ label: "Back to bills", onPress: () => router.back() }}
        />
      </View>
    );
  }

  const history = forBill.filter((row) => row.payment !== null);
  const unresolved = status.state !== "paid" && status.state !== "skipped" &&
    status.state !== "resolved_external";

  return (
    <ScrollView
      testID="bill-detail"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-4 p-4"
    >
      <BillRow testID="bill-detail-row" status={status} />

      <Card>
        <View className="flex-row items-center justify-between">
          <Text className="text-fg-2 dark:text-fg-2-dark">Expected</Text>
          <Text testID="bill-detail-estimate" className="text-fg dark:text-fg-dark">
            {estimateLabel(status.estimate)}
          </Text>
        </View>
        {/* Rule 5: the estimate AND ITS BASIS. "Around ₱2,350" means something
            different when it comes from three real payments than when it is
            still the figure the user typed at setup. */}
        <Text testID="bill-detail-basis" className="mt-1 text-xs text-fg-2 dark:text-fg-2-dark">
          {status.estimate.basis === "fixed"
            ? "A fixed amount you set."
            : status.estimate.basis === "seed"
              ? "Your starting figure — no payments recorded yet."
              : `Averaged from your last ${status.estimate.sampleSize} payment${
                  status.estimate.sampleSize === 1 ? "" : "s"
                }.`}
        </Text>
      </Card>

      {unresolved && candidates !== undefined && candidates.length > 0 ? (
        <Button
          title={`${candidates.length} possible payment${candidates.length === 1 ? "" : "s"}`}
          variant="secondary"
          testID="bill-open-matches"
          onPress={() => setSheetOpen(true)}
        />
      ) : null}

      {unresolved ? (
        <Button
          title="Skip this cycle"
          variant="secondary"
          testID="bill-skip-cycle"
          disabled={skip.isPending}
          onPress={() => skip.mutate({ billId: status.bill.id, dueDate: status.dueDate })}
        />
      ) : null}

      <SectionHeader title="Payment history" />
      {history.length === 0 ? (
        <Text testID="bill-history-empty" className="text-fg-2 dark:text-fg-2-dark">
          Nothing recorded yet.
        </Text>
      ) : (
        history.map((row) => (
          <Card key={row.dueDate} testID={`bill-history-${row.dueDate}`}>
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-fg dark:text-fg-dark">
                  {formatDate(parseDateIso(row.dueDate).getTime())}
                </Text>
                <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
                  {row.payment === null
                    ? "Settled"
                    : `Paid ${formatDate(row.payment.createdAt)}`}
                </Text>
              </View>
              <AmountText amount={row.estimate.amount} />
            </View>
          </Card>
        ))
      )}

      <BillMatchSheet
        visible={sheetOpen}
        candidates={candidates ?? []}
        billName={status.bill.name}
        busy={record.isPending || reject.isPending}
        onDismiss={() => setSheetOpen(false)}
        onConfirm={async (transactionId) => {
          await record.mutateAsync({
            billId: status.bill.id,
            dueDate: status.dueDate,
            transactionId,
          });
          setSheetOpen(false);
        }}
        onReject={async (transactionId) => {
          await reject.mutateAsync({ billId: status.bill.id, transactionId });
        }}
      />
    </ScrollView>
  );
}
