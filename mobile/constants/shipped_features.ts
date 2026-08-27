// constants/shipped_features.ts — the single per-build phased-rollout switch
// (docs/superpowers/plans/2026-08-02-mobile-foundation-part2.md Task 15;
// behavior per docs/11-mobile-app-design-prompt.md "TWO GATING STATES", state
// 1, "Soon"). M1 ships the ledger, Wallets, and Review Queue only — none of
// which this map gates — so every key below starts "soon". Flipping a key to
// "shipped" is the ONLY change a later plan makes to this file; no key is ever
// flipped back. See the Task 15 plan's rollout table for which plan flips
// which key.
//
// As of m3b Task 8 every key the Task 15 rollout table named was "shipped" —
// that table's last row. `SoonGate` and `ShipState`'s "soon" branch stayed in
// the codebase on the strength of one argument: a future feature could still
// land ahead of its own rollout. The mobile UI revamp Part 3 Task 3 is that
// future feature — `shared_budgets` below is the first key added AFTER the
// rollout table closed, seeded "soon" on arrival rather than flipped by it,
// and it is what gives `SoonGate` a live user again.

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
  | "parser_diagnostics"
  | "shared_budgets"
  | "problem_reports";

export type ShipState = "shipped" | "soon";

export const SHIPPED_FEATURES: Readonly<Record<FeatureKey, ShipState>> = {
  // Flipped by m2-part2 Task 14. M2 Tasks 1-8 built Limits and Tasks 9-13
  // built Income; the foundation plan's rollout table (Part 2, Task 15)
  // assigns BOTH keys to this plan and to no other. They ship together
  // because a percent-of-income Limit is not usable until income is known.
  limits: "shipped",
  income: "shipped",
  // Flipped by m2b Task 9. Tasks 1-4 built Goals and Tasks 5-8 built Loans;
  // the foundation plan's rollout table assigns both keys to this plan and to
  // no other.
  goals: "shipped",
  loans: "shipped",
  // Flipped by m2c Task 6, the last of the M2 control features. The Plan tab
  // now has no Soon items at all; every key still "soon" below belongs to M3.
  bills: "shipped",
  // Flipped by M3 Part 2 Task 7. Task 4 built the Home hero and Task 6 built
  // recurring-pattern detection; the foundation plan's rollout table assigns
  // both keys to this plan and to no other. Neither key gates anything with a
  // SoonGate in practice — Home's hero and the Subscriptions row are gated by
  // `PlusGate` (a tier paywall) instead — but the rollout table still tracks
  // them so this map stays the single source of truth for "is this plan out".
  safe_to_spend: "shipped",
  recurring: "shipped",
  // Flipped by m3b Task 8, the last plan in the rollout table. Reports (m3b
  // Task 3), the CSV export capability (Task 4), the Privacy centre (Task 6)
  // and Listener health / Parser diagnostics (Task 7) were all built ahead of
  // this flip; Task 8 is only the switch plus the More-hub wiring those four
  // screens needed once SoonGate stopped blocking their rows. Every
  // FeatureKey the Task 15 rollout table named was "shipped" as of this flip
  // — that table itself had nothing left to give a future plan to flip.
  reports: "shipped",
  csv_export: "shipped",
  privacy_center: "shipped",
  listener_health: "shipped",
  parser_diagnostics: "shipped",
  // The first key added after the rollout table closed. Every other key here
  // was flipped to "shipped" by a plan that had built the thing behind it;
  // this one is seeded "soon" and stays that way until shared budgets exists.
  // It also gives SoonGate a live user again — before this, the gate could not
  // close for any key, which made it read as dead machinery.
  shared_budgets: "soon",
  // Seeded "shipped" on arrival, unlike `shared_budgets` above: the offline
  // problem-report screen, its outbox and its retry loop all land in the same
  // change as this key, so there is no window in which the row would promise a
  // destination that is not there. The key exists at all so the row keeps the
  // same gate-wrapped shape as every other row on the More hub — a later
  // decision to hide reporting (a build for a closed pilot, say) is then one
  // word here rather than a deleted row.
  problem_reports: "shipped",
};

export function isShipped(key: FeatureKey): boolean {
  return SHIPPED_FEATURES[key] === "shipped";
}

export function useShippedFeature(key: FeatureKey): ShipState {
  return SHIPPED_FEATURES[key];
}
