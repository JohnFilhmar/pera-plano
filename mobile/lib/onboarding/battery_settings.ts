// lib/onboarding/battery_settings.ts — the battery-exemption system intent and
// the one helper that fires it.
//
// EXTRACTED FROM app/(onboarding)/battery.tsx (GAP-018), unchanged, because a
// second caller now exists: app/(tabs)/more/permissions.tsx, the way back for
// a user who skipped the onboarding step. Two screens hardcoding the same
// intent string is how one of them silently stops resolving after a rename —
// the intent name is not type-checked, and a wrong one fails as "nothing
// happened", not as an error.
//
// LIVES UNDER lib/onboarding/ RATHER THAN lib/permissions/, next to
// onboarding_state.ts: the onboarding step is still the primary caller and
// still the only place the exemption is explained (BatteryExplainer,
// OemGuidance). The Settings screen is the recovery route for that step, not a
// separate feature with its own home.
import { Linking } from "react-native";

/**
 * `Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` — the app-list
 * screen where the user finds PeraPlano and sets it to "Not optimized"/
 * "Allow". Deliberately NOT `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
 * (the direct per-app system dialog): that one needs the
 * `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` manifest permission declared and
 * justified at Play review, the same category of cost this app already
 * avoided once for `QUERY_ALL_PACKAGES` (docs/04-features/01-onboarding.md
 * open question 2). The list screen needs no new permission at all.
 */
export const BATTERY_SETTINGS_INTENT = "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS";

/**
 * Best-effort, and it cannot be anything else. Some OEM builds do not resolve
 * this intent at all, and there is nothing to recover from when that happens
 * — no second screen to try, and no way to read the exemption back afterwards
 * either (app/(onboarding)/battery.tsx's header explains why the outcome is
 * unverifiable). Callers get no result for the same reason: there is none
 * worth acting on.
 */
export function openBatterySettings(): void {
  Linking.sendIntent(BATTERY_SETTINGS_INTENT).catch(() => {
    // Swallowed on purpose — see this function's own doc.
  });
}
