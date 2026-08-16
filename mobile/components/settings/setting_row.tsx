// components/settings/setting_row.tsx — the repeating unit of the Settings
// screen (M3b Task 5).
//
// EACH ROW IS ITS OWN `Card`, not a divided list inside one shared card. The
// app has no border/divider token — `constants/colors.ts` names only the
// contract-§2 semantic pairs plus the chart-only ramp, nothing a horizontal
// rule could use without inventing a colour outside that file, which the
// release-gate grep for hex colours exists to catch. Spacing between Cards is
// how every other multi-row screen in the app already separates rows
// (app/(tabs)/more/index.tsx, app/(tabs)/plan/index.tsx) — this follows suit
// rather than introducing a new divider style Settings alone would own.
//
// SLOTS, NOT VARIANTS — same reasoning as `components/ui/list_row.tsx`: every
// setting differs only in its title/subtitle text and what control sits on
// the right (a `Switch`, a stepper, anything else a later row needs), never
// in the row's own layout.
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Card } from "@/components/ui/card";

export type SettingRowProps = {
  title: string;
  subtitle?: string;
  control: ReactNode;
  testID?: string;
};

export function SettingRow({ title, subtitle, control, testID }: SettingRowProps) {
  return (
    <Card testID={testID}>
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text className="text-base font-semibold text-fg dark:text-fg-dark">{title}</Text>
          {subtitle ? (
            <Text className="mt-1 text-sm text-fg-2 dark:text-fg-2-dark">{subtitle}</Text>
          ) : null}
        </View>
        <View>{control}</View>
      </View>
    </Card>
  );
}
