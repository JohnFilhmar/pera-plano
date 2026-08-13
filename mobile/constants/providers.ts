// constants/providers.ts — human names for the providers the parser ruleset
// knows by lowercase key.
//
// WHY THIS EXISTS. The ruleset (lib/ingest/ruleset_types.ts) carries
// `providerKey` and `packageNames` and nothing a user should ever read: the
// keys are routing identifiers ("gcash", "sms_relay") and the packages are
// android ids ("com.globe.gcash.android"). A matcher chip has to say
// "Catches: GCash", so the display half of that mapping lives here — the one
// place, so a second screen cannot invent "Gcash".
//
// The list is docs/11-mobile-app-design-prompt.md's provider picker, verbatim,
// and matches the thirteen providers in assets/parser_rules/seed.json. It is
// NOT authoritative over the ruleset: the ruleset is remote-updatable and can
// ship a provider this file has never heard of, which is why every lookup
// below degrades to something readable rather than to a blank chip.
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";

export const PROVIDER_LABELS: Record<string, string> = {
  gcash: "GCash",
  maya: "Maya",
  bpi: "BPI",
  bdo: "BDO",
  unionbank: "UnionBank",
  metrobank: "Metrobank",
  seabank: "SeaBank",
  gotyme: "GoTyme",
  cimb: "CIMB",
  landbank: "Landbank",
  shopeepay: "ShopeePay",
  grabpay: "GrabPay",
  sms_relay: "Bank SMS",
};

/**
 * The name to show for a provider key. m1c Task 5's matcher picker.
 *
 * Falls back to the KEY, never to an empty string: the ruleset is
 * remotely-updatable and can ship a provider this file has never heard of, and
 * a picker row with no label is a row the user cannot choose deliberately.
 * "seabank" is worse than "SeaBank" and better than blank.
 */
export function providerLabel(providerKey: string): string {
  return PROVIDER_LABELS[providerKey] ?? providerKey;
}

/**
 * The name to show for a matcher's android package.
 *
 * Falls back twice, never to an empty string: an unlabelled key shows the key,
 * and a package no installed ruleset claims shows the package itself. A blank
 * chip reading "Catches:" would tell the user their wallet catches nothing,
 * which is the opposite of what a stale label means.
 */
export function providerLabelForPackage(
  providers: readonly ProviderRuleset[],
  packageName: string,
): string {
  const provider = providers.find((candidate) => candidate.packageNames.includes(packageName));
  if (!provider) return packageName;
  return providerLabel(provider.providerKey);
}
