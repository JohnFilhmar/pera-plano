// app/(onboarding)/__tests__/first_run_handoff.test.tsx — the first session on
// a brand-new phone, from the very first frame to the first screen of the
// numbered flow, with NOTHING faked between them except the three pre-flow
// screens' own internals (device lock, recovery phrase, provider picker —
// each has its own suite; app/(onboarding)/__tests__/index.test.tsx owns their
// sequencing).
//
// THE DEFECT THIS FILE PINS. app/(onboarding)/index.tsx ends its pre-flow with
// `<Redirect href="/(onboarding)/welcome">`. On a fresh install that component
// is rendered DIRECTLY by app/lock.tsx, because contexts/lock_context.tsx
// reports "needs_onboarding" and app/_layout.tsx's AppShell renders the lock
// screen INSTEAD of the Stack for every status that is not "unlocked". A
// Redirect with no navigator mounted updates router state that nothing is
// rendering: the user finished the provider step and simply stopped there. The
// only way onward was to force-quit and relaunch, which restarts at
// getKeyState() === "locked" and therefore at the ordinary unlock prompt.
//
// WHY THE FIX HANDS BACK TO THE LOCK GATE RATHER THAN MOUNTING A NAVIGATOR
// EARLY. Everything after the provider step needs an OPEN DATABASE, not just a
// router: wallets.tsx, income.tsx, first_limit.tsx and done.tsx all read and
// write through repositories, and done.tsx's `completeOnboarding()` is a
// setting write. During "needs_onboarding" nothing has ever called
// unlockDatabase(), so every one of those calls would throw DatabaseLockedError
// — and the wallet step additionally reads the parser ruleset that
// bootstrapApp() seeds, which does not run until unlock either. So the fix
// (contexts/lock_context.tsx's keysProvisioned) routes the freshly-keyed user
// through the ordinary unlock, and the flow continues from there. This file
// walks exactly that, in one unbroken session.
//
// THE GATE THIS HANDS OFF TO NOW AUTO-FIRES ITS OWN UNLOCK (task-6-brief.md),
// AND THAT APPLIES HERE TOO, DELIBERATELY -- NOT AS A SPECIAL CASE. The
// alternative — auto-prompt on an ordinary cold start or re-lock, but suppress
// it specifically right after this pre-flow, on the grounds that the user
// authenticated seconds ago provisioning their device key — was considered
// and rejected: it would require UnlockPrompt to know "we just provisioned
// keys", state it has no business holding, and a single biometric touch
// immediately after setting up biometrics reads as confirmation the lock
// works rather than as friction. Simple and consistent beats a special case.
// The tests below were updated to assert this (the gate unlocking itself,
// with no `fireEvent.press` where the old manual tap used to be required)
// rather than the superseded "handed to the gate, not through it" behaviour.
jest.mock("expo-font", () => ({
  ...jest.requireActual("expo-font"),
  useFonts: jest.fn(() => [true, null]),
}));

jest.mock("@/contexts/theme_context", () => ({
  ...jest.requireActual("@/contexts/theme_context"),
  useTheme: jest.fn(() => ({
    resolved: "light",
    isReady: true,
    preference: "auto",
    setPreference: jest.fn(),
  })),
}));

// The lock context itself is REAL here — it is half the subject. Its
// dependencies are not: expo-local-authentication and the key manager both
// reach hardware, and @/modules/notification_listener's value side calls
// requireNativeModule() at import time, which throws under Jest.
jest.mock("expo-local-authentication", () => ({
  authenticateAsync: jest.fn(),
}));

// The REAL app/lock.tsx is imported below, and it composes
// components/lock/recovery_unlock_form.tsx, which holds a GAP-017 screen
// capture guard. expo-screen-capture is another requireNativeModule module
// with nothing to bind to under Jest; this suite only needs it to load, so
// the hook is inert here. The suites that assert on the guard's behaviour
// (components/lock/__tests__/recovery_unlock_form.test.tsx,
// components/onboarding/__tests__/recovery_phrase.test.tsx) mock it with the
// package's real mount/unmount semantics instead.
jest.mock("expo-screen-capture", () => ({
  usePreventScreenCapture: jest.fn(),
}));

jest.mock("@/lib/crypto/key_manager", () => {
  class RecoveryUnlockFailedError extends Error {
    constructor() {
      super("unable to unlock with the provided recovery phrase");
      this.name = "RecoveryUnlockFailedError";
    }
  }
  return {
    getKeyState: jest.fn(),
    unlockWithDeviceKey: jest.fn(),
    rewrapAfterInvalidation: jest.fn(),
    lock: jest.fn(),
    RecoveryUnlockFailedError,
  };
});

jest.mock("@/modules/notification_listener", () => {
  class DeviceKeyMissingError extends Error {
    code = "DeviceKeyMissing";
  }
  class DeviceKeyInvalidatedError extends Error {
    code = "DeviceKeyInvalidated";
  }
  class NotAuthenticatedError extends Error {
    code = "NotAuthenticated";
  }
  return {
    DeviceKeyMissingError,
    DeviceKeyInvalidatedError,
    NotAuthenticatedError,
    isDeviceSecure: jest.fn().mockResolvedValue(true),
    openSecuritySettings: jest.fn(),
    drainPendingCaptures: jest.fn().mockResolvedValue([]),
    addCaptureListener: jest.fn().mockReturnValue(jest.fn()),
  };
});

// Bootstrap and ingest are mocked exactly as app/__tests__/root_layout.test.tsx
// mocks them: this file's subject is which screen the user is looking at, not
// what the app seeds once it is finally open.
jest.mock("@/lib/bootstrap", () => ({
  ...jest.requireActual("@/lib/bootstrap"),
  bootstrapApp: jest.fn().mockResolvedValue({ onboardingComplete: false }),
}));

jest.mock("@/lib/ingest/pipeline", () => ({
  startIngest: jest.fn().mockResolvedValue(jest.fn()),
}));

// The three pre-flow screens are faked down to a single "advance" control
// each. Their internals (a real Keystore probe, a real 12-word confirmation, a
// real native prefs write) are covered by their own suites, and none of them
// is what this file is about — the HANDOFF at the end of them is.
jest.mock("../device_lock", () => ({
  __esModule: true,
  default: ({ onSecure }: { onSecure?: () => void }) => {
    const { Text } = require("react-native");
    return (
      <Text testID="fake-device-lock" onPress={onSecure}>
        device-lock
      </Text>
    );
  },
}));

jest.mock("../recovery_phrase", () => ({
  __esModule: true,
  default: ({ onDone }: { onDone?: () => void }) => {
    const { Text } = require("react-native");
    return (
      <Text testID="fake-recovery-phrase" onPress={onDone}>
        recovery-phrase
      </Text>
    );
  },
}));

jest.mock("../providers", () => ({
  __esModule: true,
  default: ({ onDone }: { onDone?: () => void }) => {
    const { Text } = require("react-native");
    return (
      <Text testID="fake-providers" onPress={onDone}>
        providers
      </Text>
    );
  },
}));

import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { renderRouter, screen } from "expo-router/testing-library";
import { Text } from "react-native";
import { authenticateAsync } from "expo-local-authentication";

import { getKeyState, unlockWithDeviceKey } from "@/lib/crypto/key_manager";
import { LockProvider } from "@/contexts/lock_context";
import { closeDatabase } from "@/lib/db/database";
import { freshDb, TEST_DEK } from "@/test_support/db";

import LockScreen from "../../lock";
import RootLayout from "../../_layout";
import Index from "../../index";
import OnboardingLayout from "../_layout";
import OnboardingIndexScreen from "../index";
import WelcomeScreen from "../welcome";

const mockGetKeyState = getKeyState as jest.Mock;
const mockUnlockWithDeviceKey = unlockWithDeviceKey as jest.Mock;
const mockAuthenticateAsync = authenticateAsync as jest.Mock;

/** Stands in for the whole tab tree: if anything below ever renders this, a
 * locked app has put the user's money on screen. */
function TabsStub() {
  return <Text testID="tabs-stub">tabs</Text>;
}

/**
 * The first-run tree EXACTLY as app/_layout.tsx builds it while the lock
 * reports "needs_onboarding": the provider, the lock screen, and NO navigator
 * anywhere — that absence is the whole defect, so this rendering deliberately
 * has no router to lean on.
 */
function renderFirstRunShell() {
  return render(
    <LockProvider>
      <LockScreen />
    </LockProvider>,
  );
}

function renderApp(initialUrl = "/") {
  return renderRouter(
    {
      _layout: RootLayout,
      index: Index,
      "(onboarding)/_layout": OnboardingLayout,
      "(onboarding)/index": OnboardingIndexScreen,
      "(onboarding)/welcome": WelcomeScreen,
      "(tabs)/index": TabsStub,
    },
    { initialUrl },
  );
}

/** Walks the three pre-flow screens the way a first-run user does. Flipping
 * `getKeyState` to "unlocked" at the phrase step is not a convenience: that is
 * literally what happens on the device, since performInitializeKeys() assigns
 * key_manager's in-memory `dek` on success (see its own comment). */
async function walkPreFlow() {
  await waitFor(() => expect(screen.getByTestId("fake-device-lock")).toBeTruthy());
  fireEvent.press(screen.getByTestId("fake-device-lock"));

  await waitFor(() => expect(screen.getByTestId("fake-recovery-phrase")).toBeTruthy());
  fireEvent.press(screen.getByTestId("fake-recovery-phrase"));
  mockGetKeyState.mockResolvedValue("unlocked");

  await waitFor(() => expect(screen.getByTestId("fake-providers")).toBeTruthy());
  fireEvent.press(screen.getByTestId("fake-providers"));
}

beforeEach(async () => {
  jest.clearAllMocks();
  // A migrated database, which on a real device is what bootstrapApp() leaves
  // behind AFTER the unlock below. Repositories are not the subject here; the
  // one this file does reach is app/index.tsx's `onboarding_complete` read.
  await freshDb();
  mockAuthenticateAsync.mockResolvedValue({ success: true });
  mockUnlockWithDeviceKey.mockResolvedValue(TEST_DEK);
});

afterEach(async () => {
  await closeDatabase();
});

async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// The handoff itself, in the tree the device actually renders: no navigator.
//
// DELIBERATELY NOT renderRouter. A router harness mounts an ExpoRoot, and the
// broken `<Redirect>` firing inside one makes the whole root re-mount — which
// re-runs LockProvider's getKeyState() effect and lands on "locked" all by
// itself. That is a harness artifact and, ironically, the exact shape of the
// force-quit-and-relaunch the defect used to require: a test built on it would
// have gone green against the broken code. These two render the first-run tree
// as app/_layout.tsx builds it instead, where there is nothing to re-mount and
// nowhere for a Redirect to land.
// ---------------------------------------------------------------------------

test("the pre-flow hands off to the lock gate, which auto-fires its own unlock -- no dead end, no manual tap needed", async () => {
  // No keys at all: contexts/lock_context.tsx reports "needs_onboarding" and
  // app/(onboarding)/index.tsx starts at the device-lock gate.
  mockGetKeyState.mockResolvedValue("uninitialized");

  renderFirstRunShell();
  await walkPreFlow();

  // THE DEFECT. Before the fix this is where a first session ended: the
  // provider screen simply stayed on screen, because the `<Redirect>` that
  // replaced it had no navigator to move and nothing else was wired up.
  await waitFor(() => expect(screen.getByTestId("unlock-prompt")).toBeTruthy());
  expect(screen.queryByTestId("fake-providers")).toBeNull();
  // Handed TO a REAL gate, and task-6-brief.md means the gate does not just
  // sit there either: UnlockPrompt auto-fires the moment it mounts, so the
  // freshly-keyed device unlocks itself without the user tapping anything.
  // (Deliberate, ruled: one biometric touch immediately after setting up
  // biometrics reads as confirmation the lock works, not as friction --
  // see this file's header for why the alternative of suppressing the
  // auto-fire specifically here was rejected.)
  await waitFor(() => expect(mockUnlockWithDeviceKey).toHaveBeenCalledTimes(1));
});

test("the gate it hands off to is the real one: a refused authentication leaves the app locked", async () => {
  mockGetKeyState.mockResolvedValue("uninitialized");
  mockAuthenticateAsync.mockResolvedValue({ success: false });

  renderFirstRunShell();
  await walkPreFlow();
  await waitFor(() => expect(screen.getByTestId("unlock-prompt")).toBeTruthy());

  // The gate's OWN auto-fire (task-6-brief.md) is already one real, refused
  // attempt -- proven here BEFORE any tap, and bounded to exactly one: if the
  // auto-fire ever looped on a refusal, `mockAuthenticateAsync` would show
  // more than a single call at this point.
  await waitFor(() => expect(screen.getByTestId("unlock-error")).toBeTruthy());
  expect(screen.getByTestId("unlock-prompt")).toBeTruthy();
  expect(mockAuthenticateAsync).toHaveBeenCalledTimes(1);
  // A failed authentication is not a way past the DEK: nothing unwrapped it.
  expect(mockUnlockWithDeviceKey).not.toHaveBeenCalled();

  // The anti-loop guarantee itself, exercised on the real first-run path: a
  // manual retry is a SECOND, independent attempt -- not blocked, and not
  // automatic either. This is the fallback unlock_prompt.tsx's header
  // describes: after the auto-fire's own failure, only a fresh tap tries
  // again.
  fireEvent.press(screen.getByTestId("unlock-button"));

  await waitFor(() => expect(mockAuthenticateAsync).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId("unlock-error")).toBeTruthy();
  expect(screen.getByTestId("unlock-prompt")).toBeTruthy();
  expect(mockUnlockWithDeviceKey).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// The rest of the same session, with the router in play: the unlock the
// handoff leads to is what mounts the Stack, and the numbered flow starts.
// ---------------------------------------------------------------------------

test("one unlock later -- fired by the gate itself, no button needed -- the numbered flow's first screen is on screen, no relaunch anywhere in this session", async () => {
  mockGetKeyState.mockResolvedValue("uninitialized");

  renderApp();
  await walkPreFlow();

  await waitFor(() => expect(screen.getByTestId("unlock-prompt")).toBeTruthy());
  // Still locked at the very first paint: no tab tree, and the numbered flow
  // has not started either.
  expect(screen.queryByTestId("tabs-stub")).toBeNull();
  expect(screen.queryByTestId("welcome-promise")).toBeNull();

  // NO fireEvent.press HERE (task-6-brief.md): UnlockPrompt's own auto-fire
  // does what the manual tap used to, so the flow continues on its own.
  await waitFor(() => expect(screen.getByTestId("welcome-promise")).toBeTruthy());
  // Routed now, not rendered under the lock screen: the unlock prompt is gone,
  // and so is the pre-flow it handed off from.
  expect(screen.queryByTestId("unlock-prompt")).toBeNull();
  expect(screen.queryByTestId("fake-device-lock")).toBeNull();
});

test("a first-run install deep-linked straight at the tabs still renders no tab tree", async () => {
  // The reason the fix lives in the lock context rather than in AppShell's
  // render gate: mounting a navigator for "needs_onboarding" would make every
  // route in the app addressable while the database is still locked. Nothing
  // but onboarding may render here, whatever URL the app was opened with.
  mockGetKeyState.mockResolvedValue("uninitialized");

  renderApp("/(tabs)");
  await flushMicrotasks();

  expect(screen.queryByTestId("tabs-stub")).toBeNull();
  expect(screen.getByTestId("fake-device-lock")).toBeTruthy();
});
