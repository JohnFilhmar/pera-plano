// app/(tabs)/_layout.tsx — the five-tab bottom navigation
// (docs/06-information-architecture.md §1 "Navigation model"). TAB_CONFIG is
// the single source the JSX below maps over, so the rendered tab bar can
// never drift from this ordered list — no second, hand-maintained
// <Tabs.Screen> list to keep in sync.
//
// Active/inactive tint and bar background come from the contract §2 palette
// tokens (constants/colors.ts), resolved against the current theme —
// react-navigation's tab bar options take literal color values, not
// className strings, so this is the one place tab-bar colors are read from
// the palette object directly rather than via NativeWind `dark:` classes.
import { Ellipsis, House, ReceiptText, Target, Wallet } from "lucide-react-native";
import { Tabs } from "expo-router";
import type { ComponentType } from "react";
import { palette } from "@/constants/colors";
import { useTheme } from "@/contexts/theme_context";

type TabIconProps = { color: string; size: number };

type TabConfigEntry = {
  name: string;
  label: string;
  Icon: ComponentType<TabIconProps>;
};

export const TAB_CONFIG: readonly TabConfigEntry[] = [
  { name: "index", label: "Home", Icon: House },
  { name: "transactions", label: "Transactions", Icon: ReceiptText },
  { name: "wallets", label: "Wallets", Icon: Wallet },
  { name: "plan", label: "Plan", Icon: Target },
  { name: "more", label: "More", Icon: Ellipsis },
];

export default function TabsLayout() {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: isDark ? palette["brand-dark"] : palette.brand,
        tabBarInactiveTintColor: isDark ? palette["fg-2-dark"] : palette["fg-2"],
        tabBarStyle: {
          backgroundColor: isDark ? palette["surface-dark"] : palette.surface,
        },
      }}
    >
      {TAB_CONFIG.map(({ name, label, Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: label,
            tabBarAccessibilityLabel: label,
            tabBarButtonTestID: `tab-${name}`,
            tabBarIcon: ({ color, size }: TabIconProps) => <Icon color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
