// lib/privacy/provider_scope.ts — does the capture scope the app RECORDED
// match the one the listener is actually applying (GAP-119)?
//
// WHY THE QUESTION NEEDS ASKING AT ALL. `paused_provider_packages` is the only
// readable record of which providers the user paused, and
// `app/(tabs)/more/privacy.tsx` draws its provider switches straight from it —
// as though it were what the listener holds. It is not: it is what the app
// ASKED for. `setProviderFilter` rejects on a device that could not seal the
// allowlist (GAP-114), and `resyncProviderFilter` in lib/bootstrap.ts pushes
// the row back down on every launch precisely because that gap can open. Until
// GAP-116 the failed selection was lost outright; now it survives and heals at
// the next launch, which leaves exactly one window unaccounted for — between
// the failed write and that launch, capture is wider than what the switches
// show and nothing says so.
//
// A COMPARISON, NOT A STORED FLAG. The alternative was persisting "the last
// push did not land" and clearing it on the next success. That is a second
// source of truth about the filter, which nobody verifies against the filter —
// the exact defect class GAP-114 and GAP-116 were about, one level up. This
// derives the answer from the two values that already exist, so it cannot
// drift and needs nothing cleared.
//
// EVERY BRANCH BELOW EXISTS TO STOP A WARNING THAT NEVER CLEARS, which would
// be worse than the silence it replaces: a permanent banner on the privacy
// screen trains the reader to ignore the one that means something. There are
// four such traps and each is named at its guard.
import type { ProviderFilter } from "@/modules/notification_listener";

/**
 * `unknown` is a real answer and the DEFAULT one, not a failure: it means the
 * app has made no checkable claim about the scope, so nothing may be said
 * either way. `not_in_force` is the only state that warns.
 */
export type ProviderScopeState = "unknown" | "in_force" | "not_in_force";

export type ProviderScopeInput = {
  /**
   * Every package name across every provider the installed ruleset knows
   * about — the same universe `resyncProviderFilter` subtracts from and the
   * same one the Privacy switch rows are built from. Neither may invent its own
   * idea of what "every package" means, or this comparison measures the
   * difference between two arithmetics instead of the difference between intent
   * and effect.
   */
  universe: readonly string[];
  /** `paused_provider_packages`, verbatim. */
  paused: readonly string[];
  /** What `getProviderFilter()` just read off the device. */
  actual: ProviderFilter;
};

/**
 * Compares the scope implied by (`universe` − `paused`) against the scope the
 * listener actually holds, using the identical arithmetic
 * `resyncProviderFilter()` uses to build the push — so "in force" means
 * literally "the next launch's re-assert would be a no-op".
 *
 * TRAP 1, AN EMPTY PAUSE ROW IS NOT A CLAIM. It is the fresh-install default,
 * and it is also what `recordOnboardingProviderPause` leaves for a user who
 * allowed everything or tapped Skip. `resyncProviderFilter` deliberately
 * pushes NOTHING for it, because "allow all" and "we have no idea yet" compute
 * the same empty row and only one of them is an instruction. Reading it as
 * "the filter was never applied" would show the warning to every clean install
 * forever, since no launch can ever make an unasserted row agree with anything.
 *
 * TRAP 2, A RULESET THAT NAMES NO PACKAGES IS NOT A CLAIM EITHER. With no
 * universe there is no "everyone else" to allow, so the expected allowlist is
 * empty for a reason that has nothing to do with the user's choices — the same
 * case `resyncProviderFilter` skips rather than pushing a deny-all it would be
 * inventing. A launch cannot fix it, so a warning about it would never clear.
 *
 * TRAP 3, A LANDED DENY-ALL IS IN FORCE EVEN WITH A STALE ALLOWLIST BESIDE IT.
 * `CapturePrefs.setProviderFilter` writes the plaintext deny-all flag and
 * reports SUCCESS when it could not seal the accompanying list (its own doc
 * argues why, and GAP-103 is why the flag exists at all), leaving whatever list
 * was there before. That list is unreachable for as long as the flag stands —
 * `shouldCapture` returns false before ever opening it — so comparing it would
 * report a mismatch on a device that is applying exactly what was asked, and
 * every relaunch would fail the same way, which is a banner that never clears.
 * The flag is checked FIRST and the list is not consulted at all when it wins.
 *
 * TRAP 4, THE RULESET UNIVERSE CANNOT EXPRESS EVERY FILTER, and that is
 * pre-existing. A selection at onboarding may allow a package the ruleset has
 * never heard of; the re-sync builds from the ruleset alone and therefore
 * narrows it away. That IS a real disagreement while it lasts and is reported
 * as one — but it is reported because a successful launch RESOLVES it, by
 * pushing the very allowlist this function computes. Convergence is the
 * property that matters: for any fixed `universe` and `paused`, a successful
 * push makes this return `in_force`, so no state here is warned about forever
 * unless the device genuinely cannot apply what the user asked for.
 */
export function compareProviderScope({
  universe,
  paused,
  actual,
}: ProviderScopeInput): ProviderScopeState {
  if (paused.length === 0) return "unknown";
  if (universe.length === 0) return "unknown";

  const pausedSet = new Set(paused);
  const expected = new Set(universe.filter((packageName) => !pausedSet.has(packageName)));

  // Something paused with nothing left over is the deny-all, which no
  // allowlist value can spell — the same reading `resyncProviderFilter` and
  // `use_set_provider_pause` both give it. Trap 3 is why the held list is not
  // looked at on either side of this branch.
  if (expected.size === 0) return actual.denyAll ? "in_force" : "not_in_force";
  if (actual.denyAll) return "not_in_force";

  const held = new Set(actual.packageNames);
  if (held.size !== expected.size) return "not_in_force";
  for (const packageName of expected) {
    if (!held.has(packageName)) return "not_in_force";
  }
  return "in_force";
}
