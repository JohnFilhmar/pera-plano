// app/__tests__/tabs_layout.test.tsx — task-17-brief.md Step 1: renders
// exactly five tabs with the expected accessible labels, in order. A single
// ordered-array assertion against real rendered tab buttons (via explicit
// tabBarButtonTestID hooks, queried in tree order) discriminates both a
// count-only bug (wrong order, right count) and an order-only bug (a sixth
// tab, right order for the first five) — a bare toHaveLength or a bare
// unordered-set comparison would miss one or the other.
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
