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
// NATIVEWIND'S STYLESHEET. Without this import every `className` in the app is
// inert: metro.config.js compiles global.css and hands it to withNativeWind,
// but nothing registers the result unless the app imports it, so the classes
// resolve to nothing and every screen renders as unstyled primitives.
//
// Found on a physical device, not in tests: the recovery-phrase heading is
// `text-center` yet rendered left-aligned, and its `rounded-lg bg-brand px-6
// py-3` button rendered as full-width plain text. The dark background looked
// right only because this file sets colours from `palette` in JS, which
// disguised the failure.
import "../global.css";

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
// Aliased: this file already imports a ThemeProvider — ours, from
// contexts/theme_context.tsx, which holds the light/dark PREFERENCE. This one
// is react-navigation's, and it tells NAVIGATORS what to paint. Two different
// jobs that happen to share a name.
import { ThemeProvider as NavigationThemeProvider } from "@react-navigation/native";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { AllocationSheet } from "@/components/goals/allocation_sheet";
import { PaydayDetectedSheet } from "@/components/income/payday_detected_sheet";
import { KeypadHost } from "@/components/ui/keypad_host";
import { MutationErrorToast } from "@/components/ui/mutation_error_toast";
import { palette } from "@/constants/colors";
import { navThemeFor } from "@/constants/nav_theme";
import { ThemeProvider, useTheme } from "@/contexts/theme_context";
import { KeypadProvider } from "@/contexts/keypad_context";
import { LockProvider, useLock } from "@/contexts/lock_context";
import { systemClock } from "@/lib/clock";
import { applyGlobalFont } from "@/lib/fonts";
import { bootstrapApp, getLastBootstrapResult, startNetworkSyncSubscriber } from "@/lib/bootstrap";
import { SchemaTooNewError } from "@/lib/db/migrations";
import { applyCaptureGuard } from "@/lib/privacy/capture_guard";
import { startSupportOutboxSubscriber } from "@/lib/support/outbox_runner";
import { useApplyAllocations } from "@/hooks/mutations/use_apply_allocations";
import { useSkipAllocations } from "@/hooks/mutations/use_skip_allocations";
import { usePaydayAllocations } from "@/hooks/use_payday_allocations";
import { BILL_HORIZON_DAYS } from "@/hooks/queries/use_bills";
import {
  runGoalMilestonePass,
  startGoalMilestoneSubscriber,
} from "@/lib/goals/goal_milestone_subscriber";
import { startIncomeLedgerSubscriber } from "@/lib/income/income_ledger_subscriber";
import { startPaydayNotificationSubscriber } from "@/lib/income/payday_notification_subscriber";
import { startLimitLedgerSubscriber } from "@/lib/limits/limit_ledger_subscriber";
import { resolveAlertRoute } from "@/lib/alerts/alert_routes";
import { startTrackingHealthSubscriber } from "@/lib/alerts/tracking_health_subscriber";
import { startRecurringLedgerSubscriber } from "@/lib/recurring/recurring_ledger_subscriber";
import { startReconcilePromptSubscriber } from "@/lib/wallets/reconcile_scheduler";
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

// "outdated-build" is its own state, not a flavour of "error", because the
// two want opposite affordances: an ordinary bootstrap failure is worth
// retrying, and a database written by a newer build never is.
type BootstrapState = "pending" | "ready" | "error" | "outdated-build";

/**
 * Starts one process-wide subscriber from inside an effect without letting it
 * take the app down, and returns the effect's teardown.
 *
 * WHY THE TRY/CATCH IS NOT DECORATIVE. Every subscriber in this shell swallows
 * failures inside its own passes, but a `start` that throws SYNCHRONOUSLY —
 * a missing native module, a database that closed under it — throws during
 * render of the effect, which React propagates: the whole tree unmounts and the
 * user is left with a blank app they cannot act on. That is the one failure
 * mode m1b plan Task 11 rule 3 exists to forbid, and the derived features these
 * subscribers drive (limits, payday summaries, tracking notices) are never
 * worth it. Returning `undefined` on a failure is deliberate too: there is
 * nothing to tear down, and an effect must not return a teardown it cannot run.
 */
function startSubscriber(name: string, start: () => () => void): (() => void) | undefined {
  try {
    return start();
  } catch (error) {
    console.warn(`${name} could not start; the app runs without it`, error);
    return undefined;
  }
}

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
        className="min-h-[44px] justify-center rounded-lg bg-brand px-4 py-3 dark:bg-brand-dark"
      >
        <Text className="font-semibold text-surface dark:text-surface-dark">Try again</Text>
      </Pressable>
    </View>
  );
}

/**
 * The database is newer than this build (lib/db/migrations.ts's
 * SchemaTooNewError), which on this app means an OTA bundle was rolled back
 * under a database that had already migrated forward.
 *
 * DELIBERATELY NO RETRY. `BootstrapErrorScreen` offers one because most
 * bootstrap failures are transient; this one never is. There are no down
 * migrations, so running again reaches the same refusal, and a button that
 * cannot work teaches the user their data is gone when it is not. The copy
 * therefore says the one true thing: their records are safe and untouched, and
 * the newer app can read them again.
 *
 * No "check for updates" action either. Calling into expo-updates from here
 * would be this app's first Updates call and OTA policy belongs to GAP-028;
 * until that is settled, pointing at the store is honest and costs nothing.
 */
function OutdatedBuildScreen() {
  return (
    <View
      testID="bootstrap-outdated-build"
      className="flex-1 items-center justify-center gap-4 bg-bg px-6 dark:bg-bg-dark"
    >
      <Text className="text-center text-lg font-semibold text-fg dark:text-fg-dark">
        This version is out of date
      </Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Your records were saved by a newer version of PeraPlano, so this one can't open them
        safely. Nothing has been lost. Update PeraPlano and everything will be here.
      </Text>
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
  const skipAllocations = useSkipAllocations();

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
        busy={applyAllocations.isPending || skipAllocations.isPending}
        onDismiss={dismissAllocations}
        onSkip={async () => {
          try {
            await skipAllocations.mutateAsync(proposals);
          } catch {
            // Same reasoning as `onConfirm` below: the toast is already up,
            // and the sheet stays open for the retry.
            return;
          }
          dismissAllocations();
        }}
        onConfirm={async (accepted, declined) => {
          try {
            await applyAllocations.mutateAsync(accepted);
            // Recorded transfers emit no `ledger:committed` (only ingest does),
            // so a milestone they crossed would wait for the next commit or
            // launch without this pass (GAP-055).
            void runGoalMilestonePass();
            // The unchecked rows already read "Skipped" (GAP-056).
            if (declined.length > 0) await skipAllocations.mutateAsync(declined);
          } catch {
            // THE CATCH IS FOR THE REJECTION, NOT FOR THE MESSAGE. `onConfirm`
            // is typed `=> void` and AllocationSheet calls it without holding
            // the promise, so an unhandled rejection was the whole cost of a
            // failed apply here. What the user is told is already handled a
            // level up and must not be duplicated: this is a real
            // `useMutation`, so lib/query_client.ts's single MutationCache
            // `onError` has already raised the failure toast by the time this
            // runs, and a second in-place message would be the same failure
            // reported twice. The `return` matters as much as the catch —
            // leaving the sheet OPEN is what keeps the proposals and the
            // user's ticks alive for the retry the toast asks for.
            return;
          }
          dismissAllocations();
        }}
      />
    </>
  );
}

/**
 * A tapped notification reduced to the only two things routing needs: the
 * request identifier (to tell one tap from the same tap arriving twice) and
 * the routing `data` the notifier attached.
 */
type TappedAlert = { id: string; data: unknown };

/**
 * Sends a tapped notification to the screen it names (docs/06 §6.1's deep-link
 * table). `lib/alerts/alert_routes.ts` decides WHICH screen; this is the caller
 * that file was written for and shipped without — every alert in the app
 * carried routing `data` that nothing read, so "Tap to fix tracking" opened the
 * app wherever it happened to be.
 *
 * ITS OWN COMPONENT BECAUSE OF WHERE IT IS MOUNTED, the same reasoning as
 * <PaydaySheets /> above. It is rendered only inside AppShell's ready branch
 * and only AFTER <Stack />, which makes two rules structural rather than
 * conditions a later edit can quietly drop:
 *
 *   NEVER NAVIGATE INTO A LOCKED APP. That branch is reached only when the
 *   lock reports "unlocked" and bootstrap has resolved, so there is no state
 *   in which this component exists and the user has not authenticated. A tap
 *   that lands on the lock screen is held by AppShell instead (see the
 *   listener effect there) and delivered here the moment this mounts.
 *
 *   NEVER NAVIGATE BEFORE THERE IS A NAVIGATOR. `router.push` throws
 *   "Attempted to navigate before mounting the Root Layout component" if the
 *   root navigator has not mounted, and this app's Stack does not mount until
 *   that same ready branch. Being a LATER SIBLING of <Stack /> means React has
 *   already run the Stack's mount effects by the time this one runs.
 *
 * `withAnchor: true`, NOT `unstable_settings.initialRouteName` ALONE. The
 * anchors on app/(tabs)/plan/_layout.tsx and app/(tabs)/more/_layout.tsx cover
 * URL deep linking only — expo-router's own documentation is explicit that
 * `initialRouteName` "only applies during deep linking". A notification tap
 * arrives as JS: the OS hands this app a response object and we call
 * `router.push` ourselves, which is an ordinary in-app push as far as the
 * router is concerned. Without the anchor a tapped bill reminder mounts
 * `plan/bills/[id]` as the Plan stack's only entry and strands the tab on it —
 * the exact 2026-09-05 device defect the cross-tab pushes in
 * app/(tabs)/index.tsx carry `withAnchor` for.
 */
function AlertTapNavigation({
  tapped,
  onHandled,
}: {
  tapped: TappedAlert | null;
  onHandled: () => void;
}) {
  useEffect(() => {
    if (!tapped) return;
    // Cleared BEFORE the push, so a route that somehow fails cannot be retried
    // on every subsequent render of this effect.
    onHandled();
    // ONBOARDING OUTRANKS THE TAP. Every destination in the deep-link table
    // lives under `(tabs)`, and app/index.tsx sends a user who has not
    // finished setup to `(onboarding)` instead — pushing a bill detail on top
    // of that would drop someone into the middle of an app they have not set
    // up yet, past a flow that is not optional. The tap is dropped rather than
    // held: `onboarding_complete` is read once per bootstrap, so a queue kept
    // here would not notice the flow finishing anyway.
    //
    // `getLastBootstrapResult()` is never null here — this component mounts
    // only inside the branch bootstrapApp() has already resolved — but its own
    // doc asks callers to treat the null defensively, and "unknown" failing
    // toward onboarding matches app/index.tsx's own choice.
    if (getLastBootstrapResult()?.onboardingComplete !== true) return;
    try {
      router.push(resolveAlertRoute(tapped.data), { withAnchor: true });
    } catch (error) {
      // The same rule as every subscriber in this shell (plan Task 11 rule 3):
      // a notification that will not route is a lost tap, and a lost tap is
      // never worth taking the app down for.
      console.warn(`a tapped notification (${tapped.id}) could not be routed`, error);
    }
  }, [tapped, onHandled]);

  return null;
}

/** Mounted unconditionally inside ThemeProvider/LockProvider so bootstrapApp()
 * starts as soon as (and only once) the lock reports "unlocked" — see this
 * file's header comment for why bootstrap cannot run any earlier. */
function AppShell({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { resolved, isReady: themeReady } = useTheme();
  const { status: lockStatus } = useLock();
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>("pending");
  const [tappedAlert, setTappedAlert] = useState<TappedAlert | null>(null);
  // The last tap this shell has already accepted. A cold start delivers the
  // SAME response twice — once from `getLastNotificationResponse()`, once from
  // the listener the line below registers — and expo-notifications' own
  // `useLastNotificationResponse` hook draws the same line, on the same field,
  // for the same reason.
  const acceptedAlertIdRef = useRef<string | null>(null);
  const clearTappedAlert = useCallback(() => setTappedAlert(null), []);

  // FLAG_SECURE FOR THE WHOLE APP, SET ONCE AND NEVER RELEASED.
  //
  // HERE RATHER THAN ANYWHERE LOWER because this component mounts
  // unconditionally, before bootstrap and regardless of lock state, so the
  // guard is already on for the lock screen and for every screen behind it.
  // Gating it on `bootstrapState` or `lockStatus` would leave a window at start
  // where the app is drawing and capture is still allowed.
  //
  // NO CLEANUP, DELIBERATELY. Releasing the flag on unmount would mean the last
  // thing this app does before going away is make itself capturable, and the
  // only unmount of this component is the app itself ending. Development builds
  // never set it in the first place -- see lib/privacy/capture_guard.ts for
  // that exemption and for why an unknown variant is guarded rather than not.
  useEffect(() => {
    void applyCaptureGuard();
  }, []);

  const runBootstrap = useCallback(() => {
    setBootstrapState("pending");
    bootstrapApp()
      .then(() => setBootstrapState("ready"))
      .catch((error: unknown) => {
        console.error("bootstrapApp failed to start the app", error);
        setBootstrapState(error instanceof SchemaTooNewError ? "outdated-build" : "error");
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

  // THE ONE SUBSCRIPTION IN THIS SHELL THAT IS NOT GATED ON ANYTHING, and it
  // has to be. A notification tapped on a locked phone wakes the app straight
  // onto the lock screen, where there is no Stack, no database and no
  // bootstrap — gate this the way its neighbours are gated and the tap is
  // simply never heard. So the tap is CAPTURED here, always, and merely HELD:
  // <AlertTapNavigation /> below is mounted only inside the unlocked, booted
  // branch, so the actual navigation cannot happen a moment sooner. Nothing in
  // this effect reads the database or renders anything, which is what makes
  // running it while locked safe.
  //
  // Both halves are needed. The listener catches a tap while this process is
  // alive; `getLastNotificationResponse()` catches the cold start, where the
  // tap that LAUNCHED the app happened before any JS existed to hear it.
  //
  // WRAPPED, BECAUSE A NATIVE MODULE THAT IS NOT THERE MUST NOT TAKE THE APP
  // DOWN. Both calls reach `expo-notifications`' native emitter and throw
  // synchronously if it is missing, which inside an effect unmounts the whole
  // tree — the failure mode `startSubscriber` above exists to forbid. Losing
  // notification routing is survivable; losing the app is not.
  useEffect(() => {
    const accept = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (acceptedAlertIdRef.current === id) return;
      acceptedAlertIdRef.current = id;
      setTappedAlert({ id, data: response.notification.request.content.data });
    };

    let subscription: { remove: () => void } | undefined;
    try {
      subscription = Notifications.addNotificationResponseReceivedListener(accept);
      const launchingResponse = Notifications.getLastNotificationResponse();
      if (launchingResponse) accept(launchingResponse);
    } catch (error) {
      console.warn("notification taps will not open their screen", error);
    }

    return () => subscription?.remove();
  }, []);

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

  // Limit recomputation re-runs on ledger commits, debounced (m2 Task 7 —
  // limit_service.ts's header calls this "the `ledger:committed` subscriber"
  // and the app shipped without one). `recomputeLimits` is the ONLY path that
  // writes limit alert state, so with nothing calling it every limit's state
  // stayed null: rollover carryover was permanently zero and no threshold ever
  // latched as fired. Same gate and the same fire-and-forget discipline as
  // income above — `runLimitPass` swallows its own failures.
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    return startSubscriber("limit recomputation", startLimitLedgerSubscriber);
  }, [bootstrapState]);

  // The payday summary PUSH (docs/06 §6.1). The in-app half is <PaydaySheets />
  // below; this is the half that reaches a user whose app is closed. It rides
  // the same `income:payday` event the sheet does, which is deduplicated per
  // transaction id and persisted — so the push cannot announce a payday twice,
  // and cannot announce one the sheet never heard about.
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    return startSubscriber("payday summary push", startPaydayNotificationSubscriber);
  }, [bootstrapState]);

  // Listener-health notices (docs/06 §6.1's "Listener health" row). Home's
  // TrackingBanner already covers the user who opens the app; this covers the
  // one who does not — the listener dies, four days pass, and four days of
  // transactions are lost with nothing to say so. Checks on start and on every
  // foreground, because notification access can be revoked from system settings
  // with no callback to this app.
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    return startSubscriber("tracking health", startTrackingHealthSubscriber);
  }, [bootstrapState]);

  // Cash reconciliation prompts (docs/04-features/02-wallets.md §cash Wallet
  // reconciliation; docs/06 §4.7's "periodic gentle prompt"). Cash sends no
  // notifications, so a cash wallet is only ever as accurate as what the user
  // remembered to enter — this is the only thing in the app that asks. Beside
  // the tracking-health subscriber because it answers the same shape of
  // question ("has this quietly stopped being true while nobody looked"), and
  // it needs both wake-ups that subscriber's neighbours use: a launch pass for
  // the calendar triggers and a ledger pass for the cash-out one.
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    return startSubscriber("cash reconcile prompts", startReconcilePromptSubscriber);
  }, [bootstrapState]);

  // Goal milestone notifications (goals rule 12, GAP-055). A launch pass and a
  // debounced pass per ledger commit, the shape the cash reconcile prompts above
  // use; `runGoalMilestonePass` swallows its own failures.
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    return startSubscriber("goal milestones", startGoalMilestoneSubscriber);
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

  // The offline problem-report outbox. Same gate and same teardown shape as
  // the subscriber above, and mounted next to it because they answer the same
  // question ("what does this app do with the network when it gets some") —
  // but kept as its own subscriber rather than folded into
  // `startNetworkSyncSubscriber`, because it needs a THIRD wake-up the other
  // two calls do not: a timer, so a report that failed keeps retrying inside
  // the session the user is already in (see lib/support/outbox_runner.ts).
  useEffect(() => {
    if (bootstrapState !== "ready") return;
    return startSupportOutboxSubscriber();
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
      {bootstrapState === "pending" ? null : bootstrapState === "outdated-build" ? (
        <OutdatedBuildScreen />
      ) : bootstrapState === "error" ? (
        <BootstrapErrorScreen onRetry={runBootstrap} />
      ) : (
        // EVERY NAVIGATOR IN THE APP READS ITS COLOURS HERE. Without it they
        // fall back to react-navigation's built-in LIGHT default, which is
        // where the "broken UI" screenshots' grey void came from: the root
        // Stack's `contentStyle` below paints only the root Stack's own
        // screens, and `(tabs)` is one of them — the Tabs navigator inside it,
        // and the `plan/` and `more/` Stacks inside that, each paint their own
        // scenes over it. constants/nav_theme.ts has the full account and why
        // this is one provider rather than a `contentStyle` per navigator.
        <NavigationThemeProvider value={navThemeFor(resolved)}>
          {/* `contentStyle` KEPT even though the theme now covers it. The two
              are not redundant in one case: a screen rendered before any theme
              consumer resolves still gets the right colour from the explicit
              prop, and it costs nothing to state the root Stack's own
              background where the root Stack is declared. */}
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />
          {/* AFTER the Stack, not inside it: a later sibling paints on top, and
              the keypad has to sit over whatever screen is focused. It renders
              nothing until a field opens it. A sheet mounts its OWN host —
              components/ui/keypad_host.tsx explains why this one cannot serve
              a Modal. */}
          <KeypadHost />
          {/* LAST OF THE OVERLAYS, so a failed write is legible over the
              keypad panel as well as over the screen. It anchors the TOP
              strip while the keypad takes the bottom band, so the two never
              contend for the same pixels — see that component's header. It
              renders nothing until something is queued. */}
          <MutationErrorToast />
          <StatusBar style="auto" />
          <PaydaySheets />
          {/* RENDERS NOTHING — it is here for its position, not its output.
              Being a later sibling of the <Stack /> above is what guarantees
              the navigator it pushes into has already mounted, and being
              inside this branch at all is what guarantees the app is unlocked
              and booted. See the component's own header. */}
          <AlertTapNavigation tapped={tappedAlert} onHandled={clearTappedAlert} />
        </NavigationThemeProvider>
      )}
    </PersistQueryClientProvider>
  );
}

/**
 * DO NOT ADD A `SafeAreaProvider` HERE. THERE IS ALREADY ONE ABOVE THIS FILE.
 *
 * app.json sets `edgeToEdgeEnabled: true`, so the app draws BEHIND the status
 * bar and behind Android's navigation bar, and a dozen surfaces now call
 * `useSafeAreaInsets()` to pad for them. The provider those calls read is
 * expo-router's: `expo-router/entry` mounts `ExpoRoot`, which wraps everything
 * — this layout included — in `<SafeAreaProvider>` (expo-router/build/
 * ExpoRoot.js). It passes no `initialMetrics` on native, so the provider
 * renders no children at all until the first real measurement lands, which is
 * what makes `useSafeAreaInsets()` safe to call from ANY surface here,
 * including app/lock.tsx's first-run flow that runs with no navigator mounted.
 *
 * A second provider nested inside it is not merely redundant: nesting is the
 * case @react-navigation/elements goes out of its way to avoid
 * (SafeAreaProviderCompat returns a plain View when a provider is already
 * present, "to avoid an issue with updates").
 *
 * WHAT WAS ACTUALLY MISSING was any CONSUMER. Nothing in the app read an inset,
 * so every bottom-anchored control sat under the navigation bar — found on a
 * physical A54, whose navigation bar measured 126px against the 24dp of flat
 * padding the onboarding footer carried.
 *
 * The rule for consumers: an edge is padded exactly once, by whichever
 * component actually touches it — `(tabs)/_layout.tsx` for the tab screens'
 * top, `OnboardingFrame` for both of the onboarding steps' edges, `BottomSheet`
 * for a sheet's bottom, each standalone screen for its own. Padding an edge in
 * a parent AND in the child that meets it double-counts, which is why there is
 * no blanket inset on this Stack's `contentStyle`.
 */
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  return (
    <KeyboardProvider>
      <ThemeProvider>
        <LockProvider>
          {/* INSIDE the lock, not outside it: which field is focused and what
              has been keyed into it is ledger data like any other, and it is
              torn down with the lock rather than surviving into a locked app. */}
          <KeypadProvider>
            <AppShell fontsLoaded={fontsLoaded} />
          </KeypadProvider>
        </LockProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
