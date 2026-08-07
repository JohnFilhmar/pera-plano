// app/__tests__/root_layout.test.tsx — the two claims task-17-brief.md rules
// 1 and 2 make about the root layout:
//  1. nothing renders before every startup gate resolves (fonts, bootstrap,
//     theme) — proven by querying for a tab label and asserting ABSENCE
//     first, then resolving the controllable gate (bootstrapApp) and
//     asserting PRESENCE. Asserting only the post-resolution state would
//     pass against a layout with no gate at all.
//  2. a throwing bootstrapApp() does not leave the screen permanently blank —
//     proven by forcing the rejection and asserting the recovery UI is on
//     screen, then that its retry action actually re-invokes bootstrapApp()
//     (not a decorative button that does nothing).
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderRouter, screen } from "expo-router/testing-library";
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

import { bootstrapApp } from "@/lib/bootstrap";

const mockBootstrapApp = bootstrapApp as jest.Mock;

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

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  mockBootstrapApp.mockReset();
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

  // Give the OTHER two gates (font loading, theme rehydration) time to
  // settle on their own — both are driven by promise chains (AsyncStorage
  // reads, expo-font's internal loader) unrelated to the bootstrap promise
  // this test controls directly. A plain microtask flush (no timers — this
  // repo doesn't rely on fake timers, and a real setTimeout risks hanging if
  // any test file does) is enough to drain those chains. Without this flush,
  // the assertion below would pass even if the bootstrap gate were deleted
  // entirely: at the very first synchronous tick, fonts/theme haven't
  // resolved either, so "nothing rendered yet" would be true for the wrong
  // reason and this test would not actually be exercising the bootstrap gate.
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });

  // Fonts and theme are ready by now; only the still-pending bootstrap
  // promise should be holding the Stack back.
  expect(screen.queryByTestId("tab-index")).toBeNull();

  await act(async () => {
    resolveBootstrap();
  });

  await waitFor(() => expect(screen.queryByTestId("tab-index")).toBeTruthy());
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
