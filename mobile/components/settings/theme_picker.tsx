// components/settings/theme_picker.tsx — the Appearance row on the Settings
// screen (M3b Task 5; brief rule 4: "changing the theme applies immediately
// without a restart").
//
// READS AND WRITES `useTheme()` DIRECTLY — NOT `app_settings_repo`, and NOT
// `hooks/mutations/use_set_setting.ts`, even though `AppSettings` happens to
// declare a `theme_preference` key. `contexts/theme_context.tsx` already
// owns persistence for this preference (AsyncStorage, key
// "peraplano.theme_preference", proven by contexts/__tests__/theme_context.
// test.tsx) and already applies it immediately (`nativewindColorScheme.set`
// runs synchronously inside `setPreference`, before this component re-renders
// at all). Writing the SAME preference through `setSetting("theme_preference",
// …)` as well would be a second persistence path for one value — two stores
// that can disagree about which theme is active, for zero benefit, since
// nothing else in the app reads `app_settings.theme_preference`. This
// component's whole job is exposing the CHOICE `useTheme()` already knows how
// to keep, not re-implementing how it is kept.
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
