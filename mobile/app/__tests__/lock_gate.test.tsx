// app/__tests__/lock_gate.test.tsx — the FOURTH render-gate condition Task 9
// added to app/_layout.tsx (interface contract §10; task-9-brief.md): fonts,
// theme, bootstrap, AND unlocked. The foundation's own retrospective (this
// file's reason for existing) found that an earlier three-condition gate had
// only ONE of three actually pinned by a discriminating test — deleting the
// other two from the render-null check left the whole suite green. Every
// test below holds the OTHER three conditions already-ready and pins
// exactly one, so deleting any single condition from app/_layout.tsx's gate
// fails exactly the test that isolates it.
//
// Same mocking shape as root_layout.test.tsx (fonts/theme/bootstrap each
// independently controllable) PLUS useLock, which that file holds fixed at
// "unlocked" throughout. This file holds fonts/theme/bootstrap fixed
// "already ready" and instead drives useLock through its own states.
jest.mock("@/lib/bootstrap", () => ({
  ...jest.requireActual("@/lib/bootstrap"),
  bootstrapApp: jest.fn(),
}));

jest.mock("expo-font", () => ({
  ...jest.requireActual("expo-font"),
  useFonts: jest.fn(),
}));

jest.mock("@/contexts/theme_context", () => ({
  ...jest.requireActual("@/contexts/theme_context"),
  useTheme: jest.fn(),
}));

jest.mock("@/contexts/lock_context", () => ({
  LockProvider: ({ children }: { children: import("react").ReactNode }) => children,
  useLock: jest.fn(),
}));

// A SPY that still calls through to the real implementation (not a stub) —
// every other test in this file relies on the real LockScreen actually
// rendering UnlockPrompt/RecoveryUnlockForm. Wrapping it in jest.fn() only
// adds the ability to assert call counts, for the one test below that
// needs to distinguish "AppShell itself blocks rendering" from "AppShell
// rendered LockScreen, which then rendered nothing for 'checking'" — two
// code paths that are otherwise observably IDENTICAL from the outside.
jest.mock("../lock", () => {
  const actual = jest.requireActual("../lock");
  return {
    __esModule: true,
    default: jest.fn(actual.default),
  };
});

import { act, waitFor } from "@testing-library/react-native";
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
import { bootstrapApp } from "@/lib/bootstrap";
import { useTheme } from "@/contexts/theme_context";
import { useLock } from "@/contexts/lock_context";
import type { LockStatus } from "@/contexts/lock_context";
import LockScreen from "../lock";

const mockLockScreen = LockScreen as unknown as jest.Mock;

const mockBootstrapApp = bootstrapApp as jest.Mock;
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

function setLockStatus(status: LockStatus, overrides: Record<string, unknown> = {}) {
  mockUseLock.mockReturnValue({
    status,
    errorMessage: null,
    unlock: jest.fn(),
    submitRecoveryPhrase: jest.fn(),
    wipeAndStartOver: jest.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  mockUseFonts.mockReturnValue([true, null]);
  mockUseTheme.mockReturnValue({
    resolved: "light",
    isReady: true,
    preference: "auto",
    setPreference: jest.fn(),
  });
  mockBootstrapApp.mockReset();
  mockBootstrapApp.mockResolvedValue(undefined);
  mockLockScreen.mockClear();
  setLockStatus("unlocked");
});

async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// The condition this file exists for: lock status blocks the tab bar even
// when fonts, theme, and bootstrap are ALL already ready.
// ---------------------------------------------------------------------------

test("cold start (status: locked) renders the lock screen, not the tabs, even with fonts/theme/bootstrap all ready", async () => {
  setLockStatus("locked");

  renderApp();
  await flushMicrotasks();

  expect(screen.queryByTestId("tab-index")).toBeNull();
  expect(screen.getByTestId("unlock-prompt")).toBeTruthy();
  // Bootstrap must not even have been attempted while locked — it would
  // throw DatabaseLockedError if it ran (Task 7's gate).
  expect(mockBootstrapApp).not.toHaveBeenCalled();
});

test("status: unlocked renders the tabs (and, unlike every locked-ish status above, actually runs bootstrap)", async () => {
  setLockStatus("unlocked");
  renderApp();

  await waitFor(() => expect(screen.queryByTestId("tab-index")).toBeTruthy());
  expect(mockBootstrapApp).toHaveBeenCalledTimes(1);
});

test('"authenticating" renders the lock screen (in its authenticating shape), not the tabs', async () => {
  setLockStatus("authenticating");
  renderApp();
  await flushMicrotasks();

  expect(screen.queryByTestId("tab-index")).toBeNull();
  expect(screen.getByTestId("unlock-prompt")).toBeTruthy();
});

test('"needs_recovery" renders the recovery form, not the tabs, and never attempts bootstrap', async () => {
  setLockStatus("needs_recovery");
  renderApp();
  await flushMicrotasks();

  expect(screen.queryByTestId("tab-index")).toBeNull();
  expect(screen.getByTestId("recovery-unlock-form")).toBeTruthy();
  expect(mockBootstrapApp).not.toHaveBeenCalled();
});

test('"checking" renders nothing (same bucket as fonts/theme), not the lock screen and not the tabs', async () => {
  setLockStatus("checking");
  renderApp();
  await flushMicrotasks();

  expect(screen.queryByTestId("tab-index")).toBeNull();
  expect(screen.queryByTestId("unlock-prompt")).toBeNull();
  expect(screen.queryByTestId("recovery-unlock-form")).toBeNull();
});

test('"checking" is blocked by AppShell itself, not merely by LockScreen happening to also render nothing for it -- LockScreen is never even mounted', async () => {
  // A white-box check: "AppShell renders null while checking" and "AppShell
  // renders LockScreen, which renders null while checking" are otherwise
  // OBSERVABLY IDENTICAL (both produce an empty screen) -- no black-box
  // assertion on rendered output can tell them apart. Asserting LockScreen
  // itself was never invoked is the only thing that actually pins THIS
  // specific line of app/_layout.tsx's gate, independent of app/lock.tsx's
  // own internal handling of the same status.
  setLockStatus("checking");
  renderApp();
  await flushMicrotasks();

  expect(mockLockScreen).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Re-confirms the other three conditions still hold with lock explicitly
// "unlocked" -- these are the same claims root_layout.test.tsx makes, kept
// here too so THIS file alone is a complete four-condition discriminator.
// ---------------------------------------------------------------------------

test("fonts pending still blocks rendering even though lock is unlocked and bootstrap is ready", async () => {
  mockUseFonts.mockReturnValue([false, null]);
  renderApp();
  await flushMicrotasks();

  expect(screen.queryByTestId("tab-index")).toBeNull();
  expect(screen.queryByTestId("unlock-prompt")).toBeNull();
});

test("theme not ready still blocks rendering even though lock is unlocked and bootstrap is ready", async () => {
  mockUseTheme.mockReturnValue({
    resolved: "light",
    isReady: false,
    preference: "auto",
    setPreference: jest.fn(),
  });
  renderApp();
  await flushMicrotasks();

  expect(screen.queryByTestId("tab-index")).toBeNull();
});

test("bootstrap pending still blocks rendering even though fonts/theme/lock are all ready", async () => {
  let resolveBootstrap!: () => void;
  mockBootstrapApp.mockReturnValue(
    new Promise<void>((resolve) => {
      resolveBootstrap = resolve;
    }),
  );

  renderApp();
  await flushMicrotasks();
  expect(screen.queryByTestId("tab-index")).toBeNull();

  await act(async () => {
    resolveBootstrap();
  });
  await waitFor(() => expect(screen.queryByTestId("tab-index")).toBeTruthy());
});
