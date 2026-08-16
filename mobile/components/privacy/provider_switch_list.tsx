// components/privacy/provider_switch_list.tsx — per-provider pause switches
// (m3b Task 6 rule 2; docs §04-features/11-settings-privacy.md Flow B).
//
// ONE ROW PER PROVIDER, NOT PER ANDROID PACKAGE. `sms_relay` alone carries
// three package names (constants/providers.ts), and a user thinks "turn off
// my bank SMS", never "turn off com.google.android.apps.messaging
// specifically". Toggling a row pauses or resumes every package that
// provider owns together — see `ProviderSwitchItem.packageNames` below.
//
// PRESENTATIONAL. `items` and `onToggle` arrive already resolved by
// app/(tabs)/more/privacy.tsx from hooks/queries/use_ruleset.ts and
// hooks/queries/use_capture_settings.ts's `usePausedProviderPackages`. This
// file never imports a repository or the native module — see
// capture_toggle.tsx's header for why that split holds across this whole
// screen.
import { Switch, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";

export type ProviderSwitchItem = {
  providerKey: string;
  displayName: string;
  /** Every Android package this provider owns — sms_relay carries three. */
  packageNames: string[];
  paused: boolean;
};

export type ProviderSwitchListProps = {
  items: ProviderSwitchItem[];
  onToggle: (item: ProviderSwitchItem, paused: boolean) => void;
  busyProviderKey?: string | null;
  testID?: string;
};

export function ProviderSwitchList({
  items,
  onToggle,
  busyProviderKey = null,
  testID = "provider-switch-list",
}: ProviderSwitchListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        testID="provider-switch-list-empty"
        title="No providers yet"
        body="Providers appear here once the installed ruleset knows about them."
      />
    );
  }

  return (
    <Card testID={testID}>
      <View className="gap-3">
        {items.map((item) => (
          <View key={item.providerKey} className="flex-row items-center justify-between gap-3">
            <View className="flex-1 gap-0.5">
              <Text className="text-base text-fg dark:text-fg-dark">{item.displayName}</Text>
              {item.paused ? (
                <Text
                  testID={`provider-switch-paused-${item.providerKey}`}
                  className="text-xs text-fg-2 dark:text-fg-2-dark"
                >
                  Paused
                </Text>
              ) : null}
            </View>
            <Switch
              testID={`provider-switch-${item.providerKey}`}
              value={!item.paused}
              onValueChange={(value) => onToggle(item, !value)}
              disabled={busyProviderKey === item.providerKey}
              accessibilityRole="switch"
              accessibilityLabel={item.displayName}
              accessibilityState={{
                checked: !item.paused,
                disabled: busyProviderKey === item.providerKey,
              }}
            />
          </View>
        ))}
      </View>
    </Card>
  );
}
