// hooks/mutations/use_set_capture_enabled.ts — the Privacy centre's master
// pause switch (m3b Task 6 rule 1; interface note 2 from the task brief).
//
// "Master pause calls setCaptureEnabled(false) on the native module AND
// persists capture_enabled in settings, so the state survives a reinstall of
// the JS layer." This is the ONLY writer of `capture_enabled` this task adds
// — the Home tab's tracking banner (app/(tabs)/index.tsx) already writes the
// setting directly on resume, but this hook is what the capture toggle
// itself drives, and it is the one that also touches the native switch.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { setSetting } from "@/lib/db/repos/app_settings_repo";
import { setCaptureEnabled } from "@/modules/notification_listener";

import { invalidateKeys } from "./invalidate_keys";

/**
 * NATIVE FIRST, SETTINGS SECOND — deliberately, and not interchangeable.
 * `capture_enabled` in `app_settings` is what `useListenerHealth` and the
 * Home tracking banner read to decide whether to show the paused pill; the
 * native call is what actually stops the listener from reading anything.
 * If the native call rejected and this wrote the setting anyway, the app
 * would report itself paused on every screen while the listener kept
 * capturing underneath it — the exact "second switch that disagrees with
 * reality" the task brief warns against, except now it disagrees in the
 * more dangerous direction (claims LESS capture than is actually happening).
 * Writing the setting only after the native call resolves means a failure
 * here leaves the toggle exactly where it was, with nothing recorded that
 * the native side never actually honoured.
 */
export function useSetCaptureEnabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (enabled: boolean): Promise<boolean> => {
      await setCaptureEnabled(enabled);
      await setSetting("capture_enabled", enabled);
      return enabled;
    },
    onSuccess: () =>
      invalidateKeys(queryClient, [queryKeys.settings.captureEnabled(), queryKeys.listenerHealth.all]),
  });
}
