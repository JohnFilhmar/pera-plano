// components/ui/list_row.tsx — m1c plan Task 2.
//
// The repeating unit of every list in the app — wallets, ledger rows, More-tab
// entries, review cards' sub-rows. Slots rather than variants: the `left` and
// `right` ends differ on every screen, but the title/subtitle rhythm and the
// touch target must not.
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

export type ListRowProps = {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  /** Reserved for rows that destroy data — "Delete all data", never "Log out". */
  destructive?: boolean;
  testID?: string;
};

export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  destructive = false,
  testID,
}: ListRowProps) {
  const body = (
    <>
      {left ? <View>{left}</View> : null}
      {/* `flex-1` on the middle column, so a long merchant name truncates
          instead of pushing the amount off the right edge. */}
      <View className="flex-1">
        <Text
          numberOfLines={1}
          className={
            destructive
              ? "text-row font-semibold text-danger dark:text-danger-dark"
              : "text-row font-semibold text-fg dark:text-fg-dark"
          }
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View>{right}</View> : null}
    </>
  );

  // 44pt is the smallest reliably tappable row; ledger rows are scanned fast
  // and mis-taps here open the wrong transaction.
  const className = "min-h-[44px] flex-row items-center gap-3 px-4 py-3";

  if (!onPress) {
    return (
      <View testID={testID} className={className}>
        {body}
      </View>
    );
  }

  // NOTE — unlike `PlusGate`, the children are NOT wrapped in
  // `pointerEvents="none"`. A gate wants to swallow its children's touches; a
  // row wants the switch or button in its `right` slot to keep working, and
  // React Native already gives the inner touchable precedence.
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      className={className}
    >
      {body}
    </Pressable>
  );
}
