// app/(onboarding)/__tests__/index.test.tsx — the ordering task-10-brief.md
// rule 1 depends on: device-lock renders BEFORE the phrase step, checked
// fresh every time this screen mounts, and a user who already has keys
// (this task's two steps already done; M3c's remaining steps not yet built)
// never sees the phrase-capture UI a second time. Both children are faked
// here — their own internal behavior has dedicated suites
// (components/onboarding/__tests__/device_lock.test.tsx,
// components/onboarding/__tests__/recovery_phrase.test.tsx); this file's
// only subject is the SEQUENCING between them.
jest.mock("@/lib/crypto/key_manager", () => ({
  getKeyState: jest.fn(),
}));

let capturedHref: string | undefined;
jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => {
    capturedHref = props.href;
    const { Text } = require("react-native");
    return <Text testID="fake-redirect">{props.href}</Text>;
  },
}));

let capturedOnSecure: (() => void) | undefined;
jest.mock("../device_lock", () => ({
  __esModule: true,
  default: (props: { onSecure?: () => void }) => {
    capturedOnSecure = props.onSecure;
    const { Text } = require("react-native");
    return <Text testID="fake-device-lock">device-lock</Text>;
  },
}));

jest.mock("../recovery_phrase", () => ({
  __esModule: true,
  default: () => {
    const { Text } = require("react-native");
    return <Text testID="fake-recovery-phrase">recovery-phrase</Text>;
  },
}));

import { act, render, screen, waitFor } from "@testing-library/react-native";
import { getKeyState } from "@/lib/crypto/key_manager";
import OnboardingIndexScreen from "../index";

const mockGetKeyState = getKeyState as jest.Mock;

beforeEach(() => {
  capturedHref = undefined;
  capturedOnSecure = undefined;
  jest.clearAllMocks();
});

test("renders nothing while getKeyState is still resolving", async () => {
  let resolveState!: (state: string) => void;
  mockGetKeyState.mockReturnValue(
    new Promise((resolve) => {
      resolveState = resolve;
    }),
  );

  render(<OnboardingIndexScreen />);

  expect(screen.queryByTestId("fake-device-lock")).toBeNull();
  expect(screen.queryByTestId("fake-recovery-phrase")).toBeNull();
  expect(screen.queryByTestId("fake-redirect")).toBeNull();

  await act(async () => {
    resolveState("uninitialized");
    await Promise.resolve();
  });
});

test("no keys yet: shows the device-lock step first, never the phrase step", async () => {
  mockGetKeyState.mockResolvedValue("uninitialized");

  render(<OnboardingIndexScreen />);

  await waitFor(() => expect(screen.getByTestId("fake-device-lock")).toBeTruthy());
  expect(screen.queryByTestId("fake-recovery-phrase")).toBeNull();
  expect(screen.queryByTestId("fake-redirect")).toBeNull();
});

test("once the device reports secure, advances to the phrase step and drops the device-lock screen", async () => {
  mockGetKeyState.mockResolvedValue("uninitialized");

  render(<OnboardingIndexScreen />);
  await waitFor(() => expect(screen.getByTestId("fake-device-lock")).toBeTruthy());
  expect(capturedOnSecure).toBeDefined();

  await act(async () => {
    capturedOnSecure!();
  });

  await waitFor(() => expect(screen.getByTestId("fake-recovery-phrase")).toBeTruthy());
  expect(screen.queryByTestId("fake-device-lock")).toBeNull();
});

test("keys already locked (Task 10's steps already done): skips both steps and falls through to the tabs", async () => {
  mockGetKeyState.mockResolvedValue("locked");

  render(<OnboardingIndexScreen />);

  await waitFor(() => expect(screen.getByTestId("fake-redirect")).toBeTruthy());
  expect(capturedHref).toBe("/(tabs)");
  expect(screen.queryByTestId("fake-device-lock")).toBeNull();
  expect(screen.queryByTestId("fake-recovery-phrase")).toBeNull();
});

test("keys already unlocked: also falls through to the tabs, never re-shows the phrase capture", async () => {
  mockGetKeyState.mockResolvedValue("unlocked");

  render(<OnboardingIndexScreen />);

  await waitFor(() => expect(screen.getByTestId("fake-redirect")).toBeTruthy());
  expect(capturedHref).toBe("/(tabs)");
  expect(screen.queryByTestId("fake-recovery-phrase")).toBeNull();
});
