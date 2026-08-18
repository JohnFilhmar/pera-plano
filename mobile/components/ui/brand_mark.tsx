// components/ui/brand_mark.tsx — task-1-brief.md.
//
// The static paper-airplane brand mark (docs/11 DESIGN LANGUAGE), rendered
// from `mobile/assets/brand/peraplano-logo-static.svg` — a copy of the
// canonical file at the repo root, `assets/brand/peraplano-logo-static.svg`
// (see that directory's README for why `mobile/` holds a copy rather than
// reaching out to it).
//
// Static-only is deliberate, not an oversight: every OTHER file in the brand
// delivery animates with SMIL, which `react-native-svg` drops silently on
// import — the file renders its first frame and nothing tells you the
// animation didn't happen (assets/brand/README.md has the full story). This
// is the one file where that doesn't matter, because it was never animated.
// The idle/launch/loading marks get their own variant once Reanimated work
// on `peraplano-logo-layered.svg` is real; a `variant` prop with one legal
// value today would be speculative API, so `BrandMark` doesn't have one.
import { cssInterop } from "nativewind";

import Logo from "@/assets/brand/peraplano-logo-static.svg";

// The generated SVG component isn't a core RN primitive, so `className` does
// nothing on it until registered with cssInterop — the same reason
// button.tsx registers it for lucide icons and for ActivityIndicator.
cssInterop(Logo, { className: { target: "style" } });

const DEFAULT_SIZE = 48;

export type BrandMarkProps = {
  /** Square edge in dp. Default 48. */
  size?: number;
  className?: string;
  testID?: string;
};

export function BrandMark({ size = DEFAULT_SIZE, className, testID }: BrandMarkProps) {
  return <Logo width={size} height={size} className={className} testID={testID} />;
}
