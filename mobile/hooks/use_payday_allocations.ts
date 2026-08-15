// hooks/use_payday_allocations.ts — m2b Task 9, rule 2.
//
// The bridge between income and goals, and the reason the two features never
// import each other: income publishes `income:payday`, goals subscribes. This
// hook is the subscription.
//
// EXTRACTED FROM THE ROOT LAYOUT SO IT CAN BE TESTED. The shell needs fonts, a
// theme, an unlocked database and a bootstrap before it renders anything, so
// asserting "a payday with proposals opens the sheet" through it would be a
// test of the shell. Here it is a test of the rule.
//
// FREE TIER FALLS OUT FOR FREE. `proposePaydayAllocations` is already gated on
// `hasPaydayAutoAllocation` and returns an empty list on free (docs/05 §3.2:
// the contributionRule is retained, only the prompt stops), so this hook needs
// no tier check of its own — and cannot drift out of step with the one the
// service applies.
import { useEffect, useState } from "react";

import { systemClock } from "@/lib/clock";
import type { AppEventMap } from "@/lib/events/app_events";
import { onAppEvent } from "@/lib/events/app_events";
import { proposePaydayAllocations } from "@/lib/goals/goals_service";
import type { AllocationProposal } from "@/lib/goals/goals_service";
import { PAYDAY_EVENT } from "@/lib/income/income_service";
import type { Centavos } from "@/types/domain";

export type PaydayAllocations = {
  /** The payday to summarize, or `null` when none is being announced. */
  payday: AppEventMap["income:payday"] | null;
  /** What the user might move. Empty on free, or with no contribution rules. */
  proposals: AllocationProposal[];
  /**
   * The payday's own amount, kept AFTER the summary is acknowledged.
   *
   * The allocation sheet shows the running total "of ₱18,500.00" and refuses a
   * total above it, so it needs this figure at the exact moment `payday` has
   * been cleared to make room for it.
   */
  paydayAmount: Centavos;
  /** Dismisses the payday summary; the allocation sheet follows if there is one. */
  acknowledgePayday: () => void;
  /** Dismisses the allocation sheet without recording anything. */
  dismissAllocations: () => void;
};

export function usePaydayAllocations(): PaydayAllocations {
  const [payday, setPayday] = useState<AppEventMap["income:payday"] | null>(null);
  const [proposals, setProposals] = useState<AllocationProposal[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    return onAppEvent(PAYDAY_EVENT, async (event) => {
      setPayday(event);
      setAcknowledged(false);
      try {
        setProposals(await proposePaydayAllocations(event, systemClock.now()));
      } catch (error) {
        // A payday is worth announcing even if the goal side fails. Swallowing
        // here costs the allocation prompt; letting it escape would take the
        // whole event handler down and lose the summary too.
        console.warn("payday allocation proposals failed", error);
        setProposals([]);
      }
    });
  }, []);

  return {
    // The summary shows first and hands off (m2-part2 Task 13 rule 5: the sheet
    // "summarizes the detected payday and hands off to goals auto-allocation").
    // Two sheets stacked at once would cover each other.
    payday: acknowledged ? null : payday,
    proposals: acknowledged ? proposals : [],
    paydayAmount: payday?.amount ?? 0,
    acknowledgePayday: () => setAcknowledged(true),
    dismissAllocations: () => {
      setProposals([]);
      setPayday(null);
    },
  };
}
