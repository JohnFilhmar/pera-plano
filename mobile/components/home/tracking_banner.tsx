// components/home/tracking_banner.tsx — M3 Part 2 Task 4, rule 5.
//
// "Silence about a tracking gap would make every number on the screen a lie."
// Safe-to-Spend, limits, wallet balances — all of them assume the ledger is
// complete. When capture stops, they are all quietly wrong, and only this
// banner can say so.
//
// TWO VARIANTS, AND THE DIFFERENCE IS WHOSE FAULT IT IS. Paused is the user's
// own choice and reads neutrally; interrupted is a fault and reads as one.
// Showing a fault banner to someone who paused on purpose trains them to
// ignore it — which means they will also ignore the real one.
import { Pressable, Text, View } from "react-native";

import type { TrackingHealth } from "@/hooks/queries/use_listener_health";
import { formatDateTime } from "@/lib/datetime";
import { ISOLATED_LINK_HIT_SLOP } from "@/lib/ui/hit_slop";

export type TrackingBannerProps = {
  health: TrackingHealth | undefined;
  onResume: () => void;
  onFix: () => void;
  testID?: string;
};

/**
 * Nothing at all when capture is healthy. A permanent "tracking is on" badge
 * is noise that makes the abnormal case harder to notice, not easier.
 */
export function TrackingBanner({ health, onResume, onFix, testID }: TrackingBannerProps) {
  if (health === undefined) return null;

  // The user's own switch comes FIRST: someone who paused deliberately should
  // not also be told their listener is disconnected, which is a consequence of
  // pausing rather than a second problem.
  if (!health.captureEnabled) {
    return (
      <View
        testID={testID ?? "tracking-paused"}
        className="flex-row items-center justify-between rounded-lg bg-surface px-4 py-3 dark:bg-surface-dark"
      >
        <Text className="flex-1 pr-3 text-fg-2 dark:text-fg-2-dark">
          Tracking is paused. Nothing is being recorded.
        </Text>
        {/* Touch target (design F1 sweep): no padding class, unstyled
            default-size text, no size guarantee — the identical shape
            app/wallet/[id].tsx's "Edit" shipped with. No sibling Pressable
            within slop distance (the row's other child is plain, inert
            text), so the isolated, uniform slop applies as-is. */}
        <Pressable
          testID="tracking-resume"
          accessibilityRole="button"
          onPress={onResume}
          hitSlop={ISOLATED_LINK_HIT_SLOP}
        >
          <Text className="font-semibold text-brand dark:text-brand-dark">Resume</Text>
        </Pressable>
      </View>
    );
  }

  if (health.granted && health.serviceConnected) return null;

  // STATES THE GAP HONESTLY (rule 5). "Since 3:40 PM yesterday" is actionable;
  // "something went wrong" is not, and a user who cannot see how much they
  // have lost cannot decide whether to reconcile.
  const since =
    health.lastCaptureAt === null
      ? "Nothing has been captured yet."
      : `Nothing has been recorded since ${formatDateTime(health.lastCaptureAt)}.`;

  return (
    <View
      testID={testID ?? "tracking-interrupted"}
      className="gap-2 rounded-lg bg-danger px-4 py-3 dark:bg-danger-dark"
    >
      <Text className="font-semibold text-surface dark:text-surface-dark">
        Tracking stopped
      </Text>
      <Text className="text-surface dark:text-surface-dark">
        {`${since} Your balances and limits may be out of date.`}
      </Text>
      <Pressable
        testID="tracking-fix"
        accessibilityRole="button"
        onPress={onFix}
        hitSlop={ISOLATED_LINK_HIT_SLOP}
      >
        <Text className="font-semibold text-surface underline dark:text-surface-dark">
          Fix tracking
        </Text>
      </Pressable>
    </View>
  );
}
