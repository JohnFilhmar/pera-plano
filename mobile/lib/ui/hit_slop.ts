// lib/ui/hit_slop.ts — touch-target compensation shared across hand-rolled
// controls that are not `components/ui/chip.tsx`'s `CHIP_HIT_SLOP` shape.
//
// WHY THIS IS A MODULE, THE SAME REASON lib/ui/contrast.ts IS ONE. The
// whole-branch review that found `app/wallet/[id].tsx`'s "Edit"/"+ Add" gap
// (design F1) also found the identical defect — a bare `Pressable` wrapping
// unpadded text, no `hitSlop`, no `min-h-[44px]` — independently reintroduced
// in five other files (`components/home/tracking_banner.tsx` ×2,
// `app/(tabs)/more/subscriptions.tsx`, `components/reports/range_picker.tsx`,
// `components/gates/upgrade_sheet.tsx`). Five copies of the same magic-number
// object is exactly the "same idea expressed five slightly different ways"
// drift this branch's own review keeps finding; one exported constant closes
// that the same way `CHIP_HIT_SLOP` already does for chips.
/**
 * For an ISOLATED text-link `Pressable` — no `onPress` sibling within a
 * `gap-*` row or column of it, unlike `Chip`'s own case. Every call site this
 * ships on today was verified individually (not assumed) to have no
 * interactive neighbour within the slop distance below.
 *
 * 16px on every edge. None of these five controls carries an explicit
 * `text-*` size class from `tailwind.config.ts`'s scale — each renders at
 * React Native's platform default, which this codebase's own eight-step
 * scale brackets between `badge` (10px/12px line-height) and `body`
 * (14px/20px); nothing on-scale in this app runs a plain link caption any
 * larger. Even at the top of that bracket (20px), the deficit to 44 is 24px,
 * needing only 12 top + 12 bottom — so 16 on every edge clears the full
 * plausible range with margin, rather than trusting a platform default this
 * file cannot measure directly. A control with a genuine adjacent Pressable
 * (a button stacked above it in a `gap-3` column, say) needs its own,
 * smaller, direction-capped value instead of this one — see
 * `components/lock/recovery_unlock_form.tsx` for that shape.
 */
export const ISOLATED_LINK_HIT_SLOP = { top: 16, bottom: 16, left: 16, right: 16 };
