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

import { render, screen } from "@testing-library/react-native";
import { useLock } from "@/contexts/lock_context";
import LockScreen from "../lock";

let capturedHref: string | undefined;
let capturedUnlockPromptProps: { isAuthenticating: boolean; errorMessage: string | null } | undefined;
let capturedRecoveryFormProps: { errorMessage: string | null } | undefined;

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
