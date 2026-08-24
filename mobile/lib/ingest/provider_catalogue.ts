// lib/ingest/provider_catalogue.ts — merges what the device has actually seen
// with what the parser seed guesses, into the one ordered list the onboarding
// provider picker renders (provider-selection plan Task 4).
//
// WHY THIS EXISTS RATHER THAN JUST RENDERING THE SEED. NOT ONE of the fifteen
// package names in assets/parser_rules/seed.json has been checked against a
// device or a Play listing — seed_rules.ts's own header says so outright.
// Seven are transparently constructed from app names (com.bpi.ng.app,
// com.bdo.digitalbanking, com.metrobank.mobilebanking and four more), but the
// remaining eight are merely unflagged, not verified, and the count is fifteen
// rather than thirteen because sms_relay carries three.
// A wrong package name is a SILENT failure: that provider is never
// routed, captures nothing, logs nothing, and looks to the user exactly like
// their bank simply does not work. The listener already receives
// `sbn.packageName` for every notification on the device (Task 3), so the app
// can learn the real names with no new Android permission — and this function
// is where the learned names take precedence over the guesses.
//
// PURE, AND DELIBERATELY SO. No native call, no database, no clock. The
// grouping, ordering, dedupe and naming rules are all decided here and tested
// directly against this function (lib/ingest/__tests__/provider_catalogue.test.ts),
// which leaves the picker's own suite free to cover interaction rather than
// set algebra.
//
// `ObservedPackage` is imported as a TYPE ONLY. The value side of
// @/modules/notification_listener calls requireNativeModule at module load, so
// a value import here would drag the native bridge into every consumer of this
// file — including a pure-function test suite that has no business mocking it.
import type { ObservedPackage } from "@/modules/notification_listener";
import type { RulesetBundle } from "@/lib/ingest/ruleset_types";

/**
 * One tappable row in the picker — exactly one Android package, never a
 * provider's whole package list.
 *
 * `seen` and `suggested` are independent facts, not a two-value enum, because
 * the interesting case is BOTH: an app the device has actually observed that
 * the seed also knows a name for. That row belongs in the observed group (the
 * package name is real, read off the device) while still carrying the seed's
 * human-recognisable label.
 */
export type ProviderChoice = {
  /** The real Android package name — what `setProviderFilter` is keyed on. */
  packageName: string;
  /**
   * The seed's `providerKey` when this package is in the catalogue, otherwise
   * the raw package name. An observed app the seed has never heard of still
   * renders, under whatever Android calls it — that is the entire point of
   * learning package names, and blanking or dropping it would hide exactly the
   * banks whose seeded name is wrong.
   */
  displayName: string;
  /** Observed on THIS device by the listener. */
  seen: boolean;
  /** Present in the parser seed / installed ruleset. */
  suggested: boolean;
};

/** Blank names cannot be filtered on and would render as an unlabelled row. */
function isUsablePackageName(packageName: string): boolean {
  return packageName.trim().length > 0;
}

/**
 * The picker's list: everything the device has observed, in the order the
 * listener reported it, followed by every catalogue package it has not.
 *
 * ORDERING. Observed entries keep `listObservedPackages()`'s own newest-first
 * ordering — recency is the only ranking the app has evidence for, and the
 * first screenful is what most people will ever read. Suggestions keep the
 * catalogue's order. Neither is re-sorted.
 *
 * DEDUPE (plan Task 4 rule 4). A package that is both observed and seeded is
 * emitted ONCE, in the observed group, with `suggested: true`. Concatenating
 * the two lists instead renders GCash twice on any phone that has it, and the
 * second row's tap toggles a different entry than the one the user is looking
 * at. The same guard collapses a package that two catalogue providers both
 * claim, and a package the listener reported twice.
 */
export function buildProviderChoices(
  observed: ObservedPackage[],
  bundle: RulesetBundle,
): ProviderChoice[] {
  // packageName -> providerKey, in catalogue order. First provider to claim a
  // package wins its label: arbitrary, but deterministic, where "last wins"
  // would make the rendered name depend on an ordering the server can change.
  const catalogue = new Map<string, string>();
  for (const provider of bundle.providers) {
    for (const packageName of provider.packageNames) {
      if (isUsablePackageName(packageName) && !catalogue.has(packageName)) {
        catalogue.set(packageName, provider.providerKey);
      }
    }
  }

  const choices: ProviderChoice[] = [];
  const emitted = new Set<string>();

  for (const entry of observed) {
    if (!isUsablePackageName(entry.packageName) || emitted.has(entry.packageName)) continue;
    emitted.add(entry.packageName);
    const providerKey = catalogue.get(entry.packageName);
    choices.push({
      packageName: entry.packageName,
      displayName: providerKey ?? entry.packageName,
      seen: true,
      suggested: providerKey !== undefined,
    });
  }

  for (const [packageName, providerKey] of catalogue) {
    if (emitted.has(packageName)) continue;
    emitted.add(packageName);
    choices.push({ packageName, displayName: providerKey, seen: false, suggested: true });
  }

  return choices;
}
