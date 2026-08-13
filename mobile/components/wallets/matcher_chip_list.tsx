// components/wallets/matcher_chip_list.tsx — m1c plan Task 4, rule 4.
//
// "Catches: GCash" — the plain-English answer to "why do this wallet's
// transactions appear by themselves?". A matcher row stores an android package
// name and an optional content hint; neither is something a user should read,
// so the package is resolved to a provider name through the installed ruleset
// (constants/providers.ts).
//
// THE HINT IS SHOWN, not hidden. One provider can feed two wallets — GCash main
// vs GSave is the canonical case (docs/04-features/02-wallets.md §matcher
// management) — and two chips both reading "Catches: GCash" on two different
// wallets would look like a bug in the app rather than like the deliberate
// split the user set up.
//
// LABELS, NOT CONTROLS. Editing matchers is Task 5's picker; a tappable chip
// here would promise an action that does not exist yet.
import { View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { providerLabelForPackage } from "@/constants/providers";
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type { WalletMatcher } from "@/types/domain";

export type MatcherChipListProps = {
  matchers: readonly WalletMatcher[];
  /** The installed ruleset's provider catalogue; empty until it loads. */
  providers: readonly ProviderRuleset[];
  testID?: string;
};

export function MatcherChipList({ matchers, providers, testID }: MatcherChipListProps) {
  // No matchers means no section at all, rather than an empty heading. A cash
  // wallet has none by rule 4 and never will.
  if (matchers.length === 0) return null;

  return (
    <View testID={testID} className="flex-row flex-wrap gap-2">
      {matchers.map((matcher) => {
        const provider = providerLabelForPackage(providers, matcher.packageName);
        const label = matcher.hint ? `Catches: ${provider} · ${matcher.hint}` : `Catches: ${provider}`;
        return <Chip key={matcher.id} testID={`matcher-chip-${matcher.id}`} label={label} />;
      })}
    </View>
  );
}
