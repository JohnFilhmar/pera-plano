// lib/income/income_service.ts — the IncomeProfile's monthly-equivalent income.
//
// ⚠ PLACEHOLDER, CREATED BY m2 TASK 8. The real implementation belongs to
// m2-part2 Task 11, which reads the `income_profiles` row and normalises the
// user's cadence (kinsenas, weekly, monthly, irregular) to a monthly figure per
// docs/04-features/04-income.md. Fill in the body there; do not add a second
// module for it.
//
// IT EXISTS NOW, RETURNING `null`, BECAUSE THE ALTERNATIVE WAS WORSE. Limits
// need this figure (`baseFor`, limits rule 10), and the m2 plan's own
// instruction is to inline a `const getMonthlyEquivalentIncome = async () =>
// null` stub inside each consuming hook and remember to delete every copy
// later. One file at the real path means Task 11 changes a body instead of
// hunting call sites, and a `grep` for the symbol finds the truth rather than
// several stubs.
//
// `null` IS THE SAFE PLACEHOLDER, NOT MERELY THE CONVENIENT ONE. `baseFor` maps
// it to "Paused — income unknown" (rule 12), so a percent-of-income limit
// renders as paused — which is precisely what it is while the app cannot read
// the user's income. Returning 0 instead would give every such limit a base of
// ₱0.00 and report every peso as a breach, which is the silent zero rule 12
// forbids. Limits on a fixed basis are unaffected either way.
import type { Centavos } from "@/types/domain";

/**
 * Monthly-equivalent income **M**, or `null` when no usable IncomeProfile
 * exists (rule 12: either `isManualOverride`, or detection confirmed with a
 * non-zero `averageAmount`).
 */
export async function getMonthlyEquivalentIncome(): Promise<Centavos | null> {
  return null;
}
