// app/(tabs)/plan/loans/[id].tsx — Loan detail (m2b Task 8, rules 4 and 5).
//
// Free sees balance, next due, payment history, reminders and the
// record-payment action; the amortization table is Plus (spec states table),
// and `ScheduleTable` carries that gate itself.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { BalanceAdjustmentSheet } from "@/components/loans/balance_adjustment_sheet";
import { LoanCard } from "@/components/loans/loan_card";
import { PaymentHistory } from "@/components/loans/payment_history";
import { PaymentMatchSheet } from "@/components/loans/payment_match_sheet";
import { RecordPaymentSheet } from "@/components/loans/record_payment_sheet";
import { ScheduleTable } from "@/components/loans/schedule_table";
import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm_dialog";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { SectionHeader } from "@/components/ui/section_header";
import { useConfirmPaymentMatch } from "@/hooks/mutations/use_confirm_payment_match";
import { useLoanHistory } from "@/hooks/queries/use_loan_history";
import { useLoans } from "@/hooks/queries/use_loans";
import { useArchiveLoan } from "@/hooks/mutations/use_archive_loan";
import { usePaymentCandidates } from "@/hooks/queries/use_payment_candidates";
import { useWallets } from "@/hooks/queries/use_wallets";
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

  // The spec's "Flow: manual payment recording" and rule 13, which had service
  // and repository halves and no way in from any screen — `useRecordPayment`
  // was imported by nothing at all. Both sheets are mounted unconditionally and
  // gated on `visible`, matching `PaymentMatchSheet` below: `BottomSheet`
  // renders null while hidden rather than parking an invisible full-screen
  // touch target over the page.
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [adjustingBalance, setAdjustingBalance] = useState(false);
  // Wallets are read HERE rather than inside the payment sheet so the sheet
  // stays a component that renders what it is handed — the same split
  // `manual_entry_form.tsx` keeps with its own route.
  const { data: wallets } = useWallets();
  const { data: history } = useLoanHistory(id);

  // ONE READ OF THE CLOCK FOR THE WHOLE SCREEN. The card's overdue ink, both
  // sheets' default date and both date pickers' upper bound all answer to it,
  // and three independent `systemClock.now()` calls could straddle midnight
  // and disagree about what "today" is on the one screen where the user is
  // back-dating a collector's visit.
  const now = systemClock.now();

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
      <LoanCard testID="loan-detail-card" status={status} now={now} />

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

      {/* THE SPEC'S OWN FIRST STEP: "Loan detail → Record payment." It is the
          PRIMARY action here and matching is the secondary one, which is the
          reverse of the order this screen shipped in — matching can only ever
          offer what a provider notification already put in the ledger, and the
          two cases the loans feature exists for (a 5-6 collector taking cash,
          a cousin handing back a thousand pesos) leave no notification at all.
          Until now there was no way to record either.

          HIDDEN ONCE SETTLED, same condition the match button carries: nothing
          is owed, so nothing can pay it, and `outstandingBalance` floors at
          zero anyway (plan rule 5) — a payment recorded against a settled loan
          would write a real ledger row and move no balance, which looks to the
          user like the app losing their money. A balance adjustment is still
          offered below, because rule 20 says a settled loan is reopened by
          exactly that. */}
      {status.outstanding > 0 ? (
        <Button
          title={status.loan.direction === "i-owe" ? "Record a payment" : "Record what they paid"}
          testID="loan-record-payment"
          onPress={() => setRecordingPayment(true)}
        />
      ) : null}

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

      {/* RULE 13, AND IT IS OFFERED ON A SETTLED LOAN TOO — rule 20: "A settled
          loan can be reopened by a balance adjustment (e.g., a late-arriving
          fee)." That is the one action on this screen with no balance
          precondition at all, which is why it sits outside the
          `outstanding > 0` guards above rather than inside them.

          SECONDARY, NOT PRIMARY. An adjustment moves a balance with no ledger
          entry behind it, so it should never be the easiest thing on the screen
          to press by accident when what actually happened was a payment. */}
      <Button
        title="Balance adjustment"
        variant="secondary"
        testID="loan-record-adjustment"
        onPress={() => setAdjustingBalance(true)}
      />

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

      {/* Rules 7 and 13's history, and rule 24's reminder that it is NOT ledger
          history: a payment from six months ago still belongs here on the free
          tier, long after its transaction has aged out of the 90-day ledger
          view. `PaymentHistory` renders its own empty state, so this section is
          unconditional — a loan with no payments yet still needs to show the
          user WHERE the ones they record will appear. */}
      <SectionHeader title="History" />
      <PaymentHistory
        entries={history ?? []}
        direction={status.loan.direction}
        counterparty={status.loan.counterparty}
      />

      <SectionHeader title="Schedule" />
      <ScheduleTable testID="loan-schedule" rows={rows} totalPaid={paid} />

      {/* THE DIRECTION IS NOT PASSED AND NOT PASSABLE. The sheet takes the
          whole `Loan`, reads `direction` off it for its wording only, and
          `recordManualPayment` derives the transaction's direction from the
          same row server-side of the hook — so there is no prop on this call
          that could disagree with the loan, which is the one way the "same
          functions for what I owe" defect gets back in. */}
      <RecordPaymentSheet
        loan={status.loan}
        wallets={wallets ?? []}
        visible={recordingPayment}
        now={now}
        onDismiss={() => setRecordingPayment(false)}
      />

      <BalanceAdjustmentSheet
        loan={status.loan}
        visible={adjustingBalance}
        now={now}
        onDismiss={() => setAdjustingBalance(false)}
      />

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
