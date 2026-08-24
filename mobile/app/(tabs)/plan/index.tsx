// app/(tabs)/plan/index.tsx — Plan's segmented host (mobile-ui-revamp Part 2
// Task 7, replacing the m2 Task 8 card hub this file used to render).
//
// FOUR SEGMENTS, INLINE, NOT A HUB OF CARDS. The old hub made every plan
// object cost a tap to the hub plus a tap into the section; a segmented
// control removes the first tap by rendering the chosen list right here.
// Pressing a segment is a state change, never a navigation (revamp spec R4) —
// `SegmentedControl` (components/ui/segmented_control.tsx) is built for
// exactly this and is verified to call nothing but `onChange`.
//
// INCOME IS NOT A FIFTH SEGMENT. The old hub's own header comment already
// argued this from the IA doc; Task 7 keeps the conclusion and changes the
// destination. `LimitsPanel` now renders a "Take-home" row at its own top,
// above its gaps and cards, because a percent-of-income Limit reads directly
// from that figure — the placement states the relationship. See
// components/plan/limits_panel.tsx for the row itself.
//
// SoonGate IS GONE FROM THIS SCREEN, NOT FORGOTTEN. `constants/shipped_features.ts`
// now reports limits, goals, loans and bills all "shipped" (the m2c Task 6
// flip), so every gate the old hub wrapped its cards in was already rendering
// its children unchanged — a gate that can no longer close is indirection
// with nothing behind it. `SoonGate` itself is untouched in the codebase;
// `app/(tabs)/more/index.tsx` still has real, live users of it.
//
// THE FOUR ROUTE FILES STILL EXIST, AND STILL RENDER THE SAME PANELS. This is
// the one task in the revamp that can break navigation, so the fact bears
// repeating: `limits/[id].tsx`, `goals/[id].tsx`, `loans/[id].tsx` and
// `bills/[id].tsx` all call `router.back()`; `app/(tabs)/index.tsx` pushes
// straight to `/plan/limits/[id]` and `/plan/bills/[id]` from its alert cards
// and strips; and `lib/alerts/alert_routes.ts` resolves a coalesced limit
// alert to the bare `/plan/limits` — a real, standalone destination, not a
// redirect into this segmented state. Deleting `app/(tabs)/plan/{limits,
// goals,loans,bills}.tsx` would strand all of that. They are left completely
// unmodified by this task.
//
// EACH PANEL KEEPS ITS OWN ScrollView — A DELIBERATE DEVIATION FROM THE
// TASK'S OWN SAMPLE CODE, RECORDED HERE SO THE NEXT READER DOES NOT "FIX" IT
// BACK. The plan's text says to hoist scrolling up to this host and strip
// each panel down to a plain `View`. That would nest zero ScrollViews here,
// but it breaks two things the plan's text does not account for: (1) the
// four standalone routes above render a panel with NO wrapping ScrollView of
// their own — they are three-line files out of this task's scope — so a
// panel with no scroller of its own would make `/plan/limits` unscrollable
// the moment its list (plus every DERIVED limit — one user limit becomes
// four, per limit_derivation.ts) overflows one screen; and (2) each panel's
// "Add" button is `position: absolute`, pinned to the bottom-right of that
// panel's own full-height wrapper — hoist the scroller and that wrapper stops
// being full-height, so the button stops floating and starts overlapping the
// last row instead. Rendering the active panel inside a plain, non-scrolling
// `View` here — instead of a second `ScrollView` — satisfies the goal the
// plan's text was actually after (a panel is never nested inside two
// scrollers, because this host never introduces one) without either of those
// regressions, and costs nothing: every panel's own scrolling and its FAB
// were already shipped and already correct, standalone and embedded alike.
//
// `plan-hub` IS RETIRED. `plan-segments-screen` is the one testID this
// revamp does not preserve under its old name — the screen it identified (a
// scrollable stack of section cards) no longer exists.
import { useState } from "react";
import { View } from "react-native";

import { BillsPanel } from "@/components/plan/bills_panel";
import { GoalsPanel } from "@/components/plan/goals_panel";
import { LimitsPanel } from "@/components/plan/limits_panel";
import { UtangPanel } from "@/components/plan/utang_panel";
import { SegmentedControl } from "@/components/ui/segmented_control";

type PlanSegment = "limits" | "goals" | "utang" | "bills";

// `as const satisfies` — not a bare `as const` — pins every `value` to the
// `PlanSegment` union AND keeps each literal narrow. `SegmentedControl`'s
// `value`/`onChange` are typed `NoInfer<T>` specifically so `T` can only be
// inferred from this array; typed any looser (a plain `string[]`, or a cast
// straight to `Segment<PlanSegment>[]` that drops the literal types), a
// stale or mistyped segment value below would silently widen `T` to `string`
// and compile instead of failing — see segmented_control.tsx's own header
// for the mechanism.
const SEGMENTS = [
  { value: "limits", label: "Limits" },
  { value: "goals", label: "Goals" },
  // "Utang" is the user-facing word (mobile-ui-revamp Part 2 Task 7). The
  // route stays `/plan/loans`, the domain type stays `Loan`, and every
  // `loan_*`/`loans_*` file keeps its name — this line is a copy change, not
  // a rename, and renaming the route would break every deep link already
  // written against it for no reason beyond the label.
  { value: "utang", label: "Utang" },
  { value: "bills", label: "Bills" },
] as const satisfies ReadonlyArray<{ value: PlanSegment; label: string }>;

export default function PlanScreen() {
  const [segment, setSegment] = useState<PlanSegment>("limits");

  return (
    <View testID="plan-segments-screen" className="flex-1 bg-bg dark:bg-bg-dark">
      <View className="px-4 pb-2 pt-4">
        <SegmentedControl
          testID="plan-segments"
          segments={SEGMENTS}
          value={segment}
          onChange={setSegment}
        />
      </View>
      {/* A plain View, not a ScrollView — see this file's header. Each panel
          fills it (every panel's own root is already `flex-1`) and scrolls
          itself exactly as it does when rendered standalone. */}
      <View className="flex-1">
        {segment === "limits" ? <LimitsPanel /> : null}
        {segment === "goals" ? <GoalsPanel /> : null}
        {segment === "utang" ? <UtangPanel /> : null}
        {segment === "bills" ? <BillsPanel /> : null}
      </View>
    </View>
  );
}
