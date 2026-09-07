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
//
// RESTYLED (mobile-ui-revamp Part 3 Task 4b): "Which way?" (2 options) and
// "How is it paid back?" (3 options) are now `SegmentedControl` — both are
// two-to-four-way exclusive choices, per the brief's field-rhythm rule.
// `loan-direction-i-owe`/`loan-direction-owed-to-me` and
// `loan-kind-free-form`/`loan-kind-flat`/`loan-kind-amortized` are the exact
// ids the hand-rolled pills already used, unchanged: `LoanDirection` and
// `ScheduleKind`'s own literal values ARE the testID suffixes, so
// `SegmentedControl`'s `${testID}-${value}` generation reproduces them without
// a rename. THE REMINDER OFFSETS STAY HAND-ROLLED PRESSABLES, deliberately not
// `Chip`: `loan_form.test.tsx` asserts `.props.accessibilityState.selected` on
// `loan-offset-*` directly, and `Chip` sets no `accessibilityState` at all —
// swapping it in would not fail loudly, it would throw
// ("Cannot read properties of undefined") the moment that assertion ran.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date_field";
import { FormScreen } from "@/components/ui/form_screen";
import { NumericField } from "@/components/ui/numeric_field";
import { SegmentedControl } from "@/components/ui/segmented_control";
import { DEFAULT_LOAN_REMINDER_OFFSETS } from "@/constants/loans";
import { toDateIso } from "@/lib/dates";
import { buildAmortizationSchedule, buildFlatSchedule, monthlyPayment } from "@/lib/loans/loan_math";
import { centavosFrom, pesoInputFrom } from "@/lib/money/peso_input";
import type { Installment, Loan, LoanDirection } from "@/types/domain";
import { usePlaceholderColor } from "@/lib/ui/placeholder";

/** Step 2's field rhythm: the label that sits above every control below. */
function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">{children}</Text>
  );
}

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

const DIRECTION_SEGMENTS = [
  { value: "i-owe", label: "I owe" },
  { value: "owed-to-me", label: "Owed to me" },
] as const satisfies ReadonlyArray<{ value: LoanDirection; label: string }>;

const KINDS: readonly { value: ScheduleKind; label: string; hint: string }[] = [
  { value: "free-form", label: "No fixed terms", hint: "Utang with no agreed schedule" },
  { value: "flat", label: "Fixed installments", hint: "A stated total, paid in equal parts" },
  { value: "amortized", label: "With interest", hint: "A rate and a term, like a bank loan" },
];

// NOT `as const` — that assertion only applies to a literal expression, and
// `.map()`'s result is not one (TS1355). Unneeded regardless: `KINDS`'s own
// element type already carries the closed `ScheduleKind` union, not `string`,
// so the destructured `value` — and everything derived from it — stays that
// narrow union through plain inference, which is what `SegmentedControl`'s
// `T` needs.
const KIND_SEGMENTS = KINDS.map(({ value, label }) => ({ value, label }));

/** Centavos -> peso text, or "" when there is nothing to seed. NEVER String(). */
function seedPeso(amount: number | undefined): string {
  return amount === undefined ? "" : pesoInputFrom(amount);
}

/**
 * The rate's unit, spelled out under the field (spec rule 3). Named rather
 * than inlined so loan_form.test.tsx can assert the exact string a user reads
 * rather than a paraphrase of it.
 */
const RATE_UNIT_HINT = "The rate is per year. A lender quoting 2% a month means 24% here.";

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
  const placeholderColor = usePlaceholderColor();
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

  // HOW MANY PAYMENTS THE SCHEDULE HAS ALREADY MISSED.
  //
  // A loan reaches this form MID-LIFE. A bank loan taken out in March and
  // entered in September has its real first due date in the past, and so does
  // every loan opened on the edit screen once a payment or two has come round
  // — so a past first due is ordinary data here, not a mistake to refuse. It
  // is still worth saying out loud, because the same date entered by accident
  // produces a schedule that is overdue the moment it is saved. The count is
  // the honest version of the floor this field used to carry.
  //
  // COUNTED BY BUILDING THE SCHEDULE rather than by stepping the calendar
  // here: `loan_math.ts` owns the month-end clamp and the interval arithmetic,
  // and a second copy of that stepping is how this hint would end up naming a
  // different number from the rows the save below actually stores.
  const todayIso = toDateIso(new Date());
  const firstDueIso = firstDue.trim();
  // Every input the relevant builder needs, so a half-filled form never counts
  // against a degenerate schedule (a flat loan with no interval yet would stack
  // every installment on one day and report them all due).
  const scheduleReady =
    kind === "amortized" ? term > 0 : kind === "flat" ? count > 0 && interval > 0 : false;
  const alreadyDue =
    !scheduleReady || firstDueIso === "" || firstDueIso > todayIso
      ? 0
      : (kind === "amortized"
          ? buildAmortizationSchedule(principal, rate, term, firstDueIso)
          : buildFlatSchedule(installment, count, firstDueIso, interval)
        ).filter((row) => row.dueDate <= todayIso).length;

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
        <View className="gap-2">
          <FieldLabel>Which way?</FieldLabel>
          <SegmentedControl
            testID="loan-direction"
            segments={DIRECTION_SEGMENTS}
            value={direction}
            onChange={chooseDirection}
          />
        </View>

        <View className="gap-1">
          <FieldLabel>{direction === "i-owe" ? "Who do you owe?" : "Who owes you?"}</FieldLabel>
          <TextInput
            placeholderTextColor={placeholderColor}
            testID="loan-counterparty"
            className="min-h-[44px] rounded-xl bg-chip px-3 py-3 text-fg dark:bg-chip-dark dark:text-fg-dark"
            placeholder="Name or lender"
            value={counterparty}
            onChangeText={setCounterparty}
          />
        </View>

        <View className="gap-1">
          <FieldLabel>How much?</FieldLabel>
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

        <View className="gap-2">
          <FieldLabel>How is it paid back?</FieldLabel>
          <SegmentedControl testID="loan-kind" segments={KIND_SEGMENTS} value={kind} onChange={setKind} />
          {/* The selected kind's own hint, since the pill itself has no room
              for one — same relocation `cadence_picker.tsx`'s cadence row
              takes for its own per-option explanation. */}
          <Text className="text-fg-2 dark:text-fg-2-dark">
            {KINDS.find((option) => option.value === kind)?.hint}
          </Text>
        </View>

        {kind === "amortized" ? (
          <View testID="loan-amortized-fields" className="gap-1">
            <FieldLabel>Annual rate and term</FieldLabel>
            <NumericField
              testID="loan-rate"
              label="Annual rate"
              mode="rate"
              placeholder="Annual rate %, e.g. 12"
              value={rateText}
              onChangeText={setRateText}
            />
            {/* THE UNIT IS STATED WHERE IT CANNOT DISAPPEAR (spec rule 3: the
                rate "is entered with an explicit per-month or per-annum
                unit"). "Annual rate" already rides on this field's
                accessibilityLabel, on the keypad panel's header, and on the
                placeholder — but NumericField swaps the placeholder for the
                value the moment a digit is typed, so the only thing left for
                a sighted user to read is "12%", carrying no unit at all. The
                arithmetic is per annum (loan_math.ts divides by 12) while PH
                lenders quote per month, so what this line prevents is a
                schedule twelve times too heavy. */}
            <Text testID="loan-rate-unit" className="text-fg-2 dark:text-fg-2-dark">
              {RATE_UNIT_HINT}
            </Text>
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
          <View testID="loan-flat-fields" className="gap-1">
            <FieldLabel>Installments</FieldLabel>
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
          <View className="gap-1">
            <FieldLabel>First payment due</FieldLabel>
            {/* NO `minimumDate` HERE, deliberately. "A first payment is
                always in the future" only ever described a loan created on
                the day it was taken out; it is false for an existing loan
                being recorded, and false for almost every loan reopened on
                the edit screen. A floor at today does not merely refuse those
                dates — the OS dialog opens CLAMPED to the floor, so a user
                who taps this field on an in-progress loan and confirms what
                the picker shows re-dates every installment the save below
                rebuilds, having asked for nothing. The already-due count is
                the guard against a mistyped past date instead. */}
            <DateField
              testID="loan-first-due"
              label="First payment due"
              placeholder="Pick a date"
              value={firstDue}
              onChange={setFirstDue}
            />
            {alreadyDue > 0 ? (
              <Text testID="loan-already-due" className="mt-2 text-fg-2 dark:text-fg-2-dark">
                {`${alreadyDue} payment${alreadyDue === 1 ? " is" : "s are"} already due.`}
              </Text>
            ) : null}
          </View>
        )}

        <View className="gap-2">
          <FieldLabel>Remind me</FieldLabel>
          {/* HAND-ROLLED, DELIBERATELY NOT `Chip` — see this file's header.
              `loan_form.test.tsx` reads `accessibilityState.selected` off
              these testIDs directly, which `Chip` never sets. The classes
              below still take the design's option-group rhythm
              (`bg-chip` resting state, `min-h-[44px]`), just without the
              component `Chip`'s own accessibility surface swapped under it. */}
          <View className="flex-row flex-wrap gap-2">
            {REMINDER_OFFSETS.map((offset) => (
              <Pressable
                key={offset.value}
                testID={`loan-offset-${offset.value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: reminderOffsets.includes(offset.value) }}
                onPress={() => toggleReminderOffset(offset.value)}
                className={`min-h-[44px] justify-center rounded-lg px-3 py-2 ${
                  reminderOffsets.includes(offset.value)
                    ? "bg-brand dark:bg-brand-dark"
                    : "bg-chip dark:bg-chip-dark"
                }`}
              >
                <Text
                  className={`text-sm ${
                    reminderOffsets.includes(offset.value)
                      ? "font-semibold text-on-brand dark:text-on-brand-dark"
                      : "text-fg dark:text-fg-dark"
                  }`}
                >
                  {offset.label}
                </Text>
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
          size="lg"
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
