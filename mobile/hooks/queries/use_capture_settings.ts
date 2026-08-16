// hooks/queries/use_capture_settings.ts — the two `app_settings` reads the
// Privacy centre's tracking controls need (m3b Task 6 rules 1-2).
//
// TWO HOOKS, ONE FILE — the same bundling `hooks/queries/use_raw_capture.ts`
// uses for its own pair of closely-related single-setting reads.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { getSetting } from "@/lib/db/repos/app_settings_repo";

/**
 * The master capture pause. THE SAME SETTING `use_listener_health.ts`'s
 * `useListenerHealth` and the Home tracking banner already read — this hook
 * exists only so the Privacy centre's toggle does not have to pull in the
 * full listener-health query (which also touches the native module) just to
 * show whether capture is on. Both read the identical `capture_enabled` row,
 * so they can never disagree about its value.
 */
export function useCaptureEnabled() {
  return useQuery({
    queryKey: queryKeys.settings.captureEnabled(),
    queryFn: () => getSetting("capture_enabled"),
  });
}

/**
 * The per-provider pause list — package names currently excluded from
 * capture, per `AppSettings.paused_provider_packages`'s own doc
 * (lib/db/repos/app_settings_repo.ts) for why this is the readable
 * complement to the native `setProviderFilter` write-only surface.
 */
export function usePausedProviderPackages() {
  return useQuery({
    queryKey: queryKeys.settings.pausedProviderPackages(),
    queryFn: () => getSetting("paused_provider_packages"),
  });
}
