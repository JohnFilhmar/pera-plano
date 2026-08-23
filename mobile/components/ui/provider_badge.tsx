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
  const { color, letter, ink } = providerBadge(providerKey);

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
      {/*
        `allowFontScaling={false}` is correct here, not a default left on:
        this box is a fixed-size square, and a glyph scaled by the OS font
        setting overflows it rather than reflowing. What makes that
        acceptable is the `accessibilityLabel` on the `View` above — it
        carries the provider's full name to assistive tech independently of
        this glyph, so the one piece of information the badge exists to
        convey (which provider this is) is never lost to a user who has
        scaling turned up. Copy this pattern only where an equivalent label
        exists elsewhere; if this `Text` were the only carrier of the
        information, disabling scaling would drop it for that user.
      */}
      <Text
        testID={testID === undefined ? undefined : `${testID}-letter`}
        allowFontScaling={false}
        style={{ fontSize: Math.round(size * 0.57), lineHeight: size, color: ink }}
        className="font-extrabold"
      >
        {letter}
      </Text>
    </View>
  );
}
