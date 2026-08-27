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
import { ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { MonthPicker } from "@/components/reports/month_picker";
import { registerIcon } from "@/components/ui/button";
import { DateField } from "@/components/ui/date_field";
import { parseDateIso } from "@/lib/dates";
import { MONTHS } from "@/lib/datetime";

const ChevronGlyph = registerIcon(ChevronDown);
import type { AvailableScopes, ReportScope } from "@/lib/reports/reports_service";
import { ISOLATED_LINK_HIT_SLOP } from "@/lib/ui/hit_slop";

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

/**
 * `'2026-08-05'` → `'Aug 5, 2026'`. Same table again.
 *
 * NOT lib/datetime.ts's `formatDate`, which takes an EpochMs: converting an
 * IsoDate to a timestamp just to format it back is the round trip that file's
 * header warns about, and every scope string here is already local-calendar.
 */
function dateLabel(iso: string): string {
  const [year, monthNumber, day] = iso.split("-");
  return `${MONTHS[Number(monthNumber) - 1]} ${Number(day)}, ${year}`;
}

/** What the period field says. Both scope kinds name themselves. */
function periodLabel(scope: ReportScope): string {
  if (scope.kind === "month") return monthLabel(scope.month);
  return `${dateLabel(scope.range.from)} – ${dateLabel(scope.range.to)}`;
}

/**
 * Guards the custom-range Apply button. Without this, `from`/`to` default to
 * `""` and a press with nothing typed (or `from` after `to`) produces a
 * query that degrades to zero rows — the report then shows "No transactions
 * in this period," which reads as the user's DATA being missing when it was
 * actually their INPUT that was never valid. Nothing downstream crashes
 * (`Number.isFinite`/SQLite's NaN comparisons close the range on their own),
 * so this is purely about not showing a misleading empty state.
 *
 * Format only — `YYYY-MM-DD` shape, not calendar validity (no Feb-30 check).
 * String comparison for `from <= to` is safe because a `YYYY-MM-DD` string
 * that matches the pattern is zero-padded, the same trick aggregate.ts's
 * `inRange` relies on for calendar order.
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidCustomRange(from: string, to: string): boolean {
  return DATE_PATTERN.test(from) && DATE_PATTERN.test(to) && from <= to;
}

/**
 * The other field's value as a picker bound — `undefined` while it is unset.
 *
 * GUARDED BY THE SAME PATTERN, not just by `!== ""`. `parseDateIso` does no
 * validation (see lib/dates.ts's header), so a half-set value would produce an
 * Invalid Date, and a dialog handed one refuses every day on the calendar:
 * the form would look broken on the very first tap rather than simply
 * unbounded.
 */
function boundFrom(value: string): Date | undefined {
  return DATE_PATTERN.test(value) ? parseDateIso(value) : undefined;
}

export function RangePicker({
  scope,
  availableScopes,
  onSelectMonth,
  onSelectCustom,
  testID,
}: RangePickerProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [monthsOpen, setMonthsOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  return (
    <View testID={testID ?? "range-picker"} className="gap-3">
      {availableScopes.customAllowed ? (
        // ONE FIELD THAT NAMES THE PERIOD, not a strip of twelve pills.
        //
        // The strip was a horizontal ScrollView over a list the service hands
        // back OLDEST FIRST, so it opened on last September with the month
        // actually being reported on off the right edge — see
        // month_picker.tsx's header for why a grid is the fix rather than an
        // auto-scroll. What is left here is the ordinary Android picker shape
        // (docs/11: "sheets for pickers"): a field showing the current value,
        // a sheet to change it.
        //
        // NAMES THE CUSTOM RANGE TOO. With a custom range applied, no month
        // pill was active and the strip said nothing at all about what was on
        // screen; this field always states the period the charts below are
        // drawn from.
        <>
          <Pressable
            testID="range-picker-month-trigger"
            onPress={() => setMonthsOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Period, ${periodLabel(scope)}`}
            className="min-h-[44px] flex-row items-center justify-between rounded-xl bg-surface px-3 py-2 dark:bg-surface-dark"
          >
            <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
              {periodLabel(scope)}
            </Text>
            <ChevronGlyph size={20} className="text-fg-2 dark:text-fg-2-dark" />
          </Pressable>

          <MonthPicker
            visible={monthsOpen}
            value={scope.kind === "month" ? scope.month : null}
            months={availableScopes.months}
            onDismiss={() => setMonthsOpen(false)}
            onSelect={(month) => {
              setMonthsOpen(false);
              onSelectMonth(month);
            }}
          />
        </>
      ) : (
        // Free has exactly one month to look at (rule 5) — a static label
        // reads as "this is what you have"; a disabled pill would read as a
        // broken control instead.
        <Text testID="range-picker-current-month" className="text-lg font-semibold text-fg dark:text-fg-dark">
          {monthLabel(availableScopes.months[0])}
        </Text>
      )}

      <PlusGate capability="reports">
        {/* Touch target (design F1 sweep): no padding class, unstyled
            default-size text, nothing rendered below it until `customOpen`
            flips true — no sibling Pressable within slop distance. */}
        <Pressable
          testID="range-picker-custom-toggle"
          onPress={() => setCustomOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel="Custom range"
          hitSlop={ISOLATED_LINK_HIT_SLOP}
        >
          <Text className="font-semibold text-brand dark:text-brand-dark">Custom range</Text>
        </Pressable>
      </PlusGate>

      {customOpen ? (
        <View testID="range-picker-custom-form" className="gap-2">
          {/* TWO DateFields THAT BOUND EACH OTHER (numeric-input-system Task
              14). These were `placeholder="YYYY-MM-DD"` TextInputs, which is
              the pattern date_field.tsx exists to retire.

              THE BOUNDS AND `isValidCustomRange` ARE NOT REDUNDANT. The bounds
              stop the user REACHING an invalid pair — the end date's calendar
              simply cannot go below the start — and the string check still
              catches one. Deleting the check because "the dialog prevents it"
              would leave the untouched `""`/`""` pair, and a half-filled form,
              with nothing guarding Apply at all.

              VISIBLE LABELS, because both fields now show the same "Pick a
              date" placeholder while empty: without them the form would be two
              identical rows with nothing saying which is the start. */}
          <View>
            <Text className="font-semibold text-fg dark:text-fg-dark">Start</Text>
            <DateField
              testID="range-picker-custom-from"
              label="Start date"
              placeholder="Pick a date"
              value={from}
              onChange={setFrom}
              maximumDate={boundFrom(to)}
            />
          </View>
          <View>
            <Text className="font-semibold text-fg dark:text-fg-dark">End</Text>
            <DateField
              testID="range-picker-custom-to"
              label="End date"
              placeholder="Pick a date"
              value={to}
              onChange={setTo}
              minimumDate={boundFrom(from)}
            />
          </View>
          {/* Tone matches cash_reconcile_sheet.tsx's field hints: say what is
              needed, not what is wrong with what was typed.

              THE FORMAT INSTRUCTION IS GONE, AND SO IS THE ORDERING ONE. "Enter
              both dates as YYYY-MM-DD" told the user to type into controls that
              cannot be typed into, and "with the start on or before the end"
              warned about a pair the bounds above make unreachable. What is
              left is the one thing still true: Apply needs both. */}
          <Text testID="range-picker-custom-hint" className="text-fg-2 dark:text-fg-2-dark">
            Pick both dates to apply a custom range.
          </Text>
          <Pressable
            testID="range-picker-custom-apply"
            onPress={() => onSelectCustom({ from, to })}
            accessibilityRole="button"
            accessibilityLabel="Apply custom range"
            disabled={!isValidCustomRange(from, to)}
            accessibilityState={{ disabled: !isValidCustomRange(from, to) }}
            className={`rounded-lg bg-brand px-3 py-2 dark:bg-brand-dark ${
              isValidCustomRange(from, to) ? "" : "opacity-50"
            }`}
          >
            <Text className="text-center font-semibold text-surface dark:text-surface-dark">Apply</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
