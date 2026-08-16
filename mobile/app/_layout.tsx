// app/_layout.tsx — root provider tree (STACK_BASIS §16, minus auth/contacts:
// this app is local-first with no login). Outer to inner:
// KeyboardProvider -> ThemeProvider -> LockProvider -> (once unlocked)
// PersistQueryClientProvider -> Stack.
//
// Renders null until the font face is loaded AND the theme preference has
// rehydrated (task-17-brief.md rule 1) AND the app lock reports "unlocked"
// AND bootstrapApp() has resolved — four conditions, not three: Task 9
// (docs/12-encryption-and-app-lock.md §7; interface contract §10) added the
// app lock as the fourth. Render any earlier and the user either sees a
// flash of unstyled, wrong-theme content on every cold start, or — the
// reason the lock condition exists at all — a locked phone's financial data
// rendered before anyone authenticated.
//
// WHY BOOTSTRAP WAITS FOR UNLOCKED, NOT THE OTHER WAY AROUND: bootstrapApp()
// calls getDatabase(), which THROWS DatabaseLockedError until
// unlockDatabase(dek) has run (lib/db/database.ts). The lock sequence (get
// the DEK, unlockDatabase(dek), setCacheEncryptionKey(dek) — all three, in
// that order, live in contexts/lock_context.tsx) must complete BEFORE
// bootstrap is even attempted, not just before the Stack renders.
//
// WHY PersistQueryClientProvider MOVED INSIDE THE LOCK GATE: it used to wrap
// the entire tree unconditionally, mounting (and triggering its own
// persisted-cache restore) long before unlock ever ran.
// lib/query_client.ts's setCacheEncryptionKey doc is explicit that the key
// "MUST be called ... before PersistQueryClientProvider's persister reads or
// writes anything — concretely, before it mounts." The only way to make that
// literally true (rather than merely "before the first read succeeds by
// accident") is to not mount the provider at all until AFTER unlock has
// already called setCacheEncryptionKey — so it now wraps only the
// post-unlock subtree. Nothing above this file's Stack/tabs ever reads
// react-query, so nothing lost access by moving it.
//
// A throwing bootstrap does not leave the screen permanently blank
// (task-17-brief.md rule 2): it renders a plain, themed recovery screen with
// a "Try again" action that re-invokes bootstrapApp(), instead of a white
// void the user has no way to act on.
import { Inter_400Regular } from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { AllocationSheet } from "@/components/goals/allocation_sheet";
import { PaydayDetectedSheet } from "@/components/income/payday_detected_sheet";
import { palette } from "@/constants/colors";
import { ThemeProvider, useTheme } from "@/contexts/theme_context";
import { LockProvider, useLock } from "@/contexts/lock_context";
import { systemClock } from "@/lib/clock";
import { applyGlobalFont } from "@/lib/fonts";
import { bootstrapApp, startNetworkSyncSubscriber } from "@/lib/bootstrap";
import { useApplyAllocations } from "@/hooks/mutations/use_apply_allocations";
import { usePaydayAllocations } from "@/hooks/use_payday_allocations";
import { BILL_HORIZON_DAYS } from "@/hooks/queries/use_bills";
import { startIncomeLedgerSubscriber } from "@/lib/income/income_ledger_subscriber";
import { startRecurringLedgerSubscriber } from "@/lib/recurring/recurring_ledger_subscriber";
import { listBillStatuses } from "@/lib/bills/bills_service";
import { postOverdueNotices, scheduleBillReminders } from "@/lib/bills/bill_reminders";
import { listLoanStatuses } from "@/lib/loans/loans_service";
import { scheduleLoanReminders } from "@/lib/loans/loan_reminders";
import { startIngest } from "@/lib/ingest/pipeline";
import { persistOptions, queryClient } from "@/lib/query_client";
import LockScreen from "./lock";

// Must run before the first render so the very first frame uses Inter, not
// the system font (lib/fonts.ts).
applyGlobalFont();

type BootstrapState = "pending" | "ready" | "error";

function BootstrapErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View
      testID="bootstrap-error"
      className="flex-1 items-center justify-center gap-4 bg-bg px-6 dark:bg-bg-dark"
    >
      <Text className="text-center text-lg font-semibold text-fg dark:text-fg-dark">
        PeraPlano couldn't start
      </Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Something went wrong preparing your data. You can try again, or close and reopen the app.
      </Text>
      <Pressable
        testID="bootstrap-retry"
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        className="rounded-lg bg-brand px-4 py-3 dark:bg-brand-dark"
      >
        <Text className="font-semibold text-surface dark:text-surface-dark">Try again</Text>
      </Pressable>
    </View>
  );
}

/**
 * The payday summary and the goals prompt it hands off to (m2b Task 9 rule 2).
 *
 * ITS OWN COMPONENT BECAUSE OF WHERE THE PROVIDER IS. `useApplyAllocations`
 * calls `useQueryClient()`, and PersistQueryClientProvider deliberately mounts
 * INSIDE AppShell, below the lock gate (see this file's header). Calling the
 * hook in AppShell itself throws "No QueryClient set" on every cold start,
 * before the lock screen gets a chance to render — which is what the shell
 * tests caught.
 *
 * Mounting the subscription down here costs nothing: payday events originate
 * from the income ledger subscriber, which does not start until bootstrap has
 * resolved either.
 */
function PaydaySheets() {
  // Extracted into a hook so the rule can be tested without a
  // fonts/theme/lock/bootstrap shell (app/__tests__/plan_hub.test.tsx).
  const { payday, proposals, paydayAmount, acknowledgePayday, dismissAllocations } =
    usePaydayAllocations();
  const applyAllocations = useApplyAllocations();

  return (
    <>
      {/* A payday summary first, then the allocation prompt it hands off to
          (m2-part2 Task 13 rule 5). Two sheets open at once would cover each
          other. */}
      <PaydayDetectedSheet payday={payday} onDismiss={acknowledgePayday} />
      <AllocationSheet
        visible={proposals.length > 0}
        proposals={proposals}
        paydayAmount={paydayAmount}
        busy={applyAllocations.isPending}
        onDismiss={dismissAllocations}
        onConfirm={async (accepted) => {
          await applyAllocations.mutateAsync(accepted);
          dismissAllocations();
        }}
      />
    </>
  );
}

/** Mounted unconditionally inside ThemeProvider/LockProvider so bootstrapApp()
 * starts as soon as (and only once) the lock reports "unlocked" — see this
 * file's header comment for why bootstrap cannot run any earlier. */
function AppShell({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { resolved, isReady: themeReady } = useTheme();
  const { status: lockStatus } = useLock();
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>("pending");

  const runBootstrap = useCallback(() => {
    setBootstrapState("pending");
    bootstrapApp()
      .then(() => setBootstrapState("ready"))
      .catch((error: unknown) => {
        console.error("bootstrapApp failed to start the app", error);
        setBootstrapState("error");
      });
  }, []);

  // Deliberately gated on lockStatus, not fired unconditionally on mount —
  // bootstrapApp() would throw DatabaseLockedError if it ran before unlock.
  //
  // MUST depend on lockStatus ALONE, not on bootstrapState: an earlier
  // version also depended on bootstrapState (to skip re-running once
  // already "ready") and re-introduced exactly the "forever-looping" bug
  // class this whole plan warns about — a rejected bootstrapApp() sets
  // bootstrapState to "error", which is itself a CHANGE the effect would
  // then react to ("error" !== "ready" is still true), calling
  // runBootstrap() again, rejecting again, forever, with no user action in
  // between. Depending on lockStatus only means this effect re-fires
  // exactly on a locked<->unlocked transition — a real re-unlock after the
  // five-minute background timeout — and never merely because bootstrap's
  // own state changed.
  useEffect(() => {
    if (lockStatus === "unlocked") {
      runBootstrap();
    }
  }, [lockStatus, runBootstrap]);

  // Ingest starts only once bootstrap has succeeded — the pipeline reads the
  // parser ruleset bootstrap seeds, and starting first would drain the native
  // buffer with no rules to parse it against.
  //
  // NOTHING HERE MAY BLOCK OR BREAK THE APP (plan Task 11 rule 3). The whole
  // effect is fire-and-forget with its own catch: a broken parser, a failed
  // drain, a rejected Keystore auth — none of them may keep the UI from
  // rendering. The user can still read their ledger and fix things by hand;
  // an app that will not open cannot be fixed at all.
  useEffect(() => {
    if (bootstrapState !== "ready") return;

    let stop: (() => void) | null = null;
    let cancelled = false;

    startIngest()
      .then((unsubscribe) => {
        // Unmounted before the drain finished: tear down immediately rather
        // than leaking a live subscription into a dead tree.
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((error: unknown) => {
        console.error("startIngest failed; the app runs without live capture", error);
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [bootstrapState]);

  // Income detection re-runs on ledger commits, debounced (m2-part2 Task 14
  // rule 2). Same gate and the same fire-and-forget discipline as ingest above:
  // the subscriber swallows its own failures, so nothing here can keep the UI
  // from rendering.
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    return startIncomeLedgerSubscriber();
  }, [bootstrapState]);

  // Recurring-pattern detection re-runs on ledger commits, debounced (M3 Part
  // 2 Task 7 rule 2 — the one-shot pass runs once in bootstrapApp() instead;
  // this is the ongoing half). Same gate and the same fire-and-forget
  // discipline as income right above: the subscriber swallows its own
  // failures, so nothing here can keep the UI from rendering.
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    return startRecurringLedgerSubscriber();
  }, [bootstrapState]);

  // Ruleset check and telemetry send, re-fired on every foreground (M3c Task
  // 7 rule 3 — the initial fire-and-forget call runs once in bootstrapApp()
  // instead; this is the ongoing half, same split as recurring detection's
  // one-shot-in-bootstrap vs. ongoing-subscriber-here above). Same gate as
  // every effect in this shell: `startNetworkSyncSubscriber`
  // (lib/bootstrap.ts) subscribes to AppState itself and does its own
  // fire-and-forget, so nothing here can block or break rendering, and
  // neither call is awaited on a foreground any more than it was at launch.
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    return startNetworkSyncSubscriber();
  }, [bootstrapState]);

  // Loan reminders, rescheduled once per launch (m2b Task 9 rule 3) so they
  // survive a reinstall or an OS reboot, which drop every queued notification.
  //
  // HERE RATHER THAN INSIDE bootstrapApp(), which the plan asks for: scheduling
  // reaches `expo-notifications` and the `NotificationListener` native module,
  // and `lib/bootstrap.ts` is imported by tests that mock nothing. Same gate
  // and the same fire-and-forget discipline as ingest above — a failed
  // reminder must never keep the app from rendering.
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    const now = systemClock.now();
    listLoanStatuses(now)
      .then((statuses) => scheduleLoanReminders(statuses, now))
      .catch((error: unknown) => {
        console.warn("loan reminders could not be scheduled", error);
      });
  }, [bootstrapState]);

  // Bill reminders and overdue escalation, once per launch (m2c Task 6 rules 2
  // and 3). Here rather than inside bootstrapApp() for the same reason as the
  // loans above, and IDEMPOTENT BY CONSTRUCTION: `scheduleBillReminders`
  // cancels every previously stored id before queueing, so running twice in one
  // launch cannot stack two notifications for the same occurrence.
  //
  // The overdue pass comes SECOND and posts immediately — spec rule 22's
  // escalation is about a state that is true right now, and its per-cycle count
  // lives in the database, so a relaunch does not restart the nagging.
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    const now = systemClock.now();
    listBillStatuses(now, BILL_HORIZON_DAYS)
      .then(async (statuses) => {
        await scheduleBillReminders(statuses, now);
        await postOverdueNotices(statuses);
      })
      .catch((error: unknown) => {
        console.warn("bill reminders could not be scheduled", error);
      });
  }, [bootstrapState]);

  // Fonts, theme, and the lock's own "checking" phase all render nothing —
  // the same bucket pre-Task-9 fonts/theme/bootstrap already shared.
  if (!fontsLoaded || !themeReady || lockStatus === "checking") {
    return null;
  }

  // The fourth render-gate condition (contract §10): anything other than
  // "unlocked" shows the lock screen instead of the app, full stop —
  // including while bootstrap would otherwise be pending/erroring, since
  // bootstrap cannot have even started yet without a DEK.
  if (lockStatus !== "unlocked") {
    return <LockScreen />;
  }

  const bg = resolved === "dark" ? palette["bg-dark"] : palette.bg;
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {bootstrapState === "pending" ? null : bootstrapState === "error" ? (
        <BootstrapErrorScreen onRetry={runBootstrap} />
      ) : (
        <>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />
          <StatusBar style="auto" />
          <PaydaySheets />
        </>
      )}
    </PersistQueryClientProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular });

  return (
    <KeyboardProvider>
      <ThemeProvider>
        <LockProvider>
          <AppShell fontsLoaded={fontsLoaded} />
        </LockProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
