// app/__tests__/more_hub.test.tsx — chart-colours-and-integration task
// (2026-08-16). Reports and Subscriptions were both finished, working
// screens with no way to reach them from the UI; this file is about the
// wiring the More hub adds — both rows render, and pressing each reaches the
// route it names (or, for Reports while still "soon", reaches nothing at
// all). Each screen's OWN behavior (Reports' charts, Subscriptions' locked
// preview) is covered next door — this file stops at "does the hub get you
// there".
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { SHIPPED_FEATURES } from "@/constants/shipped_features";
import type { FeatureKey, ShipState } from "@/constants/shipped_features";
import { ThemeProvider } from "@/contexts/theme_context";
import { __setTierForTests } from "@/lib/entitlements";
import { queryClient as appQueryClient } from "@/lib/query_client";

import MoreScreen from "../(tabs)/more";

const mockPush = jest.fn();

function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity, staleTime: 0 },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

function renderScreen(ui: ReactNode) {
  return render(
    <QueryClientProvider client={makeTestClient()}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

// SHIPPED_FEATURES is exported readonly — the same contained cast
// components/gates/__tests__/gates.test.tsx already uses to flip a key for
// one test and restore it after, rather than app code ever mutating the
// single per-build rollout switch at runtime.
function setShipState(key: FeatureKey, state: ShipState): void {
  (SHIPPED_FEATURES as Record<FeatureKey, ShipState>)[key] = state;
}

beforeEach(() => {
  mockPush.mockClear();
  __setTierForTests(null);
});

afterEach(() => {
  setShipState("reports", "soon");
  __setTierForTests(null);
});

test("BOTH ROWS RENDER", () => {
  renderScreen(<MoreScreen />);

  screen.getByTestId("more-reports");
  screen.getByTestId("more-subscriptions");
  screen.getByText("Reports");
  screen.getByText("Subscriptions");
});

test("REPORTS IS STILL SOON, AND ONLY ITS ROW CARRIES THE GREY CHIP", () => {
  // `reports` stays "soon" in constants/shipped_features.ts — a later task
  // owns flipping it. SoonGate keeps the row visible (rule: roadmap visible,
  // never hidden) but desaturated and inert. `soon-chip` is SoonGate's own
  // sibling to its children (components/gates/soon_gate.tsx), not nested
  // inside the Pressable itself, so this checks it exists exactly once (only
  // Reports uses SoonGate here — Subscriptions is PlusGate) rather than
  // scoping inside a testID it isn't nested under.
  renderScreen(<MoreScreen />);

  expect(screen.getAllByTestId("soon-chip")).toHaveLength(1);
  expect(within(screen.getByTestId("more-subscriptions")).queryByTestId("soon-chip")).toBeNull();
});

test("PRESSING REPORTS WHILE STILL SOON DOES NOT NAVIGATE", () => {
  renderScreen(<MoreScreen />);

  fireEvent.press(screen.getByTestId("more-reports"));
  expect(mockPush).not.toHaveBeenCalled();
});

test("ONCE REPORTS SHIPS, ITS ROW NAVIGATES TO /more/reports", () => {
  // Proves the route wiring itself, independent of the gate — SoonGate
  // renders children verbatim (no wrapper, no chip) once the key ships, the
  // same behavior components/gates/__tests__/gates.test.tsx pins for any
  // SoonGate-wrapped row.
  setShipState("reports", "shipped");
  renderScreen(<MoreScreen />);

  expect(screen.queryByTestId("soon-chip")).toBeNull();
  fireEvent.press(screen.getByTestId("more-reports"));
  expect(mockPush).toHaveBeenCalledWith("/more/reports");
});

test("SUBSCRIPTIONS NAVIGATES TO /more/subscriptions ON PLUS", () => {
  __setTierForTests("plus");
  renderScreen(<MoreScreen />);

  fireEvent.press(screen.getByTestId("more-subscriptions"));
  expect(mockPush).toHaveBeenCalledWith("/more/subscriptions");
});

test("SUBSCRIPTIONS OPENS THE UPGRADE SHEET INSTEAD OF NAVIGATING ON FREE", () => {
  // PlusGate intercepts the press itself (docs/11 "TWO GATING STATES") — a
  // Free user never reaches the router at all.
  __setTierForTests("free");
  renderScreen(<MoreScreen />);

  fireEvent.press(screen.getByTestId("more-subscriptions"));
  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.getByTestId("upgrade-sheet")).toBeTruthy();
});
