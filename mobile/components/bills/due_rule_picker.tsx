// components/bills/due_rule_picker.tsx — m2c Task 5, rule 4.
//
// THE PREVIEW IS THE POINT. "The preview is what catches a misconfigured rule
// before it silently misfires for months" — a due rule is the one input in this
// app whose mistakes are invisible at the moment you make them. "Every 31st"
// looks right until February; "every 2 weeks on Friday" looks right until you
// notice it anchored to the wrong Friday. Three real dates, recomputed on every
// keystroke, make both obvious immediately.
//
// PLAIN LANGUAGE, NOT THE UNION'S NAMES. The user picks "Every month on the
// 20th", not `day-of-month`. The weekday adjustment is offered only where it
// applies — the spec scopes it to month-based rules, and offering it on a
// weekly bill would ask the user to overrule the only thing that rule says.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { occurrencesBetween } from "@/lib/bills/due_rules";
import { addDaysIso, parseDateIso } from "@/lib/dates";
import { formatDate } from "@/lib/datetime";
import type { DueRule, WeekdayAdjust } from "@/types/domain";

export type DueRuleKind = DueRule["kind"];

export type DueRulePickerProps = {
  value: DueRule;
  onChange: (rule: DueRule) => void;
  /** The date the preview counts forward from. */
  today: string;
  testID?: string;
};

const KINDS: readonly { value: DueRuleKind; label: string }[] = [
  { value: "day-of-month", label: "Every month on a date" },
  { value: "semi-monthly", label: "Every 15th and month-end" },
  { value: "last-day-of-month", label: "Last day of the month" },
  { value: "every-n-weeks", label: "Every few weeks" },
  { value: "every-n-months", label: "Every few months" },
];

const ADJUSTS: readonly { value: WeekdayAdjust; label: string }[] = [
  { value: "none", label: "Keep the date" },
  { value: "earlier", label: "Move earlier" },
  { value: "later", label: "Move later" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A sensible default for each kind, so switching never yields an invalid rule. */
function defaultFor(kind: DueRuleKind, today: string): DueRule {
  const day = parseDateIso(today).getDate();
  switch (kind) {
    case "day-of-month":
      return { kind, day };
    case "semi-monthly":
      return { kind };
    case "last-day-of-month":
      return { kind };
    case "every-n-weeks":
      return { kind, n: 2, weekday: parseDateIso(today).getDay(), anchorDate: today };
    case "every-n-months":
      return { kind, n: 3, day, anchorMonth: parseDateIso(today).getMonth() + 1 };
  }
}

/** Only month-based rules take the weekend shift — see the header. */
function acceptsAdjust(rule: DueRule): boolean {
  return rule.kind !== "every-n-weeks";
}

function clampDay(text: string): number {
  const parsed = Number.parseInt(text.replace(/[^0-9]/g, ""), 10);
  if (Number.isNaN(parsed)) return 1;
  return Math.min(31, Math.max(1, parsed));
}

function clampN(text: string): number {
  const parsed = Number.parseInt(text.replace(/[^0-9]/g, ""), 10);
  if (Number.isNaN(parsed)) return 1;
  return Math.min(12, Math.max(1, parsed));
}

export function DueRulePicker({ value, onChange, today, testID }: DueRulePickerProps) {
  // The next three occurrences. A year is enough for every kind the union can
  // express — an annual rule's third date is two years out, so the window is
  // widened rather than the preview silently showing fewer than three.
  const preview = [
    ...occurrencesBetween(value, addDaysIso(today, 1), addDaysIso(today, 1200)),
  ].slice(0, 3);

  return (
    <View testID={testID} className="gap-3">
      <Text className="text-sm font-medium text-fg-2 dark:text-fg-2-dark">When is it due?</Text>

      <View className="flex-row flex-wrap gap-2">
        {KINDS.map((kind) => (
          <Pressable
            key={kind.value}
            testID={`due-kind-${kind.value}`}
            onPress={() => onChange(defaultFor(kind.value, today))}
            className={`rounded-lg px-3 py-2 ${
              value.kind === kind.value
                ? "bg-brand-soft dark:bg-brand-soft-dark"
                : "bg-surface dark:bg-surface-dark"
            }`}
          >
            <Text className="text-sm text-fg dark:text-fg-dark">{kind.label}</Text>
          </Pressable>
        ))}
      </View>

      {value.kind === "day-of-month" ? (
        <LabelledNumber
          testID="due-day"
          label="Day of the month"
          value={String(value.day)}
          onChange={(text) => onChange({ ...value, day: clampDay(text) })}
          // Rule 2's clamping means 29-31 are safe to offer: they land on the
          // last day of a shorter month rather than skipping it.
          hint="29, 30 and 31 fall back to the last day of shorter months."
        />
      ) : null}

      {value.kind === "every-n-months" ? (
        <View className="gap-3">
          <LabelledNumber
            testID="due-every-n-months"
            label="Every how many months?"
            value={String(value.n)}
            onChange={(text) => onChange({ ...value, n: clampN(text) })}
            hint="3 is quarterly, 12 is yearly."
          />
          <LabelledNumber
            testID="due-month-day"
            label="Day of the month"
            value={String(value.day)}
            onChange={(text) => onChange({ ...value, day: clampDay(text) })}
          />
        </View>
      ) : null}

      {value.kind === "every-n-weeks" ? (
        <View className="gap-3">
          <LabelledNumber
            testID="due-every-n-weeks"
            label="Every how many weeks?"
            value={String(value.n)}
            onChange={(text) => onChange({ ...value, n: clampN(text) })}
          />
          <Text className="text-sm font-medium text-fg-2 dark:text-fg-2-dark">On which day?</Text>
          <View className="flex-row flex-wrap gap-2">
            {WEEKDAYS.map((label, weekday) => (
              <Pressable
                key={label}
                testID={`due-weekday-${weekday}`}
                onPress={() => onChange({ ...value, weekday })}
                className={`rounded-lg px-3 py-2 ${
                  value.weekday === weekday
                    ? "bg-brand-soft dark:bg-brand-soft-dark"
                    : "bg-surface dark:bg-surface-dark"
                }`}
              >
                <Text className="text-sm text-fg dark:text-fg-dark">{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {acceptsAdjust(value) ? (
        <View className="gap-2">
          <Text className="text-sm font-medium text-fg-2 dark:text-fg-2-dark">
            If it lands on a weekend
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {ADJUSTS.map((adjust) => (
              <Pressable
                key={adjust.value}
                testID={`due-adjust-${adjust.value}`}
                onPress={() => onChange({ ...value, weekdayAdjust: adjust.value })}
                className={`rounded-lg px-3 py-2 ${
                  (value.weekdayAdjust ?? "none") === adjust.value
                    ? "bg-brand-soft dark:bg-brand-soft-dark"
                    : "bg-surface dark:bg-surface-dark"
                }`}
              >
                <Text className="text-sm text-fg dark:text-fg-dark">{adjust.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View testID="due-preview" className="rounded-lg bg-surface p-3 dark:bg-surface-dark">
        <Text className="text-xs font-medium text-fg-2 dark:text-fg-2-dark">Next three</Text>
        {preview.length === 0 ? (
          <Text className="mt-1 text-sm text-fg-2 dark:text-fg-2-dark">
            This rule has no upcoming dates.
          </Text>
        ) : (
          preview.map((date) => (
            <Text
              key={date}
              testID={`due-preview-${date}`}
              className="mt-1 text-sm text-fg dark:text-fg-dark"
            >
              {formatDate(parseDateIso(date).getTime())}
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

function LabelledNumber({
  testID,
  label,
  value,
  onChange,
  hint,
}: {
  testID: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  hint?: string;
}) {
  const [text, setText] = useState(value);

  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-fg-2 dark:text-fg-2-dark">{label}</Text>
      <TextInput
        testID={testID}
        value={text}
        onChangeText={(next) => {
          setText(next);
          onChange(next);
        }}
        keyboardType="number-pad"
        className="rounded-lg bg-surface px-3 py-2 text-fg dark:bg-surface-dark dark:text-fg-dark"
      />
      {hint === undefined ? null : (
        <Text className="text-xs text-fg-2 dark:text-fg-2-dark">{hint}</Text>
      )}
    </View>
  );
}
