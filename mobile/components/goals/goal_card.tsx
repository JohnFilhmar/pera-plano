// components/goals/goal_card.tsx — m2b Task 4, rules 1-2.
//
// PRESENTATIONAL. `pace` arrives from `computeGoalProgress`; this file decides
// nothing about whether the user is on track, for the same reason `LimitCard`
// does not recompute a limit's thresholds — two opinions about one verdict
// drift the first time a boundary moves.
//
// THE PACE CHIP CARRIES THE FIX, NOT JUST A COLOUR. Spec rule 11: the Behind
// state "always shows the concrete fix: 'Save ₱1,250.00 per payday to hit
// June 1.' It never shows only a warning color." A colour alone tells a user
// they are failing without telling them by how much.
//
// RESTYLED (mobile-ui-revamp Part 3 Task 4b): the ring shrinks to 44dp and its
// percentage moves OUT of the ring onto the text line, joined to the amounts
// as "N% · ₱X of ₱Y". THE PERCENTAGE AND THE AMOUNTS STAY TWO TEXT NODES, NOT
// ONE STRING — `goal_card.test.tsx` asserts `screen.getByText("50%")` and
// `screen.getByText("₱25,000.00 of ₱50,000.00")` as two SEPARATE exact
// matches, and RNTL's `getByText` requires a node's full text to equal the
// query; concatenating them into one node would make both assertions fail
// (the string being searched for would never be a whole node's content again).
// A reached goal still fills its ring brand, and now shows a party glyph in
// place of the plain check — `expect(screen.queryByText("100%")).toBeNull()`
// only pins the ABSENCE of percentage text on that path, so swapping the icon
// costs that test nothing.
import { PartyPopper } from "lucide-react-native";
import { Text, View } from "react-native";

import { PACE_RING_COLOR, ProgressRing } from "@/components/goals/progress_ring";
import { formatCentavos } from "@/components/ui/amount_text";
import { registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { ChipTone } from "@/components/ui/chip";
import { palette } from "@/constants/colors";
import { useTheme } from "@/contexts/theme_context";
import { formatDate } from "@/lib/datetime";
import { parseDateIso } from "@/lib/dates";
import type { GoalProgress } from "@/lib/goals/goal_math";
import type { ContributionRule } from "@/types/domain";

const PartyGlyph = registerIcon(PartyPopper);

export type GoalCardProps = {
  name: string;
  progress: GoalProgress;
  /** `'YYYY-MM-DD'`, echoed back in the Behind copy. */
  targetDate: string | null;
  /**
   * `AUTO` chip when set (task-4b board). Optional and defaults to `undefined`
   * — `components/plan/goals_panel.tsx` (mobile-ui-revamp Part 2, out of this
   * task's reach) calls this card without it, and omitting the chip entirely
   * is the correct behaviour there, not a missing prop.
   */
  contributionRule?: ContributionRule | null;
  testID?: string;
};

/**
 * Contract §2 tokens only. `danger` is reserved for Past due: a goal that is
 * merely behind is not an error state, and colouring it red teaches the user to
 * ignore the one colour that means something has actually gone wrong.
 */
const PACE_TONE: Record<GoalProgress["pace"], ChipTone> = {
  reached: "brand",
  on_track: "brand",
  no_deadline: "neutral",
  behind: "warn",
  past_due: "danger",
};

const PACE_LABEL: Record<GoalProgress["pace"], string> = {
  reached: "Reached",
  on_track: "On track",
  behind: "Behind",
  past_due: "Past due",
  no_deadline: "No deadline",
};

export function GoalCard({
  name,
  progress,
  targetDate,
  contributionRule,
  testID,
}: GoalCardProps) {
  const { resolved } = useTheme();
  const ringColor = PACE_RING_COLOR[resolved === "dark" ? "dark" : "light"][progress.pace];
  // The ring is react-native-svg: `stroke` takes a literal colour, not a
  // NativeWind class, so the token has to be read rather than applied. Read it
  // from the palette — the same `brand-soft` pair Tailwind is generated from —
  // so there is exactly one definition of the colour to keep in step.
  const trackColor = palette[resolved === "dark" ? "brand-soft-dark" : "brand-soft"];
  const reached = progress.pace === "reached";

  return (
    <Card testID={testID}>
      <View className="flex-row items-center gap-3">
        {/* 44dp (task-4b board) — down from the 96dp hero ring this card
            shipped with. The fraction/percentage that used to sit in its
            centre moves to the text column: at 44dp there is no room left to
            draw a legible number inside the stroke. */}
        <ProgressRing
          testID={testID === undefined ? undefined : `${testID}-ring`}
          fraction={progress.fraction}
          color={ringColor}
          trackColor={trackColor}
          size={44}
          strokeWidth={5}
        >
          {reached ? <PartyGlyph size={18} className="text-brand dark:text-brand-dark" /> : null}
        </ProgressRing>

        <View className="flex-1">
          <Text className="font-semibold text-fg dark:text-fg-dark">{name}</Text>
          {/* "N% · ₱X of ₱Y" — two text nodes, not one string. See this
              file's header on why: `goal_card.test.tsx` asserts each exactly. */}
          <View className="mt-1 flex-row flex-wrap items-baseline gap-1">
            {reached ? null : (
              <>
                <Text
                  testID={testID === undefined ? undefined : `${testID}-percent`}
                  className="text-fg-2 dark:text-fg-2-dark"
                >
                  {`${Math.round(progress.fraction * 100)}%`}
                </Text>
                <Text className="text-fg-2 dark:text-fg-2-dark">·</Text>
              </>
            )}
            {/* Both figures, always. "₱25,000.00 of ₱50,000.00" answers "how
                far" and "how far to go" in one line; a percentage alone
                answers neither in pesos, which is the unit the user actually
                thinks in. */}
            <Text
              testID={testID === undefined ? undefined : `${testID}-amounts`}
              className="text-fg-2 dark:text-fg-2-dark"
            >
              {`${formatCentavos(progress.saved)} of ${formatCentavos(progress.target)}`}
            </Text>
          </View>

          {/* No pace chip without a deadline — spec rule 10: "Goals without
              targetDate show progress only". The AUTO chip is independent of
              that rule: a contribution rule can exist on a goal with no
              deadline at all. */}
          {progress.pace === "no_deadline" && (contributionRule ?? null) === null ? null : (
            <View className="mt-2 flex-row flex-wrap gap-2">
              {progress.pace === "no_deadline" ? null : (
                <Chip
                  testID={testID === undefined ? undefined : `${testID}-pace`}
                  label={PACE_LABEL[progress.pace]}
                  tone={PACE_TONE[progress.pace]}
                />
              )}
              {(contributionRule ?? null) === null ? null : (
                <Chip
                  testID={testID === undefined ? undefined : `${testID}-auto`}
                  label="AUTO"
                  tone="brand"
                  fill="soft"
                />
              )}
            </View>
          )}
        </View>
      </View>

      {/* Rule 11's concrete fix. Shown for Behind, and for Past due too — a
          user whose date has slipped still needs a number, and "move the date"
          is only actionable if they know what the old one was costing. */}
      {progress.pace === "behind" && progress.requiredPerPeriod !== null ? (
        <Text testID={testID === undefined ? undefined : `${testID}-fix`} className="mt-3 text-fg dark:text-fg-dark">
          {`Save ${formatCentavos(progress.requiredPerPeriod)} per ${progress.periodLabel}${
            targetDate === null ? "" : ` to hit ${formatDate(parseDateIso(targetDate).getTime())}`
          }.`}
        </Text>
      ) : null}

      {progress.pace === "past_due" ? (
        <Text testID={testID === undefined ? undefined : `${testID}-overdue`} className="mt-3 text-fg dark:text-fg-dark">
          {`${formatCentavos(progress.remaining)} short. Move the date, lower the target, or complete it anyway.`}
        </Text>
      ) : null}
    </Card>
  );
}
