// app/(onboarding)/__tests__/alerts_step.test.tsx — the onboarding alerts
// step (GAP-003), the screen that finally gives `requestAlertPermission`
// (lib/alerts/alerts_service.ts) a caller.
//
// THE REGRESSION THIS FILE PINS. That function existed and nothing in the app
// called it. On Android 13+ POST_NOTIFICATIONS defaults to denied until
// something asks, so every notifier's grant check was false forever and no
// limit alert, bill reminder, loan reminder, payday summary or
// tracking-interrupted notice could be displayed at all. The first test below
// is the one that fails the moment the ask is dropped again: it asserts the
// primary button ACTUALLY invokes the request, not merely that the step
// advances.
//
// THE SERVICE IS MOCKED, NOT expo-notifications. `requestAlertPermission`
// reaches the native permission API, which cannot answer under Jest, and the
// same seam app/__tests__/bills_screen.test.tsx already uses for this module
// keeps `@/modules/notification_listener` out of the import graph too.
jest.mock("@/lib/alerts/alerts_service", () => ({
  requestAlertPermission: jest.fn(),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { requestAlertPermission } from "@/lib/alerts/alerts_service";

import AlertsScreen from "../alerts";

const mockRequestAlertPermission = requestAlertPermission as jest.Mock;

function pressPrimary() {
  fireEvent.press(screen.getByTestId("onboarding-primary-button"));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("the step explains what alerts are for before it asks for anything", () => {
  mockRequestAlertPermission.mockResolvedValue(true);
  render(<AlertsScreen />);

  // The value screen docs step 4 requires, rendered with no dialog raised:
  // rendering alone must never ask.
  expect(screen.getByTestId("alerts-step-intro")).toBeTruthy();
  expect(screen.getByTestId("alerts-step-promises")).toBeTruthy();
  expect(mockRequestAlertPermission).not.toHaveBeenCalled();
});

test("THE REGRESSION: the primary button actually asks the OS for the permission", async () => {
  mockRequestAlertPermission.mockResolvedValue(true);
  render(<AlertsScreen />);

  pressPrimary();

  await waitFor(() => expect(mockRequestAlertPermission).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/done"));
});

test("skipping advances without spending the one-shot dialog", async () => {
  mockRequestAlertPermission.mockResolvedValue(true);
  render(<AlertsScreen />);

  fireEvent.press(screen.getByTestId("onboarding-skip-link"));

  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/done"));
  expect(mockRequestAlertPermission).not.toHaveBeenCalled();
});

test("a refusal is explained rather than treated as an error, and does not advance on its own", async () => {
  mockRequestAlertPermission.mockResolvedValue(false);
  render(<AlertsScreen />);

  pressPrimary();

  await waitFor(() => expect(screen.getByTestId("alerts-step-declined")).toBeTruthy());
  expect(mockPush).not.toHaveBeenCalled();
});

test("after a refusal the next press opens the phone's settings, never a second silent request", async () => {
  mockRequestAlertPermission.mockResolvedValue(false);
  render(<AlertsScreen />);

  pressPrimary();
  await waitFor(() => expect(screen.getByTestId("alerts-step-declined")).toBeTruthy());

  pressPrimary();

  await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
  // Android answers a second request from what it remembers, with no dialog —
  // so a second call here would be a button that silently does nothing.
  expect(mockRequestAlertPermission).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith("/(onboarding)/done");
});

test("a request that throws lands on the same settings route, not a dead button", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockRequestAlertPermission.mockRejectedValue(new Error("no permission module"));
  render(<AlertsScreen />);

  pressPrimary();

  await waitFor(() => expect(screen.getByTestId("alerts-step-declined")).toBeTruthy());
  expect(mockPush).not.toHaveBeenCalled();
});

test("a double-tap raises exactly one dialog", async () => {
  let resolveRequest: ((granted: boolean) => void) | undefined;
  mockRequestAlertPermission.mockReturnValue(
    new Promise<boolean>((resolve) => {
      resolveRequest = resolve;
    }),
  );
  render(<AlertsScreen />);

  pressPrimary();
  pressPrimary();

  expect(mockRequestAlertPermission).toHaveBeenCalledTimes(1);
  resolveRequest!(true);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/done"));
});
