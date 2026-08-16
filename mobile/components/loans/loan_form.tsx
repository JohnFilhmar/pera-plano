// components/loans/loan_form.tsx — m2b Task 8, rule 3.
//
// THE FORM ADAPTS TO THE SCHEDULE KIND, because the three kinds ask for
// genuinely different things (spec rule 1):
//   amortized — rate and term, with the monthly payment previewed LIVE
//   flat      — installment, count, interval; no rate anywhere
//   free-form — nothing beyond counterparty and principal
//
// FLAT NEVER ASKS FOR A RATE, and that is not a simplification. Spec rule 4:
// 5-6 "is modeled as flat or free-form only. The app never derives or displays
// an interest rate for it." A rate field on this branch would invite the user
// to enter one and the app to show it back.
//
// OWED-TO-ME DEFAULTS TO FREE-FORM (rule 3): personal lending rarely has terms,
// and defaulting a loan to your cousin into an amortization schedule asks a
// question nobody agreed on.
//
// REMINDERS — same picker as components/bills/bill_form.tsx, on purpose (m2b
// gap closed by migration 008). A user should not meet two different reminder
// pickers in one app. It offers the spec's own three offsets (rule 15) rather
// than bills' five, because rule 15 names exactly those three and no others —
// unlike bills rule 10, which enumerates a wider menu.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { centavosFromDigits, formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { DEFAULT_LOAN_REMINDER_OFFSETS } from "@/constants/loans";
import { buildAmortizationSchedule, buildFlatSchedule, monthlyPayment } from "@/lib/loans/loan_math";
import type { Installment, LoanDirection } from "@/types/domain";

export type ScheduleKind = "amortized" | "flat" | "free-form";

export type LoanFormValues = {
  direction: LoanDirection;
  counterparty: string;
  principal: number;
  interestRate: number | null;
  schedule: Installment[] | null;
  nextDueDate: string | null;
  nextDueAmount: number | null;
  reminderOffsets: number[];
};

/** Rule 15's own three offsets. Negative-is-before, matching types/domain.ts. */
const REMINDER_OFFSETS: readonly { value: number; label: string }[] = [
  { value: -3, label: "3 days before" },
  { value: 0, label: "On the due date" },
  { value: 3, label: "3 days after" },
];

export type LoanFormProps = {
  onSubmit: (values: LoanFormValues) => void;
  busy?: boolean;
};

const DIRECTIONS: readonly { value: LoanDirection; label: string }[] = [
  { value: "i-owe", label: "I owe" },
  { value: "owed-to-me", label: "Owed to me" },
];

const KINDS: readonly { value: ScheduleKind; label: string; hint: string }[] = [
  { value: "free-form", label: "No fixed terms", hint: "Utang with no agreed schedule" },
  { value: "flat", label: "Fixed installments", hint: "A stated total, paid in equal parts" },
  { value: "amortized", label: "With interest", hint: "A rate and a term, like a bank loan" },
];

export function LoanForm({ onSubmit, busy = false }: LoanFormProps) {
  const [direction, setDirection] = useState<LoanDirection>("i-owe");
  const [kind, setKind] = useState<ScheduleKind>("free-form");
  const [counterparty, setCounterparty] = useState("");
  const [principalDigits, setPrincipalDigits] = useState("");
  const [rateText, setRateText] = useState("");
  const [termText, setTermText] = useState("");
  const [installmentDigits, setInstallmentDigits] = useState("");
  const [countText, setCountText] = useState("");
  const [intervalText, setIntervalText] = useState("7");
  const [firstDue, setFirstDue] = useState("");
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([
    ...DEFAULT_LOAN_REMINDER_OFFSETS,
  ]);

  const principal = centavosFromDigits(principalDigits);
  const rate = Number(rateText) || 0;
  const term = Math.trunc(Number(termText)) || 0;
  const installment = centavosFromDigits(installmentDigits);
  const count = Math.trunc(Number(countText)) || 0;
  const interval = Math.trunc(Number(intervalText)) || 0;

  // Rule 3's LIVE preview. It is the only place the user sees what the rate and
  // term actually cost per month before committing to them.
  const preview =
    kind === "amortized" && principal > 0 && term > 0
      ? monthlyPayment(principal, rate, term)
      : null;

  const canSave =
    counterparty.trim() !== "" &&
    principal > 0 &&
    !busy &&
    (kind === "free-form" ||
      (kind === "amortized" && term > 0 && firstDue.trim() !== "") ||
      (kind === "flat" && installment > 0 && count > 0 && interval > 0 && firstDue.trim() !== ""));

  const chooseDirection = (next: LoanDirection) => {
    setDirection(next);
    // Rule 3's default, applied on the switch rather than only at first render
    // — a user who picks "Owed to me" after setting up an amortized loan is
    // telling us this is personal lending.
    if (next === "owed-to-me") setKind("free-form");
  };

  const toggleReminderOffset = (offset: number) => {
    setReminderOffsets((current) =>
      current.includes(offset)
        ? current.filter((value) => value !== offset)
        : [...current, offset].sort((a, b) => a - b),
    );
  };

  return (
    <View className="gap-6">
      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">Which way?</Text>
        <View className="mt-2 flex-row gap-2">
          {DIRECTIONS.map((option) => (
            <Pressable
              key={option.value}
              testID={`loan-direction-${option.value}`}
              onPress={() => chooseDirection(option.value)}
              className={`rounded-full px-4 py-2 ${
                direction === option.value
                  ? "bg-brand dark:bg-brand-dark"
                  : "bg-surface dark:bg-surface-dark"
              }`}
            >
              <Text
                className={
                  direction === option.value
                    ? "text-surface dark:text-surface-dark"
                    : "text-fg dark:text-fg-dark"
                }
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">
          {direction === "i-owe" ? "Who do you owe?" : "Who owes you?"}
        </Text>
        <TextInput
          testID="loan-counterparty"
          className="mt-2 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
          placeholder="Name or lender"
          value={counterparty}
          onChangeText={setCounterparty}
        />
      </View>

      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">How much?</Text>
        <TextInput
          testID="loan-principal"
          className="mt-2 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
          keyboardType="numeric"
          placeholder="Amount, e.g. 5000"
          value={principalDigits}
          onChangeText={setPrincipalDigits}
        />
        <Text testID="loan-principal-preview" className="mt-2 text-fg-2 dark:text-fg-2-dark">
          {formatCentavos(principal)}
        </Text>
      </View>

      <View>
        <Text className="font-semibold text-fg dark:text-fg-dark">How is it paid back?</Text>
        <View className="mt-2 gap-2">
          {KINDS.map((option) => (
            <Pressable
              key={option.value}
              testID={`loan-kind-${option.value}`}
              accessibilityState={{ selected: kind === option.value }}
              onPress={() => setKind(option.value)}
              className={`rounded-2xl p-4 ${
                kind === option.value
                  ? "bg-brand-soft dark:bg-brand-soft-dark"
                  : "bg-surface dark:bg-surface-dark"
              }`}
            >
              <Text className="font-semibold text-fg dark:text-fg-dark">{option.label}</Text>
              <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">{option.hint}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {kind === "amortized" ? (
        <View testID="loan-amortized-fields">
          <Text className="font-semibold text-fg dark:text-fg-dark">Rate and term</Text>
          <TextInput
            testID="loan-rate"
            className="mt-2 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
            keyboardType="numeric"
            placeholder="Annual rate %, e.g. 12"
            value={rateText}
            onChangeText={setRateText}
          />
          <TextInput
            testID="loan-term"
            className="mt-2 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
            keyboardType="numeric"
            placeholder="Months, e.g. 12"
            value={termText}
            onChangeText={setTermText}
          />
          {preview === null ? null : (
            <Text testID="loan-payment-preview" className="mt-2 text-fg dark:text-fg-dark">
              {`About ${formatCentavos(preview)} a month.`}
            </Text>
          )}
        </View>
      ) : null}

      {kind === "flat" ? (
        <View testID="loan-flat-fields">
          <Text className="font-semibold text-fg dark:text-fg-dark">Installments</Text>
          <TextInput
            testID="loan-installment"
            className="mt-2 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
            keyboardType="numeric"
            placeholder="Each payment, e.g. 1000"
            value={installmentDigits}
            onChangeText={setInstallmentDigits}
          />
          <TextInput
            testID="loan-count"
            className="mt-2 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
            keyboardType="numeric"
            placeholder="How many payments"
            value={countText}
            onChangeText={setCountText}
          />
          <TextInput
            testID="loan-interval"
            className="mt-2 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
            keyboardType="numeric"
            placeholder="Days between payments"
            value={intervalText}
            onChangeText={setIntervalText}
          />
          {installment > 0 && count > 0 ? (
            <Text testID="loan-flat-total" className="mt-2 text-fg dark:text-fg-dark">
              {`${formatCentavos(installment * count)} in total.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {kind === "free-form" ? null : (
        <View>
          <Text className="font-semibold text-fg dark:text-fg-dark">First payment due</Text>
          <TextInput
            testID="loan-first-due"
            className="mt-2 rounded-xl bg-surface p-3 text-fg dark:bg-surface-dark dark:text-fg-dark"
            placeholder="YYYY-MM-DD"
            value={firstDue}
            onChangeText={setFirstDue}
          />
        </View>
      )}

      <View className="gap-2">
        <Text className="text-sm font-medium text-fg-2 dark:text-fg-2-dark">Remind me</Text>
        <View className="flex-row flex-wrap gap-2">
          {REMINDER_OFFSETS.map((offset) => (
            <Pressable
              key={offset.value}
              testID={`loan-offset-${offset.value}`}
              accessibilityRole="button"
              accessibilityState={{ selected: reminderOffsets.includes(offset.value) }}
              onPress={() => toggleReminderOffset(offset.value)}
              className={`rounded-lg px-3 py-2 ${
                reminderOffsets.includes(offset.value)
                  ? "bg-brand-soft dark:bg-brand-soft-dark"
                  : "bg-surface dark:bg-surface-dark"
              }`}
            >
              <Text className="text-sm text-fg dark:text-fg-dark">{offset.label}</Text>
            </Pressable>
          ))}
        </View>
        {reminderOffsets.length === 0 ? (
          // Rule 15: many 5-6 borrowers do not want a due-date reminder for a
          // collector who simply shows up — so no reminders is a real choice,
          // not a mistake to block, and the due state still shows in-app.
          <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
            No notifications. The loan still shows its due date in the app.
          </Text>
        ) : null}
      </View>

      <Button
        title="Save loan"
        testID="loan-save"
        disabled={!canSave}
        loading={busy}
        onPress={() => {
          if (!canSave) return;

          // The schedule is MATERIALIZED here, which is what `Loan.schedule`
          // stores (`Installment[] | null`) — the builders in loan_math are the
          // single place either shape is computed.
          const schedule: Installment[] | null =
            kind === "amortized"
              ? buildAmortizationSchedule(principal, rate, term, firstDue.trim()).map((row) => ({
                  dueDate: row.dueDate,
                  amountDue: row.payment,
                  principalPortion: row.principal,
                  interestPortion: row.interest,
                }))
              : kind === "flat"
                ? buildFlatSchedule(installment, count, firstDue.trim(), interval).map((row) => ({
                    dueDate: row.dueDate,
                    amountDue: row.payment,
                  }))
                : null;

          onSubmit({
            direction,
            counterparty: counterparty.trim(),
            // A flat loan's principal for balance purposes is the TOTAL
            // repayable, not the cash borrowed — spec rule 2: "Flat: total
            // repayable minus the sum of paymentHistory[]". Borrow ₱5,000 and
            // repay ₱6,000 and the app tracks ₱6,000 down to zero.
            principal: kind === "flat" ? installment * count : principal,
            // No rate is stored for flat or free-form, so nothing downstream can
            // display one for 5-6 (spec rule 4).
            interestRate: kind === "amortized" ? rate : null,
            schedule,
            nextDueDate: schedule?.[0]?.dueDate ?? null,
            nextDueAmount: schedule?.[0]?.amountDue ?? null,
            reminderOffsets,
          });
        }}
      />
    </View>
  );
}
