// components/ui/fab.tsx — the green + button on Home and Transactions.
//
// 56dp, Material's floating-action size. Sits above the tab bar, so callers
// place it with `absolute bottom-*` INSIDE the screen, not in the tab layout:
// only two of five tabs have one.
import { Plus } from "lucide-react-native";
import { Pressable } from "react-native";

import { registerIcon } from "./button";
import type { IconComponent } from "./button";

export type FabProps = {
  onPress: () => void;
  icon?: IconComponent;
  accessibilityLabel: string;
  testID?: string;
};

const FAB_SIZE = 56;

export function Fab({ onPress, icon = Plus, accessibilityLabel, testID }: FabProps) {
  const Icon = registerIcon(icon);

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="items-center justify-center rounded-full bg-brand shadow-sm dark:bg-brand-dark"
      style={{ width: FAB_SIZE, height: FAB_SIZE }}
    >
      <Icon size={24} className="text-on-brand dark:text-on-brand-dark" />
    </Pressable>
  );
}
