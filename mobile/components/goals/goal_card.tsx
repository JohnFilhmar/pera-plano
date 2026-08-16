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
import { Check } from "lucide-react-native";
import { Text, View } from "react-native";

import { PACE_RING_COLOR, ProgressRing } from "@/components/goals/progress_ring";
import { formatCentavos } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { ChipTone } from "@/components/ui/chip";
import { palette } from "@/constants/colors";
import { useTheme } from "@/contexts/theme_context";
import { formatDate } from "@/lib/datetime";
import { parseDateIso } from "@/lib/dates";
import type { GoalProgress } from "@/lib/goals/goal_math";

export type GoalCardProps = {
  name: string;
  progress: GoalProgress;
  /** `'YYYY-MM-DD'`, echoed back in the Behind copy. */
  targetDate: string | null;
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

export function GoalCard({ name, progress, targetDate, testID }: GoalCardProps) {
  const { resolved } = useTheme();
  const ringColor = PACE_RING_COLOR[resolved === "dark" ? "dark" : "light"][progress.pace];
  // The ring is react-native-svg: `stroke` takes a literal colour, not a
  // NativeWind class, so the token has to be read rather than applied. Read it
  // from the palette — the same `brand-soft` pair Tailwind is generated from —
  // so there is exactly one definition of the colour to keep in step.
  const trackColor = palette[resolved === "dark" ? "brand-soft-dark" : "brand-soft"];

  return (
    <Card testID={testID}>
      <View className="flex-row items-center gap-4">
        <ProgressRing
          testID={testID === undefined ? undefined : `${testID}-ring`}
          fraction={progress.fraction}
          color={ringColor}
          trackColor={trackColor}
        >
          {progress.pace === "reached" ? (
            <Check size={28} className="text-brand dark:text-brand-dark" />
          ) : (
            <Text className="text-base font-semibold text-fg dark:text-fg-dark">
              {`${Math.round(progress.fraction * 100)}%`}
            </Text>
          )}
        </ProgressRing>

        <View className="flex-1">
          <Text className="font-semibold text-fg dark:text-fg-dark">{name}</Text>
          {/* Both figures, always. "₱25,000.00 of ₱50,000.00" answers "how far"
              and "how far to go" in one line; a percentage alone answers
              neither in pesos, which is the unit the user actually thinks in. */}
          <Text testID={testID === undefined ? undefined : `${testID}-amounts`} className="mt-1 text-fg-2 dark:text-fg-2-dark">
            {`${formatCentavos(progress.saved)} of ${formatCentavos(progress.target)}`}
          </Text>

          {/* No pace chip without a deadline — spec rule 10: "Goals without
              targetDate show progress only". */}
          {progress.pace === "no_deadline" ? null : (
            <View className="mt-2 flex-row">
              <Chip
                testID={testID === undefined ? undefined : `${testID}-pace`}
                label={PACE_LABEL[progress.pace]}
                tone={PACE_TONE[progress.pace]}
              />
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
