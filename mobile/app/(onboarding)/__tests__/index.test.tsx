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

let capturedOnPhraseDone: (() => void) | undefined;
jest.mock("../recovery_phrase", () => ({
  __esModule: true,
  default: (props: { onDone?: () => void }) => {
    capturedOnPhraseDone = props.onDone;
    const { Text } = require("react-native");
    return <Text testID="fake-recovery-phrase">recovery-phrase</Text>;
  },
}));

// THE PROVIDER PICKER IS NOT MOCKED HERE ANY MORE, BECAUSE IT IS NOT HERE
// (GAP-091). It used to be this sequencer's third child and had to be faked --
// app/(onboarding)/providers.tsx imports @/modules/notification_listener, whose
// value side calls requireNativeModule at module load and throws under Jest. It
// is a numbered step now, after "battery", so this file no longer reaches it at
// all; its own suite is components/onboarding/__tests__/provider_picker.test.tsx.

import { act, render, screen, waitFor } from "@testing-library/react-native";
import { getKeyState } from "@/lib/crypto/key_manager";
import { closeDatabase } from "@/lib/db/database";
import { recordOnboardingStep } from "@/lib/onboarding/onboarding_state";
import { freshDb } from "@/test_support/db";
import OnboardingIndexScreen from "../index";

const mockGetKeyState = getKeyState as jest.Mock;

// A REAL DATABASE NOW, FOR ONE READ (GAP-067). The already-keyed branch resumes
// at the recorded step instead of always redirecting to "welcome", and mocking
// that read away would leave the branch this file exists to pin asserted
// against a stub of itself.
beforeEach(async () => {
  await freshDb();
  capturedHref = undefined;
  capturedOnSecure = undefined;
  capturedOnPhraseDone = undefined;
  jest.clearAllMocks();
});

afterEach(async () => {
  await closeDatabase();
});

/** Walks the flow as a fresh install does: device lock, then the phrase. */
async function advanceToPhraseStep() {
  mockGetKeyState.mockResolvedValue("uninitialized");
  render(<OnboardingIndexScreen />);
  await waitFor(() => expect(screen.getByTestId("fake-device-lock")).toBeTruthy());
  await act(async () => {
    capturedOnSecure!();
  });
  await waitFor(() => expect(screen.getByTestId("fake-recovery-phrase")).toBeTruthy());
}

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

test("keys already locked (Task 10's steps already done): skips both steps and continues into the numbered flow", async () => {
  mockGetKeyState.mockResolvedValue("locked");

  render(<OnboardingIndexScreen />);

  await waitFor(() => expect(screen.getByTestId("fake-redirect")).toBeTruthy());
  expect(capturedHref).toBe("/(onboarding)/welcome");
  expect(screen.queryByTestId("fake-device-lock")).toBeNull();
  expect(screen.queryByTestId("fake-recovery-phrase")).toBeNull();
});

test("keys already unlocked: also continues into the numbered flow, never re-shows the phrase capture", async () => {
  mockGetKeyState.mockResolvedValue("unlocked");

  render(<OnboardingIndexScreen />);

  await waitFor(() => expect(screen.getByTestId("fake-redirect")).toBeTruthy());
  expect(capturedHref).toBe("/(onboarding)/welcome");
  expect(screen.queryByTestId("fake-recovery-phrase")).toBeNull();
});

// ---------------------------------------------------------------------------
// Where this sequencer STOPS (GAP-091). It ran a third pre-flow screen, the
// provider picker, between the phrase and the numbered flow -- which is before
// notification access is granted, so the picker's whole subject ("apps we've
// seen") was empty on every fresh install. It is a numbered step now, and this
// sequencer's only job is the two unskippable screens that make keys exist.
// ---------------------------------------------------------------------------

test("the phrase is the last thing this sequencer runs, and it hands straight to the numbered flow", async () => {
  await advanceToPhraseStep();
  expect(capturedOnPhraseDone).toBeDefined();

  await act(async () => {
    capturedOnPhraseDone!();
  });

  await waitFor(() => expect(screen.getByTestId("fake-redirect")).toBeTruthy());
  expect(capturedHref).toBe("/(onboarding)/welcome");
  expect(screen.queryByTestId("fake-recovery-phrase")).toBeNull();
});

test("the handoff callback fires once the keys exist, with no third screen in between", async () => {
  // app/lock.tsx supplies `onKeysReady` and is branch 1 by definition: there is
  // no navigator for a Redirect to move, so the callback is the real forward
  // action and a screen rendered after it would strand a first-run user.
  const onKeysReady = jest.fn();
  mockGetKeyState.mockResolvedValue("uninitialized");

  render(<OnboardingIndexScreen onKeysReady={onKeysReady} />);
  await waitFor(() => expect(screen.getByTestId("fake-device-lock")).toBeTruthy());
  await act(async () => {
    capturedOnSecure!();
  });
  await waitFor(() => expect(screen.getByTestId("fake-recovery-phrase")).toBeTruthy());

  await act(async () => {
    capturedOnPhraseDone!();
  });

  await waitFor(() => expect(onKeysReady).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("fake-redirect")).toBeNull();
});

// ---------------------------------------------------------------------------
// Resuming (GAP-067). The already-keyed branch used to redirect to "welcome"
// unconditionally, which is what turned an interrupted run into a loop: the
// access and battery steps both hand off to system Settings, five minutes there
// trips the background re-lock, and coming back threw away every finished step.
// ---------------------------------------------------------------------------

test("an interrupted run resumes at the step it reached, not at welcome", async () => {
  await recordOnboardingStep("battery");
  mockGetKeyState.mockResolvedValue("locked");

  render(<OnboardingIndexScreen />);

  await waitFor(() => expect(screen.getByTestId("fake-redirect")).toBeTruthy());
  expect(capturedHref).toBe("/(onboarding)/battery");
});

test("the redirect never renders once at welcome before correcting itself", async () => {
  await recordOnboardingStep("income");
  mockGetKeyState.mockResolvedValue("unlocked");

  render(<OnboardingIndexScreen />);

  // A first render at "welcome" would ALREADY HAVE NAVIGATED -- a Redirect is
  // not a suggestion -- so the resume target has to be read before the step
  // flips rather than filled in afterwards. Every href this screen ever
  // produced is captured, so a two-step correction is visible here.
  await waitFor(() => expect(screen.getByTestId("fake-redirect")).toBeTruthy());
  expect(capturedHref).toBe("/(onboarding)/income");
});

test("a fresh install with nothing recorded still starts at welcome", async () => {
  mockGetKeyState.mockResolvedValue("locked");

  render(<OnboardingIndexScreen />);

  await waitFor(() => expect(screen.getByTestId("fake-redirect")).toBeTruthy());
  expect(capturedHref).toBe("/(onboarding)/welcome");
});
