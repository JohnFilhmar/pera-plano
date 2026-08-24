// components/settings/theme_picker.tsx — the Appearance row on the Settings
// screen (M3b Task 5; brief rule 4: "changing the theme applies immediately
// without a restart").
//
// READS AND WRITES `useTheme()` DIRECTLY — NOT `app_settings_repo`, and NOT
// `hooks/mutations/use_set_setting.ts`. `AppSettings` deliberately declares
// no `theme_preference` key at all (see that file's own doc) — this
// preference lives ONLY in AsyncStorage, owned end to end by
// `contexts/theme_context.tsx` (key "peraplano.theme_preference", proven by
// contexts/__tests__/theme_context.
// test.tsx) and already applies it immediately. NOT synchronously inside
// `setPreference` itself, though — that function only calls
// `setPreferenceState` and `AsyncStorage.setItem`. `nativewindColorScheme.set`
// runs from a SEPARATE `useEffect` keyed on `[preference]`, which fires after
// React commits the state update and this component (and every `dark:`
// consumer) has already re-rendered once on the new `preference` value — not
// before. The net effect is still "applies without a restart", which is all
// brief rule 4 requires; it is simply two steps, not one. Routing the SAME
// preference through `app_settings` as well would be a second persistence
// path for one value — two stores that can disagree about which theme is
// active, for zero benefit. This component's whole job is exposing the
// CHOICE `useTheme()` already knows how to keep, not re-implementing how it
// is kept.
import { Pressable, Text, View } from "react-native";

import { useTheme, type ThemePreference } from "@/contexts/theme_context";

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemePicker() {
  const { preference, setPreference } = useTheme();

  return (
    <View testID="theme-picker" className="flex-row gap-2">
      {OPTIONS.map((option) => {
        const selected = option.value === preference;
        return (
          <Pressable
            key={option.value}
            testID={`theme-picker-${option.value}`}
            onPress={() => setPreference(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            className={`flex-1 items-center rounded-xl px-3 py-2 ${
              selected ? "bg-brand dark:bg-brand-dark" : "bg-bg dark:bg-bg-dark"
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                selected
                  ? "text-surface dark:text-surface-dark"
                  : "text-fg-2 dark:text-fg-2-dark"
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
