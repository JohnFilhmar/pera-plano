// components/ui/image_placeholder.tsx — task-2-brief.md.
//
// Stands in for onboarding artwork that doesn't exist yet. Rather than block
// on photography, each call site carries its own art brief as PROPS, and this
// component renders that brief as visible text inside a dashed, unmistakably-
// placeholder panel — a reviewer reads the intended scene off the running app
// instead of trusting a code comment nobody sees on a device. `BrandMark`
// (Task 1) sits in the corner instead of a lucide icon so the placeholder
// itself reads as PeraPlano's, not a generic broken-image tile.
//
// OVERFLOW DECISION (rule 5): the box grows past its ratio rather than
// clipping the brief. `aspectRatio` is applied only via RN's `aspectRatio`
// style — never a fixed `height`, and never `overflow: hidden` — so Yoga
// uses it to size the box when nothing else demands more room, but a brief
// long enough to wrap past that height still pushes the container taller
// instead of being cut off. `overflow: hidden` here would silently swallow
// the one thing this component exists to show (rule 1: never truncated).
//
// This is a plain UI primitive: no import from components/onboarding/, no
// notion of a carousel or of panel N of M beyond rendering the badge text it
// is handed.
import { Text, View } from "react-native";

import { BrandMark } from "./brand_mark";

const DEFAULT_ASPECT_RATIO = 16 / 9;
const GLYPH_SIZE = 28;

export type ImagePlaceholderProps = {
  /** Short scene name, e.g. "The tap". Rendered as the heading. */
  label: string;
  /** The art brief: what the final image must show. Rendered verbatim, in full. */
  brief: string;
  /** 1-based position, e.g. 2 — renders as "2 / 4" with `of`. Both or neither. */
  index?: number;
  of?: number;
  /** width / height. Default 16 / 9. */
  aspectRatio?: number;
  testID?: string;
};

export function ImagePlaceholder({
  label,
  brief,
  index,
  of,
  aspectRatio = DEFAULT_ASPECT_RATIO,
  testID,
}: ImagePlaceholderProps) {
  // Rule 3: passing exactly one of the pair is a caller bug — render no
  // badge rather than a half-formed one.
  const showBadge = index !== undefined && of !== undefined;

  return (
    <View
      testID={testID}
      style={{ aspectRatio }}
      className="items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand bg-brand-soft p-4 dark:border-brand-dark dark:bg-brand-soft-dark"
    >
      <View className="absolute left-3 top-3">
        <BrandMark size={GLYPH_SIZE} />
      </View>
      {showBadge ? (
        <View className="absolute right-3 top-3 rounded-full bg-brand px-2 py-0.5 dark:bg-brand-dark">
          <Text className="text-xs font-semibold text-surface dark:text-surface-dark">
            {`${index} / ${of}`}
          </Text>
        </View>
      ) : null}
      <Text className="text-center text-base font-semibold text-fg dark:text-fg-dark">
        {label}
      </Text>
      {/* Rule 1: rendered verbatim, in full — no numberOfLines, no ellipsis.
          See the overflow decision above for why the box can grow to fit it. */}
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">{brief}</Text>
    </View>
  );
}
