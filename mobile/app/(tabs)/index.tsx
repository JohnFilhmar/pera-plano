// app/(tabs)/index.tsx — the Home tab (M3 Part 2 Task 4;
// docs/06-information-architecture.md §3.1).
//
// ONE NUMBER, THEN ITS CONTEXT. The hero answers "can I spend today"; every
// section beneath it answers "why is it that number" — what needs attention,
// what limits are running, what bills were already subtracted. A user who
// distrusts the figure must be able to find its parts without leaving.
//
// THE TRACKING BANNER IS FIRST FOR A REASON. If capture has stopped, every
// other number on this screen is stale — so the caveat precedes the claims.
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { AlertsFeed, deriveHomeAlerts } from "@/components/home/alerts_feed";
import { LimitProgressList } from "@/components/home/limit_progress_list";
import { ProjectionSparkline } from "@/components/home/projection_sparkline";
import { SafeToSpendHero } from "@/components/home/safe_to_spend_hero";
import { TrackingBanner } from "@/components/home/tracking_banner";
import { UpcomingBillsStrip } from "@/components/home/upcoming_bills_strip";
import { PlusGate } from "@/components/gates/plus_gate";
import { queryKeys } from "@/constants/query_keys";
import { useBills } from "@/hooks/queries/use_bills";
import { useCategories } from "@/hooks/queries/use_categories";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { useListenerHealth } from "@/hooks/queries/use_listener_health";
import { useSafeToSpend } from "@/hooks/queries/use_safe_to_spend";
import { useSafeToSpendInput } from "@/hooks/queries/use_safe_to_spend_input";
import { onAppEvent } from "@/lib/events/app_events";
import { projectToPeriodEnd } from "@/lib/safe_to_spend_projection";
import { setSetting } from "@/lib/db/repos/app_settings_repo";

const SCOPE_LABEL: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  annual: "yearly",
};

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: result, refetch: refetchSafeToSpend } = useSafeToSpend();
  const { data: limits } = useLimitStatuses();
  const { data: bills } = useBills();
  const { data: health } = useListenerHealth();
  const { data: categories } = useCategories();

  const categoryNames = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category.name])),
    [categories],
  );

  // Rule 6: a notification captured seconds ago must be reflected without a
  // manual pull. The ledger event is the only signal that a number changed
  // while the user was looking at it.
  useEffect(() => {
    return onAppEvent("ledger:committed", async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.safeToSpend.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.limits.all });
    });
  }, [queryClient]);

  // ...and on focus, because a day can roll over while the app sits in the
  // background and the period would otherwise be yesterday's.
  useFocusEffect(
    useCallback(() => {
      void refetchSafeToSpend();
    }, [refetchSafeToSpend]),
  );

  const drivingScope = limits?.find(
    (status) => status.limit.id === result?.drivingLimitId,
  )?.limit.scope;

  const alerts = useMemo(
    () => deriveHomeAlerts(limits, bills, categoryNames),
    [limits, bills, categoryNames],
  );

  if (result === undefined) {
    return <View testID="home-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  return (
    <ScrollView
      testID="home"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-5 p-4"
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => void refetchSafeToSpend()} />
      }
    >
      <TrackingBanner
        health={health}
        onResume={async () => {
          await setSetting("capture_enabled", true);
          await queryClient.invalidateQueries({ queryKey: queryKeys.listenerHealth.all });
        }}
        // The listener-health screen (m3b Task 7) is the destination this
        // action always wanted — the detailed view behind this exact banner.
        onFix={() => router.push("/more/listener_health")}
      />

      <SafeToSpendHero
        result={result}
        scopeLabel={drivingScope === undefined ? null : SCOPE_LABEL[drivingScope]}
        onSetLimit={() => router.push("/plan/limits/new")}
        onOpenReviewQueue={() => router.push("/review")}
      />

      {/* Free sees today's number only; the curve is Plus (contract §7). */}
      <PlusGate capability="projection">
        <ProjectionCurve />
      </PlusGate>

      <AlertsFeed
        alerts={alerts}
        onOpen={(alert) => {
          if (alert.target.kind === "bill") {
            router.push({
              pathname: "/plan/bills/[id]",
              params: { id: alert.target.billId, dueDate: alert.target.dueDate },
            });
          } else {
            router.push({ pathname: "/plan/limits/[id]", params: { id: alert.target.limitId } });
          }
        }}
      />

      <UpcomingBillsStrip
        statuses={bills}
        onOpen={(billId, dueDate) =>
          router.push({ pathname: "/plan/bills/[id]", params: { id: billId, dueDate } })
        }
      />

      <LimitProgressList
        statuses={limits}
        categoryNames={categoryNames}
        onOpen={(limitId) => router.push({ pathname: "/plan/limits/[id]", params: { id: limitId } })}
      />

      {/* Clears the tab bar on short devices. */}
      <View className="h-8" />
    </ScrollView>
  );
}

/**
 * Split out so the projection is computed only when the gate lets it render —
 * `PlusGate` returns the upgrade prompt instead of its children on free, and a
 * curve computed for nobody is work done for nobody.
 */
function ProjectionCurve() {
  const { data: result } = useSafeToSpend();
  const { data: input } = useSafeToSpendInput();

  if (result === undefined || input === undefined) return null;
  return <ProjectionSparkline points={projectToPeriodEnd(input, result)} />;
}
