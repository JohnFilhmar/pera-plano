// lib/entitlements.ts — the ONLY place in the app that knows about tiers
// (interface contract §7; docs/05-monetization.md §4). Gated call-sites ask a
// question here; nothing else hardcodes tier behavior.
//
// Gate principles (docs/05 §3.1), true of every function below:
//   1. Hitting a cap blocks creating a NEW record — it never deletes data.
//   2. Existing records keep working fully, including after a downgrade.
//   3. "History: 90 days" is a VISIBILITY window; nothing is ever purged by it.

export type Tier = "free" | "plus";

/** MVP ships everyone on Plus; turning enforcement on is a one-constant change. */
const MVP_TIER: Tier = "plus";

// Free-tier caps, straight from the canonical tier matrix (docs/05 §2).
const FREE_WALLET_CAP = 3;
const FREE_ACTIVE_LIMIT_CAP = 1;
const FREE_GOAL_CAP = 1;
const FREE_LOAN_CAP = 1;
const FREE_HISTORY_WINDOW_DAYS = 90;

let tierOverride: Tier | null = null;

/**
 * TEST SEAM ONLY — lets unit tests exercise both tiers without a billing stack.
 * App code never calls this; production always resolves MVP_TIER. Pass `null`
 * to restore the shipped tier.
 */
export function __setTierForTests(tier: Tier | null): void {
  tierOverride = tier;
}

export function getTier(): Tier {
  return tierOverride ?? MVP_TIER;
}

export function canCreateWallet(currentCount: number): boolean {
  return getTier() === "plus" || currentCount < FREE_WALLET_CAP;
}

export function canCreateLimit(activeCount: number): boolean {
  return getTier() === "plus" || activeCount < FREE_ACTIVE_LIMIT_CAP;
}

export function canCreateGoal(currentCount: number): boolean {
  return getTier() === "plus" || currentCount < FREE_GOAL_CAP;
}

export function canCreateLoan(currentCount: number): boolean {
  return getTier() === "plus" || currentCount < FREE_LOAN_CAP;
}

/** Days of ledger visible to the user; null = unlimited. Never a retention rule. */
export function historyWindowDays(): number | null {
  return getTier() === "plus" ? null : FREE_HISTORY_WINDOW_DAYS;
}

export function hasRecurringDetection(): boolean {
  return getTier() === "plus";
}

/**
 * Payday auto-allocation for Goals with a `contributionRule`
 * (docs/05-monetization.md §2's tier matrix: "Unlimited + payday auto-allocate").
 *
 * Free keeps the RULE and loses only the PROMPT — §3.2 is explicit: "payday
 * auto-allocation stops entirely (it is a Plus capability): `contributionRule`
 * settings are retained but no prompts fire and no planned contributions are
 * created." That is gate principle 1 again: a cap blocks a new action, it never
 * deletes what the user already configured, so a downgrade-then-upgrade returns
 * them to exactly the rules they had.
 *
 * Added by m2b Task 3, whose rule 5 requires the gate go through this file
 * rather than a `getTier() === "plus"` written at the call site.
 */
export function hasPaydayAutoAllocation(): boolean {
  return getTier() === "plus";
}

export function hasBackup(): boolean {
  return getTier() === "plus";
}

/**
 * Reports' trend view (docs/04-features/10-reports.md's states table: a Free
 * user who "opens Trends / custom range" gets a "Locked preview with Plus
 * prompt; no data shown", and docs/05-monetization.md §4's Reports row:
 * "Trends, custom ranges, and comparison views render as locked previews").
 *
 * ITS OWN FUNCTION for exactly the reason `hasCsvExport` below gives for
 * being one: trends and export are separate rows of the tier matrix
 * (docs/05-monetization.md §2) that only happen to coincide in MVP.
 *
 * The SCREEN asks this, not just `PlusGate`: the gate decides how to frame a
 * child, but only the call site can decide WHICH child — the real series, or
 * the sample frame that replaces it — and rule 5 of m2b Task 3 (see
 * `hasPaydayAutoAllocation` above) wants that question asked here rather than
 * as a `getTier() === "plus"` written into the screen.
 */
export function hasTrends(): boolean {
  return getTier() === "plus";
}

/**
 * Reports' CSV export (docs/04-features/10-reports.md Flow D: "CSV export is
 * Plus. Free users see the Export action disabled with the Plus prompt.").
 *
 * DELIBERATELY ITS OWN FUNCTION, not a reuse of `hasBackup`. Export and cloud
 * backup both happen to gate on bare `getTier() === "plus"` in MVP, but they
 * are unrelated capabilities in the tier matrix (docs/05-monetization.md §2)
 * that only coincide today — collapsing them into one check would make a
 * future split (or a MVP_TIER experiment that flips one but not the other)
 * require finding every accidental caller of the wrong name instead of
 * changing one function body.
 */
export function hasCsvExport(): boolean {
  return getTier() === "plus";
}

/** Safe-to-Spend end-of-period projection (Free sees today only). */
export function hasProjection(): boolean {
  return getTier() === "plus";
}

/**
 * Whether the assistant may run at an answer level. Levels 1 to 3 are free for
 * everyone; 4 and 5 are Plus (assistant levels spec §6). Takes a plain number so
 * this module, the only one that knows about tiers, depends on nothing in
 * `lib/ai`.
 *
 * @param level - An answer level, 1 to 5.
 * @returns True when the current tier may use that level.
 */
export function canUseAssistantLevel(level: number): boolean {
  return level <= 3 || getTier() === "plus";
}
