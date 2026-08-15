// components/income/cadence_picker.tsx — m2-part2 Task 13, rule 3.
//
// The four cadences, labelled the way a user would say them rather than the way
// the domain enum spells them. `kinsenas` keeps its name — it is the Philippine
// word for exactly this and every payroll department uses it — but it is
// glossed, because a user who moved here recently may not know it.
import { Pressable, Text, View } from "react-native";

import type { IncomeCadence } from "@/types/domain";

export type CadencePickerProps = {
  value: IncomeCadence;
  onChange: (cadence: IncomeCadence) => void;
};

const OPTIONS: readonly { cadence: IncomeCadence; label: string; hint: string }[] = [
  { cadence: "kinsenas", label: "Kinsenas", hint: "Twice a month — the 15th and month-end" },
  { cadence: "weekly", label: "Weekly", hint: "Every week, same day" },
  { cadence: "monthly", label: "Monthly", hint: "Once a month" },
  { cadence: "irregular", label: "It varies", hint: "Gigs, commissions, no fixed schedule" },
];

export function CadencePicker({ value, onChange }: CadencePickerProps) {
  return (
    <View className="gap-2">
      {OPTIONS.map((option) => {
        const selected = option.cadence === value;
        return (
          <Pressable
            key={option.cadence}
            testID={`cadence-${option.cadence}`}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.cadence)}
            className={`rounded-2xl p-4 ${
              selected ? "bg-brand-soft dark:bg-brand-soft-dark" : "bg-surface dark:bg-surface-dark"
            }`}
          >
            <Text className="font-semibold text-fg dark:text-fg-dark">{option.label}</Text>
            <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">{option.hint}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
