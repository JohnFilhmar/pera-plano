// components/income/cadence_picker.tsx — m2-part2 Task 13, rule 3.
//
// The four cadences, labelled the way a user would say them rather than the way
// the domain enum spells them. `kinsenas` keeps its name — it is the Philippine
// word for exactly this and every payroll department uses it — but it is
// glossed, because a user who moved here recently may not know it.
//
// RESTYLED (mobile-ui-revamp Part 3 Task 4b) to `SegmentedControl` — exactly
// four options, the brief's own two-to-four-way exclusive-choice rule.
// `cadence-kinsenas`/`cadence-weekly`/`cadence-monthly`/`cadence-irregular`
// are the ids the hand-rolled pills already used and
// `income_screen.test.tsx`'s `fireEvent.press(screen.getByTestId("cadence-monthly"))`
// still presses: `IncomeCadence`'s own literal values ARE those suffixes, so
// `SegmentedControl`'s `${testID}-${value}` generation reproduces them without
// a rename. The per-option HINT ("Twice a month — the 15th and month-end")
// moves below the control, for the selected cadence only — the pill itself
// has no room for a sentence.
import { Text, View } from "react-native";

import { SegmentedControl } from "@/components/ui/segmented_control";
import type { IncomeCadence } from "@/types/domain";

export type CadencePickerProps = {
  value: IncomeCadence;
  onChange: (cadence: IncomeCadence) => void;
};

const OPTIONS = [
  { cadence: "kinsenas", label: "Kinsenas", hint: "Twice a month — the 15th and month-end" },
  { cadence: "weekly", label: "Weekly", hint: "Every week, same day" },
  { cadence: "monthly", label: "Monthly", hint: "Once a month" },
  { cadence: "irregular", label: "It varies", hint: "Gigs, commissions, no fixed schedule" },
] as const satisfies ReadonlyArray<{ cadence: IncomeCadence; label: string; hint: string }>;

const SEGMENTS = OPTIONS.map(({ cadence, label }) => ({ value: cadence, label }));

export function CadencePicker({ value, onChange }: CadencePickerProps) {
  const selectedHint = OPTIONS.find((option) => option.cadence === value)?.hint;

  return (
    <View className="gap-2">
      <SegmentedControl testID="cadence" segments={SEGMENTS} value={value} onChange={onChange} />
      {selectedHint === undefined ? null : (
        <Text className="text-fg-2 dark:text-fg-2-dark">{selectedHint}</Text>
      )}
    </View>
  );
}
