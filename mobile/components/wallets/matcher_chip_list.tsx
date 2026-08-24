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
//
// RESTYLED mobile-ui-revamp Part 2 Task 5b: `fill="outline"` (the design
// board's rounded, `bg-chip`-on-`border-line` pill), rendered inline in the
// wallet detail screen's matchers Card beside a dashed "+ Add" affordance.
//
// TWO THINGS THE BOARD DRAWS THAT THIS FILE DELIBERATELY DOES NOT REPRODUCE.
// The board's chips carry a monospaced label and a trailing "×" glyph.
// Neither made it in:
//   - `Chip`'s label Text hardcodes `font-semibold` (via chip.tsx's own
//     `text-micro font-semibold` base), and this codebase's Tailwind config
//     (tailwind.config.ts) redefines `.font-semibold` to select a REGISTERED
//     FONT FAMILY (`Inter_600SemiBold`) rather than setting `fontWeight` —
//     `corePlugins: { fontWeight: false }`. Layering `font-mono` (which also
//     sets `fontFamily`, to Tailwind's default `ui-monospace` stack) on top
//     of that is an untested combination with no existing precedent: every
//     other `font-mono` call site in this app (review_card.tsx,
//     why_recorded_panel.tsx, transaction/[id].tsx) pairs it with NO weight
//     class, specifically avoiding two utilities racing to set the same
//     property. `Chip` is not in this task's file list, so it was not
//     extended to resolve that — see the wallet detail screen's own comments
//     for the fuller reasoning.
//   - The label text here is pinned byte-for-byte by
//     components/wallets/__tests__/wallet_card.test.tsx ("Catches: GCash",
//     "Catches: GCash · GSave", "Catches: com.unknown.app"), a file outside
//     this task's list. Folding a "×" into it would break those pins; adding
//     it as a second Text node is not possible through `Chip`'s single label
//     slot without the same out-of-scope change as the mono label. The chips
//     stay exactly what this file's own title says: labels, not controls —
//     removal still lives behind "Edit", on the matcher picker.
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
        return (
          <Chip key={matcher.id} testID={`matcher-chip-${matcher.id}`} label={label} fill="outline" />
        );
      })}
    </View>
  );
}
