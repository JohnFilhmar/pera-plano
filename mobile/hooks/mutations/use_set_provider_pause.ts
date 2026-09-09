// hooks/mutations/use_set_provider_pause.ts — the Privacy centre's
// per-provider switches (m3b Task 6 rule 2; docs
// §04-features/11-settings-privacy.md Flow B).
//
// "Per-provider switches call setProviderFilter with the enabled package
// list. Turning a provider off must stop captures from it immediately, not
// at the next launch." `setProviderFilter` is an ALLOWLIST: an empty array
// means "allow every package" (the fresh-install default), a non-empty array
// means "ONLY these packages". Pausing one provider therefore does not mean
// "send its packages"; it means "send everyone ELSE's packages" — the
// allowlist has to be computed from the FULL known package universe minus
// whatever is currently paused, every time.
//
// AND WHEN THAT SUBTRACTION LEAVES NOTHING, THE ALLOWLIST CANNOT SAY SO. That
// is the second argument, `denyAll` (GAP-103): pausing EVERY provider computes
// `[]`, which the native side reads as allow-all, so the most restrictive
// action in the Privacy centre used to produce the least restrictive outcome.
// It is a separate signal rather than a call to `setCaptureEnabled(false)`
// because the master pause and the provider switches are two independent
// controls, and neither may silently move the other.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { setProviderFilter } from "@/modules/notification_listener";

import { invalidateKeys } from "./invalidate_keys";

export type SetProviderPauseVariables = {
  /** Every package name belonging to the provider being toggled. */
  packageNames: string[];
  /** `true` to pause this provider, `false` to resume it. */
  paused: boolean;
  /**
   * Every package name across every provider the installed ruleset knows about.
   *
   * MUST NOT BE EMPTY while anything is paused. With no universe to subtract
   * from, "everyone else" has no members, and this mutation reads a paused set
   * with nothing left over as deny-all. `app/(tabs)/more/privacy.tsx` builds
   * this from the same rows the switch being toggled belongs to, so it always
   * carries at least that provider's packages — which is why there is no guard
   * here, unlike `resyncProviderFilter()` in `lib/bootstrap.ts`, where the
   * ruleset genuinely can be missing at launch.
   */
  allPackageNames: string[];
};

/**
 * NATIVE FIRST, SETTINGS SECOND — the same ordering `use_set_capture_enabled.ts`
 * uses, and for the identical reason: `paused_provider_packages` is the ONLY
 * readable record of which providers are paused (the native module exposes a
 * setter but no getter — see `AppSettings.paused_provider_packages`'s own
 * doc), so a settings write with no matching native write would tell the
 * switch list a provider is paused that is, in fact, still capturing.
 *
 * NO EMPTY-ALLOWLIST TRAP, IN EITHER DIRECTION, and there are two of them.
 *
 * When the resulting paused set is empty, the native call is
 * `setProviderFilter([], false)` — genuine allow-all — rather than an explicit
 * list of every package this ruleset currently knows about. Passing the full
 * list instead would silently block any package the listener learns about
 * AFTER this write (a provider the user has not touched a switch for yet),
 * which is the exact inverted-default failure `app/(onboarding)/providers.tsx`
 * already documents for the identical choice at onboarding time.
 *
 * When every known package is paused, the remaining allowlist is ALSO empty —
 * and that empty means the opposite. It is sent as `setProviderFilter([],
 * true)`, the explicit deny-all, because `[]` on its own would hand the user
 * who just blocked everything an unrestricted listener. The two cases are told
 * apart by whether anything is paused at all, never by the length of the
 * computed list, which is `0` in both.
 */
export function useSetProviderPause() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      packageNames,
      paused,
      allPackageNames,
    }: SetProviderPauseVariables): Promise<string[]> => {
      const current = await getSetting("paused_provider_packages");
      const pausedSet = new Set(current);
      for (const packageName of packageNames) {
        if (paused) {
          pausedSet.add(packageName);
        } else {
          pausedSet.delete(packageName);
        }
      }

      const nextPaused = [...pausedSet];
      const remaining = allPackageNames.filter((packageName) => !pausedSet.has(packageName));
      // Nothing paused is allow-all, so the allowlist is cleared rather than
      // filled with the whole universe. Something paused with nothing left
      // over is deny-all, which no allowlist value can express.
      const allowed = nextPaused.length === 0 ? [] : remaining;
      const denyAll = nextPaused.length > 0 && remaining.length === 0;

      await setProviderFilter(allowed, denyAll);
      await setSetting("paused_provider_packages", nextPaused);
      return nextPaused;
    },
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.settings.pausedProviderPackages()]),
  });
}
