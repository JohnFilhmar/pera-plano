// components/bills/bill_form.tsx — m2c Task 5.
//
// The spec's create flow, in its order: name, amount and its TYPE, due rule,
// reminders, category. Two things it deliberately does not have:
//
//   NO TIER GATE (rule 6). "Bills have no dedicated cap row: bill creation,
//   reminders, and auto-match are unlimited in both tiers — bills are core
//   control, and a capped bill list would make Free-tier Safe-to-Spend
//   dishonest." An untracked bill is a missed payment.
//
//   NO WALLET FIELD. A bill is not paid from one place; the mark-paid flow
//   picks a wallet per payment, at payment time.
//
// FIXED VS ESTIMATED IS THE FIRST REAL DECISION, so it is asked as one — with
// the consequence spelled out rather than a bare toggle. A user who picks Fixed
// for Meralco will fight the app every month; one who picks Estimated for rent
// will see a `~` on a figure that never moves.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { DueRulePicker } from "@/components/bills/due_rule_picker";
import { centavosFromDigits, formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { DEFAULT_REMINDER_OFFSETS } from "@/lib/db/repos/bills_repo";
import type { BillAmountMode, DueRule } from "@/types/domain";

export type BillFormValues = {
  name: string;
  amount: number;
  amountMode: BillAmountMode;
  dueRule: DueRule;
  reminderOffsets: number[];
};

export type BillFormProps = {
  today: string;
  onSubmit: (values: BillFormValues) => void;
  busy?: boolean;
  testID?: string;
};

const MODES: readonly { value: BillAmountMode; label: string; hint: string }[] = [
  {
    value: "fixed",
    label: "Always the same",
    hint: "Rent, tuition, a subscription — one exact amount.",
  },
  {
    value: "estimated",
    label: "Varies each time",
    hint: "Meralco, Maynilad — the app learns the amount from what you pay.",
  },
];

/**
 * Spec rule 10's supported offsets: 7, 5, 3, 1 days before, and on the due
 * date. Negative-is-before, matching types/domain.ts.
 */
const OFFSETS: readonly { value: number; label: string }[] = [
  { value: -7, label: "7 days before" },
  { value: -5, label: "5 days before" },
  { value: -3, label: "3 days before" },
  { value: -1, label: "1 day before" },
  { value: 0, label: "On the due date" },
];

export function BillForm({ today, onSubmit, busy = false, testID }: BillFormProps) {
  const [name, setName] = useState("");
  const [digits, setDigits] = useState("");
  const [amountMode, setAmountMode] = useState<BillAmountMode>("estimated");
  const [dueRule, setDueRule] = useState<DueRule>({
    kind: "day-of-month",
    day: new Date(`${today}T00:00:00`).getDate(),
  });
  const [offsets, setOffsets] = useState<number[]>([...DEFAULT_REMINDER_OFFSETS]);

  const amount = centavosFromDigits(digits);
  const canSave = name.trim().length > 0 && amount > 0;

  const toggleOffset = (offset: number) => {
    setOffsets((current) =>
      current.includes(offset)
        ? current.filter((value) => value !== offset)
        : [...current, offset].sort((a, b) => a - b),
    );
  };

  return (
    <View testID={testID} className="gap-5">
      <View className="gap-1">
        <Text className="text-sm font-medium text-fg-2 dark:text-fg-2-dark">What is it?</Text>
        <TextInput
          testID="bill-name"
          value={name}
          onChangeText={setName}
          placeholder="Meralco"
          className="rounded-lg bg-surface px-3 py-2 text-fg dark:bg-surface-dark dark:text-fg-dark"
        />
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium text-fg-2 dark:text-fg-2-dark">
          Does the amount change?
        </Text>
        {MODES.map((mode) => (
          <Pressable
            key={mode.value}
            testID={`bill-mode-${mode.value}`}
            accessibilityRole="button"
            accessibilityState={{ selected: amountMode === mode.value }}
            onPress={() => setAmountMode(mode.value)}
            className={`rounded-2xl p-4 ${
              amountMode === mode.value
                ? "bg-brand-soft dark:bg-brand-soft-dark"
                : "bg-surface dark:bg-surface-dark"
            }`}
          >
            <Text className="font-semibold text-fg dark:text-fg-dark">{mode.label}</Text>
            <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">{mode.hint}</Text>
          </Pressable>
        ))}
      </View>

      <View className="gap-1">
        <Text className="text-sm font-medium text-fg-2 dark:text-fg-2-dark">
          {amountMode === "fixed" ? "How much is it?" : "Roughly how much?"}
        </Text>
        <TextInput
          testID="bill-amount"
          value={digits}
          onChangeText={setDigits}
          keyboardType="number-pad"
          className="rounded-lg bg-surface px-3 py-2 text-fg dark:bg-surface-dark dark:text-fg-dark"
        />
        <Text testID="bill-amount-preview" className="text-fg-2 dark:text-fg-2-dark">
          {formatCentavos(amount)}
        </Text>
        {amountMode === "estimated" ? (
          <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
            A starting figure. It updates itself from what you actually pay.
          </Text>
        ) : null}
      </View>

      <DueRulePicker testID="bill-due-rule" value={dueRule} onChange={setDueRule} today={today} />

      <View className="gap-2">
        <Text className="text-sm font-medium text-fg-2 dark:text-fg-2-dark">Remind me</Text>
        <View className="flex-row flex-wrap gap-2">
          {OFFSETS.map((offset) => (
            <Pressable
              key={offset.value}
              testID={`bill-offset-${offset.value}`}
              accessibilityRole="button"
              accessibilityState={{ selected: offsets.includes(offset.value) }}
              onPress={() => toggleOffset(offset.value)}
              className={`rounded-lg px-3 py-2 ${
                offsets.includes(offset.value)
                  ? "bg-brand-soft dark:bg-brand-soft-dark"
                  : "bg-surface dark:bg-surface-dark"
              }`}
            >
              <Text className="text-sm text-fg dark:text-fg-dark">{offset.label}</Text>
            </Pressable>
          ))}
        </View>
        {offsets.length === 0 ? (
          // Rule 12 keeps the in-app card either way, so no reminders is a
          // real choice rather than a mistake to block.
          <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
            No notifications. The bill still shows as due in the app.
          </Text>
        ) : null}
      </View>

      <Button
        title="Save bill"
        testID="bill-save"
        disabled={!canSave || busy}
        onPress={() =>
          onSubmit({ name: name.trim(), amount, amountMode, dueRule, reminderOffsets: offsets })
        }
      />
    </View>
  );
}
