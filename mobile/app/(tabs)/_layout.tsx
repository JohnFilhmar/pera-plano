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
import { View } from "react-native";
import { ReviewCountBadge } from "@/components/review/review_badge";
import { palette } from "@/constants/colors";
import { useTheme } from "@/contexts/theme_context";

type TabIconProps = { color: string; size: number };

type TabConfigEntry = {
  name: string;
  label: string;
  Icon: ComponentType<TabIconProps>;
  /**
   * Carries the Review Queue count (docs/04-features/08-review-queue.md rule
   * 18 — "The Transactions tab badge counts actionable items").
   *
   * A FLAG RATHER THAN A SECOND ICON ENTRY, so the badge cannot silently end up
   * on two tabs or on none. The queue rides Transactions because that is where
   * its results land: the badge is a claim about the ledger, and putting it on
   * a tab that does not lead to the ledger would make the number unactionable.
   */
  badged?: boolean;
};

export const TAB_CONFIG: readonly TabConfigEntry[] = [
  { name: "index", label: "Home", Icon: House },
  { name: "transactions", label: "Transactions", Icon: ReceiptText, badged: true },
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
      {TAB_CONFIG.map(({ name, label, Icon, badged }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: label,
            tabBarAccessibilityLabel: label,
            tabBarButtonTestID: `tab-${name}`,
            tabBarIcon: ({ color, size }: TabIconProps) =>
              badged ? (
                // The badge is positioned absolutely against this wrapper, so
                // it rides the glyph without changing the tab bar's layout —
                // a badge that reflowed the bar would move every other tab
                // under a thumb already on its way down.
                <View>
                  <Icon color={color} size={size} />
                  <ReviewCountBadge />
                </View>
              ) : (
                <Icon color={color} size={size} />
              ),
          }}
        />
      ))}
    </Tabs>
  );
}
