// components/wallets/matcher_picker.tsx — m1c plan Task 5, rules 1 and 2.
//
// "Which apps' notifications belong in this wallet?" — the only place in the app
// where a user tells the Ingest pipeline where money lands.
//
// TWO RULES SHAPE EVERY LINE BELOW.
//
//   ONE PROVIDER MAY FEED TWO WALLETS. GCash main and GSave post from the same
//   android package, so provider identity alone cannot separate them. A matcher
//   is therefore a PROVIDER PLUS AN OPTIONAL HINT, and the hint field is the
//   whole reason this is a picker rather than a list of checkboxes.
//
//   A PAIR BELONGS TO EXACTLY ONE WALLET. Assigning a pair already held
//   elsewhere MOVES it. `setMatchers` guarantees the move; this component
//   guarantees the user was told. Silence there is the worst outcome available:
//   the pair moves anyway, the other wallet quietly stops catching anything, and
//   nothing on any screen says why. (Letting BOTH keep it would be worse still —
//   `resolveWallet` refuses two claimants, so every capture from that provider
//   would hard-route to the Review Queue forever.)
//
// PRESENTATIONAL. Providers, the current selection and the owners list all
// arrive as props; the routes own the reads (Global Constraints: no repository
// import inside a component).
//
// NO DISCRIMINATOR PHRASES ARE HARDCODED. The hint is free text with an
// illustrative placeholder, per the spec's own acceptance criterion: "Any
// sub-account discriminator phrases shown in matcher setup are sourced from the
// parser corpus at runtime and marked illustrative". A built-in list of magic
// words would be this doc's illustration masquerading as data.
import { Text, TextInput, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list_row";
import { providerLabel } from "@/constants/providers";
import {
  matchersForProvider,
  ownerOfPair,
  selectedHintByProvider,
} from "@/lib/wallets/matchers";
import type { MatcherOwner } from "@/lib/wallets/matchers";
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { NewWalletMatcher } from "@/types/domain";

export type MatcherPickerProps = {
  /** The installed ruleset's provider catalogue. Empty renders nothing. */
  providers: readonly ProviderRuleset[];
  value: readonly NewWalletMatcher[];
  onChange: (matchers: NewWalletMatcher[]) => void;
  /** Every matcher on the device, so a claimed pair can be named. */
  owners?: readonly MatcherOwner[];
  /** The wallet being edited; its own rows are never a conflict with itself. */
  walletId?: string;
  testID?: string;
};

export function MatcherPicker({
  providers,
  value,
  onChange,
  owners = [],
  walletId,
  testID = "matcher-picker",
}: MatcherPickerProps) {
  const selection = selectedHintByProvider(providers, value);

  /**
   * Rows whose package no installed provider claims — a matcher left behind by
   * a ruleset that has since dropped the provider.
   *
   * CARRIED THROUGH EVERY EDIT, never rebuilt away. The picker cannot render a
   * provider it has never heard of, and regenerating the set from only what it
   * CAN render would delete the row on the next save: a wallet silently losing a
   * route the user never touched, on a screen that showed no sign of it.
   */
  const unclaimed = value.filter(
    (matcher) => !providers.some((provider) => provider.packageNames.includes(matcher.packageName)),
  );

  function emit(next: Map<string, string>): void {
    const matchers: NewWalletMatcher[] = [...unclaimed];
    for (const provider of providers) {
      const hint = next.get(provider.providerKey);
      if (hint === undefined) continue;
      matchers.push(...matchersForProvider(provider, hint));
    }
    onChange(matchers);
  }

  function toggle(providerKey: string): void {
    const next = new Map(selection);
    if (next.has(providerKey)) next.delete(providerKey);
    else next.set(providerKey, "");
    emit(next);
  }

  function setHint(providerKey: string, hint: string): void {
    const next = new Map(selection);
    next.set(providerKey, hint);
    emit(next);
  }

  if (providers.length === 0) return null;

  return (
    <View testID={testID} className="gap-1">
      <Text className="px-4 text-sm text-fg-2 dark:text-fg-2-dark">
        Pick the apps whose notifications belong in this wallet. If one app holds two accounts —
        like GCash and GSave — put the second one in its own wallet and type a word its
        notifications use, so we can tell them apart.
      </Text>

      {providers.map((provider) => {
        const hint = selection.get(provider.providerKey);
        const selected = hint !== undefined;
        const owner = selected ? ownerOfPair(owners, provider, hint, walletId) : null;

        return (
          <View key={provider.providerKey}>
            <ListRow
              testID={`matcher-provider-${provider.providerKey}`}
              title={providerLabel(provider.providerKey)}
              onPress={() => toggle(provider.providerKey)}
              right={
                selected ? (
                  <Chip label="Catching" tone="brand" />
                ) : (
                  <Chip label="Not catching" tone="neutral" />
                )
              }
            />
            {selected ? (
              <View className="gap-1 px-4 pb-3">
                <TextInput
                  testID={`matcher-hint-${provider.providerKey}`}
                  value={hint}
                  onChangeText={(text) => setHint(provider.providerKey, text)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  // Illustrative only — see the file header. The real phrases
                  // come from what this device has actually captured.
                  placeholder="Sub-account word, e.g. GSave (optional)"
                  accessibilityLabel={`Sub-account word for ${providerLabel(provider.providerKey)}`}
                  className="rounded-lg border border-fg-2 px-3 py-2 text-fg dark:border-fg-2-dark dark:text-fg-dark"
                />
                {owner ? (
                  <Text
                    testID={`matcher-conflict-${provider.providerKey}`}
                    className="text-sm text-warn dark:text-warn-dark"
                  >
                    {`${owner.walletName} already catches this. Saving will move it to this wallet — ${owner.walletName} will stop catching it.`}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
