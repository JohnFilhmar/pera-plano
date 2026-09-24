// app/__tests__/permissions_screen.test.tsx — GAP-018. The permissions
// checklist (app/(tabs)/more/permissions.tsx) and the More-hub row that
// reaches it.
//
// WHAT THIS FILE IS ACTUALLY DEFENDING. Every grant PeraPlano needs is offered
// once, inside onboarding, and every one of them is skippable. Before this
// screen a skipped battery exemption was permanent short of a reinstall, and
// the tests below are written so that removing either half of the fix — the
// screen, or the row that reaches it — fails them: the last test presses the
// hub row and asserts the route, and every other test needs the screen to
// exist at all.
//
// THREE MOCK LAYERS, ONE PER SEAM. `@/modules/notification_listener` calls
// `requireNativeModule` at import time and cannot be required under Jest at
// all; `expo-notifications` is the alerts read; `@/lib/alerts/alerts_service`
// is the one write either surface may cause. Same three seams
// app/__tests__/listener_health_screen.test.tsx and
// app/__tests__/more_hub.test.tsx already mock, mocked the same way.
//
// react-native is mocked through a Proxy over `jest.requireActual`, the
// pattern app/__tests__/listener_health_screen.test.tsx and
// components/onboarding/__tests__/battery_step.test.tsx both use — a plain
// `{...actual}` spread eagerly evaluates every lazy getter on the real module,
// including native-only exports that crash outside a real app. `AppState` is
// replaced so a return from the settings app can be simulated; `Linking` keeps
// the real module's other members and swaps the two the screen calls.
const mockSendIntent = jest.fn();
const mockOpenSettings = jest.fn();

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const listeners: Array<(state: string) => void> = [];
  const mockAppState = {
    currentState: "active",
    addEventListener: jest.fn((_event: string, cb: (state: string) => void) => {
      listeners.push(cb);
      return {
        remove: jest.fn(() => {
          const idx = listeners.indexOf(cb);
          if (idx >= 0) listeners.splice(idx, 1);
        }),
      };
    }),
    __emit: (state: string) => {
      for (const cb of [...listeners]) cb(state);
    },
  };
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === "AppState") return mockAppState;
      if (prop === "Linking") {
        return { ...actual.Linking, sendIntent: mockSendIntent, openSettings: mockOpenSettings };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
});

jest.mock("@/modules/notification_listener", () => ({
  isAccessGranted: jest.fn(),
  openAccessSettings: jest.fn(),
}));

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
}));

jest.mock("@/lib/alerts/alerts_service", () => ({
  requestAlertPermission: jest.fn(),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";

import { ThemeProvider } from "@/contexts/theme_context";
import { requestAlertPermission } from "@/lib/alerts/alerts_service";
import { __setTierForTests } from "@/lib/entitlements";
import { BATTERY_SETTINGS_INTENT } from "@/lib/onboarding/battery_settings";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { isAccessGranted, openAccessSettings } from "@/modules/notification_listener";

import MoreScreen from "../(tabs)/more";
import PermissionsScreen from "../(tabs)/more/permissions";

const mockPush = jest.fn();
const mockIsAccessGranted = isAccessGranted as jest.MockedFunction<typeof isAccessGranted>;
const mockOpenAccessSettings = openAccessSettings as jest.Mock;
const mockGetPermissionsAsync = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestAlertPermission = requestAlertPermission as jest.Mock;

/**
 * ASYNC `act`, NOT A BARE `act(() => __emit(...))`. The listener starts two
 * permission reads and only sets state when they resolve, so a synchronous
 * `act` returns with the microtask queue still full and leaves the assertion
 * to `waitFor`'s polling — which, measured, took ~12s of a 15s budget to
 * notice and blew straight past it on a cold cache. Awaiting an async `act`
 * drains those microtasks before the assertion instead of racing them.
 */
async function emitAppState(state: "active" | "background"): Promise<void> {
  await act(async () => {
    (AppState as unknown as { __emit: (s: string) => void }).__emit(state);
  });
}

/** The Chip's label Text carries `${testID}-label` (components/ui/chip.tsx). */
function stateLabel(row: string): unknown {
  return screen.getByTestId(`${row}-state-label`).props.children;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Both grants held by default, so each test below changes exactly the one
  // fact it is about.
  mockIsAccessGranted.mockResolvedValue(true);
  mockGetPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: false });
});

// ---------------------------------------------------------------------------
// The checklist itself.
// ---------------------------------------------------------------------------

test("EVERY GRANT GETS A ROW, AND THE UNREADABLE ONE SAYS SO RATHER THAN GUESSING", async () => {
  render(<PermissionsScreen />);

  await waitFor(() => expect(stateLabel("permissions-access")).toBe("On"));
  expect(stateLabel("permissions-alerts")).toBe("On");
  // Nothing in the app can read the battery exemption
  // (app/(onboarding)/battery.tsx's header), so this row never claims a state
  // — and never claims "Off", which is the claim that would be a lie.
  expect(stateLabel("permissions-battery")).toBe("Can't tell");
  expect(stateLabel("permissions-battery")).not.toBe("Off");
});

test("A SKIPPED NOTIFICATION-ACCESS GRANT IS COMPLETABLE FROM SETTINGS", async () => {
  mockIsAccessGranted.mockResolvedValue(false);
  render(<PermissionsScreen />);

  fireEvent.press(await screen.findByTestId("permissions-open-access-settings"));

  expect(mockOpenAccessSettings).toHaveBeenCalledTimes(1);
  expect(stateLabel("permissions-access")).toBe("Off");
});

test("THE NOTIFICATION-ACCESS ACTION IS ABSENT ONCE THE GRANT IS HELD", async () => {
  render(<PermissionsScreen />);

  await waitFor(() => expect(stateLabel("permissions-access")).toBe("On"));
  expect(screen.queryByTestId("permissions-open-access-settings")).toBeNull();
});

test("A SKIPPED ALERTS GRANT RAISES THE ONE-SHOT DIALOG, AND THE ROW GOES QUIET ONCE IT LANDS", async () => {
  mockGetPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  mockRequestAlertPermission.mockResolvedValue(true);
  render(<PermissionsScreen />);

  const button = await screen.findByTestId("permissions-turn-on-alerts");
  expect(button.props.accessibilityLabel).toBe("Turn on alerts");
  fireEvent.press(button);

  await waitFor(() => expect(mockRequestAlertPermission).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByTestId("permissions-turn-on-alerts")).not.toBeOnTheScreen());
  expect(stateLabel("permissions-alerts")).toBe("On");
});

test("ONCE ANDROID IS DONE PROMPTING THE ALERTS ROW OPENS SETTINGS INSTEAD OF ASKING AGAIN", async () => {
  // A second `requestPermissionsAsync` resolves from what the OS remembers,
  // with no dialog — a button that silently does nothing.
  mockGetPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
  render(<PermissionsScreen />);

  const button = await screen.findByTestId("permissions-turn-on-alerts");
  expect(button.props.accessibilityLabel).toBe("Open phone settings");
  fireEvent.press(button);

  await waitFor(() => expect(mockOpenSettings).toHaveBeenCalledTimes(1));
  expect(mockRequestAlertPermission).not.toHaveBeenCalled();
});

test("THE ALERTS ACTION IS ABSENT ONCE THE GRANT IS HELD", async () => {
  render(<PermissionsScreen />);

  await waitFor(() => expect(stateLabel("permissions-alerts")).toBe("On"));
  expect(screen.queryByTestId("permissions-turn-on-alerts")).toBeNull();
});

test("THE BATTERY ROW FIRES THE SAME INTENT THE ONBOARDING STEP FIRES, AND IS ALWAYS OFFERED", async () => {
  mockSendIntent.mockResolvedValue(undefined);
  render(<PermissionsScreen />);

  // Present even with both readable grants held — the exemption is skippable
  // independently of them and there is no state to hide the row on.
  await waitFor(() => expect(stateLabel("permissions-access")).toBe("On"));
  fireEvent.press(screen.getByTestId("permissions-open-battery-settings"));

  expect(mockSendIntent).toHaveBeenCalledWith(BATTERY_SETTINGS_INTENT);
  expect(BATTERY_SETTINGS_INTENT).toBe("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
});

test("THE BRAND-SPECIFIC BATTERY GUIDANCE IS ON THIS SCREEN, NOT ONLY IN ONBOARDING", async () => {
  render(<PermissionsScreen />);

  await waitFor(() => expect(stateLabel("permissions-access")).toBe("On"));
  // "Open battery settings" lands on a list whose menu names differ per skin,
  // so the shortcut without the steps is half an answer (GAP-018's own point
  // about the OEM guidance being reachable exactly once).
  expect(screen.getByTestId("oem-guidance-steps")).toBeTruthy();
});

test("A GRANT CHANGED IN THE SETTINGS APP IS PICKED UP ON RETURN, NOT LEFT STALE", async () => {
  // The whole screen hands the user to another app. `useFocusEffect` would
  // never fire on the return, because leaving PeraPlano does not unfocus this
  // screen — only AppState does.
  mockIsAccessGranted.mockResolvedValue(false);
  render(<PermissionsScreen />);

  await screen.findByTestId("permissions-open-access-settings");

  mockIsAccessGranted.mockResolvedValue(true);
  await emitAppState("active");

  expect(screen.queryByTestId("permissions-open-access-settings")).toBeNull();
  expect(stateLabel("permissions-access")).toBe("On");
});

test("A READ THAT FAILED IS NEVER RENDERED AS OFF, AND STILL OFFERS THE WAY OUT", async () => {
  mockIsAccessGranted.mockRejectedValue(new Error("native module unavailable"));
  mockGetPermissionsAsync.mockRejectedValue(new Error("no permissions module"));
  render(<PermissionsScreen />);

  await waitFor(() => expect(stateLabel("permissions-access")).toBe("Can't tell"));
  expect(stateLabel("permissions-alerts")).toBe("Can't tell");
  // Hiding the action here would strand a user whose grant really is missing;
  // claiming "Off" would be a fact the app does not have.
  expect(screen.getByTestId("permissions-open-access-settings")).toBeTruthy();
  expect(screen.getByTestId("permissions-turn-on-alerts")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The More hub row — the half that makes the screen reachable at all.
// ---------------------------------------------------------------------------

function renderHub(ui: ReactNode) {
  const defaults = appQueryClient.getDefaultOptions();
  const client = new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity, staleTime: 0 },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

test("MORE REACHES THE CHECKLIST, WHICH IS THE ONLY THING THAT MAKES IT A RECOVERY ROUTE", async () => {
  // Left pending for the same reason app/__tests__/more_hub.test.tsx leaves it
  // pending: this test is about the row, not about the hub's own conditional
  // alerts row, and a read that resolved would land its state update outside
  // `act`.
  mockGetPermissionsAsync.mockImplementation(() => new Promise(() => {}));
  __setTierForTests(null);
  renderHub(<MoreScreen />);

  fireEvent.press(screen.getByTestId("more-permissions"));

  expect(mockPush).toHaveBeenCalledWith("/more/permissions");
  // Unconditional, unlike the alerts row beside it: the battery exemption
  // cannot be read, so a checklist that hid itself on state would hide from
  // the one user who came looking for it.
  await waitFor(() => expect(screen.getByTestId("more-permissions")).toBeTruthy());
});
