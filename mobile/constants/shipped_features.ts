// constants/shipped_features.ts — the single per-build phased-rollout switch
// (docs/superpowers/plans/2026-08-02-mobile-foundation-part2.md Task 15;
// behavior per docs/11-mobile-app-design-prompt.md "TWO GATING STATES", state
// 1, "Soon"). M1 ships the ledger, Wallets, and Review Queue only — none of
// which this map gates — so every key below starts "soon". Flipping a key to
// "shipped" is the ONLY change a later plan makes to this file; no key is ever
// flipped back. See the Task 15 plan's rollout table for which plan flips
// which key.

export type FeatureKey =
  | "limits"
  | "income"
  | "goals"
  | "loans"
  | "bills"
  | "safe_to_spend"
  | "recurring"
  | "reports"
  | "csv_export"
  | "privacy_center"
  | "listener_health"
  | "parser_diagnostics";

export type ShipState = "shipped" | "soon";

export const SHIPPED_FEATURES: Readonly<Record<FeatureKey, ShipState>> = {
  // Flipped by m2-part2 Task 14. M2 Tasks 1-8 built Limits and Tasks 9-13
  // built Income; the foundation plan's rollout table (Part 2, Task 15)
  // assigns BOTH keys to this plan and to no other. They ship together
  // because a percent-of-income Limit is not usable until income is known.
  limits: "shipped",
  income: "shipped",
  goals: "soon",
  loans: "soon",
  bills: "soon",
  safe_to_spend: "soon",
  recurring: "soon",
  reports: "soon",
  csv_export: "soon",
  privacy_center: "soon",
  listener_health: "soon",
  parser_diagnostics: "soon",
};

export function isShipped(key: FeatureKey): boolean {
  return SHIPPED_FEATURES[key] === "shipped";
}

export function useShippedFeature(key: FeatureKey): ShipState {
  return SHIPPED_FEATURES[key];
}
