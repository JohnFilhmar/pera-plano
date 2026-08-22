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
 * Android package → provider key, for the packages shipped in
 * assets/parser_rules/seed.json.
 *
 * A FALLBACK, NOT AN AUTHORITY. The installed ruleset is what actually routes a
 * capture and it is remote-updatable (docs/03 §11.1: a wrong package name is
 * corrected without an app release), so it always wins below. This table exists
 * for the window where the ruleset has not answered — a cold React Query cache,
 * an install whose ruleset write failed — because during that window the only
 * other answer is the raw package id.
 *
 * On a matcher chip that would merely be ugly. On m1c Task 7's "Why was this
 * recorded?" panel it is a broken promise: the panel exists to tell the user
 * which app was read, and "com.globe.gcash.android" does not tell them that.
 */
const PACKAGE_PROVIDER_KEYS: Record<string, string> = {
  "com.globe.gcash.android": "gcash",
  "com.paymaya": "maya",
  "com.bpi.ng.app": "bpi",
  "com.bdo.digitalbanking": "bdo",
  "com.unionbank.ecommerce.mobile.android": "unionbank",
  "com.metrobank.mobilebanking": "metrobank",
  "com.seabank.ph": "seabank",
  "com.gotyme.bank": "gotyme",
  "com.cimbbank.ph": "cimb",
  "com.lbp.mobilebanking": "landbank",
  "com.shopee.ph": "shopeepay",
  "com.grabtaxi.passenger": "grabpay",
  "com.google.android.apps.messaging": "sms_relay",
  "com.samsung.android.messaging": "sms_relay",
};

/**
 * The name to show for a matcher's android package.
 *
 * Falls back three times, never to an empty string: the installed ruleset
 * first, then the shipped package table above, then the package itself. A blank
 * chip reading "Catches:" would tell the user their wallet catches nothing,
 * which is the opposite of what a stale label means.
 */
export function providerLabelForPackage(
  providers: readonly ProviderRuleset[],
  packageName: string,
): string {
  const provider = providers.find((candidate) => candidate.packageNames.includes(packageName));
  if (provider) return providerLabel(provider.providerKey);

  const knownKey = PACKAGE_PROVIDER_KEYS[packageName];
  return knownKey ? providerLabel(knownKey) : packageName;
}

/**
 * Colour + initial per provider, for the 14dp rounded square the design draws
 * beside every wallet row and every provider-picker tile (00 Component sheet's
 * "GCash" chip; 04 Wallets' list).
 *
 * COLOURED INITIALS, NOT LOGOS, ON PURPOSE. No provider artwork is bundled
 * with the app. A letter on a brand-adjacent colour is recognisable at 14dp,
 * costs nothing to ship, and creates no trademark surface — which matters for
 * an app that names thirteen banks and e-wallets it has no relationship with.
 *
 * These colours are for identification only. None of them may be used as a
 * status: they are not in `palette` for exactly that reason.
 */
export const PROVIDER_BADGE: Record<string, { color: string; letter: string }> = {
  gcash: { color: "#0038A8", letter: "G" },
  maya: { color: "#12B76A", letter: "M" },
  bpi: { color: "#B32017", letter: "B" },
  bdo: { color: "#0B2B63", letter: "B" },
  unionbank: { color: "#E36C0A", letter: "U" },
  metrobank: { color: "#0A3D91", letter: "M" },
  seabank: { color: "#F4511E", letter: "S" },
  gotyme: { color: "#00B5AD", letter: "G" },
  cimb: { color: "#A6192E", letter: "C" },
  landbank: { color: "#00713C", letter: "L" },
  shopeepay: { color: "#EE4D2D", letter: "S" },
  grabpay: { color: "#00B14F", letter: "G" },
  sms_relay: { color: "#5B6E64", letter: "S" },
};

const UNKNOWN_PROVIDER_COLOR = "#5B6E64";

/**
 * Badge for a provider key, falling back the same way `providerLabel` does:
 * the ruleset is remote-updatable and can name a provider this file has never
 * heard of. A grey square with the key's own initial is worse than the real
 * badge and much better than a blank square.
 */
export function providerBadge(providerKey: string): { color: string; letter: string } {
  const known = PROVIDER_BADGE[providerKey];
  if (known !== undefined) return known;
  const initial = providerKey.trim().charAt(0).toUpperCase();
  return { color: UNKNOWN_PROVIDER_COLOR, letter: initial === "" ? "?" : initial };
}
