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

import { renderRouter, screen } from "expo-router/testing-library";
import { waitFor } from "@testing-library/react-native";
import RootLayout from "../_layout";
import Index from "../index";
import TabsLayout from "../(tabs)/_layout";
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
