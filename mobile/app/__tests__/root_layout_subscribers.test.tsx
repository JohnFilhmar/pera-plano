// app/__tests__/root_layout_subscribers.test.tsx — that the process-wide
// subscribers this shell owns are actually STARTED, and torn down again.
//
// WHY ITS OWN FILE. root_layout.test.tsx isolates the four render gates
// (fonts, theme, lock, bootstrap) one at a time and its own header explains
// how easily that isolation is lost; lock_gate.test.tsx is the precedent for
// splitting a distinct claim out rather than folding it in. The claim here is a
// different one: three notification paths shipped with a real, unit-tested
// implementation and NO PRODUCTION CALLER, and every unit test in the app
// stayed green through it. Nothing catches that except a test that asserts the
// call site exists.
//
//   - `recomputeLimits` -> the limits ledger subscriber. Without it
//     `setLimitAlertState` never runs, so rollover carryover is permanently
//     zero and no threshold ever fires.
//   - `notifyPaydaySummary` -> the payday push subscriber. Without it only a
//     user who opens the app learns their pay landed.
//   - `notifyTrackingInterrupted` -> the tracking health subscriber. Without it
//     a dead listener is invisible to anyone who does not open the app.
import { act, waitFor } from "@testing-library/react-native";
import { renderRouter, screen } from "expo-router/testing-library";
import { useFonts } from "expo-font";

import RootLayout from "../_layout";
import Index from "../index";
import TabsLayout from "../(tabs)/_layout";
import HomeScreen from "../(tabs)/index";
import TransactionsScreen from "../(tabs)/transactions";
import WalletsScreen from "../(tabs)/wallets";
import PlanScreen from "../(tabs)/plan";
import MoreScreen from "../(tabs)/more";

jest.mock("@/lib/bootstrap", () => ({
  ...jest.requireActual("@/lib/bootstrap"),
  bootstrapApp: jest.fn(),
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

jest.mock("@/contexts/lock_context", () => ({
  LockProvider: ({ children }: { children: import("react").ReactNode }) => children,
  useLock: jest.fn(),
}));

jest.mock("@/modules/notification_listener", () => ({
  openSecuritySettings: jest.fn(),
  drainPendingCaptures: jest.fn().mockResolvedValue([]),
  addCaptureListener: jest.fn().mockReturnValue(jest.fn()),
  getListenerHealth: jest
    .fn()
    .mockResolvedValue({ granted: true, serviceConnected: true, lastCaptureAt: null }),
}));

jest.mock("@/lib/ingest/pipeline", () => ({
  startIngest: jest.fn().mockResolvedValue(jest.fn()),
}));

// The three subscribers under test. Mocked at their own module boundary so
// this file asserts the CALL, not the behaviour — each one's behaviour has its
// own suite next to its implementation.
jest.mock("@/lib/limits/limit_ledger_subscriber", () => ({
  startLimitLedgerSubscriber: jest.fn(() => jest.fn()),
}));

jest.mock("@/lib/income/payday_notification_subscriber", () => ({
  startPaydayNotificationSubscriber: jest.fn(() => jest.fn()),
}));

jest.mock("@/lib/alerts/tracking_health_subscriber", () => ({
  startTrackingHealthSubscriber: jest.fn(() => jest.fn()),
}));

// Everything else the shell fires once per launch and that would otherwise
// reach a database or the notification stack from inside these tests.
jest.mock("@/lib/bills/bills_service", () => ({ listBillStatuses: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/bills/bill_reminders", () => ({
  scheduleBillReminders: jest.fn().mockResolvedValue(undefined),
  postOverdueNotices: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/loans/loans_service", () => ({ listLoanStatuses: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/loans/loan_reminders", () => ({
  scheduleLoanReminders: jest.fn().mockResolvedValue(undefined),
}));

import { bootstrapApp } from "@/lib/bootstrap";
import { useTheme } from "@/contexts/theme_context";
import { useLock } from "@/contexts/lock_context";
import { startTrackingHealthSubscriber } from "@/lib/alerts/tracking_health_subscriber";
import { startPaydayNotificationSubscriber } from "@/lib/income/payday_notification_subscriber";
import { startLimitLedgerSubscriber } from "@/lib/limits/limit_ledger_subscriber";

const mockBootstrapApp = bootstrapApp as jest.Mock;
const mockUseFonts = useFonts as jest.Mock;
const mockUseTheme = useTheme as jest.Mock;
const mockUseLock = useLock as jest.Mock;
const mockStartLimits = startLimitLedgerSubscriber as jest.Mock;
const mockStartPayday = startPaydayNotificationSubscriber as jest.Mock;
const mockStartTracking = startTrackingHealthSubscriber as jest.Mock;

const SUBSCRIBERS: Array<[string, jest.Mock]> = [
  ["limits ledger", mockStartLimits],
  ["payday summary push", mockStartPayday],
  ["tracking health", mockStartTracking],
];

function renderApp() {
  return renderRouter(
    {
      _layout: RootLayout,
      index: Index,
      "(tabs)/_layout": TabsLayout,
      "(tabs)/index": HomeScreen,
      "(tabs)/transactions": TransactionsScreen,
      "(tabs)/wallets": WalletsScreen,
      "(tabs)/plan": PlanScreen,
      "(tabs)/more": MoreScreen,
    },
    { initialUrl: "/(tabs)" },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStartLimits.mockReturnValue(jest.fn());
  mockStartPayday.mockReturnValue(jest.fn());
  mockStartTracking.mockReturnValue(jest.fn());
  mockBootstrapApp.mockResolvedValue({ onboardingComplete: true });
  mockUseFonts.mockReturnValue([true, null]);
  mockUseTheme.mockReturnValue({
    resolved: "light",
    isReady: true,
    preference: "auto",
    setPreference: jest.fn(),
  });
  mockUseLock.mockReturnValue({
    status: "unlocked",
    errorMessage: null,
    unlock: jest.fn(),
    submitRecoveryPhrase: jest.fn(),
    wipeAndStartOver: jest.fn(),
  });
});

describe.each(SUBSCRIBERS)("the %s subscriber", (_name, start) => {
  test("IS STARTED ONCE BOOTSTRAP RESOLVES, AND NOT BEFORE", async () => {
    let resolveBootstrap: (value: { onboardingComplete: boolean }) => void = () => undefined;
    mockBootstrapApp.mockReturnValue(
      new Promise<{ onboardingComplete: boolean }>((resolve) => {
        resolveBootstrap = resolve;
      }),
    );

    renderApp();

    // Every one of these reads the database the moment it runs, and the
    // database is not open until bootstrap has finished with it.
    expect(start).not.toHaveBeenCalled();

    await act(async () => {
      resolveBootstrap({ onboardingComplete: true });
    });

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  test("is torn down when the tree unmounts", async () => {
    const stop = jest.fn();
    start.mockReturnValue(stop);

    const view = renderApp();
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    view.unmount();

    // A subscription that outlives its tree keeps recomputing and posting for
    // the rest of the process.
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  test("A THROWING START STILL RENDERS THE APP", async () => {
    // Limits, payday summaries and tracking notices are derived convenience;
    // the ledger is the product. An app that will not open cannot be fixed by
    // the user at all.
    start.mockImplementation(() => {
      throw new Error("subscriber exploded");
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    renderApp();

    await waitFor(() => expect(screen.queryByTestId("tab-index")).toBeTruthy());
    expect(screen.queryByTestId("bootstrap-error")).toBeNull();
    warn.mockRestore();
  });
});

test("all three subscribers start on one launch", async () => {
  // Per-subscriber tests above would all pass if the shell started only the one
  // each of them happened to look at.
  renderApp();

  await waitFor(() => expect(mockStartLimits).toHaveBeenCalledTimes(1));
  expect(mockStartPayday).toHaveBeenCalledTimes(1);
  expect(mockStartTracking).toHaveBeenCalledTimes(1);
});
