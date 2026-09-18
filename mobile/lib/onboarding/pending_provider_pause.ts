// lib/onboarding/pending_provider_pause.ts — the hand-off that lets
// app/(onboarding)/providers.tsx keep a record of the provider filter it just
// pushed, on a screen that has no database to write one to (GAP-116).
//
// WHY A HAND-OFF RATHER THAN A `setSetting` CALL ON THAT SCREEN. The provider
// step is one of the three pre-flow onboarding screens, rendered by
// app/lock.tsx's "needs_onboarding" branch — ABOVE the unlock gate.
// `unlockDatabase()` is called only from contexts/lock_context.tsx's unlock
// paths, which run after `keysProvisioned()` has moved the lock to "locked",
// so on that screen `getDatabase()` still rejects with `DatabaseLockedError`
// (the same reason providers.tsx's own `loadBundle()` falls back to the
// bundled seed) and the `app_settings` table does not exist yet either, since
// the migrations run inside the `bootstrapApp()` that unlock has not fired. A
// `setSetting("paused_provider_packages", ...)` there could do nothing but
// throw.
//
// WHAT IS HELD IS ALREADY THE SETTING'S SHAPE — the PAUSED packages, exactly
// what hooks/mutations/use_set_provider_pause.ts writes — so
// `persistOnboardingProviderPause()` in lib/bootstrap.ts is one `setSetting`
// with no arithmetic of its own. The inversion happens here, next to the rule
// that makes it dangerous, and nothing downstream gets a second idea of what
// the allowlist meant.
//
// THE SCREEN CAN NOW PERSIST IT ITSELF, AND USUALLY DOES (GAP-091). The step
// moved into the numbered flow, where the database IS open, so
// `persistPendingProviderPause()` below runs on the screen and the row lands in
// the same session the user chose in -- which is what the Privacy centre reads
// back, and it would otherwise have shown stale switches until the next launch,
// since `bootstrapApp()` has already run by then. The hand-off through this
// module is kept rather than replaced: it is still what survives a write that
// fails, and `bootstrapApp()` still drains it on the next launch.
//
// IN MEMORY, NOT IN AsyncStorage. The only durable store available before the
// database opens is the plaintext one contexts/theme_context.tsx uses, and
// which banks a user chose is precisely the kind of fact this app keeps inside
// SQLCipher. What that costs is a process death between the provider step and
// the first unlock — and that selection is unrecoverable either way, because
// app/(onboarding)/index.tsx does not re-run the provider step for an install
// that already has keys.

import { setSetting } from "@/lib/db/repos/app_settings_repo";

let pending: string[] | null = null;

/**
 * Records what the provider step just pushed, as the paused list the launch
 * re-sync reads.
 *
 * INVERTS AGAINST THE RULESET UNIVERSE, because the setting is the complement
 * of what that screen holds: it has an ALLOWLIST, `paused_provider_packages`
 * holds what is BLOCKED. `universe` must be the same "every package the
 * installed ruleset knows about" that `resyncProviderFilter()` in
 * lib/bootstrap.ts and the switch rows in app/(tabs)/more/privacy.tsx build
 * their arithmetic from — a package the listener observed but the ruleset has
 * never heard of is deliberately NOT recorded as paused, because the re-sync
 * narrows to that universe anyway and the Privacy switch list would have no
 * row to un-pause it from.
 *
 * ONBOARDING CANNOT EXPRESS A DENY-ALL AT ALL, and both guards below exist
 * because the inversion can manufacture one out of a user who asked for the
 * opposite. `resyncProviderFilter()` reads a non-empty row whose remainder is
 * empty as "every provider is paused" and pushes `setProviderFilter([], true)`,
 * so anything recorded here that covers the whole universe silently stops
 * capture at the next launch.
 *
 *   1. AN EMPTY ALLOWLIST RECORDS NOTHING PAUSED. `[]` from that screen means
 *      ALLOW EVERY PACKAGE — "the user tapped Skip" and "the user ticked
 *      nothing" both write `setProviderFilter([], false)`, see its header — so
 *      the naive `universe - []` would record EVERY provider as paused and
 *      hand every user who skipped the step a listener that captures nothing.
 *
 *   2. A SELECTION THAT KEEPS NOTHING THE RULESET KNOWS ABOUT RECORDS NOTHING
 *      EITHER. The catalogue is `listObservedPackages()` UNION the ruleset, so
 *      a user whose only bank is a package the ruleset has never heard of ticks
 *      one tile and leaves every known package unticked. Inverted, that is the
 *      entire universe paused — indistinguishable from "pause everything" to
 *      the re-sync, and the exact opposite of what they asked for. The re-sync
 *      builds its allowlist from the ruleset universe alone and therefore
 *      cannot express "allow only this unknown package" (pre-existing, and
 *      documented in `resyncProviderFilter`); what it must not do is turn that
 *      into a block. Not recording leaves the bridge holding the allowlist the
 *      screen just pushed, or allow-all if that push failed — degraded but
 *      still capturing, which is the same trade that screen's `.catch` makes.
 *
 * Both are the reasoning `resyncProviderFilter`'s own "a ruleset that names no
 * packages is still skipped" already applies: two different states compute the
 * same empty remainder, only one of them is a deny-all, and the length of the
 * computed list can never tell them apart.
 */
export function recordOnboardingProviderPause(allowlist: string[], universe: string[]): void {
  pending = null;
  if (allowlist.length === 0) return;

  const allowed = new Set(allowlist);
  const paused = universe.filter((packageName) => !allowed.has(packageName));
  // Nothing to narrow: the user allowed everything the ruleset knows about.
  if (paused.length === 0) return;
  // Guard 2 above — no known package survived, so this cannot be recorded
  // without becoming a deny-all.
  if (paused.length === universe.length) return;

  pending = paused;
}

/** What `lib/bootstrap.ts` has still to persist, or `null` when there is nothing. */
export function pendingOnboardingProviderPause(): string[] | null {
  return pending;
}

/**
 * Moves the record into `paused_provider_packages`, if there is one.
 *
 * TWO CALLERS, ONE BODY. `app/(onboarding)/providers.tsx` calls it as the user
 * leaves the step, and `bootstrapApp()` calls it on every launch. The second is
 * not redundant: it is what recovers a selection whose first write failed, and
 * it is the only caller that can run at all when the step was reached before
 * the database was open.
 *
 * FAILURES ARE SWALLOWED, and the record is dropped only once the write has
 * actually resolved: a pass that could not store the selection leaves it for
 * the next one rather than losing it to the very failure this hand-off exists
 * for. Clearing at all is what keeps a later pass from re-writing a stale
 * onboarding choice over a pause the user has since changed in the Privacy
 * centre.
 */
export async function persistPendingProviderPause(): Promise<void> {
  const paused = pendingOnboardingProviderPause();
  if (paused === null) return;
  try {
    await setSetting("paused_provider_packages", paused);
    clearOnboardingProviderPause();
  } catch (error) {
    console.error(
      "the onboarding provider selection could not be recorded; it stays pending for the next launch",
      error,
    );
  }
}

/**
 * Drops the record, once it is actually in `app_settings`.
 *
 * SEPARATE FROM THE READ ON PURPOSE. A read that cleared as it returned would
 * lose the selection to the one failure this whole hand-off exists for — a
 * swallowed write — and clearing at all is what stops a second
 * `bootstrapApp()` in the same process (a re-lock, then a re-unlock) from
 * re-writing a stale onboarding choice over a pause the user has since changed
 * in the Privacy centre.
 */
export function clearOnboardingProviderPause(): void {
  pending = null;
}
