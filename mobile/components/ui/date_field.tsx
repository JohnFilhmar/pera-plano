// mobile/components/ui/date_field.tsx — W1 Task 8. Replaces the five
// placeholder="YYYY-MM-DD" TextInputs the app shipped with.
//
// IsoDate IN, IsoDate OUT. No Date object crosses this boundary and nothing
// here calls toISOString: that method is UTC, and for a UTC+8 user picking a
// date late in the evening it names YESTERDAY. The conversion below reads the
// local calendar fields off the Date the picker hands back, which is the same
// rule components/transactions/day_group_header.tsx already follows.
import { useState } from "react";
import { Pressable, Text } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

import type { IsoDate } from "@/types/domain";

/** A Date -> the LOCAL calendar day it names. Never toISOString. */
function isoDateFrom(date: Date): IsoDate {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `'YYYY-MM-DD'` -> a local Date at midnight, or today when absent/unparseable. */
function dateFrom(value: IsoDate | null): Date {
  if (value === null) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
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
            onChange(isoDateFrom(picked));
          }}
        />
      ) : null}
    </>
  );
}
