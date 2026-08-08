// app/__tests__/lock_screen.test.tsx — LockScreen's own routing decision:
// which status maps to which child, in isolation from the render-gate
// wiring (lock_gate.test.tsx) and from the state machine itself
// (contexts/__tests__/lock_context.test.tsx). Each of the four branches is
// pinned separately so deleting any one of them fails exactly its own test.
jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => {
    capturedHref = props.href;
    return null;
  },
}));

jest.mock("@/contexts/lock_context", () => ({
  useLock: jest.fn(),
}));

jest.mock("@/components/lock/unlock_prompt", () => ({
  UnlockPrompt: (props: { isAuthenticating: boolean; errorMessage: string | null }) => {
    capturedUnlockPromptProps = props;
    const { Text } = require("react-native");
    return <Text testID="fake-unlock-prompt">unlock-prompt</Text>;
  },
}));

jest.mock("@/components/lock/recovery_unlock_form", () => ({
  RecoveryUnlockForm: (props: { errorMessage: string | null }) => {
    capturedRecoveryFormProps = props;
    const { Text } = require("react-native");
    return <Text testID="fake-recovery-form">recovery-form</Text>;
  },
}));

jest.mock("@/components/onboarding/device_lock_explainer", () => ({
  DeviceLockExplainer: (props: { onOpenSettings: () => void }) => {
    capturedDeviceLockExplainerProps = props;
    const { Text } = require("react-native");
    return <Text testID="fake-device-lock-explainer">device-lock-explainer</Text>;
  },
}));

jest.mock("@/modules/notification_listener", () => ({
  openSecuritySettings: jest.fn(),
}));

import { render, screen } from "@testing-library/react-native";
import { useLock } from "@/contexts/lock_context";
import { openSecuritySettings } from "@/modules/notification_listener";
import LockScreen from "../lock";

let capturedHref: string | undefined;
let capturedUnlockPromptProps: { isAuthenticating: boolean; errorMessage: string | null } | undefined;
let capturedRecoveryFormProps: { errorMessage: string | null } | undefined;
let capturedDeviceLockExplainerProps: { onOpenSettings: () => void } | undefined;

const mockUseLock = useLock as jest.Mock;

function baseLockValue(overrides: Partial<ReturnType<typeof useLock>> = {}) {
  return {
    status: "locked" as const,
    errorMessage: null,
    unlock: jest.fn(),
    submitRecoveryPhrase: jest.fn(),
    wipeAndStartOver: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  capturedHref = undefined;
  capturedUnlockPromptProps = undefined;
  capturedRecoveryFormProps = undefined;
  capturedDeviceLockExplainerProps = undefined;
  jest.clearAllMocks();
});

test('"checking" renders nothing at all', () => {
  mockUseLock.mockReturnValue(baseLockValue({ status: "checking" }));
  render(<LockScreen />);
  expect(screen.toJSON()).toBeNull();
  expect(capturedHref).toBeUndefined();
});

test('"needs_onboarding" redirects to "/(onboarding)"', () => {
  mockUseLock.mockReturnValue(baseLockValue({ status: "needs_onboarding" }));
  render(<LockScreen />);
  expect(capturedHref).toBe("/(onboarding)");
});

test('"needs_recovery" renders RecoveryUnlockForm, not UnlockPrompt', () => {
  mockUseLock.mockReturnValue(
    baseLockValue({ status: "needs_recovery", errorMessage: "wrong words" }),
  );
  render(<LockScreen />);
  expect(screen.getByTestId("fake-recovery-form")).toBeTruthy();
  expect(screen.queryByTestId("fake-unlock-prompt")).toBeNull();
  expect(capturedRecoveryFormProps?.errorMessage).toBe("wrong words");
});

test('"needs_device_lock" renders DeviceLockExplainer, wired to openSecuritySettings -- not RecoveryUnlockForm or UnlockPrompt', () => {
  mockUseLock.mockReturnValue(baseLockValue({ status: "needs_device_lock" }));
  render(<LockScreen />);
  expect(screen.getByTestId("fake-device-lock-explainer")).toBeTruthy();
  expect(screen.queryByTestId("fake-recovery-form")).toBeNull();
  expect(screen.queryByTestId("fake-unlock-prompt")).toBeNull();
  expect(capturedDeviceLockExplainerProps?.onOpenSettings).toBe(openSecuritySettings);
});

test('"locked" renders UnlockPrompt with isAuthenticating=false', () => {
  mockUseLock.mockReturnValue(baseLockValue({ status: "locked" }));
  render(<LockScreen />);
  expect(screen.getByTestId("fake-unlock-prompt")).toBeTruthy();
  expect(capturedUnlockPromptProps?.isAuthenticating).toBe(false);
});

test('"authenticating" renders UnlockPrompt with isAuthenticating=true', () => {
  mockUseLock.mockReturnValue(baseLockValue({ status: "authenticating" }));
  render(<LockScreen />);
  expect(screen.getByTestId("fake-unlock-prompt")).toBeTruthy();
  expect(capturedUnlockPromptProps?.isAuthenticating).toBe(true);
});
