// components/home/limit_progress_list.tsx — M3 Part 2 Task 4, rule 3.
//
// Each active limit's bar, coloured by the 50/80/100 thresholds.
//
// REUSES `LimitCard` RATHER THAN DRAWING ITS OWN BAR. The Plan tab already
// renders exactly this — spend, effective limit, days left, and the threshold
// band as a tone — and two components colouring the same bands independently
// would eventually disagree about where 80% is. The list is the composition;
// the row is the shipped component.
import { Pressable, View } from "react-native";

import { LimitCard } from "@/components/limits/limit_card";
import { SectionHeader } from "@/components/ui/section_header";
import type { LimitStatus } from "@/lib/limits/limit_service";
import { limitDisplayName } from "@/lib/limits/limit_label";

export type LimitProgressListProps = {
  statuses: LimitStatus[] | undefined;
  categoryNames?: ReadonlyMap<string, string>;
  onOpen: (limitId: string) => void;
  testID?: string;
};

export function LimitProgressList({
  statuses,
  categoryNames,
  onOpen,
  testID,
}: LimitProgressListProps) {
  // Nothing rather than an empty section: the hero's no-limit state is already
  // making this exact point, louder and with an action attached.
  if (statuses === undefined || statuses.length === 0) return null;

  return (
    <View testID={testID ?? "limit-progress"} className="gap-3">
      <SectionHeader title="Your limits" />
      {statuses.map((status) => (
        // Wrapped rather than adding `onPress` to `LimitCard`: that component
        // is presentational on the Plan tab and does not need to learn about
        // navigation to be tappable here.
        <Pressable
          key={status.limit.id}
          testID={`limit-progress-${status.limit.id}`}
          accessibilityRole="button"
          onPress={() => onOpen(status.limit.id)}
        >
          <LimitCard
            name={limitDisplayName(status.limit, categoryNames)}
            spend={status.spend}
            effectiveLimit={status.effectiveLimit}
            daysLeft={status.window.daysLeft}
            uiState={status.uiState}
          />
        </Pressable>
      ))}
    </View>
  );
}
