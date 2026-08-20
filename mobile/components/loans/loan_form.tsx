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
//
// ON THE KEYPAD AND A DATE PICKER (numeric-input-system Task 10). This is the
// only form with all three keypad modes at once: peso (principal,
// installment), rate (annual rate, parsed exactly as it always was — this is
// an input-layer change only, never a basis-points conversion) and integer
// (term, count, interval — their decimal key is inert). STATE STAYS INTERNAL:
// unlike manual entry (Task 9), this screen never auto-opens the panel on
// mount, so there is no reason to lift any of it to the route — this is a
// component swap, not a state rewrite. FormScreen is mounted HERE rather than
// at the two routes that render this form, because only this file was in
// scope for the migration; its content container already sets `flexGrow: 1`,
// which is why the root View below carries `flex-1`.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date_field";
import { FormScreen } from "@/components/ui/form_screen";
import { NumericField } from "@/components/ui/numeric_field";
import { DEFAULT_LOAN_REMINDER_OFFSETS } from "@/constants/loans";
import { buildAmortizationSchedule, buildFlatSchedule, monthlyPayment } from "@/lib/loans/loan_math";
import { centavosFrom, pesoInputFrom } from "@/lib/money/peso_input";
import type { Installment, Loan, LoanDirection } from "@/types/domain";

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

/**
 * What seeds an EDIT (owner's device report: a loan "should also be
 * modifable").
 *
 * ITS OWN SHAPE, NOT `Partial<LoanFormValues>`. Those are the form's OUTPUT —
 * `schedule` there is a built `Installment[]`, while the form's inputs are the
 * term/installment/count/interval the schedule was BUILT FROM. Seeding from the
 * output would make the form reverse-engineer its own inputs on every render.
 * `loanFormInitialFrom` does that reconstruction once, where it can be tested.
 */
export type LoanFormInitial = {
  direction?: LoanDirection;
  kind?: ScheduleKind;
  counterparty?: string;
  /** Centavos. Converted to peso text with `pesoInputFrom`, never `String`. */
  principal?: number;
  interestRate?: number | null;
  termMonths?: number;
  /** Centavos, as above. */
  installmentAmount?: number;
  installmentCount?: number;
  intervalDays?: number;
  firstDue?: string;
  reminderOffsets?: number[];
};

/**
 * Rebuilds a loan's form inputs from the loan itself.
 *
 * THE SCHEDULE IS STORED AS INSTALLMENTS, not as the parameters that generated
 * it, so this is genuinely a reconstruction rather than a lookup:
 *
 *   kind      no schedule -> free-form; a rate -> amortized; otherwise flat
 *   count     how many installments there are
 *   interval  the gap between the first two due dates
 *   firstDue  the first installment's due date
 *
 * WHY IT MATTERS THAT THIS IS RIGHT. An edit screen that seeded these wrong
 * would rebuild a DIFFERENT schedule on save, silently rewriting a repayment
 * plan the user only opened to fix a typo in the lender's name.
 */
export function loanFormInitialFrom(loan: Loan): LoanFormInitial {
  const schedule = loan.schedule ?? [];
  const kind: ScheduleKind =
    schedule.length === 0 ? "free-form" : loan.interestRate !== null ? "amortized" : "flat";

  const firstDue = schedule[0]?.dueDate ?? loan.nextDueDate ?? "";
  // Whole days between the first two due dates. Two installments are the
  // minimum that can express an interval; with fewer, the form's own default
  // stands rather than a number invented from one date.
  const intervalDays =
    schedule.length >= 2
      ? Math.round(
          (Date.parse(`${schedule[1].dueDate}T00:00:00`) -
            Date.parse(`${schedule[0].dueDate}T00:00:00`)) /
            86_400_000,
        )
      : undefined;

  return {
    direction: loan.direction,
    kind,
    counterparty: loan.counterparty,
    principal: loan.principal,
    interestRate: loan.interestRate,
    termMonths: kind === "amortized" ? schedule.length : undefined,
    installmentAmount: kind === "flat" ? schedule[0]?.amountDue : undefined,
    installmentCount: kind === "flat" ? schedule.length : undefined,
    intervalDays,
    firstDue,
    reminderOffsets: loan.reminderOffsets,
  };
}

export type LoanFormProps = {
  onSubmit: (values: LoanFormValues) => void;
  busy?: boolean;
  initial?: LoanFormInitial;
  /** "Save loan" on create, "Save changes" on edit. */
  submitLabel?: string;
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

/** Centavos -> peso text, or "" when there is nothing to seed. NEVER String(). */
function seedPeso(amount: number | undefined): string {
  return amount === undefined ? "" : pesoInputFrom(amount);
}

/** A count/term/rate -> its text, or "" — these are plain numbers, not money. */
function seedNumber(value: number | null | undefined): string {
  return value === undefined || value === null ? "" : String(value);
}

export function LoanForm({
  onSubmit,
  busy = false,
  initial,
  submitLabel = "Save loan",
}: LoanFormProps) {
  const [direction, setDirection] = useState<LoanDirection>(initial?.direction ?? "i-owe");
  const [kind, setKind] = useState<ScheduleKind>(initial?.kind ?? "free-form");
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? "");
  // pesoInputFrom, not String: these hold PESO TEXT and the seed is Centavos.
  const [principalText, setPrincipalText] = useState(seedPeso(initial?.principal));
  const [rateText, setRateText] = useState(seedNumber(initial?.interestRate));
  const [termText, setTermText] = useState(seedNumber(initial?.termMonths));
  const [installmentText, setInstallmentText] = useState(seedPeso(initial?.installmentAmount));
  const [countText, setCountText] = useState(seedNumber(initial?.installmentCount));
  const [intervalText, setIntervalText] = useState(
    initial?.intervalDays !== undefined ? String(initial.intervalDays) : "7",
  );
  const [firstDue, setFirstDue] = useState(initial?.firstDue ?? "");
  const [reminderOffsets, setReminderOffsets] = useState<number[]>(
    initial?.reminderOffsets ? [...initial.reminderOffsets] : [...DEFAULT_LOAN_REMINDER_OFFSETS],
  );

  const principal = centavosFrom(principalText);
  const rate = Number(rateText) || 0;
  const term = Math.trunc(Number(termText)) || 0;
  const installment = centavosFrom(installmentText);
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
    <FormScreen>
      {/* flex-1 gap-6 was already here; bg-bg/px-4/pt-4 move in from the route
          (numeric-input-system Task 10 fix round) now that FormScreen is the
          only scroll view — see app/(tabs)/plan/loans/new.tsx's header. pt-4
          is a BARE utility, not insets.top: this screen lives inside
          (tabs)/_layout.tsx's <Tabs>, which already pads every tab screen's
          top edge for the status bar in one place. pt-4 only restores the
          16px breathing room the removed wrapper's p-4 gave on top of that
          inset — the same convention as bills/goals/limits' own `new` routes.
          No bottom padding here: FormScreen's contentContainerStyle owns that
          edge (Math.max(keypadHeight, 0) + BASE_PADDING), so a symmetric p-4
          would double-count it, same defect Task 9's fix round removed. */}
      <View className="flex-1 gap-6 bg-bg px-4 pt-4 dark:bg-bg-dark">
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
          <NumericField
            testID="loan-principal"
            label="How much?"
            mode="peso"
            placeholder="Amount, e.g. 5000"
            value={principalText}
            onChangeText={setPrincipalText}
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
            <NumericField
              testID="loan-rate"
              label="Annual rate"
              mode="rate"
              placeholder="Annual rate %, e.g. 12"
              value={rateText}
              onChangeText={setRateText}
            />
            <NumericField
              testID="loan-term"
              label="Months"
              mode="integer"
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
            <NumericField
              testID="loan-installment"
              label="Each payment"
              mode="peso"
              placeholder="Each payment, e.g. 1000"
              value={installmentText}
              onChangeText={setInstallmentText}
            />
            <NumericField
              testID="loan-count"
              label="How many payments"
              mode="integer"
              placeholder="How many payments"
              value={countText}
              onChangeText={setCountText}
            />
            <NumericField
              testID="loan-interval"
              label="Days between payments"
              mode="integer"
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
            <DateField
              testID="loan-first-due"
              label="First payment due"
              placeholder="Pick a date"
              value={firstDue}
              onChange={setFirstDue}
              // A first payment is always in the future — LoanForm has no
              // injected clock (no `now` prop), so `new Date()` is the read.
              minimumDate={new Date()}
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
          title={submitLabel}
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
    </FormScreen>
  );
}
