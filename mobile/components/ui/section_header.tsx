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

/**
 * Touch target (design F1 sweep). The action label carries no padding class
 * at all — `text-sm` alone (14px/20px line-height, Tailwind's own default
 * scale) is the whole painted height. 44 - 20 = 24, split evenly: 12 top, 12
 * bottom closes it exactly. Uncapped horizontally: this is the only
 * interactive element in its `justify-between` header row (the title beside
 * it is a plain, non-interactive `Text`), so there is no adjacent Pressable
 * for a wider slop to collide with — the same reasoning
 * `app/wallet/[id].tsx`'s "Edit" hitSlop documents for its own isolated case.
 */
const SECTION_ACTION_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

export function SectionHeader({ title, action, testID }: SectionHeaderProps) {
  return (
    <View
      testID={testID}
      className="flex-row items-center justify-between px-4 pb-2 pt-5"
    >
      <Text className="text-section font-bold text-fg dark:text-fg-dark">
        {title}
      </Text>
      {action ? (
        <Pressable
          testID="section-header-action"
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={SECTION_ACTION_HIT_SLOP}
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
