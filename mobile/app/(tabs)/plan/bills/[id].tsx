// app/(tabs)/plan/bills/[id].tsx — bill detail (m2c Task 5, rule 5).
//
// Scoped to ONE CYCLE, taken from the route params. Rule 25 has two cycles of
// the same bill open at once with different candidates and different windows,
// so a screen that showed "the bill" without saying which occurrence would have
// to guess which one the user tapped.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { BillMatchSheet } from "@/components/bills/bill_match_sheet";
import { BillRow } from "@/components/bills/bill_row";
import { estimateLabel } from "@/components/bills/estimate_text";
import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm_dialog";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { SectionHeader } from "@/components/ui/section_header";
import { useBillCandidates } from "@/hooks/queries/use_bill_candidates";
import { useBills } from "@/hooks/queries/use_bills";
import { useArchiveBill } from "@/hooks/mutations/use_archive_bill";
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
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  // THE REF IS THE GUARD on the skip, not `confirmingSkip` and not
  // `skip.isPending` (GAP-079, GAP-060): a setter does not change the value the
  // handler closure running in this tick already read, and React Query notifies
  // its observers on a timer, so two confirms inside ONE tick both see `false`
  // and both write. The cycle itself survives that — migration 006 is UNIQUE on
  // (bill_id, due_date), so the loser's INSERT is simply rejected — but a
  // rejected mutation is a failure toast (GAP-013) about a skip that in fact
  // went through, which is the same "the app is lying about my money" the
  // confirmation below exists to prevent. The state beside the ref exists only
  // to re-render the button, which a ref never does.
  const skipInFlight = useRef(false);
  const [skipBusy, setSkipBusy] = useState(false);
  const archive = useArchiveBill();

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
    return (
      <View testID="bill-detail-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={5} />
      </View>
    );
  }

  if (status === undefined) {
    return (
      <View testID="bill-detail-missing" className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          title="This bill is gone"
          body="It was deleted. Any payments you recorded are still in your ledger, and you can restore the bill from Plan → Bills."
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

      {/* ASKS FIRST (GAP-086). Skipping is a one-way write on a Safe-to-Spend
          input — the cycle leaves the term, its reminders are cancelled, and
          `resolveCycle` refuses to reopen it — so a single tap that did it
          silently moved the headline number with nothing to reverse. Delete,
          two buttons down and no less recoverable, has always confirmed. */}
      {unresolved ? (
        <Button
          title="Skip this cycle"
          variant="secondary"
          testID="bill-skip-cycle"
          disabled={skip.isPending || skipBusy}
          onPress={() => setConfirmingSkip(true)}
        />
      ) : null}

      <ConfirmDialog
        visible={confirmingSkip}
        title="Skip this cycle?"
        // Names the cycle, because this screen is scoped to ONE occurrence and
        // a bill can have two open at once (rule 25) — "skip this cycle" alone
        // does not say which one is about to go.
        body={`Nothing will be recorded as paid for ${formatDate(
          parseDateIso(status.dueDate).getTime(),
        )}. It stops counting against your Safe-to-Spend and its remaining reminders are cancelled. You cannot undo this.`}
        confirmLabel="Skip this cycle"
        onCancel={() => setConfirmingSkip(false)}
        onConfirm={() => {
          if (skipInFlight.current || skip.isPending) return;
          skipInFlight.current = true;
          setSkipBusy(true);
          setConfirmingSkip(false);
          skip.mutate(
            { billId: status.bill.id, dueDate: status.dueDate },
            {
              // `onSettled`, not the success arm: a refused skip leaves the
              // button on screen (the cycle is still unresolved) and the retry
              // it needs has to be tappable again.
              onSettled: () => {
                skipInFlight.current = false;
                setSkipBusy(false);
              },
            },
          );
        }}
      />

      {/* THE TWO ACTIONS ON THE BILL ITSELF, as opposed to on this cycle
          (owner: bills are "unarchivable ... should also be modifable").
          `updateBill` and `archiveBill` have both existed in the repository
          since m2c and nothing in the app ever called either. */}
      <View className="flex-row flex-wrap gap-3">
        <Button
          title="Edit bill"
          variant="secondary"
          testID="bill-edit"
          onPress={() =>
            router.push({ pathname: "/plan/bills/[id]/edit", params: { id: status.bill.id } })
          }
        />
        {/* SPEC RULE 27, WORD FOR WORD: stops future cycles, reminders and
            matching; history and linked transactions are untouched. There is no
            hard delete on offer at all — the payment history keeps feeding the
            estimator, and rule 27's "never deletes or alters any ledger
            Transaction" is easiest to guarantee by not removing the rows that
            point at them. */}
        <Button
          title="Delete bill"
          variant="destructive"
          testID="bill-archive"
          onPress={() => setConfirmingArchive(true)}
          loading={archive.isPending}
        />
      </View>

      <ConfirmDialog
        visible={confirmingArchive}
        title="Delete this bill?"
        body="No more cycles, reminders or automatic matching. Everything you have already paid stays in your ledger, and the amounts still inform your other estimates. You can restore it from Plan → Bills."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmingArchive(false)}
        onConfirm={async () => {
          setConfirmingArchive(false);
          await archive.mutateAsync(status.bill.id);
          router.back();
        }}
      />

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
