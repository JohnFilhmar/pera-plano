// components/ui/error_state.tsx — task-5-brief.md.
//
// ErrorState mirrors EmptyState's structure — disc, glyph, title, body, one
// optional action — but reports a FAILURE instead of an absence: a
// TriangleAlert glyph on a danger-toned disc rather than the brand mark on
// its inviting mint one, and the one action (when there is one) is a
// *retry*, not an "add". An error with nothing the user can do about it
// renders no button at all — a dead button is worse than none.
//
// THE DISC HAS NO OPAQUE "danger-soft" TOKEN TO REACH FOR. constants/colors.ts
// is explicit that `brand-soft` is the only real opaque soft token in the
// palette; `danger` (like `warn`) only ever appears as a soft tint via the
// design's alpha rule, computed at render time — see that file's SOFT-CHIP
// INK block. `components/ui/chip.tsx` already solves this exact problem for
// its own `soft` fill, so this file reuses its precise recipe (`SOFT_ALPHA`
// composited over `danger`/`danger-dark` with `softBackground`) instead of
// inventing a second one or reaching for a raw hex literal.
//
// `useColorScheme()` (nativewind), NOT `useTheme()` (contexts/theme_context.tsx).
// `useTheme` throws outside a mounted `ThemeProvider`, and this component's
// own tests render it with no provider above it — the same reason `Chip`
// reads the colour scheme this way instead (see that file's header).
//
// NO WRAPPER AROUND THE ICON (fix round 1, task-5-fix1). An earlier revision
// wrapped `AlertIcon` in a `testID`-carrying `View` and copied the icon's
// className onto that wrapper, because a `testID` passed straight to a
// lucide icon never reaches anything `getByTestId` can find
// (`components/wallets/wallet_type_icon.tsx` documents the same finding).
// That fix solved the wrong problem: the wrapper's className was a COPY, not
// the real prop the glyph renders from, so retinting only the icon and
// leaving the wrapper's copy behind shipped the wrong colour with the test
// still green. `error_state.test.tsx` finds the real element instead — it
// queries by component type (`TriangleAlert`, a stable, importable
// reference) and reads `className` off its immediate parent, because
// NativeWind's cssInterop wrapper consumes `className` before it reaches
// `TriangleAlert` itself (confirmed by inspecting the rendered tree: the
// wrapper receives `{ size, className }`, `TriangleAlert` underneath it
// receives only `{ ref, size }`). Either way there is nothing left for a
// hand-rolled wrapper to do here, so it is gone rather than patched again.
import { TriangleAlert } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { Text, View } from "react-native";

import { Button, registerIcon } from "./button";
import { SOFT_ALPHA } from "./chip";
import { palette } from "@/constants/colors";
import { softBackground } from "@/lib/ui/contrast";

export type ErrorStateProps = {
  title: string;
  body: string;
  onRetry?: () => void;
  retryLabel?: string;
  testID?: string;
};

const AlertIcon = registerIcon(TriangleAlert);

export function ErrorState({ title, body, onRetry, retryLabel, testID }: ErrorStateProps) {
  const { colorScheme } = useColorScheme();
  const tint = colorScheme === "dark" ? palette["danger-dark"] : palette.danger;

  return (
    <View testID={testID} className="items-center gap-3 px-8 py-12">
      <View
        className="rounded-full p-4"
        style={{ backgroundColor: softBackground(tint, SOFT_ALPHA) }}
      >
        <AlertIcon size={32} className="text-danger dark:text-danger-dark" />
      </View>
      <Text className="text-center text-title font-bold text-fg dark:text-fg-dark">{title}</Text>
      <Text className="text-center text-body font-medium text-fg-2 dark:text-fg-2-dark">
        {body}
      </Text>
      {onRetry ? (
        <View className="mt-2">
          <Button
            testID={testID === undefined ? undefined : `${testID}-retry`}
            title={retryLabel ?? "Retry"}
            onPress={onRetry}
          />
        </View>
      ) : null}
    </View>
  );
}
