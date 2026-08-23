// components/home/greeting_header.tsx — the two-line header above the Home hero.
//
// "Beta User" IS A FIXED STRING, AND DELIBERATELY SO. The app has no account,
// no third-party auth, and no name field — everything lives on the phone. The
// design draws a personal greeting; this is the version of it that does not
// require collecting anything. It also reads as a tag rather than a
// placeholder, which is the point: early testers keep it.
//
// Nothing behind it is persisted. No install date, no cohort id. That work is
// deferred to Google account linking (revamp spec §6.3), and an install date
// cannot be reconstructed retroactively, so do not add a "member since" line
// here on the assumption that the data exists.
import { Text, View } from "react-native";

import { BrandMark } from "@/components/ui/brand_mark";

export const BETA_USER_LABEL = "Beta User";

export type GreetingHeaderProps = {
  periodLabel: string;
  testID?: string;
};

export function GreetingHeader({ periodLabel, testID }: GreetingHeaderProps) {
  return (
    <View testID={testID} className="flex-row items-center gap-3">
      <BrandMark size={36} />
      <View className="flex-1">
        <Text numberOfLines={1} className="text-section font-bold text-fg dark:text-fg-dark">
          {`Kumusta, ${BETA_USER_LABEL}`}
        </Text>
        <Text numberOfLines={1} className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
          {periodLabel}
        </Text>
      </View>
    </View>
  );
}
