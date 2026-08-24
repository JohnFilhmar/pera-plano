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
import { ListRow } from "@/components/ui/list_row";

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
      <View>
        {items.map((item, index) => (
          // A `ListRow` per provider, matching every other toggle row in the
          // Privacy centre (task-4 brief step 2) — but the "Paused" indicator
          // stays a SIBLING `Text` with its own testID rather than going
          // through `ListRow`'s `subtitle` (a plain string with no testID
          // slot of its own). `provider-switch-paused-${key}` is asserted
          // directly in app/__tests__/privacy_screen.test.tsx; folding it
          // into `subtitle` would still show the word "Paused" on screen but
          // make that exact row unqueryable by testID.
          <View
            key={item.providerKey}
            className={index === 0 ? "" : "border-t border-line dark:border-line-dark"}
          >
            <ListRow
              title={item.displayName}
              right={
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
              }
            />
            {item.paused ? (
              // fix-round-1, Minor: this Text's spacing depends on two
              // numbers it does not own. `px-4` matches `ListRow`'s own
              // horizontal inset (components/ui/list_row.tsx) so "Paused"
              // lines up under the title rather than the row's outer edge,
              // and `-mt-2` (-8px) only partially cancels that same row's
              // `py-3` (12px) bottom padding, leaving the small gap this was
              // tuned by eye to have — not a full cancel, and not derived
              // from either constant in code. Correct today; if `ListRow`'s
              // own padding ever changes, this drifts and nobody here would
              // notice.
              <Text
                testID={`provider-switch-paused-${item.providerKey}`}
                className="-mt-2 px-4 pb-2 text-xs text-fg-2 dark:text-fg-2-dark"
              >
                Paused
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </Card>
  );
}
