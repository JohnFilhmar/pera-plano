// components/reports/month_picker.tsx — the month/year sheet behind
// range_picker.tsx's period field.
//
// REPLACES A HORIZONTAL STRIP THAT OPENED ON THE WRONG MONTH.
// `availableScopes()` (lib/reports/reports_service.ts) hands back twelve
// trailing months OLDEST FIRST — the order a trend chart reads left to right,
// and the order the strip laid them out in. A ScrollView starts at offset 0,
// so opening Reports showed last September while the month actually being
// reported on sat off the right edge, unscrolled-to and unhighlighted. Fixing
// that in place means an auto-scroll measured against a list whose width is
// only known after layout — a scrollTo race that reads as a jump on every
// mount. A grid has no scroll offset to be wrong about: the sheet opens ON the
// selected month's year, and the selection is visible without moving anything.
//
// PRESENTATIONAL. It is handed the months the tier may pick and reports a
// press back; it asks lib/entitlements.ts nothing, the same discipline
// range_picker.tsx's header sets out.
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { BottomSheet } from "@/components/ui/bottom_sheet";
import { registerIcon } from "@/components/ui/button";
import { MONTHS } from "@/lib/datetime";

const PrevGlyph = registerIcon(ChevronLeft);
const NextGlyph = registerIcon(ChevronRight);

export type MonthPickerProps = {
  visible: boolean;
  /** The selected `'YYYY-MM'`, or null while a custom range is what's showing. */
  value: string | null;
  /** Every month the tier may pick, `'YYYY-MM'`, oldest first. */
  months: readonly string[];
  onDismiss: () => void;
  onSelect: (month: string) => void;
};

/** `2026, 8` → `'2026-08'`. Zero-padded, the shape every scope string uses. */
function monthKey(year: number, monthNumber: number): string {
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

/**
 * The distinct years `months` touches, ascending.
 *
 * DERIVED, NEVER ASSUMED. A trailing-12 window spans exactly two calendar
 * years today, but Free's list is one month in one year and the window size is
 * a constant that has already changed once (AVAILABLE_MONTHS_PLUS). Reading
 * the years off the list keeps the stepper's bounds honest whatever the
 * service decides to offer.
 */
function yearsIn(months: readonly string[]): number[] {
  const seen = new Set(months.map((month) => Number(month.slice(0, 4))));
  return [...seen].sort((a, b) => a - b);
}

/**
 * The year the sheet opens on: the selected month's, when that year is still
 * offered — otherwise the NEWEST year available.
 *
 * THIS IS THE FIX. The old strip's answer was "whatever is at scroll offset
 * 0," which is the oldest month in the window. Falling back to the newest
 * rather than the oldest matters for the custom-range case too (`value` is
 * null there): a user reaching for a month is far likelier to want a recent
 * one than one from last year.
 */
function initialYear(value: string | null, months: readonly string[]): number {
  const years = yearsIn(months);
  if (years.length === 0) return new Date().getFullYear();
  if (value !== null) {
    const selected = Number(value.slice(0, 4));
    if (years.includes(selected)) return selected;
  }
  return years[years.length - 1];
}

export function MonthPicker({ visible, value, months, onDismiss, onSelect }: MonthPickerProps) {
  const years = yearsIn(months);
  const [year, setYear] = useState(() => initialYear(value, months));

  // Re-anchored on every OPEN, not just on mount. The sheet stays mounted
  // between visits (BottomSheet renders nothing while hidden, but this
  // component's state survives), so without this a user who paged back to
  // 2025, dismissed, and reopened would land on 2025 again — the same
  // "opens somewhere I didn't ask for" defect the strip had, just earned a
  // different way.
  //
  // KEYED ON THE WINDOW'S CONTENTS, NOT THE ARRAY. `months` is a react-query
  // result and stable today, but a caller that rebuilt the list inline would
  // hand this effect a new identity on every render — and it would then snap
  // the year back to the selection while the user was still stepping through
  // it. A joined key changes only when the window genuinely does (a tier
  // change mid-session), which is the one case that should re-anchor.
  const windowKey = months.join(",");
  useEffect(() => {
    if (!visible) return;
    setYear(initialYear(value, windowKey === "" ? [] : windowKey.split(",")));
  }, [visible, value, windowKey]);

  const index = years.indexOf(year);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < years.length - 1;

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} title="Select a month">
      <View testID="range-picker-months" className="gap-3">
        <View className="flex-row items-center justify-between">
          <Pressable
            testID="range-picker-year-prev"
            onPress={() => (hasPrev ? setYear(years[index - 1]) : undefined)}
            disabled={!hasPrev}
            accessibilityRole="button"
            accessibilityLabel="Previous year"
            accessibilityState={{ disabled: !hasPrev }}
            className={`min-h-[44px] min-w-[44px] items-center justify-center rounded-full ${
              hasPrev ? "" : "opacity-30"
            }`}
          >
            <PrevGlyph size={22} className="text-fg dark:text-fg-dark" />
          </Pressable>

          <Text testID="range-picker-year" className="text-lg font-semibold text-fg dark:text-fg-dark">
            {year}
          </Text>

          <Pressable
            testID="range-picker-year-next"
            onPress={() => (hasNext ? setYear(years[index + 1]) : undefined)}
            disabled={!hasNext}
            accessibilityRole="button"
            accessibilityLabel="Next year"
            accessibilityState={{ disabled: !hasNext }}
            className={`min-h-[44px] min-w-[44px] items-center justify-center rounded-full ${
              hasNext ? "" : "opacity-30"
            }`}
          >
            <NextGlyph size={22} className="text-fg dark:text-fg-dark" />
          </Pressable>
        </View>

        {/* All twelve months are ALWAYS drawn, and the ones outside the window
            are drawn DISABLED rather than omitted. A grid missing eight cells
            reads as a rendering bug; a dimmed cell reads as "not this one,"
            which is what it means. */}
        <View className="flex-row flex-wrap gap-2">
          {MONTHS.map((label, offset) => {
            const key = monthKey(year, offset + 1);
            const available = months.includes(key);
            const active = value === key;
            return (
              <Pressable
                key={key}
                testID={`range-picker-month-${key}`}
                onPress={() => onSelect(key)}
                disabled={!available}
                accessibilityRole="button"
                accessibilityLabel={`${label} ${year}`}
                accessibilityState={{ disabled: !available, selected: active }}
                className={`min-h-[44px] w-[31%] items-center justify-center rounded-xl ${
                  active ? "bg-brand dark:bg-brand-dark" : "bg-bg dark:bg-bg-dark"
                } ${available ? "" : "opacity-30"}`}
              >
                <Text
                  className={
                    active
                      ? "font-semibold text-surface dark:text-surface-dark"
                      : "text-fg dark:text-fg-dark"
                  }
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </BottomSheet>
  );
}
