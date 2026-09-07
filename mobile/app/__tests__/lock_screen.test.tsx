// app/__tests__/lock_screen.test.tsx — LockScreen's own routing decision:
// which status maps to which child, in isolation from the render-gate
// wiring (lock_gate.test.tsx) and from the state machine itself
// (contexts/__tests__/lock_context.test.tsx). Each of the five branches is
// pinned separately so deleting any one of them fails exactly its own test.
//
// "needs_onboarding" used to render <Redirect href="/(onboarding)"> (a
// route that did not exist yet); task-10-brief.md replaced that with a
// direct render of app/(onboarding)/index.tsx's OnboardingIndexScreen — see
// app/lock.tsx's header comment for why a Redirect could never actually
// have worked here. The real onboarding chain (device_lock.tsx,
// recovery_phrase.tsx, key_manager.ts) has its own dedicated suites, so it
// is faked here exactly like UnlockPrompt/RecoveryUnlockForm/
// DeviceLockExplainer already are below.
jest.mock("@/contexts/lock_context", () => ({
  useLock: jest.fn(),
}));

jest.mock("@/app/(onboarding)/index", () => ({
  __esModule: true,
  default: () => {
    const { Text } = require("react-native");
    return <Text testID="fake-onboarding-entry">onboarding-entry</Text>;
  },
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
  capturedUnlockPromptProps = undefined;
  capturedRecoveryFormProps = undefined;
  capturedDeviceLockExplainerProps = undefined;
  jest.clearAllMocks();
});

test('"checking" renders nothing at all', () => {
  mockUseLock.mockReturnValue(baseLockValue({ status: "checking" }));
  render(<LockScreen />);
  expect(screen.toJSON()).toBeNull();
  expect(screen.queryByTestId("fake-onboarding-entry")).toBeNull();
});

test('"needs_onboarding" renders the onboarding flow directly, not the tabs or a Redirect', () => {
  mockUseLock.mockReturnValue(baseLockValue({ status: "needs_onboarding" }));
  render(<LockScreen />);
  expect(screen.getByTestId("fake-onboarding-entry")).toBeTruthy();
  expect(screen.queryByTestId("fake-recovery-form")).toBeNull();
  expect(screen.queryByTestId("fake-unlock-prompt")).toBeNull();
});

// GAP-078. contexts/lock_context.tsx routes a wipe that failed AFTER deleting
// the database file to "needs_onboarding" WITH a message. Every screen the
// sequencer can render below is a first-run screen that knows nothing about
// it, so this branch is the only place that message can be seen at all.
test('"needs_onboarding" carrying a message shows it above the flow, so a failed wipe is not handed back as a pristine first run', () => {
  mockUseLock.mockReturnValue(
    baseLockValue({
      status: "needs_onboarding",
      errorMessage: "Your data was erased, but PeraPlano couldn't finish resetting.",
    }),
  );
  render(<LockScreen />);
  expect(screen.getByTestId("onboarding-lock-notice")).toHaveTextContent(/Your data was erased/);
  // The flow still runs — the notice is a strip above it, never a replacement
  // for it. Setting up again from here is the whole point.
  expect(screen.getByTestId("fake-onboarding-entry")).toBeTruthy();
});

test('an ordinary first run has no message and gets no notice strip', () => {
  mockUseLock.mockReturnValue(baseLockValue({ status: "needs_onboarding", errorMessage: null }));
  render(<LockScreen />);
  expect(screen.queryByTestId("onboarding-lock-notice")).toBeNull();
  expect(screen.getByTestId("fake-onboarding-entry")).toBeTruthy();
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
