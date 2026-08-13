// components/ui/section_header.tsx — m1c plan Task 2.
//
// Divides a scrolling screen into named sections ("This month", "I owe",
// "Recent") with an optional single action on the right ("See all", "Add").
// The smallest primitive here, and the one that keeps section spacing from
// being re-invented per screen.
import { Pressable, Text, View } from "react-native";

export type SectionHeaderProps = {
  title: string;
  action?: { label: string; onPress: () => void };
  testID?: string;
};

export function SectionHeader({ title, action, testID }: SectionHeaderProps) {
  return (
    <View
      testID={testID}
      className="flex-row items-center justify-between px-4 pb-2 pt-5"
    >
      <Text className="text-base font-semibold text-fg dark:text-fg-dark">
        {title}
      </Text>
      {action ? (
        <Pressable
          testID="section-header-action"
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          {/* Brand green, never `fg-2`: a section action is a live link, and a
              grey one reads as a disabled "Soon" affordance. */}
          <Text className="text-sm font-semibold text-brand dark:text-brand-dark">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
