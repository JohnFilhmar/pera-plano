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
import { act, fireEvent, waitFor } from "@testing-library/react-native";
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

import { bootstrapApp } from "@/lib/bootstrap";
import { useTheme } from "@/contexts/theme_context";

const mockBootstrapApp = bootstrapApp as jest.Mock;
const mockUseFonts = useFonts as jest.Mock;
const mockUseTheme = useTheme as jest.Mock;

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
  mockUseFonts.mockReturnValue([true, null]);
  mockUseTheme.mockReturnValue({
    resolved: "light",
    isReady: true,
    preference: "auto",
    setPreference: jest.fn(),
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
