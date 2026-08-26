// app/(tabs)/plan/loans/[id].tsx — Loan detail (m2b Task 8, rules 4 and 5).
//
// Free sees balance, next due, payment history, reminders and the
// record-payment action; the amortization table is Plus (spec states table),
// and `ScheduleTable` carries that gate itself.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { LoanCard } from "@/components/loans/loan_card";
import { PaymentMatchSheet } from "@/components/loans/payment_match_sheet";
import { ScheduleTable } from "@/components/loans/schedule_table";
import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm_dialog";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { SectionHeader } from "@/components/ui/section_header";
import { useConfirmPaymentMatch } from "@/hooks/mutations/use_confirm_payment_match";
import { useLoans } from "@/hooks/queries/use_loans";
import { useArchiveLoan } from "@/hooks/mutations/use_archive_loan";
import { usePaymentCandidates } from "@/hooks/queries/use_payment_candidates";
import { systemClock } from "@/lib/clock";
import type { ScheduleRow } from "@/lib/loans/loan_math";

export default function LoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: statuses } = useLoans();
  const { data: candidates } = usePaymentCandidates(id);
  const confirm = useConfirmPaymentMatch();
  const [sheetOpen, setSheetOpen] = useState(false);
  // The unfiltered list is fetched ONLY once the user asks for it — it drops
  // the score floor and reads up to 50 transactions, which is not work to do
  // on every visit to a loan that has a perfectly good suggestion waiting.
  const [browsingAll, setBrowsingAll] = useState(false);
  const { data: allCandidates } = usePaymentCandidates(browsingAll ? id : undefined, true);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const archive = useArchiveLoan();

  if (statuses === undefined) {
    return (
      <View testID="loan-detail-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={5} />
      </View>
    );
  }

  const status = statuses.find((candidate) => candidate.loan.id === id);
  if (status === undefined) {
    return (
      <View testID="loan-detail-missing" className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          title="This loan is gone"
          body="It was deleted. Any payments you recorded are still in your ledger."
          action={{ label: "Back to loans", onPress: () => router.back() }}
        />
      </View>
    );
  }

  // `Loan.schedule` stores installments; `ScheduleTable` renders schedule rows.
  // Mapping here rather than widening the table keeps the table usable with a
  // freshly built schedule too, before anything is saved.
  const rows: ScheduleRow[] = (status.loan.schedule ?? []).map((installment, index) => ({
    index: index + 1,
    dueDate: installment.dueDate,
    payment: installment.amountDue,
    principal: installment.principalPortion ?? installment.amountDue,
    interest: installment.interestPortion ?? 0,
    balanceAfter: 0,
  }));

  const paid = status.loan.principal - status.outstanding;

  return (
    <ScrollView
      testID="loan-detail"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-4 p-4"
    >
      <LoanCard testID="loan-detail-card" status={status} now={systemClock.now()} />

      <Card>
        <View className="flex-row items-center justify-between">
          <Text className="text-fg-2 dark:text-fg-2-dark">Paid so far</Text>
          <AmountText testID="loan-detail-paid" amount={paid} />
        </View>
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-fg-2 dark:text-fg-2-dark">Payments recorded</Text>
          <Text className="text-fg dark:text-fg-dark">{String(status.paidCount)}</Text>
        </View>
      </Card>

      {/* Rule 5's sheet: an offer, not a banner — nothing is recorded until
          the user taps a candidate inside it.

          THE BUTTON IS ALWAYS HERE, even with nothing suggested. Scoring is
          weakest exactly where owed-to-me lending lives — a partial amount,
          from a person, on a loan with no schedule — so "no suggestions" is
          not the same as "no payment arrived", and a screen that offers no
          action in that case leaves the user with no way to record money they
          watched land. */}
      {status.outstanding > 0 ? (
        <Button
          title={
            candidates !== undefined && candidates.length > 0
              ? `${candidates.length} possible payment${candidates.length === 1 ? "" : "s"}`
              : "Match a payment"
          }
          variant="secondary"
          testID="loan-open-matches"
          onPress={() => {
            // With nothing scored above the floor there is no suggestion list
            // to show, so opening straight into the full one saves a tap that
            // could only ever land on an empty sheet.
            const hasSuggestions = candidates !== undefined && candidates.length > 0;
            setBrowsingAll(!hasSuggestions);
            setSheetOpen(true);
          }}
        />
      ) : null}

      {/* Owner's device report: loans are "unarchivable, softdelete data, no
          hard delete, should also be modifable". `updateLoan` existed and
          nothing called it; archiving had no column, no repository function and
          no UI until migration 010. */}
      <View className="flex-row flex-wrap gap-3">
        <Button
          title="Edit loan"
          variant="secondary"
          testID="loan-edit"
          onPress={() =>
            router.push({ pathname: "/plan/loans/[id]/edit", params: { id: status.loan.id } })
          }
        />
        {/* NEVER A DELETE. `loan_payments` rows point at real ledger
            Transactions, so removing the loan would leave the money visibly
            gone from the ledger with nothing left to explain it. */}
        <Button
          title="Archive loan"
          variant="destructive"
          testID="loan-archive"
          onPress={() => setConfirmingArchive(true)}
          loading={archive.isPending}
        />
      </View>

      <ConfirmDialog
        visible={confirmingArchive}
        title="Archive this loan?"
        body="It stops appearing in Plan and its reminders stop. Every payment you recorded stays in your ledger exactly as it is."
        confirmLabel="Archive"
        destructive
        onCancel={() => setConfirmingArchive(false)}
        onConfirm={async () => {
          setConfirmingArchive(false);
          await archive.mutateAsync(status.loan.id);
          router.back();
        }}
      />

      <SectionHeader title="Schedule" />
      <ScheduleTable testID="loan-schedule" rows={rows} totalPaid={paid} />

      <PaymentMatchSheet
        visible={sheetOpen}
        candidates={(browsingAll ? allCandidates : candidates) ?? []}
        counterparty={status.loan.counterparty}
        direction={status.loan.direction}
        showingAll={browsingAll}
        onShowAll={() => setBrowsingAll(true)}
        busy={confirm.isPending}
        onDismiss={() => {
          setSheetOpen(false);
          setBrowsingAll(false);
        }}
        onConfirm={async (transactionId) => {
          await confirm.mutateAsync({ loanId: status.loan.id, transactionId });
          setSheetOpen(false);
          setBrowsingAll(false);
        }}
      />
    </ScrollView>
  );
}
