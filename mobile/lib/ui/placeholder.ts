// lib/ui/placeholder.ts — the one colour every `TextInput` placeholder in the
// app is painted with.
//
// WHY THIS EXISTS. Not one `TextInput` in this codebase passed
// `placeholderTextColor`, so every placeholder fell back to React Native's
// default — and on Android that default is resolved from the SYSTEM theme, not
// from the app's. A phone in system dark mode running the app in light mode
// painted "Meralco" in the dark theme's near-white hint colour on a light
// `bg-chip` field: the placeholder was effectively invisible, which is exactly
// the state a placeholder exists to avoid. The mirror case (system light, app
// dark) is the same bug with the colours swapped.
//
// The fix has to be a resolved colour value rather than a `className`: RN gives
// placeholder ink its own prop, and nothing in `className` reaches it.
//
// `fg-2` is the token, matching every "secondary text" label the forms already
// render next to these fields. It clears WCAG AA against both field fills the
// app uses — `chip` (#EDF3EE light / #18231E dark) and `surface` — so the hint
// is legible in either theme rather than merely present.
import { useColorScheme } from "nativewind";

import { palette } from "@/constants/colors";

/**
 * Reads NativeWind's resolved scheme rather than `useTheme()`
 * (contexts/theme_context.tsx) for the same reason `components/ui/chip.tsx`
 * does: `useTheme` throws outside a mounted `ThemeProvider`, and these fields
 * are rendered by component tests and by sheets that mount with no provider
 * above them. theme_context.tsx drives `colorScheme.set()` from the stored
 * preference, so this hook reads the value `useTheme` itself feeds.
 */
export function usePlaceholderColor(): string {
  const { colorScheme } = useColorScheme();
  return colorScheme === "dark" ? palette["fg-2-dark"] : palette["fg-2"];
}
