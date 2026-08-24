// app/__tests__/listener_health_screen.test.tsx — m3b Task 7.
//
// react-native's AppState is mocked via a Proxy over jest.requireActual, the
// same pattern components/onboarding/__tests__/device_lock.test.tsx already
// uses — a plain `{...actual}` spread would eagerly evaluate every lazy
// getter on the real module, including native-only exports that crash
// outside a real app.
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
      return Reflect.get(target, prop, receiver);
    },
  });
});

// `useListenerHealth` and this screen's own settings button both reach
// `@/modules/notification_listener`, which calls `requireNativeModule` at
// import time and cannot be required under Jest at all.
jest.mock("@/modules/notification_listener", () => ({
  getListenerHealth: jest.fn(),
  openAccessSettings: jest.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import { setSetting } from "@/lib/db/repos/app_settings_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import { getListenerHealth, openAccessSettings } from "@/modules/notification_listener";

import ListenerHealthScreen from "../(tabs)/more/listener_health";

const mockHealth = getListenerHealth as jest.MockedFunction<typeof getListenerHealth>;
const mockOpenAccessSettings = openAccessSettings as jest.Mock;

function emitAppState(state: "active" | "background") {
  (AppState as unknown as { __emit: (s: string) => void }).__emit(state);
}

function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity, staleTime: 0 },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

function renderScreen(ui: ReactNode) {
  return render(
    <QueryClientProvider client={makeTestClient()}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  mockHealth.mockResolvedValue({ granted: true, serviceConnected: true, lastCaptureAt: null });
});

afterEach(async () => {
  await closeDatabase();
});

test("a healthy, active listener renders the health card and OEM guidance, with no paused note", async () => {
  renderScreen(<ListenerHealthScreen />);

  await screen.findByTestId("health-card");
  screen.getByText("Granted");
  screen.getByText("Connected");
  screen.getByTestId("oem-guidance");
  expect(screen.queryByTestId("listener-health-paused-note")).toBeNull();
});

test("a paused capture switch shows the neutral note alongside the still-true facts", async () => {
  await setSetting("capture_enabled", false);

  renderScreen(<ListenerHealthScreen />);

  await screen.findByTestId("listener-health-paused-note");
  screen.getByText(/Tracking is paused/);
  // The three facts are still shown — pausing does not make them false.
  screen.getByText("Granted");
});

test("revoked access opens the loud warning, and the settings button reaches the native call", async () => {
  mockHealth.mockResolvedValue({ granted: false, serviceConnected: false, lastCaptureAt: null });

  renderScreen(<ListenerHealthScreen />);

  await screen.findByTestId("health-card-revoked-warning");
  fireEvent.press(screen.getByTestId("health-card-open-settings"));
  expect(mockOpenAccessSettings).toHaveBeenCalledTimes(1);
});

test("returning to the foreground re-asks the native health check, never trusting stale state", async () => {
  renderScreen(<ListenerHealthScreen />);
  await screen.findByTestId("health-card");
  expect(mockHealth).toHaveBeenCalledTimes(1);

  // The user tapped through to system settings and re-granted access — the
  // mock now reports the corrected state on the next read.
  mockHealth.mockResolvedValue({ granted: true, serviceConnected: true, lastCaptureAt: 123 });

  act(() => emitAppState("active"));

  await waitFor(() => expect(mockHealth).toHaveBeenCalledTimes(2));
});
