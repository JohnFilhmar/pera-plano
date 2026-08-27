// components/loans/balance_adjustment_sheet.tsx — loans rule 13, which had a
// repository, a test suite and no way in from any screen.
//
// WHAT AN ADJUSTMENT IS FOR, in the spec's own words: "reality the app cannot
// see: accrued interest or fees on free-form loans, lender-side corrections,
// penalties, or payments made entirely outside tracked money." Rule 12 adds the
// one the user meets first — "The app never applies penalties or late fees on
// its own; if the lender charges one, the user records it as a balance
// adjustment" — and the flow section adds the other: a relative who paid the
// collector directly.
//
// NO TRANSACTION IS CREATED, and that is the whole difference from
// record_payment_sheet.tsx. None of those four things moved money through a
// wallet the app tracks, so writing a ledger row for them would put a wallet's
// balance out by exactly the amount and leave the user with a second, invented
// error to find. The balance moves; the ledger does not.
//
// THE USER NEVER TYPES A MINUS SIGN. `recordAdjustment` takes a SIGNED amount,
// and the app's numeric keypad has no minus key at all (components/ui/
// numeric_keypad.tsx) — so the sign is asked as a question in words and applied
// here. That is the safer shape anyway: "-500" and "500" are one keystroke
// apart and move a balance ₱1,000 in opposite directions, while "Adds to" and
// "Reduces" cannot be confused for each other by a slipped thumb.
//
// THE NOTE IS REQUIRED AND IS REFUSED HERE, IN WORDS. `recordAdjustment` throws
// `AdjustmentNoteRequiredError` on a blank one and that guard stays where it is
// — every caller should meet it — but an error class is not a message, and an
// unhandled rejection surfacing as a red screen over a half-filled form is not
// a validation experience. The check below runs first so the throw is
// unreachable from this sheet, which is the point: the repository keeps the
// invariant, the sheet keeps the user informed.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { formatCentavos } from "@/components/ui/amount_text";
import { BottomSheet } from "@/components/ui/bottom_sheet";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date_field";
import { NumericField } from "@/components/ui/numeric_field";
import { SegmentedControl } from "@/components/ui/segmented_control";
import { useRecordAdjustment } from "@/hooks/mutations/use_record_adjustment";
import { toDateIso } from "@/lib/dates";
import { centavosFrom } from "@/lib/money/peso_input";
import { occurredAtFor } from "@/lib/transactions/manual_entry";
import type { EpochMs, Loan } from "@/types/domain";

/**
 * Which way the balance moves. Named for the EFFECT rather than for the sign,
 * because "positive" and "negative" are the storage's vocabulary and the user's
 * question is whether they now owe more or less.
 */
type AdjustmentEffect = "adds" | "reduces";

/**
 * NO `wallets` PROP, unlike `RecordPaymentSheet`'s — and the absence is the
 * point rather than an oversight. An adjustment has no paying wallet by
 * definition (rule 13 is the case where the money never touched one), so there
 * is nothing to pick and nothing to default; a sheet that accepted a wallet
 * list and ignored it would invite the next reader to wire it up.
 */
export type BalanceAdjustmentSheetProps = {
  loan: Loan;
  visible: boolean;
  onDismiss: () => void;
  /** Fires once the adjustment row is written. */
  onDone?: () => void;
  /** Injected, never `Date.now()` — see `RecordPaymentSheet`'s own `now`. */
  now: EpochMs;
  testID?: string;
};

export function BalanceAdjustmentSheet({
  loan,
  visible,
  onDismiss,
  onDone,
  now,
  testID = "balance-adjustment-sheet",
}: BalanceAdjustmentSheetProps) {
  const iOwe = loan.direction === "i-owe";

  const [effect, setEffect] = useState<AdjustmentEffect>("adds");
  const [amountText, setAmountText] = useState("");
  const [day, setDay] = useState(toDateIso(new Date(now)));
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const adjust = useRecordAdjustment();

  const magnitude = centavosFrom(amountText);
  const occurredAt = occurredAtFor(day, now);
  const amountMissing = magnitude <= 0;
  // `.trim()`, matching `recordAdjustment`'s own test exactly: a note of three
  // spaces is a blank note, and a sheet that accepted it would hand the
  // repository something it is about to throw on.
  const noteMissing = note.trim() === "";
  const dateInvalid = occurredAt === null;

  // THE SIGN, APPLIED IN ONE PLACE. Positive increases what is owed, negative
  // reduces it (`LoanAdjustment.amount`), and `outstandingBalance` adds this
  // straight onto principal-minus-payments — so a flipped sign here is a
  // balance wrong by twice the figure, in the direction the user least expects.
  const signed = effect === "adds" ? magnitude : -magnitude;

  // "What I owe" and "what they owe me" are different sentences about the same
  // arithmetic, and rule 1's whole point is that the two directions are not one
  // net position. A single wording would leave half of all loans described
  // backwards on the one control whose sign the user has to get right.
  const effectSegments = [
    { value: "adds" as const, label: iOwe ? "Adds to what I owe" : "Adds to what they owe" },
    {
      value: "reduces" as const,
      label: iOwe ? "Reduces what I owe" : "Reduces what they owe",
    },
  ];

  function reset(): void {
    setEffect("adds");
    setAmountText("");
    setDay(toDateIso(new Date(now)));
    setNote("");
    setShowErrors(false);
  }

  function confirm(): void {
    // Restated rather than read off the booleans above so `occurredAt` narrows
    // out of `null` — the same reasoning `record_payment_sheet.tsx`'s guard
    // carries, and the same refusal to reach for a non-null assertion.
    if (magnitude <= 0 || note.trim() === "" || occurredAt === null) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    adjust.mutate(
      { loanId: loan.id, amount: signed, occurredAt, note: note.trim() },
      {
        onSuccess: () => {
          reset();
          onDone?.();
          onDismiss();
        },
      },
    );
  }

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Balance adjustment">
      <View testID={testID} className="gap-3">
        <Text testID="loan-adjustment-explainer" className="text-body text-fg dark:text-fg-dark">
          For money the app never saw — a fee or interest the lender added, a
          penalty, a correction, or a payment made entirely outside your wallets.
          Nothing is added to your ledger; only this loan&apos;s balance moves.
        </Text>

        <View className="gap-2">
          <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">
            Which way?
          </Text>
          <SegmentedControl
            testID="loan-adjustment-effect"
            segments={effectSegments}
            value={effect}
            onChange={setEffect}
          />
        </View>

        <View className="gap-1">
          <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">How much?</Text>
          <NumericField
            testID="loan-adjustment-amount"
            label="How much?"
            mode="peso"
            placeholder="Type the amount"
            value={amountText}
            onChangeText={setAmountText}
          />
          {/* The preview carries the SIGN the write will carry — a plain
              magnitude here would show the same thing for both segments and
              hide the only choice on this sheet that can be made backwards.
              U+2212 MINUS SIGN, components/ui/amount_text.tsx's own
              convention. */}
          <Text
            testID="loan-adjustment-preview"
            style={{ fontVariant: ["tabular-nums"] }}
            className="text-title font-bold text-fg dark:text-fg-dark"
          >
            {`${effect === "adds" ? "+" : "−"}${formatCentavos(magnitude)}`}
          </Text>
          {showErrors && amountMissing ? (
            <Text
              testID="loan-adjustment-amount-error"
              className="text-sm text-danger dark:text-danger-dark"
            >
              Enter how much the balance changes by.
            </Text>
          ) : null}
        </View>

        <View className="gap-1">
          <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">When?</Text>
          <DateField
            testID="loan-adjustment-date"
            label="When did this happen?"
            placeholder="Pick a date"
            value={day}
            onChange={setDay}
            maximumDate={new Date(now)}
          />
          {showErrors && dateInvalid ? (
            <Text
              testID="loan-adjustment-date-error"
              className="text-sm text-danger dark:text-danger-dark"
            >
              Pick today or a day already past.
            </Text>
          ) : null}
        </View>

        <View className="gap-1">
          <Text className="text-micro font-semibold text-fg-2 dark:text-fg-2-dark">
            What is it for?
          </Text>
          <TextInput
            testID="loan-adjustment-note"
            className="min-h-[44px] rounded-xl bg-chip px-3 py-3 text-fg dark:bg-chip-dark dark:text-fg-dark"
            placeholder="Late fee, interest, Ate paid the collector..."
            value={note}
            onChangeText={setNote}
            accessibilityLabel="What is this adjustment for?"
          />
          {showErrors && noteMissing ? (
            // Rule 13's required note, said as a reason rather than as a
            // refusal. An adjustment has no ledger entry behind it, so months
            // later this line is the ONLY thing that can explain why a balance
            // moved — a user who is told that writes one, a user who is told
            // "note is required" writes ".".
            <Text
              testID="loan-adjustment-note-error"
              className="text-sm text-danger dark:text-danger-dark"
            >
              Say what this is for. There is no transaction behind an adjustment,
              so this note is the only record of why the balance changed.
            </Text>
          ) : null}
        </View>

        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button
              testID="loan-adjustment-cancel"
              title="Cancel"
              variant="secondary"
              onPress={() => {
                reset();
                onDismiss();
              }}
            />
          </View>
          <View className="flex-1">
            <Button
              testID="loan-adjustment-confirm"
              title="Save adjustment"
              onPress={confirm}
              loading={adjust.isPending}
            />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
