// components/reports/range_picker.tsx — M3b Task 3, rule 5.
//
// NEVER ASKS lib/entitlements.ts FOR THE MONTH LIST OR THE customAllowed
// FLAG — `availableScopes()` (lib/reports/reports_service.ts) already
// resolved that tier question once; this component only lays out what it is
// handed, the same "ask the question in one place" discipline
// resolveScope() documents for the service layer.
//
// IT DOES still wrap the custom-range row in PlusGate. PlusGate owns the
// shared "labeled row + lock badge + upgrade sheet" presentation
// (components/gates/plus_gate.tsx), and re-deriving that from
// `customAllowed` alone here would be a second, easy-to-drift copy of the
// same lock icon. Interfaces note: a Plus row that NAMES the feature — not a
// blurred preview of real data — is what rule 5 asks for here.
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { MONTHS } from "@/lib/datetime";
import type { AvailableScopes, ReportScope } from "@/lib/reports/reports_service";

export type RangePickerProps = {
  scope: ReportScope;
  availableScopes: AvailableScopes;
  onSelectMonth: (month: string) => void;
  onSelectCustom: (range: { from: string; to: string }) => void;
  testID?: string;
};

/** `'2026-08'` → `'Aug 2026'`. lib/datetime.ts's own month table, not a new one. */
function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-");
  return `${MONTHS[Number(monthNumber) - 1]} ${year}`;
}

export function RangePicker({
  scope,
  availableScopes,
  onSelectMonth,
  onSelectCustom,
  testID,
}: RangePickerProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  return (
    <View testID={testID ?? "range-picker"} className="gap-3">
      {availableScopes.customAllowed ? (
        <ScrollView horizontal testID="range-picker-months" showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {availableScopes.months.map((month) => {
              const active = scope.kind === "month" && scope.month === month;
              return (
                <Pressable
                  key={month}
                  testID={`range-picker-month-${month}`}
                  onPress={() => onSelectMonth(month)}
                  accessibilityRole="button"
                  accessibilityLabel={monthLabel(month)}
                  className={`rounded-full px-3 py-2 ${
                    active ? "bg-brand dark:bg-brand-dark" : "bg-surface dark:bg-surface-dark"
                  }`}
                >
                  <Text
                    className={
                      active
                        ? "font-semibold text-surface dark:text-surface-dark"
                        : "text-fg dark:text-fg-dark"
                    }
                  >
                    {monthLabel(month)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        // Free has exactly one month to look at (rule 5) — a static label
        // reads as "this is what you have"; a disabled pill would read as a
        // broken control instead.
        <Text testID="range-picker-current-month" className="text-lg font-semibold text-fg dark:text-fg-dark">
          {monthLabel(availableScopes.months[0])}
        </Text>
      )}

      <PlusGate capability="reports">
        <Pressable
          testID="range-picker-custom-toggle"
          onPress={() => setCustomOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel="Custom range"
        >
          <Text className="font-semibold text-brand dark:text-brand-dark">Custom range</Text>
        </Pressable>
      </PlusGate>

      {customOpen ? (
        <View testID="range-picker-custom-form" className="gap-2">
          <TextInput
            testID="range-picker-custom-from"
            value={from}
            onChangeText={setFrom}
            placeholder="YYYY-MM-DD"
            className="rounded-lg border border-fg-2 px-3 py-2 text-fg dark:border-fg-2-dark dark:text-fg-dark"
          />
          <TextInput
            testID="range-picker-custom-to"
            value={to}
            onChangeText={setTo}
            placeholder="YYYY-MM-DD"
            className="rounded-lg border border-fg-2 px-3 py-2 text-fg dark:border-fg-2-dark dark:text-fg-dark"
          />
          <Pressable
            testID="range-picker-custom-apply"
            onPress={() => onSelectCustom({ from, to })}
            accessibilityRole="button"
            accessibilityLabel="Apply custom range"
            className="rounded-lg bg-brand px-3 py-2 dark:bg-brand-dark"
          >
            <Text className="text-center font-semibold text-surface dark:text-surface-dark">Apply</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
