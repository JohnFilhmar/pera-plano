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

// Faked for the same reason as the two above — this file's only subject is the
// SEQUENCING. It is also the one child that MUST be mocked rather than merely
// ought to be: app/(onboarding)/providers.tsx imports
// @/modules/notification_listener, whose value side calls requireNativeModule
// at module load and throws under Jest.
let capturedOnProvidersDone: (() => void) | undefined;
jest.mock("../providers", () => ({
  __esModule: true,
  default: (props: { onDone?: () => void }) => {
    capturedOnProvidersDone = props.onDone;
    const { Text } = require("react-native");
    return <Text testID="fake-providers">providers</Text>;
  },
}));

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
  capturedOnProvidersDone = undefined;
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
// The provider step (provider-selection plan Task 4) — the first of the steps
// that "actually belong after the phrase". Completing it now continues into
// the numbered flow (m3c-onboarding-client plan Task 2) rather than falling
// through to /(tabs) — see this file's header for the redirect target.
// ---------------------------------------------------------------------------

test("the provider picker never renders before the recovery phrase is captured", async () => {
  await advanceToPhraseStep();

  // Ordering matters for the same reason the device lock leads: the picker
  // writes to native prefs, and a user who abandons onboarding before the
  // phrase would have a configured listener and no way back to their data.
  expect(screen.queryByTestId("fake-providers")).toBeNull();
});

test("once the recovery phrase is captured, advances to the provider picker", async () => {
  await advanceToPhraseStep();
  expect(capturedOnPhraseDone).toBeDefined();

  await act(async () => {
    capturedOnPhraseDone!();
  });

  await waitFor(() => expect(screen.getByTestId("fake-providers")).toBeTruthy());
  expect(screen.queryByTestId("fake-recovery-phrase")).toBeNull();
  expect(screen.queryByTestId("fake-redirect")).toBeNull();
});

test("completing the provider step continues into the numbered flow's first screen", async () => {
  await advanceToPhraseStep();
  await act(async () => {
    capturedOnPhraseDone!();
  });
  await waitFor(() => expect(screen.getByTestId("fake-providers")).toBeTruthy());
  expect(capturedOnProvidersDone).toBeDefined();

  await act(async () => {
    capturedOnProvidersDone!();
  });

  await waitFor(() => expect(screen.getByTestId("fake-redirect")).toBeTruthy());
  expect(capturedHref).toBe("/(onboarding)/welcome");
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
