// hooks/queries/use_listener_health.ts — M3 Part 2 Task 4, rule 5.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { getListenerHealth } from "@/modules/notification_listener";

export type TrackingHealth = {
  /** The listener's own facts. */
  granted: boolean;
  serviceConnected: boolean;
  lastCaptureAt: number | null;
  /** Waiting in the buffer, and thrown away by its cap (GAP-051). */
  pendingCaptures: number;
  evictedCaptures: number;
  /** The user's own switch — distinct from a fault (spec: paused vs interrupted). */
  captureEnabled: boolean;
};

/**
 * Whether capture is actually working, and whether the user meant it to be.
 *
 * TWO SOURCES, DELIBERATELY. `getListenerHealth` is a live native read of
 * whether the service is connected; `capture_enabled` is the user's own pause
 * switch. Conflating them would show a fault banner to someone who paused on
 * purpose, and a reassuring "paused" pill to someone whose listener has
 * silently died — which is the failure rule 5 exists to prevent.
 *
 * `retry: false` because a native bridge that throws will throw again; retrying
 * delays the banner that says tracking is broken.
 */
export function useListenerHealth() {
  return useQuery<TrackingHealth>({
    queryKey: queryKeys.listenerHealth.current(),
    retry: false,
    queryFn: async () => {
      const [health, captureEnabled] = await Promise.all([
        getListenerHealth(),
        getSetting("capture_enabled"),
      ]);
      return { ...health, captureEnabled };
    },
  });
}
