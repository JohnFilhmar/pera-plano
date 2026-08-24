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
  /** Every package name across every provider the installed ruleset knows about. */
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
 * NO EMPTY-ALLOWLIST TRAP. When the resulting paused set is empty, the
 * native call is `setProviderFilter([])` — genuine allow-all — rather than
 * an explicit list of every package this ruleset currently knows about.
 * Passing the full list instead would silently block any package the
 * listener learns about AFTER this write (a provider the user has not
 * touched a switch for yet), which is the exact inverted-default failure
 * `app/(onboarding)/providers.tsx` already documents for the identical
 * choice at onboarding time.
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
      const allowed = nextPaused.length === 0
        ? []
        : allPackageNames.filter((packageName) => !pausedSet.has(packageName));

      await setProviderFilter(allowed);
      await setSetting("paused_provider_packages", nextPaused);
      return nextPaused;
    },
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.settings.pausedProviderPackages()]),
  });
}
