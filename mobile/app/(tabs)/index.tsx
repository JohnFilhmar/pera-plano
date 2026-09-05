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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { AlertsFeed, deriveHomeAlerts } from "@/components/home/alerts_feed";
import { GreetingHeader } from "@/components/home/greeting_header";
import { LimitProgressList } from "@/components/home/limit_progress_list";
import { ProjectionSparkline } from "@/components/home/projection_sparkline";
import { SafeToSpendHero } from "@/components/home/safe_to_spend_hero";
import { TrackingBanner } from "@/components/home/tracking_banner";
import { UpcomingBillsStrip } from "@/components/home/upcoming_bills_strip";
import { UtangStrip } from "@/components/home/utang_strip";
import { PlusGate } from "@/components/gates/plus_gate";
import { BrandMark } from "@/components/ui/brand_mark";
import { LAUNCH_MS } from "@/components/ui/brand_mark_motion";
import { EmptyState } from "@/components/ui/empty_state";
import { getEmptyStateCopy } from "@/components/ui/empty_states";
import { Fab } from "@/components/ui/fab";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { StatTile } from "@/components/ui/stat_tile";
import { queryKeys } from "@/constants/query_keys";
import { useSetCaptureEnabled } from "@/hooks/mutations/use_set_capture_enabled";
import { useBills } from "@/hooks/queries/use_bills";
import { useCategories } from "@/hooks/queries/use_categories";
import { useDailySpend } from "@/hooks/queries/use_daily_spend";
import { useGoals } from "@/hooks/queries/use_goals";
import { useLoans } from "@/hooks/queries/use_loans";
import { useLimitStatuses } from "@/hooks/queries/use_limit_statuses";
import { useListenerHealth } from "@/hooks/queries/use_listener_health";
import { useSafeToSpend } from "@/hooks/queries/use_safe_to_spend";
import { useSafeToSpendInput } from "@/hooks/queries/use_safe_to_spend_input";
import { useTransactions } from "@/hooks/queries/use_transactions";
import { useWallets } from "@/hooks/queries/use_wallets";
import { systemClock } from "@/lib/clock";
import { onAppEvent } from "@/lib/events/app_events";
import { projectToPeriodEnd } from "@/lib/safe_to_spend_projection";
import { totalActiveBalance } from "@/lib/wallets/summary";

const HOME_EMPTY = getEmptyStateCopy("home");

const SCOPE_LABEL: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  annual: "yearly",
};

/** Sunday-first, matching `Date#getDay()`'s own 0..6 numbering. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: result } = useSafeToSpend();
  const { data: limits } = useLimitStatuses();
  const { data: bills } = useBills();
  const { data: health } = useListenerHealth();
  const { data: categories } = useCategories();
  const { data: dailySeries } = useDailySpend(7);
  const { data: wallets } = useWallets();
  const { data: goals } = useGoals();
  const { data: loans } = useLoans();
  const setCaptureEnabled = useSetCaptureEnabled();
  const [amountsHidden, setAmountsHidden] = useState(false);
  // IA §5's "Home" row: only reached for its OWN reason — a healthy listener
  // with nothing captured yet — never for a stopped one, which TrackingBanner
  // already owns above. `{}` matches the Transactions tab's own unfiltered
  // query key, so this shares that cache entry rather than opening a second.
  //
  // STILL `{}`, NOT `{ limit: 1 }`: `TxFilter` (types/domain.ts) has no
  // `limit` field — only `walletId`, `categoryId`, `from`, `to`, `direction`
  // and `excludeTransferLinked` — so narrowing this read to one row is a
  // follow-up on `listTransactions`/`TxFilter` itself, not something to
  // invent a field for here. It costs nothing new either way: the hero's own
  // bar strip now reads `useDailySpend` instead of this query, which was the
  // expensive part.
  const { data: transactions } = useTransactions({});

  const categoryNames = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category.name])),
    [categories],
  );

  // task-7-brief.md Step 4: "First auto-capture — plays when the ledger
  // commits its first transaction ever." The gate reads THIS ref, not
  // `transactions` itself, from inside the event handler below — the
  // handler is registered once (deps: [queryClient]) and a plain closure
  // over `transactions` would freeze on whatever it was at that first
  // subscription. Kept current on every render instead of re-subscribing the
  // listener on every ledger change.
  const transactionsCountRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    transactionsCountRef.current = transactions?.length;
  }, [transactions]);

  const [firstCapturePlayToken, setFirstCapturePlayToken] = useState(0);
  const [showFirstCaptureMark, setShowFirstCaptureMark] = useState(false);

  useEffect(() => {
    if (!showFirstCaptureMark) return;
    const timer = setTimeout(() => setShowFirstCaptureMark(false), LAUNCH_MS);
    return () => clearTimeout(timer);
  }, [showFirstCaptureMark]);

  // Rule 6: a notification captured seconds ago must be reflected without a
  // manual pull. The ledger event is the only signal that a number changed
  // while the user was looking at it.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onAppEvent("ledger:committed", async () => {
      // Read BEFORE invalidating — "first ever", not "the ledger currently
      // has one row", which is already true by the time invalidation lands.
      const ledgerWasEmpty = transactionsCountRef.current === 0;

      await queryClient.invalidateQueries({ queryKey: queryKeys.safeToSpend.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.limits.all });
      // AND TRANSACTIONS, so the "watching for your first transaction" empty
      // state above clears itself the moment one actually lands — without
      // this the first capture of a session would leave that card showing
      // stale, since nothing else on this screen re-reads the ledger.
      await queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });

      if (ledgerWasEmpty) {
        // task-7-brief.md's own hazard note: this handler runs off a
        // notification-driven ledger commit, so the JS thread may still be
        // busy parsing it. Deferred one frame past the commit rather than
        // played inline with the invalidations above.
        requestAnimationFrame(() => {
          if (cancelled) return;
          setFirstCapturePlayToken((token) => token + 1);
          setShowFirstCaptureMark(true);
        });
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [queryClient]);

  // INVALIDATES THE ROOT rather than refetching the hero's own query. The Plus
  // projection reads a SECOND query under that root (`useSafeToSpendInput`),
  // and a bare `refetch()` on the hero leaves the curve drawn from limits and
  // bills the number above it no longer agrees with.
  const refreshSafeToSpend = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.safeToSpend.all }),
    [queryClient],
  );

  // ...and on focus, because a day can roll over while the app sits in the
  // background and the period would otherwise be yesterday's.
  useFocusEffect(
    useCallback(() => {
      void refreshSafeToSpend();
    }, [refreshSafeToSpend]),
  );

  // Found once, read twice: the tile row's "Spent so far" below reads this
  // same status's `.spend` rather than re-deriving driving-limit lookup logic
  // a second time.
  const drivingStatus = limits?.find((status) => status.limit.id === result?.drivingLimitId);
  const drivingScope = drivingStatus?.limit.scope;

  const alerts = useMemo(
    () => deriveHomeAlerts(limits, bills, categoryNames),
    [limits, bills, categoryNames],
  );

  // The strip is the seven days ENDING today, so the first label is six days
  // back. `getDay()` is 0 (Sun) through 6 (Sat); hardcoding "Mon" and "Sun" —
  // the design board's own literal labels — is only right one day in seven.
  //
  // READS `systemClock`, NOT A BARE `new Date()` — this is a composition edge
  // (lib/clock.ts's own rule: "only the composition edges ... reach for
  // systemClock"), the same seam `useDailySpend`'s own `endingOn` already
  // goes through for this identical bar strip. Going around it would leave
  // the wraparound at both ends of the week (Sat -> Sun, Sun -> Mon)
  // untestable except by waiting for the calendar to land on those two days.
  const todayIndex = new Date(systemClock.now()).getDay();
  const seriesStartLabel = WEEKDAYS[(todayIndex + 1) % 7];
  const seriesEndLabel = WEEKDAYS[todayIndex];

  // A paused hero is not a fourth colour (safe_to_spend_hero.tsx) — it is
  // "this number might be stale". Any of the three ways capture can be down
  // triggers it: access revoked, the service disconnected, or the user's own
  // pause switch.
  const paused =
    health !== undefined &&
    (health.granted === false || !health.serviceConnected || !health.captureEnabled);

  const periodLabel =
    drivingScope === undefined ? "No limit set" : `${SCOPE_LABEL[drivingScope]} period`;

  if (result === undefined) {
    return (
      <View testID="home-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={6} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView
        testID="home"
        className="flex-1"
        contentContainerClassName="gap-5 p-4"
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => void refreshSafeToSpend()} />
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
          // `withAnchor` ON EVERY PUSH THAT LEAVES THIS TAB. Home is in one tab and each
          // of these targets is a screen inside another tab's Stack. Pushed without an
          // anchor on a cold start, the target becomes that stack's only entry: no Back,
          // and the tab button returns to the same screen. `unstable_settings` in the
          // two nested layouts covers the deep-link case; this covers the in-app tap,
          // which is the one the owner hit.
          onFix={() => router.push("/more/listener_health", { withAnchor: true })}
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

        <GreetingHeader testID="home-greeting" periodLabel={periodLabel} />

        <SafeToSpendHero
          result={result}
          scopeLabel={drivingScope === undefined ? null : SCOPE_LABEL[drivingScope]}
          dailySeries={dailySeries ?? []}
          startLabel={seriesStartLabel}
          endLabel={seriesEndLabel}
          paused={paused}
          amountsHidden={amountsHidden}
          onToggleAmounts={() => setAmountsHidden((hidden) => !hidden)}
          onSetLimit={() => router.push("/plan/limits/new", { withAnchor: true })}
          onOpenReviewQueue={() => router.push("/review")}
        />

        <View testID="home-stat-tiles" className="flex-row gap-3">
          <StatTile
            testID="home-stat-balance"
            label="Balance"
            amount={totalActiveBalance(wallets ?? [])}
          />
          <StatTile
            testID="home-stat-spent"
            label="Spent so far"
            amount={result.state === "no_limit" ? 0 : (drivingStatus?.spend ?? 0)}
            // PAUSED FIRST. The hero two elements above stops asserting a
            // spending verdict the moment capture might be stale — grey
            // instead of green/amber/red — and this tile signals the same
            // "Spent so far" figure by tone, so it has to stand down for the
            // identical reason: painting it red or amber immediately beneath
            // a hero that has deliberately gone neutral would assert the
            // exact verdict the hero just withheld.
            tone={
              paused
                ? "neutral"
                : result.state === "over"
                  ? "danger"
                  : result.state === "tight"
                    ? "warn"
                    : "neutral"
            }
          />
          <StatTile
            testID="home-stat-saved"
            label="Saved"
            amount={(goals ?? []).reduce((sum, status) => sum + status.progress.saved, 0)}
            tone="brand"
          />
        </View>

        {/* Free sees today's number only; the curve is Plus (contract §7). */}
        <PlusGate capability="projection">
          <ProjectionCurve />
        </PlusGate>

        <AlertsFeed
          alerts={alerts}
          onOpen={(alert) => {
            if (alert.target.kind === "bill") {
              router.push(
                {
                  pathname: "/plan/bills/[id]",
                  params: { id: alert.target.billId, dueDate: alert.target.dueDate },
                },
                { withAnchor: true },
              );
            } else {
              router.push(
                { pathname: "/plan/limits/[id]", params: { id: alert.target.limitId } },
                { withAnchor: true },
              );
            }
          }}
        />

        <UpcomingBillsStrip
          statuses={bills}
          onOpen={(billId, dueDate) =>
            router.push(
              { pathname: "/plan/bills/[id]", params: { id: billId, dueDate } },
              { withAnchor: true },
            )
          }
        />

        {/* Below "Coming up" and above the limits, because that is the order of
            claims on the user's money: this period's committed bills, then what
            is owed outside this period, then the caps the rest is measured
            against. It renders nothing at all when nothing is owed. */}
        <UtangStrip
          statuses={loans}
          // `systemClock`, not `Date.now()` — the same composition-edge rule
          // `todayIndex` above follows, and what lets a "due in 3d" countdown
          // be an ordinary fixture in a test.
          now={systemClock.now()}
          onOpen={(loanId) =>
            router.push({ pathname: "/plan/loans/[id]", params: { id: loanId } }, { withAnchor: true })
          }
          onSeeAll={() => router.push("/plan/loans", { withAnchor: true })}
        />

        <LimitProgressList
          statuses={limits}
          categoryNames={categoryNames}
          onOpen={(limitId) =>
            router.push({ pathname: "/plan/limits/[id]", params: { id: limitId } }, { withAnchor: true })
          }
        />

        {/* Clears the tab bar above AND the floating add button below it. */}
        <View className="h-20" />
      </ScrollView>

      <View className="absolute bottom-6 right-6">
        <Fab
          testID="home-add"
          onPress={() => router.push("/transaction/new")}
          accessibilityLabel="Add a transaction"
        />
      </View>

      {/* First auto-capture (task-7-brief.md Step 4) — non-blocking, so it
          never sits between the user and the Fab or the list beneath it. */}
      {showFirstCaptureMark ? (
        <View
          testID="home-first-capture"
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center"
        >
          <BrandMark
            testID="home-first-capture-mark"
            variant="launch"
            playToken={firstCapturePlayToken}
            size={64}
          />
        </View>
      ) : null}
    </View>
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
