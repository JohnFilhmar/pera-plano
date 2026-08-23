// components/ui/segmented_control.tsx — the pill row the design uses wherever
// one of a few mutually exclusive views is on screen: Plan's four panels,
// manual entry's Expense/Income/Transfer, the income cadence picker, and the
// Amount-versus-%-of-income toggle on both limit forms.
//
// Four screens hand-rolled this before it existed, with four different
// paddings and two different selected treatments. One component is the point.
//
// NOT A TAB BAR. It changes what a screen shows; it never navigates. Plan
// keeps real routes underneath (see the revamp spec R4) precisely so that
// pressing a segment can stay a state change.
import { Pressable, Text, View } from "react-native";

export type Segment<T extends string> = { value: T; label: string };

// `value` and `onChange` are typed `NoInfer<T>`, not `T` — `segments` is the
// ONLY position `T` may be inferred from, deliberately. TypeScript infers a
// generic independently at every position where it appears and then unions
// the candidates, so with plain `T` on all three properties a stale or
// typo'd `value` — one that names no real segment — does not error. It just
// becomes another candidate, and `T` inflates to include it. That compiles
// clean and fails silently at runtime instead: `segment.value === value` is
// false for every segment, so nothing paints as selected, and — because the
// press handler only withholds `onChange` when a segment IS selected — every
// press fires it regardless of which segment was pressed. `NoInfer` removes
// `value`/`onChange` from inference entirely, so a mismatched `value` is a
// compile error instead of a silent no-op. That still only protects a caller
// whose `segments` type is a literal union (an `as const` array, e.g.) — a
// caller typed as plain `string` gives `T = string` and reopens the hole,
// which is what the runtime-asserting test below (and the `@ts-expect-error`
// pin next to it) both exist to catch.
export type SegmentedControlProps<T extends string> = {
  segments: ReadonlyArray<Segment<T>>;
  value: NoInfer<T>;
  onChange: (value: NoInfer<T>) => void;
  testID?: string;
};

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  testID,
}: SegmentedControlProps<T>) {
  return (
    <View testID={testID} className="flex-row gap-2">
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            testID={testID === undefined ? undefined : `${testID}-${segment.value}`}
            onPress={() => {
              if (!selected) onChange(segment.value);
            }}
            // "radio", not "button": this is one-of-N, and this codebase
            // already has the pattern for it — `cadence_picker.tsx` and
            // `category_picker.tsx` both use `"radio"` for the same
            // semantic, with no `"radiogroup"` on their container, so this
            // follows that rather than inventing a third shape. A `"button"`
            // role announces four unrelated actions instead of a set of
            // mutually exclusive options.
            accessibilityRole="radio"
            accessibilityLabel={segment.label}
            accessibilityState={{ selected }}
            className={`min-h-[44px] flex-1 items-center justify-center rounded-full px-3 ${
              selected ? "bg-brand dark:bg-brand-dark" : "bg-chip dark:bg-chip-dark"
            }`}
          >
            <Text
              numberOfLines={1}
              className={`text-row font-semibold ${
                selected
                  ? "text-on-brand dark:text-on-brand-dark"
                  : "text-fg-2 dark:text-fg-2-dark"
              }`}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
