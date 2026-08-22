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

export type SegmentedControlProps<T extends string> = {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
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
            accessibilityRole="button"
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
