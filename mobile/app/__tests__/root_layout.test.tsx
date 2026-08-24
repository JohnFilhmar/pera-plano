// app/__tests__/root_layout.test.tsx — the two claims task-17-brief.md rules
// 1 and 2 make about the root layout:
//  1. nothing renders before every startup gate resolves (fonts, bootstrap,
//     theme) — proven PER GATE: each of the three (useFonts, bootstrapApp,
//     useTheme's isReady) is independently mockable, and each test below
//     holds exactly one of them pending while the other two are mocked
//     already-ready, then asserts absence. A round of coordinator review
//     found that an earlier version of this file only isolated the
//     bootstrap gate — deleting the font or theme condition from
//     app/_layout.tsx's render-null check left all tests green, because
//     nothing here pinned those two gates individually. See the mutation log
//     in the task-17 fix report for the break/fail/revert evidence.
//  2. a throwing bootstrapApp() does not leave the screen permanently blank —
//     proven by forcing the rejection and asserting the recovery UI is on
//     screen, then that its retry action actually re-invokes bootstrapApp()
//     (not a decorative button that does nothing).
//
// Task 9 added a FOURTH gate (the app lock, contexts/lock_context.tsx) —
// this file holds it at an already-"unlocked" default throughout (via the
// same "mock the hook, keep the provider real-but-irrelevant" shape used for
// theme below) so the three gates above keep being tested in isolation. The
// lock gate itself gets its OWN dedicated, discriminating tests in
// app/__tests__/lock_gate.test.tsx — deliberately NOT folded in here, so a
// regression in either the pre-existing three or the new fourth condition
// points at one obvious file.
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { renderRouter, screen } from "expo-router/testing-library";
import { useFonts } from "expo-font";
import RootLayout from "../_layout";
import Index from "../index";
import TabsLayout from "../(tabs)/_layout";
import HomeScreen from "../(tabs)/index";
import TransactionsScreen from "../(tabs)/transactions";
import WalletsScreen from "../(tabs)/wallets";
import PlanScreen from "../(tabs)/plan";
import MoreScreen from "../(tabs)/more";
import { UnlockPrompt } from "@/components/lock/unlock_prompt";

jest.mock("@/lib/bootstrap", () => ({
  ...jest.requireActual("@/lib/bootstrap"),
  bootstrapApp: jest.fn(),
}));

// expo-font's useFonts and theme_context's useTheme are mocked the same way
// bootstrapApp already is — each gate gets its own controllable knob, kept
// at an "already ready" default in beforeEach so any ONE test can pin just
// the gate it's isolating without the other two confounding the result.
// ThemeProvider itself is kept real (spread via requireActual) — AppShell
// reads useTheme() directly (mocked), so ThemeProvider's own context value
// is irrelevant here; only the hook return matters.
jest.mock("expo-font", () => ({
  ...jest.requireActual("expo-font"),
  useFonts: jest.fn(),
}));

jest.mock("@/contexts/theme_context", () => ({
  ...jest.requireActual("@/contexts/theme_context"),
  useTheme: jest.fn(),
}));

// Unlike ThemeProvider above, LockProvider is NOT kept real: its real
// implementation reaches expo-local-authentication, expo-secure-store and
// the notification_listener native module, none of which have a native
// registration under Jest. AppShell reads useLock() directly (mocked), so
// the provider itself only needs to exist as a harmless passthrough for the
// tree to mount at all.
jest.mock("@/contexts/lock_context", () => ({
  LockProvider: ({ children }: { children: import("react").ReactNode }) => children,
  useLock: jest.fn(),
}));

// _layout.tsx unconditionally imports ./lock (LockScreen), which now imports
// openSecuritySettings from this module for its "needs_device_lock" branch
// (task-9a-brief) -- module-level imports execute regardless of which
// branch actually renders, so the real module's top-level
// requireNativeModule() call would throw here too without this mock, even
// though useLock is held at "unlocked" throughout this file.
jest.mock("@/modules/notification_listener", () => ({
  openSecuritySettings: jest.fn(),
  // startIngest reaches for both of these. Without them it throws on an
  // undefined call, which the layout swallows -- so the suite would pass while
  // silently never exercising the real start path.
  drainPendingCaptures: jest.fn().mockResolvedValue([]),
  addCaptureListener: jest.fn().mockReturnValue(jest.fn()),
}));

jest.mock("@/lib/ingest/pipeline", () => ({
  startIngest: jest.fn().mockResolvedValue(jest.fn()),
}));

import { bootstrapApp } from "@/lib/bootstrap";
import { startIngest } from "@/lib/ingest/pipeline";
import { useTheme } from "@/contexts/theme_context";
import { useLock } from "@/contexts/lock_context";

const mockBootstrapApp = bootstrapApp as jest.Mock;
const mockStartIngest = startIngest as jest.Mock;
const mockUseFonts = useFonts as jest.Mock;
const mockUseTheme = useTheme as jest.Mock;
const mockUseLock = useLock as jest.Mock;

function renderApp() {
  return renderRouter(
    {
      _layout: RootLayout,
      index: Index,
      "(tabs)/_layout": TabsLayout,
      "(tabs)/index": HomeScreen,
      "(tabs)/transactions": TransactionsScreen,
      "(tabs)/wallets": WalletsScreen,
      "(tabs)/plan": PlanScreen,
      "(tabs)/more": MoreScreen,
    },
    { initialUrl: "/(tabs)" },
  );
}

/** Flushes pending microtask chains (bootstrapApp's own `.then()`, any
 * promise-driven state) without touching real or fake timers, so a test
 * isolating one gate can be sure the OTHER two have already settled before
 * it asserts on the one it's pinning. */
async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  mockBootstrapApp.mockReset();
  mockStartIngest.mockReset();
  mockStartIngest.mockResolvedValue(jest.fn());
  mockUseFonts.mockReturnValue([true, null]);
  mockUseTheme.mockReturnValue({
    resolved: "light",
    isReady: true,
    preference: "auto",
    setPreference: jest.fn(),
  });
  // Held "unlocked" by default so these tests keep isolating fonts/theme/
  // bootstrap exactly as before Task 9 added the fourth gate — see
  // lock_gate.test.tsx for the dedicated tests that pin THIS condition.
  mockUseLock.mockReturnValue({
    status: "unlocked",
    errorMessage: null,
    unlock: jest.fn(),
    submitRecoveryPhrase: jest.fn(),
    wipeAndStartOver: jest.fn(),
  });
  // app/_layout.tsx deliberately logs a caught bootstrap failure (so it isn't
  // swallowed silently) — expected noise in the two failure tests below.
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

test("renders nothing while bootstrapApp is pending, then the tab bar once it resolves", async () => {
  let resolveBootstrap!: () => void;
  mockBootstrapApp.mockReturnValue(
    new Promise<void>((resolve) => {
      resolveBootstrap = resolve;
    }),
  );

  renderApp();

  // Fonts and theme are mocked already-ready — only the still-pending
  // bootstrap promise should be holding the Stack back.
  expect(screen.queryByTestId("tab-index")).toBeNull();

  await act(async () => {
    resolveBootstrap();
  });

  await waitFor(() => expect(screen.queryByTestId("tab-index")).toBeTruthy());
});

test("renders nothing while fonts are still loading, even though bootstrap and theme are ready", async () => {
  mockUseFonts.mockReturnValue([false, null]);
  mockBootstrapApp.mockResolvedValue(undefined);

  renderApp();
  await flushMicrotasks();

  expect(screen.queryByTestId("tab-index")).toBeNull();
});

test("renders nothing while the theme hasn't rehydrated, even though bootstrap and fonts are ready", async () => {
  mockUseTheme.mockReturnValue({
    resolved: "light",
    isReady: false,
    preference: "auto",
    setPreference: jest.fn(),
  });
  mockBootstrapApp.mockResolvedValue(undefined);

  renderApp();
  await flushMicrotasks();

  expect(screen.queryByTestId("tab-index")).toBeNull();
});

test("a throwing bootstrapApp renders the recovery screen instead of leaving the app blank", async () => {
  mockBootstrapApp.mockRejectedValue(new Error("disk full"));

  renderApp();

  await waitFor(() => expect(screen.getByTestId("bootstrap-error")).toBeTruthy());
  // Not a blank void: there is content on screen and no tab bar.
  expect(screen.queryByTestId("tab-index")).toBeNull();
});

// Design F1 sweep: this button relied on px-4/py-3 padding plus its Text's
// (unstyled) height alone to reach 44pt, with no explicit guarantee.
// `min-h-[44px]` removes that ambiguity directly.
test("the retry action guarantees a 44pt minimum touch target directly", async () => {
  mockBootstrapApp.mockRejectedValue(new Error("disk full"));

  renderApp();

  await waitFor(() => expect(screen.getByTestId("bootstrap-error")).toBeTruthy());
  expect(String(screen.getByTestId("bootstrap-retry").props.className)).toContain(
    "min-h-[44px]",
  );
});

test("the recovery screen's retry action actually re-invokes bootstrapApp and can recover to the tab bar", async () => {
  mockBootstrapApp.mockRejectedValueOnce(new Error("disk full"));
  mockBootstrapApp.mockResolvedValueOnce(undefined);

  renderApp();
  await waitFor(() => expect(screen.getByTestId("bootstrap-error")).toBeTruthy());
  expect(mockBootstrapApp).toHaveBeenCalledTimes(1);

  await act(async () => {
    fireEvent.press(screen.getByTestId("bootstrap-retry"));
  });

  expect(mockBootstrapApp).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.queryByTestId("tab-index")).toBeTruthy());
  expect(screen.queryByTestId("bootstrap-error")).toBeNull();
});

// ---------------------------------------------------------------------------
// Ingest startup (m1b plan Task 11, rules 2 and 3).
// ---------------------------------------------------------------------------

test("ingest starts once bootstrap resolves, and not before", async () => {
  let resolveBootstrap: (value: { onboardingComplete: boolean }) => void = () => undefined;
  mockBootstrapApp.mockReturnValue(
    new Promise<{ onboardingComplete: boolean }>((resolve) => {
      resolveBootstrap = resolve;
    }),
  );

  renderApp();

  // The pipeline reads the ruleset bootstrap seeds. Draining the native buffer
  // before that exists would burn captures against no parser rules — and the
  // drain is destructive, so those captures do not come back.
  expect(mockStartIngest).not.toHaveBeenCalled();

  await act(async () => {
    resolveBootstrap({ onboardingComplete: true });
  });

  await waitFor(() => expect(mockStartIngest).toHaveBeenCalledTimes(1));
});

test("a rejecting startIngest still renders the app", async () => {
  mockBootstrapApp.mockResolvedValue({ onboardingComplete: true });
  // A broken ruleset, a failed drain, a Keystore auth window that closed —
  // every one of these is survivable. An app that will not open is not: the
  // user cannot even read the ledger they already have, let alone fix it.
  mockStartIngest.mockRejectedValue(new Error("drain failed"));
  jest.spyOn(console, "error").mockImplementation(() => undefined);

  renderApp();

  await waitFor(() => expect(screen.queryByTestId("tab-index")).toBeTruthy());
  expect(screen.queryByTestId("bootstrap-error")).toBeNull();
});

test("unmounting tears down the live capture subscription", async () => {
  const unsubscribe = jest.fn();
  mockBootstrapApp.mockResolvedValue({ onboardingComplete: true });
  mockStartIngest.mockResolvedValue(unsubscribe);

  const view = renderApp();
  await waitFor(() => expect(mockStartIngest).toHaveBeenCalledTimes(1));

  view.unmount();

  // A subscription surviving its tree keeps delivering captures into a dead
  // listener for the rest of the process.
  await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
});

/**
 * SAFE-AREA INSETS ARE READABLE FROM A SURFACE WITH NO NAVIGATOR ABOVE IT.
 *
 * app.json sets `edgeToEdgeEnabled: true`, so a dozen surfaces now call
 * `useSafeAreaInsets()` to pad for the status and navigation bars, and that
 * hook THROWS when nothing above it provides insets. The provider is not
 * mounted in app code: `expo-router/entry` mounts `ExpoRoot`, which wraps this
 * whole layout in one. That is an assumption about a dependency, so it is
 * asserted rather than trusted — an expo-router upgrade that moved it would
 * otherwise surface as a crash on a user's phone.
 *
 * THE LOCKED STATE IS THE ONLY STATE THAT PROVES IT. react-navigation mounts a
 * fallback provider inside each navigator, which is why the tab bar was
 * correct all along; an unlocked render is therefore covered whatever
 * expo-router does. Locked, AppShell renders <LockScreen /> INSTEAD of the
 * Stack — no navigator, no fallback — and `UnlockPrompt` calls the hook. That
 * is the honest case rather than a contrived one: app/lock.tsx is also what
 * renders the entire first-run onboarding flow, the surface the inset defect
 * was reported against.
 *
 * `jest.unmock` is the point of the test. test_support/safe_area_mock.ts
 * answers zero instead of throwing so that suites mounting a lone component do
 * not have to care — which would mask exactly the failure being checked here.
 */
jest.unmock("react-native-safe-area-context");

test("a screen rendered with no navigator can still read safe-area insets", async () => {
  mockBootstrapApp.mockResolvedValue({ onboardingComplete: true });
  mockUseLock.mockReturnValue({
    status: "locked",
    errorMessage: null,
    unlock: jest.fn(),
    submitRecoveryPhrase: jest.fn(),
    wipeAndStartOver: jest.fn(),
  });

  // Proves the unmock above actually took, and that the hook really is the
  // strict one. Without this the test below could pass for the boring reason
  // that nothing in the tree can fail — the mock's zeros would satisfy it just
  // as well as a real provider would.
  expect(() =>
    render(<UnlockPrompt isAuthenticating={false} errorMessage={null} onUnlock={jest.fn()} />),
  ).toThrow(/No safe area value available/);

  renderApp();

  // Reaching the prompt at all is the assertion: UnlockPrompt calls
  // useSafeAreaInsets(), so an unprovided tree throws during render instead.
  await waitFor(() => expect(screen.queryByTestId("unlock-prompt")).toBeTruthy());
});
