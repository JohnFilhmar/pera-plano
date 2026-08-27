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
import { providerLabel } from "@/constants/providers";

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
   * The ruleset's routing identifier for this package ("gcash", "sms_relay"),
   * or `null` for an observed app no provider claims.
   *
   * A ROUTING KEY, NEVER SHOWN TO A USER — that is `displayName` below. This
   * field is what a caller passes to `providerBadge`, matches against
   * `ruleset.providers`, or dedupes a provider's several packages on.
   *
   * `null` IS A REAL STATE, not a missing value to paper over: an app the
   * catalogue has never heard of is exactly what the observed list exists to
   * surface, and a caller that needs a non-null key (proposing a Wallet, say)
   * must decide for itself what to do about it rather than be handed a raw
   * package id dressed up as a provider key. That was the old shape's bug —
   * see `displayName`.
   */
  providerKey: string | null;
  /**
   * The name Android itself shows for this package on THIS phone, from
   * `getAppLabels`, or `null` when it was never resolved — the app is not
   * installed, or the labels were never fetched.
   *
   * Kept as its own field rather than folded silently into `displayName` so a
   * caller can tell "this is the real, current name off the device" from
   * "this is our best guess". Set by `applyAppLabels`, never by
   * `buildProviderChoices`, which is pure and cannot reach the bridge.
   */
  appLabel: string | null;
  /**
   * What to PRINT for this choice. Always non-empty, and always something a
   * person can read.
   *
   * Resolved best-available-first: the device's own app label, then the
   * curated brand name for the provider key, then the raw package id. Every
   * step down that chain is a step further from what the user's launcher
   * actually says.
   *
   * THIS USED TO BE THE PROVIDER KEY, and callers relied on that — a tile
   * rendered the literal string "seabank", and `wallets.tsx` matched it
   * against `ruleset.providers[].providerKey`. Both jobs are now split out
   * (`providerKey` above), because one field cannot be both a stable routing
   * identifier and a name that tracks a company's rebrand: `ph.seabank.seabank`
   * routes as "seabank" forever and is called Maribank today.
   */
  displayName: string;
  /** Observed on THIS device by the listener. */
  seen: boolean;
  /** Present in the parser seed / installed ruleset. */
  suggested: boolean;
};

/**
 * The printable name for a choice, given everything currently known about it
 * — the one place the fallback chain is written down.
 *
 * THE DEVICE LABEL WINS OUTRIGHT, including over a curated `PROVIDER_LABELS`
 * entry. That is the whole point: the curated names are hand-written and go
 * stale on a rebrand, while the label is read off the app on the user's phone
 * seconds before it is rendered. Preferring the curated name "for consistency"
 * would reintroduce the exact bug — showing "SeaBank" beside an icon that
 * says Maribank, on the one screen whose job is to have the user recognise
 * their own banking app.
 *
 * The rule is uniform, deliberately, including for `sms_relay`: the picker
 * asks which APPS to listen to, so "Messages" (what the launcher says) beats
 * "Bank SMS" (what we wish it said), and the package line under the tile is
 * what tells the Google and Samsung ones apart.
 */
function resolveDisplayName(
  providerKey: string | null,
  appLabel: string | null,
  packageName: string,
): string {
  if (appLabel !== null && appLabel.trim() !== "") return appLabel.trim();
  if (providerKey !== null) return providerLabel(providerKey);
  return packageName;
}

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
    const providerKey = catalogue.get(entry.packageName) ?? null;
    choices.push({
      packageName: entry.packageName,
      providerKey,
      appLabel: null,
      displayName: resolveDisplayName(providerKey, null, entry.packageName),
      seen: true,
      suggested: providerKey !== null,
    });
  }

  for (const [packageName, providerKey] of catalogue) {
    if (emitted.has(packageName)) continue;
    emitted.add(packageName);
    choices.push({
      packageName,
      providerKey,
      appLabel: null,
      displayName: resolveDisplayName(providerKey, null, packageName),
      seen: false,
      suggested: true,
    });
  }

  return choices;
}

/**
 * Re-labels choices with the real app names `getAppLabels` read off the
 * device, leaving everything else about them untouched.
 *
 * A SECOND PURE PASS RATHER THAN A PARAMETER ON `buildProviderChoices`,
 * because the two steps cannot happen at the same time: the native call needs
 * the package list, and the package list is what `buildProviderChoices`
 * produces. Threading a labels argument through would force the caller to
 * build the list, fetch, then build it a second time — running the dedupe and
 * ordering rules twice for one answer.
 *
 * TOTAL AND ORDER-PRESERVING. Every input choice comes out, in the same
 * position: `getAppLabels` is partial by contract (an app the user has not
 * installed simply has no entry), so a choice with no label keeps the name it
 * already had. Dropping unlabelled entries would delete the whole
 * "Common in the Philippines" group, which is by definition apps this phone
 * does not have.
 *
 * A blank or whitespace-only label is treated as no label at all. The native
 * side already refuses to emit one, and this is the second guard on the same
 * rule: a blank `displayName` renders as an unlabelled, untappable-looking
 * tile, which is worse than the stale name it replaced.
 */
export function applyAppLabels(
  choices: readonly ProviderChoice[],
  labels: Readonly<Record<string, string>>,
): ProviderChoice[] {
  return choices.map((choice) => {
    const label = labels[choice.packageName];
    if (label === undefined || label.trim() === "") return choice;

    const appLabel = label.trim();
    return {
      ...choice,
      appLabel,
      displayName: resolveDisplayName(choice.providerKey, appLabel, choice.packageName),
    };
  });
}
