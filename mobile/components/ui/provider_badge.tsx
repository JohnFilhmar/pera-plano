// components/ui/provider_badge.tsx — the 14dp identity square the design puts
// beside every wallet row, matcher chip and provider tile.
//
// The colour comes from `constants/providers.ts` rather than `palette`,
// because a provider colour identifies a company and never signals a state.
// Keeping it out of the token file is what stops someone painting a warning
// GCash-blue six months from now.
import { Text, View } from "react-native";

import { providerBadge, providerLabel } from "@/constants/providers";

export type ProviderBadgeProps = {
  providerKey: string;
  size?: number;
  testID?: string;
};

export function ProviderBadge({ providerKey, size = 14, testID }: ProviderBadgeProps) {
  const { color, letter } = providerBadge(providerKey);

  return (
    <View
      testID={testID}
      accessibilityLabel={providerLabel(providerKey)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 2.8),
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        testID={testID === undefined ? undefined : `${testID}-letter`}
        allowFontScaling={false}
        style={{ fontSize: Math.round(size * 0.57), lineHeight: size, color: "#FFFFFF" }}
        className="font-extrabold"
      >
        {letter}
      </Text>
    </View>
  );
}
