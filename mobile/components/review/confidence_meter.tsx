// components/review/confidence_meter.tsx — m1c plan Task 9 rule 4.
//
// How sure the pipeline was, on the one screen where the user is being asked to
// check its work. The number is the same `confidence` the ConfidenceGate scored
// and the orchestrator wrote into the queued payload — never a re-derivation,
// and never a decoration.
//
// A DECORATIVE METER IS WORSE THAN NO METER. A bar that renders the same width
// on every card teaches the user that the app's uncertainty is theatre, and the
// next time it genuinely is 30% sure they will confirm it as fast as the 89%
// one. That is the "rubber stamp" failure the whole Review Queue exists to
// avoid, arriving through the one element that claims to quantify doubt.
//
// IT MUST NOT RENDER WHEN THERE IS NO SCORE. `unknown-provider` payloads carry
// no `confidence` at all (pipeline.ts, both queue sites) because nothing was
// ever parsed — no provider matched, so no stage ran to produce one. A meter
// there would read 0%, which is not "we are unsure": it is the app stating a
// measurement it never took. `review_card.tsx` owns that decision; this
// component simply has no null branch to hide it in.
import { Text, View } from "react-native";

export type ConfidenceMeterProps = {
  /** The gate's score, 0..1, exactly as `pipeline.ts` wrote it. */
  confidence: number;
  testID?: string;
};

/**
 * `0.72` → `72`. Clamped to 0–100 and rounded to a whole percent.
 *
 * CLAMPED RATHER THAN TRUSTED. The score arrives after arbitrary float
 * subtraction (the categorizer's penalty is applied in `pipeline.ts`), and the
 * payload is `Record<string, unknown>` read back out of a JSON column — so a
 * value outside 0..1, or not a number at all, is a real shape this function can
 * be handed. Unclamped, a 1.4 renders a fill wider than its own track; a NaN
 * renders "NaN%" on a card asking the user to trust the app's arithmetic.
 */
export function confidencePercent(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}

/**
 * The score as a bar and a sentence, both from the same number.
 *
 * BOTH HALVES, DELIBERATELY. The bar is scannable and the sentence is what a
 * screen reader — and anyone who does not read bar charts — actually gets. The
 * wording matches the "Why was this recorded?" panel's
 * ("Matched with 88% confidence") so the same score reads the same way on the
 * card that proposes a row and the panel that later explains it.
 */
export function ConfidenceMeter({ confidence, testID = "confidence-meter" }: ConfidenceMeterProps) {
  const percent = confidencePercent(confidence);

  return (
    <View
      testID={testID}
      className="gap-1"
      accessibilityRole="progressbar"
      accessibilityLabel={`Read with ${percent}% confidence`}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
    >
      {/* The track. `bg-bg` rather than a grey of its own: an unfilled meter is
          the absence of the brand colour, not a fifth semantic tone. */}
      <View className="h-2 overflow-hidden rounded-full bg-bg dark:bg-bg-dark">
        <View
          testID={`${testID}-fill`}
          // Percent width is a LAYOUT value, not a colour — the palette rule
          // (contract §2 tokens only) is about the fill's colour, which is a
          // NativeWind class like everything else in the app.
          style={{ width: `${percent}%` }}
          className="h-2 rounded-full bg-brand dark:bg-brand-dark"
        />
      </View>
      <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
        {`Read with ${percent}% confidence`}
      </Text>
    </View>
  );
}
