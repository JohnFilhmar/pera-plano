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
//
// THE THREE FILLS (mobile-ui-revamp Part 3 Task 4b) are exactly the pairing
// Part 1 Task 2's soft-chip contrast work was done for: a far-out "due in Nd"
// is tone="neutral" fill="outline", "due today" is tone="warn" fill="soft",
// and overdue is tone="danger" fill="soft". THE NEAR/FAR BOUNDARY STAYS <=3
// DAYS, not the design board's own "due in 3d" example — this file's existing
// test ("a distant due date is NEUTRAL, not a warning") already asserts 3
// days out as warn and only >3 days as neutral, and this file's own header
// gives the reason ("Red and amber are for something wrong or imminent"). The
// board's example string is treated as illustrative, not as a literal
// re-threshold: only the FILL changed for warn/danger, never the boundary.
// PAID / SKIPPED / SETTLED ELSEWHERE STAY SOLID — the brief names three
// pairings, not five, and these are not urgency signals.
import { Chip } from "@/components/ui/chip";
import type { ChipFill, ChipTone } from "@/components/ui/chip";
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
): { label: string; tone: ChipTone; fill: ChipFill } {
  switch (state) {
    case "overdue": {
      const days = Math.abs(daysUntil);
      return {
        label: days === 1 ? "1 day late" : `${days} days late`,
        tone: "danger",
        fill: "soft",
      };
    }
    case "due_today":
      return { label: "Due today", tone: "warn", fill: "soft" };
    case "paid":
      return { label: "Paid", tone: "brand", fill: "solid" };
    case "skipped":
      return { label: "Skipped", tone: "neutral", fill: "solid" };
    case "resolved_external":
      // Distinct from Paid: the obligation was met, but no tracked wallet moved,
      // so there is no transaction to open and nothing for the estimator.
      return { label: "Settled elsewhere", tone: "brand", fill: "solid" };
    case "upcoming":
      return daysUntil <= 3
        ? { label: `Due in ${daysUntil}d`, tone: "warn", fill: "soft" }
        : { label: `Due in ${daysUntil}d`, tone: "neutral", fill: "outline" };
  }
}

export function DueChip({ state, daysUntil, testID }: DueChipProps) {
  const { label, tone, fill } = dueChipFor(state, daysUntil);
  return <Chip testID={testID} label={label} tone={tone} fill={fill} />;
}
