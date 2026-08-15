// components/bills/due_chip.tsx — m2c Task 5, rule 2.
//
// One chip, four states. Presentational on purpose: the verdict arrives from
// `listBillStatuses`, which compares calendar dates against the clock its list
// was built with. A chip that re-derived "overdue" from `Date.now()` would
// disagree with the section it is sitting in at exactly midnight.
//
// DANGER IS RESERVED FOR ALREADY LATE. "Due in 3 days" is warn at most —
// spending red on a date that has not passed leaves nothing louder for the day
// the payment is genuinely overdue, and a user who sees red every week stops
// reading it. Same call as the loan card's chip.
import { Chip } from "@/components/ui/chip";
import type { ChipTone } from "@/components/ui/chip";
import type { BillCycleState } from "@/lib/bills/bills_service";

export type DueChipProps = {
  state: BillCycleState;
  /** Negative once past — straight from the status, never recomputed. */
  daysUntil: number;
  testID?: string;
};

/** Exported for the list's ordering, which sorts by the same urgency. */
export function dueChipFor(
  state: BillCycleState,
  daysUntil: number,
): { label: string; tone: ChipTone } {
  switch (state) {
    case "overdue": {
      const days = Math.abs(daysUntil);
      return { label: days === 1 ? "1 day late" : `${days} days late`, tone: "danger" };
    }
    case "due_today":
      return { label: "Due today", tone: "warn" };
    case "paid":
      return { label: "Paid", tone: "brand" };
    case "skipped":
      return { label: "Skipped", tone: "neutral" };
    case "resolved_external":
      // Distinct from Paid: the obligation was met, but no tracked wallet moved,
      // so there is no transaction to open and nothing for the estimator.
      return { label: "Settled elsewhere", tone: "brand" };
    case "upcoming":
      return { label: `Due in ${daysUntil}d`, tone: daysUntil <= 3 ? "warn" : "neutral" };
  }
}

export function DueChip({ state, daysUntil, testID }: DueChipProps) {
  const { label, tone } = dueChipFor(state, daysUntil);
  return <Chip testID={testID} label={label} tone={tone} />;
}
