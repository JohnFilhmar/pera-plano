// app/__tests__/alert_navigation.test.tsx — that tapping one of this app's own
// notifications actually opens the screen docs/06 §6.1's deep-link table names.
//
// WHY ITS OWN FILE, and why the claim is not "resolveAlertRoute returns the
// right Href". `lib/alerts/alert_routes.ts` shipped fully unit-tested
// (lib/alerts/__tests__/alert_audit.test.ts) and with NO PRODUCTION CALLER: no
// `addNotificationResponseReceivedListener` existed anywhere in the app, so
// every alert carried routing data nothing read and "Tap to fix tracking"
// opened the app wherever it happened to be. Every unit test stayed green
// through that, which is the same blind spot root_layout_subscribers.test.tsx
// was written for — and the same remedy: assert the CALL SITE exists, by
// driving a real router and looking at where it ends up.
//
// The routes below are stubs on purpose. What is under test is the shell's
// wiring and the navigation state it produces, not what a bill detail renders;
// the real screens have their own suites. `(tabs)/plan/_layout` is the REAL
// module, though, because its `unstable_settings` anchor is half of the
// 2026-09-05 tab-capture fix and the third test below depends on it.
import type { ReactNode } from "react";

const mockLock: { status: string; listeners: Set<() => void> } = {
  status: "unlocked",
  listeners: new Set(),
};

// A CONTROLLABLE LOCK, not a fixed one. lock_gate.test.tsx renders each status
// once and never moves between them, which is all its own claim needs. This
// file's first test is about a TRANSITION — a tap heard while locked, held,
// and delivered on unlock — so the mock has to be able to change its answer
// and re-render the tree that read it.
jest.mock("@/contexts/lock_context", () => {
  const react = require("react") as typeof import("react");
  const subscribe = (onStoreChange: () => void) => {
    mockLock.listeners.add(onStoreChange);
    return () => {
      mockLock.listeners.delete(onStoreChange);
    };
  };
  const getSnapshot = () => mockLock.status;
  return {
    LockProvider: ({ children }: { children: ReactNode }) => children,
    useLock: () => ({
      status: react.useSyncExternalStore(subscribe, getSnapshot),
      errorMessage: null,
      unlock: jest.fn(),
      submitRecoveryPhrase: jest.fn(),
      wipeAndStartOver: jest.fn(),
    }),
  };
});

const mockTaps: {
  listeners: Set<(response: unknown) => void>;
  launching: unknown;
} = { listeners: new Set(), launching: null };

// expo-notifications stands in for the OS. `launching` is what the native
// module reports as the response that opened the app (the cold-start half),
// and `listeners` is where the shell's live listener lands (the warm half).
jest.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: jest.fn((listener: (response: unknown) => void) => {
    mockTaps.listeners.add(listener);
    return {
      remove: () => {
        mockTaps.listeners.delete(listener);
      },
    };
  }),
  getLastNotificationResponse: jest.fn(() => mockTaps.launching),
  // The rest of the surface the shell pulls in transitively through
  // lib/alerts/alerts_service.ts — same shape as that module's own suite.
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("os-id-1"),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

jest.mock("@/lib/bootstrap", () => ({
  ...jest.requireActual("@/lib/bootstrap"),
  bootstrapApp: jest.fn(),
  getLastBootstrapResult: jest.fn(),
  startNetworkSyncSubscriber: jest.fn(() => jest.fn()),
}));

jest.mock("expo-font", () => ({
  ...jest.requireActual("expo-font"),
  useFonts: jest.fn(),
}));

jest.mock("@/contexts/theme_context", () => ({
  ...jest.requireActual("@/contexts/theme_context"),
  useTheme: jest.fn(),
}));

jest.mock("@/modules/notification_listener", () => ({
  openSecuritySettings: jest.fn(),
  drainPendingCaptures: jest.fn().mockResolvedValue([]),
  addCaptureListener: jest.fn().mockReturnValue(jest.fn()),
  getListenerHealth: jest
    .fn()
    .mockResolvedValue({ granted: true, serviceConnected: true, lastCaptureAt: null }),
}));

// ../_layout pulls in ./lock, whose recovery form holds a GAP-017 screen
// capture guard; expo-screen-capture has no native module under Jest. Inert
// here for the same reason root_layout_subscribers.test.tsx keeps it inert.
jest.mock("expo-screen-capture", () => ({
  usePreventScreenCapture: jest.fn(),
}));

jest.mock("@/lib/ingest/pipeline", () => ({
  startIngest: jest.fn().mockResolvedValue(jest.fn()),
}));

jest.mock("@/lib/limits/limit_ledger_subscriber", () => ({
  startLimitLedgerSubscriber: jest.fn(() => jest.fn()),
}));

jest.mock("@/lib/income/payday_notification_subscriber", () => ({
  startPaydayNotificationSubscriber: jest.fn(() => jest.fn()),
}));

jest.mock("@/lib/alerts/tracking_health_subscriber", () => ({
  startTrackingHealthSubscriber: jest.fn(() => jest.fn()),
}));

jest.mock("@/lib/bills/bills_service", () => ({ listBillStatuses: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/bills/bill_reminders", () => ({
  scheduleBillReminders: jest.fn().mockResolvedValue(undefined),
  postOverdueNotices: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/loans/loans_service", () => ({ listLoanStatuses: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/loans/loan_reminders", () => ({
  scheduleLoanReminders: jest.fn().mockResolvedValue(undefined),
}));

import { act, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { renderRouter, screen } from "expo-router/testing-library";
import { useFonts } from "expo-font";
import { Text, View } from "react-native";

import { bootstrapApp, getLastBootstrapResult } from "@/lib/bootstrap";
import { useTheme } from "@/contexts/theme_context";
import type { LockStatus } from "@/contexts/lock_context";

import RootLayout from "../_layout";
import TabsLayout from "../(tabs)/_layout";
import HomeScreen from "../(tabs)/index";
import TransactionsScreen from "../(tabs)/transactions";
import WalletsScreen from "../(tabs)/wallets";
import MoreScreen from "../(tabs)/more";
import * as PlanLayoutModule from "../(tabs)/plan/_layout";

const mockBootstrapApp = bootstrapApp as jest.Mock;
const mockGetLastBootstrapResult = getLastBootstrapResult as jest.Mock;
const mockUseFonts = useFonts as jest.Mock;
const mockUseTheme = useTheme as jest.Mock;

function Stub({ testID }: { testID: string }) {
  return (
    <View testID={testID}>
      <Text>{testID}</Text>
    </View>
  );
}

function renderApp() {
  return renderRouter(
    {
      _layout: RootLayout,
      index: () => <Stub testID="root-index" />,
      "(tabs)/_layout": TabsLayout,
      "(tabs)/index": HomeScreen,
      "(tabs)/transactions": TransactionsScreen,
      "(tabs)/wallets": WalletsScreen,
      "(tabs)/more": MoreScreen,
      "(tabs)/plan/_layout": PlanLayoutModule,
      "(tabs)/plan/index": () => <Stub testID="plan-index" />,
      "(tabs)/plan/bills/[id]": () => <Stub testID="bill-detail" />,
    },
    { initialUrl: "/(tabs)" },
  );
}

function setLockStatus(status: LockStatus) {
  mockLock.status = status;
  for (const listener of [...mockLock.listeners]) listener();
}

/** The exact `data` lib/bills/bill_reminders.ts attaches to a due-bill reminder. */
function billReminderResponse(identifier: string) {
  return {
    actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
    notification: {
      request: {
        identifier,
        content: {
          title: "Meralco is due in 3 days",
          body: "Tap to see the bill",
          data: { kind: "billReminder", billId: "b-1", dueDate: "2026-09-15" },
        },
      },
    },
  };
}

function deliverTap(response: unknown) {
  for (const listener of [...mockTaps.listeners]) listener(response);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTaps.listeners.clear();
  mockTaps.launching = null;
  mockLock.status = "unlocked";
  mockLock.listeners.clear();
  mockBootstrapApp.mockResolvedValue({ onboardingComplete: true });
  mockGetLastBootstrapResult.mockReturnValue({ onboardingComplete: true });
  mockUseFonts.mockReturnValue([true, null]);
  mockUseTheme.mockReturnValue({
    resolved: "light",
    isReady: true,
    preference: "auto",
    setPreference: jest.fn(),
  });
});

async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

test("A TAP HEARD ON THE LOCK SCREEN OPENS ITS SCREEN ONLY AFTER UNLOCK", async () => {
  // The case the shell cannot ignore: tapping a notification on a locked phone
  // wakes the app onto the lock screen, where there is no Stack to navigate.
  // The tap must neither be dropped nor acted on early.
  setLockStatus("locked");
  const view = renderApp();
  await flushMicrotasks();

  expect(screen.getByTestId("unlock-prompt")).toBeTruthy();

  await act(async () => {
    deliverTap(billReminderResponse("notif-1"));
  });

  expect(screen.queryByTestId("bill-detail")).toBeNull();
  expect(view.getPathname()).not.toBe("/plan/bills/b-1");

  await act(async () => {
    setLockStatus("unlocked");
  });

  await waitFor(() => expect(screen.getByTestId("bill-detail")).toBeTruthy());
  expect(view.getPathname()).toBe("/plan/bills/b-1");
  // `dueDate` is not part of the route, so it rides as a search param — the
  // bill detail reads it to know WHICH occurrence the reminder was about.
  expect(view.getSearchParams()).toMatchObject({ dueDate: "2026-09-15" });
});

test("THE NOTIFICATION THAT LAUNCHED THE APP OPENS ITS SCREEN", async () => {
  // A cold start has no live listener to hear the tap that started it — the
  // OS records it and the shell has to go and read it.
  mockTaps.launching = billReminderResponse("notif-cold");

  const view = renderApp();

  await waitFor(() => expect(screen.getByTestId("bill-detail")).toBeTruthy());
  expect(view.getPathname()).toBe("/plan/bills/b-1");
});

test("BACK FROM A TAPPED BILL REMINDER LANDS ON THE PLAN LIST, NOT OUT OF THE TAB", async () => {
  // The other half of the 2026-09-05 device fix. `unstable_settings.
  // initialRouteName` on plan/_layout.tsx covers URL deep links only; a
  // notification tap reaches the router as an ordinary in-app `router.push`,
  // so without `withAnchor` the bill detail mounts as the Plan stack's ONLY
  // entry and the tab is stranded on it. This test fails the moment that
  // option is dropped.
  mockTaps.launching = billReminderResponse("notif-anchor");

  const view = renderApp();
  await waitFor(() => expect(screen.getByTestId("bill-detail")).toBeTruthy());

  await act(async () => {
    router.back();
  });

  await waitFor(() => expect(view.getPathname()).toBe("/plan"));
});
