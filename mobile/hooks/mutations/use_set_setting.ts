// hooks/mutations/use_set_setting.ts — the Settings screen's single write
// path (M3b Task 5; app/(tabs)/more/settings.tsx).
//
// GENERIC OVER THE KEY, deliberately, so one hook covers every row on the
// screen (telemetry, the recurring-forget multiplier, and any setting a
// later task adds) instead of one hand-written mutation per key — the same
// shape `getSetting`/`setSetting` already chose in `app_settings_repo.ts`.
// A caller pins `K` at the call site (`useSetSetting<"telemetry_enabled">()`),
// which is what keeps `value` narrowed to that key's own type instead of
// widening to `AppSettings[keyof AppSettings]`.
//
// THEME DOES NOT GO THROUGH HERE, AND `AppSettings` HAS NO `theme_preference`
// KEY TO ROUTE THROUGH EVEN IF IT DID. `useTheme().setPreference` already
// persists (AsyncStorage) and applies (nativewind) in one call — a second key
// here would only be a second, independently-timed persistence path for the
// same preference. See `components/settings/theme_picker.tsx` and
// `app_settings_repo.ts`'s own doc.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { setSetting, type AppSettings } from "@/lib/db/repos/app_settings_repo";

import { invalidateKeys } from "./invalidate_keys";

export function useSetSetting<K extends keyof AppSettings>() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { key: K; value: AppSettings[K] }>({
    mutationFn: ({ key, value }) => setSetting(key, value),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.settings.all]),
  });
}
