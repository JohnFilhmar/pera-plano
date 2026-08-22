// components/ui/share_bar.tsx — the stacked split bar and legend above the
// Wallets total ("GCash 60% · Maya 17% · BPI 5% · Cash 18%").
//
// Colours arrive as values, not tokens: the caller is Wallets, and a wallet's
// colour is its PROVIDER's colour (constants/providers.ts), which is identity
// rather than status. This component must not reach for `palette` itself.
import { Text, View } from "react-native";

export type Share = { id: string; label: string; value: number; color: string };

export type ShareBarProps = {
  shares: readonly Share[];
  testID?: string;
};

export function ShareBar({ shares, testID }: ShareBarProps) {
  const total = shares.reduce((sum, share) => sum + share.value, 0);
  if (total <= 0) return null;

  const withPercent = shares.map((share) => ({
    ...share,
    percent: Math.round((share.value / total) * 100),
  }));

  return (
    <View testID={testID}>
      <View className="h-2 flex-row overflow-hidden rounded-full">
        {withPercent.map((share) => (
          <View
            key={share.id}
            testID={testID === undefined ? undefined : `${testID}-seg-${share.id}`}
            style={{ flex: share.value, backgroundColor: share.color }}
          />
        ))}
      </View>
      <View className="mt-2 flex-row flex-wrap gap-x-3 gap-y-1">
        {withPercent.map((share) => (
          <View key={share.id} className="flex-row items-center gap-1.5">
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: share.color }} />
            <Text className="text-micro font-medium text-fg-2 dark:text-fg-2-dark">
              {`${share.label} ${share.percent}%`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
