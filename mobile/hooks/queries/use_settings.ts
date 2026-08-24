// hooks/queries/use_settings.ts — the Settings screen's single read (M3b
// Task 5; app/(tabs)/more/settings.tsx).
//
// ONE QUERY, THE WHOLE STORE. `app_settings` is a handful of independent
// key/value rows one screen renders together (telemetry, the
// recurring-forget multiplier, and any future row) — a `getAllSettings()`
// read is simpler than a query per key and gives every row on the screen the
// same staleness, and `queryKeys.settings` deliberately has no `list()`
// sibling to key a narrower read on (constants/query_keys.ts: "settings —
// all key only"). A screen that needs one key on its own already exists
// (`use_listener_health.ts`) and calls `getSetting` directly rather than
// depending on this hook.
//
// Theme is NOT read through here. `contexts/theme_context.tsx` persists and
// resolves the theme preference itself (AsyncStorage, not `app_settings`) —
// see `components/settings/theme_picker.tsx` for why the Settings screen
// reads and writes theme via `useTheme()` instead of this hook.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { getAllSettings } from "@/lib/db/repos/app_settings_repo";

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: () => getAllSettings(),
  });
}
