// hooks/queries/use_ruleset.ts — m1c plan Task 4.
//
// The installed parser ruleset, which the UI reads for exactly two things:
//
//   `tunables.balanceDriftToleranceCentavos` — how far a reported balance may
//   sit from the computed one before the wallet enters the drift attention
//   state. It lives in ruleset data, and is read from here rather than inlined
//   as ₱1.00, BECAUSE THE SPEC ADMITS IT DOES NOT KNOW THE VALUE:
//   docs/04-features/02-wallets.md §14 open question 1 says the threshold
//   "needs tuning against real parser accuracy data during M1". A badge whose
//   threshold cannot be retuned remotely is a badge that stays wrong until an
//   app release.
//
//   `providers` — the package-name → provider-key catalogue behind a matcher
//   chip's human label (constants/providers.ts).
//
// Thin, like every hook here: one key, one repository call. `null` means no
// ruleset is installed (or every stored row is corrupt) — bootstrapApp() seeds
// the bundled one on every launch, so on a device this is a first-run frame,
// not a steady state. Consumers treat it as "threshold unknown" and show
// nothing rather than guessing.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { getActiveRuleset } from "@/lib/db/repos/parser_rulesets_repo";

export function useRuleset() {
  return useQuery({
    queryKey: queryKeys.ruleset.active(),
    queryFn: () => getActiveRuleset(),
  });
}
