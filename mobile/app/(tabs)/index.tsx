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
import { EmptyState } from "@/components/ui/empty_state";
import { getEmptyStateCopy } from "@/components/ui/empty_states";
import { queryKeys } from "@/constants/query_keys";
import { useSetCaptureEnabled } from "@/hooks/mutations/use_set_capture_enabled";
import { useBills } from "@/hooks/queries/use_bills";
import { useCategories } from "@/hooks/queries/use_categories";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { useListenerHealth } from "@/hooks/queries/use_listener_health";
import { useSafeToSpend } from "@/hooks/queries/use_safe_to_spend";
import { useSafeToSpendInput } from "@/hooks/queries/use_safe_to_spend_input";
import { useTransactions } from "@/hooks/queries/use_transactions";
import { onAppEvent } from "@/lib/events/app_events";
import { projectToPeriodEnd } from "@/lib/safe_to_spend_projection";

const HOME_EMPTY = getEmptyStateCopy("home");

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
  const setCaptureEnabled = useSetCaptureEnabled();
  // IA §5's "Home" row: only reached for its OWN reason — a healthy listener
  // with nothing captured yet — never for a stopped one, which TrackingBanner
  // already owns above. `{}` matches the Transactions tab's own unfiltered
  // query key, so this shares that cache entry rather than opening a second.
  const { data: transactions } = useTransactions({});

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
      // AND TRANSACTIONS, so the "watching for your first transaction" empty
      // state above clears itself the moment one actually lands — without
      // this the first capture of a session would leave that card showing
      // stale, since nothing else on this screen re-reads the ledger.
      await queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
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
        // THE SAME PATH THE PRIVACY TOGGLE USES, not a direct `setSetting`
        // write. `useSetCaptureEnabled` is native-first, settings-second (see
        // its own doc): it calls the native `setCaptureEnabled` before
        // touching `app_settings`, which is what keeps this resume button
        // from reporting capture ON everywhere while the native listener's
        // SharedPreferences flag stays OFF underneath it — exactly what a
        // direct `setSetting("capture_enabled", true)` here used to risk.
        onResume={() => setCaptureEnabled.mutate(true)}
        // The listener-health screen (m3b Task 7) is the destination this
        // action always wanted — the detailed view behind this exact banner.
        onFix={() => router.push("/more/listener_health")}
      />

      {/* IA §5's "Home" row, reached ONLY when the listener is healthy — a
          stopped or paused listener is TrackingBanner's story above, not
          this one, per the row's own "if Notification Access missing: setup
          card instead" clause. */}
      {health?.granted === true &&
      health.serviceConnected &&
      health.captureEnabled &&
      transactions !== undefined &&
      transactions.length === 0 ? (
        <EmptyState
          testID="home-empty"
          title={HOME_EMPTY.title}
          body={HOME_EMPTY.body}
          action={
            HOME_EMPTY.actionLabel === undefined
              ? undefined
              : { label: HOME_EMPTY.actionLabel, onPress: () => router.push("/transaction/new") }
          }
        />
      ) : null}

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
