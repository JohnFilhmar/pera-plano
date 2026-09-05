// app/__tests__/tabs_layout.test.tsx — task-17-brief.md Step 1: renders
// exactly five tabs with the expected accessible labels, in order. A single
// ordered-array assertion against real rendered tab buttons (via explicit
// tabBarButtonTestID hooks, queried in tree order) discriminates both a
// count-only bug (wrong order, right count) and an order-only bug (a sixth
// tab, right order for the first five) — a bare toHaveLength or a bare
// unordered-set comparison would miss one or the other.
//
// Unlike root_layout.test.tsx, this file renders the REAL RootLayout with the REAL
// bootstrapApp() (nothing here mocks @/lib/bootstrap) — the whole point is proving the real
// startup sequence produces five real tabs. As of Task 7, bootstrapApp()'s getDatabase() call
// throws DatabaseLockedError until something has called unlockDatabase(dek) (interface
// contract §3's gate), so this test satisfies that precondition itself.
//
// TASK 9 CLOSED THE GAP THIS FILE USED TO FLAG: app/_layout.tsx now gates
// bootstrap behind the app lock (contexts/lock_context.tsx), so on a real
// device unlockDatabase() finally does get called before bootstrap runs.
// Under Jest, though, the REAL lock flow reaches expo-local-authentication
// and the notification_listener native module (via key_manager.ts) — neither
// has a native registration here, and this file's actual subject is tab
// rendering + real bootstrap, not the lock state machine (which has its own
// dedicated suites: contexts/__tests__/lock_context.test.tsx,
// app/__tests__/lock_gate.test.tsx). So the lock context is mocked
// pre-"unlocked" here, the same way root_layout.test.tsx and
// lock_gate.test.tsx isolate it, while bootstrapApp stays real.
jest.mock("@/contexts/lock_context", () => ({
  LockProvider: ({ children }: { children: import("react").ReactNode }) => children,
  useLock: () => ({
    status: "unlocked",
    errorMessage: null,
    unlock: jest.fn(),
    submitRecoveryPhrase: jest.fn(),
    wipeAndStartOver: jest.fn(),
  }),
}));

// _layout.tsx unconditionally imports ./lock (LockScreen), which now imports
// openSecuritySettings from this module for its "needs_device_lock" branch
// (task-9a-brief) -- module-level imports execute regardless of which branch
// actually renders, so the real module's top-level requireNativeModule()
// call would throw here too without this mock, even with lock status held
// at "unlocked" throughout.
jest.mock("@/modules/notification_listener", () => ({
  openSecuritySettings: jest.fn(),
}));

// ../_layout pulls in ./lock, which composes
// components/lock/recovery_unlock_form.tsx and its GAP-017 screen capture
// guard. expo-screen-capture is another requireNativeModule module with
// nothing to bind to under Jest; nothing here is about the guard, so it is
// inert. components/lock/__tests__/recovery_unlock_form.test.tsx owns the
// assertions on its mount/unmount behaviour.
jest.mock("expo-screen-capture", () => ({
  usePreventScreenCapture: jest.fn(),
}));

import path from "path";
import { getMockConfig, renderRouter, screen } from "expo-router/testing-library";
import { waitFor } from "@testing-library/react-native";
import RootLayout from "../_layout";
import Index from "../index";
import TabsLayout, { TAB_CONFIG } from "../(tabs)/_layout";
import HomeScreen from "../(tabs)/index";
import TransactionsScreen from "../(tabs)/transactions";
import WalletsScreen from "../(tabs)/wallets";
import PlanScreen from "../(tabs)/plan";
import MoreScreen from "../(tabs)/more";
import { closeDatabase, unlockDatabase } from "@/lib/db/database";
import { TEST_DEK } from "@/test_support/db";

beforeEach(async () => {
  await unlockDatabase(TEST_DEK);
});

afterEach(async () => {
  await closeDatabase();
});

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

test("renders exactly five tabs with the expected accessible labels, in order", async () => {
  renderApp();

  await waitFor(() => expect(screen.queryByTestId("tab-index")).toBeTruthy());

  const tabs = screen.getAllByTestId(/^tab-/);
  expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual([
    "Home",
    "Transactions",
    "Wallets",
    "Plan",
    "More",
  ]);
});

/**
 * WHY THE TEST ABOVE CANNOT FAIL AGAINST THE BUG THIS ONE CATCHES.
 *
 * `renderApp` hands `renderRouter` a HAND-WRITTEN map of eight routes, so it
 * proves what those eight render as — never what the app/ DIRECTORY registers.
 * On a physical A54 the real directory produced twenty-four tab buttons: the
 * three real ones plus twenty-one labelled with a raw route path
 * (`plan/bills/[id]`, `more/subscriptions`, …) under a `⏷` placeholder glyph,
 * running off the right edge of the screen. Every assertion above still passed,
 * because the five expected tabs WERE there — the defect is the extras, and an
 * ordered-array check over a curated route map has nothing to say about them.
 *
 * So this test reads the REAL app/ tree off disk. `getMockConfig` is
 * expo-router's own testing entry point: it runs the same `getRoutes` the app
 * runs at startup over a require.context built from the actual filesystem, and
 * returns the react-navigation config. Anything a contributor adds under app/
 * shows up here without this file being edited — which is the whole point,
 * since the failure mode being guarded is a route nobody remembered to think
 * about.
 *
 * The assertion is EQUALITY against TAB_CONFIG, not containment. Containment is
 * what the render test above already does, and containment is exactly what this
 * bug slips through.
 */
type ScreenTree = { screens?: Record<string, unknown> };

function screensOf(node: unknown, label: string): Record<string, unknown> {
  const screens = (node as ScreenTree | undefined)?.screens;
  if (!screens) {
    throw new Error(`expo-router's route config has no "${label}" navigator with children`);
  }
  return screens;
}

test("the tab navigator registers exactly the five tabs TAB_CONFIG declares", () => {
  // The real directory, not a fixture: `..` is app/ itself.
  const config = getMockConfig(path.resolve(__dirname, ".."));

  const root = screensOf(screensOf(config, "config").__root, "__root");
  const registered = Object.keys(screensOf(root["(tabs)"], "(tabs)"));

  // Sorted, because tab-bar ORDER is the render test's claim above; this one is
  // about MEMBERSHIP, and sorting keeps a reordering of TAB_CONFIG from
  // failing both tests for one reason.
  expect(registered.sort()).toEqual([...TAB_CONFIG.map(({ name }) => name)].sort());
});

/**
 * The mechanism, asserted directly so a regression names itself.
 *
 * expo-router builds its navigator from the directory tree, and a directory
 * with no `_layout.tsx` does not become a navigator — its routes are HOISTED
 * into the nearest ancestor that has one. Deleting `app/(tabs)/plan/_layout.tsx`
 * therefore does not make `plan/` render without a stack; it makes every screen
 * under `plan/` a direct child of the TAB navigator, and `<Tabs>` gives each
 * child a button. That is where the twenty-one strays came from, and it is why
 * `TAB_CONFIG` could not prevent them: that list configures the five entries it
 * names and says nothing about routes it does not.
 *
 * A route name containing "/" inside a tab navigator is the fingerprint of that
 * hoisting — `plan/bills/[id]` is a route whose parent directory never became a
 * navigator. Nothing legitimate produces one, so this holds for tabs added
 * later too.
 */
test("no route is hoisted into the tab navigator from a directory with no layout", () => {
  const config = getMockConfig(path.resolve(__dirname, ".."));

  const root = screensOf(screensOf(config, "config").__root, "__root");
  const hoisted = Object.keys(screensOf(root["(tabs)"], "(tabs)")).filter((route) =>
    route.includes("/"),
  );

  expect(hoisted).toEqual([]);
});
