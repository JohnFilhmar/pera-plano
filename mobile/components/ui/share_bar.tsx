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
        {withPercent.map((share) => {
          // Reanimated installs a runtime check that warns on "a shared value's
          // `.value` inside an inline style", and it keys off the TEXTUAL shape
          // of the style object — any `<expr>.value` member expression inside a
          // `style={{ ... }}` literal — not the actual runtime type behind it.
          // `Share.value` is a plain number (the magnitude the percentage below
          // is computed from), never a Reanimated `SharedValue`, but
          // `style={{ flex: share.value, ... }}` still tripped the warning once
          // per rendered segment, on every render.
          //
          // Destructuring here, and renaming the field to `shareValue` rather
          // than keeping the local as `value`, removes the `.value` member
          // expression from the style object entirely, so the heuristic has
          // nothing to (mis)fire on. This is a false positive, not a fix to a
          // real bug — confirmed by reproducing it with a plain, non-Reanimated
          // probe. Do not "tidy" this back into `share.value` inline: once
          // `ShareBar` is wired into the Wallets screen (Part 2) this renders
          // on every load, and recurring cosmetic console noise on a screen
          // that loads constantly is exactly how a team learns to stop reading
          // warnings — which is how a genuine Reanimated misuse later goes
          // unnoticed.
          const { value: shareValue, color } = share;
          return (
            <View
              key={share.id}
              testID={testID === undefined ? undefined : `${testID}-seg-${share.id}`}
              style={{ flex: shareValue, backgroundColor: color }}
            />
          );
        })}
      </View>
      <View className="mt-2 flex-row flex-wrap gap-x-3 gap-y-1">
        {withPercent.map((share) => {
          // `share.value` is never read here, so this style object alone never
          // tripped the heuristic above — but `color` is destructured out the
          // same way for consistency with the segment bar, so both render
          // paths handle `Share` fields identically rather than one reading
          // `share.color` inline and the other not.
          const { color } = share;
          return (
            <View key={share.id} className="flex-row items-center gap-1.5">
              <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              <Text className="text-micro font-medium text-fg-2 dark:text-fg-2-dark">
                {`${share.label} ${share.percent}%`}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
