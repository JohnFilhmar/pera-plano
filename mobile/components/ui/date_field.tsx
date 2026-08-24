// mobile/components/ui/date_field.tsx — W1 Task 8. Replaces the five
// placeholder="YYYY-MM-DD" TextInputs the app shipped with.
//
// IsoDate IN, IsoDate OUT. No Date object crosses this boundary and nothing
// here calls toISOString: that method is UTC, and for a UTC+8 user picking a
// date late in the evening it names YESTERDAY. Conversion is delegated to
// lib/dates.ts's toDateIso/parseDateIso -- that file is the control plane for
// this exact 'YYYY-MM-DD' <-> Date conversion (see its header) -- rather than
// a second local-calendar-field implementation, which is the same call
// components/transactions/day_group_header.tsx's header explains: two copies
// of the same instant is how they end up disagreeing about it.
import { useState } from "react";
import { Pressable, Text } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

import { parseDateIso, toDateIso } from "@/lib/dates";
import type { IsoDate } from "@/types/domain";

/**
 * `'YYYY-MM-DD'` -> a local Date at midnight, or today when absent/unparseable.
 *
 * The guard runs BEFORE `parseDateIso`, not after: that function does no
 * validation at all (by design -- see its header), so a garbage or partial
 * string would otherwise silently produce an Invalid Date, or (worse, for a
 * zero-valued component like "2026-00-19") a Date that quietly rolled back a
 * month/year instead of the "fall back to today" this field has always done.
 */
function dateFrom(value: IsoDate | null): Date {
  if (value === null) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return parseDateIso(value);
}

export type DateFieldProps = {
  testID: string;
  label: string;
  value: IsoDate | null;
  onChange: (value: IsoDate) => void;
  placeholder?: string;
  /** Bounds are per-field on purpose: "any date" is wrong on every one of these. */
  minimumDate?: Date;
  maximumDate?: Date;
};

export function DateField({
  testID,
  label,
  value,
  onChange,
  placeholder = "",
  minimumDate,
  maximumDate,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const empty = value === null || value === "";

  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={empty ? label : `${label}, ${value}`}
        onPress={() => setOpen(true)}
        className="mt-2 rounded-xl bg-surface p-3 dark:bg-surface-dark"
      >
        <Text className={empty ? "text-fg-2 dark:text-fg-2-dark" : "text-fg dark:text-fg-dark"}>
          {empty ? placeholder : value}
        </Text>
      </Pressable>

      {open ? (
        <DateTimePicker
          value={dateFrom(value)}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(event, picked) => {
            // Android's dialog closes itself; the component must be unmounted
            // either way or the next press re-opens nothing.
            setOpen(false);
            if (event.type !== "set" || picked === undefined) return;
            onChange(toDateIso(picked));
          }}
        />
      ) : null}
    </>
  );
}
