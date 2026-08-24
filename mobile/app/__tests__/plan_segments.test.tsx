// app/__tests__/plan_segments.test.tsx — mobile-ui-revamp Part 2 Task 7.
//
// Replaces app/__tests__/plan_hub.test.tsx's hub-navigation half (its payday
// half moved to hooks/__tests__/use_payday_allocations.test.tsx — see that
// file's header for why). The hub rendered a scrollable stack of cards and
// pushed a route on press; this screen renders four panels inline and swaps
// between them with local state. Every assertion below follows from that:
// there is no `plan-hub` testID left to find, "Loans" is not on screen
// anywhere, and — the contract this whole task rests on — pressing a segment
// must never call `router.push`.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";

import PlanScreen from "../(tabs)/plan/index";

/** The app's own defaults, with `retry: 0` so a failing read fails the test.
 * Copied verbatim from app/__tests__/limit_routes.test.tsx, per this task's
 * own brief — the four panels this screen hosts are exactly what that file's
 * helper was already built to render. */
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

/** <KeypadHost/> before the subject — see limit_routes.test.tsx's own
 * comment on this helper for why the order matters. Nothing rendered by this
 * screen opens the keypad, but every panel it hosts is also a real, routable
 * screen on its own (app/(tabs)/plan/{limits,goals,loans,bills}.tsx) that
 * does, so the helper is copied whole rather than trimmed to what today's
 * tests happen to touch. */
function renderScreen(ui: ReactNode) {
  const client = makeTestClient();
  return render(
    <QueryClientProvider client={client}>
      <KeypadProvider>
        <KeypadHost />
        {ui}
      </KeypadProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await freshDb();
  mockPush.mockClear();
  __setTierForTests(null);
  await seedDefaultCategories();
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

test("all four segments are present, and Loans is now Utang", () => {
  renderScreen(<PlanScreen />);
  screen.getByText("Limits");
  screen.getByText("Goals");
  screen.getByText("Utang");
  screen.getByText("Bills");
  expect(screen.queryByText("Loans")).toBeNull();
});

test("Limits is the segment shown first", () => {
  renderScreen(<PlanScreen />);
  expect(screen.getByTestId("plan-segments-limits").props.accessibilityState).toMatchObject({
    selected: true,
  });
});

test("pressing a segment swaps the panel WITHOUT navigating", () => {
  renderScreen(<PlanScreen />);
  fireEvent.press(screen.getByTestId("plan-segments-utang"));
  expect(screen.getByTestId("plan-segments-utang").props.accessibilityState).toMatchObject({
    selected: true,
  });
  expect(mockPush).not.toHaveBeenCalled();
});

// The three tests above all pass on a host that swapped nothing — they only
// ever inspect the SegmentedControl's own selected state, never which panel
// actually mounted. A ternary chain in app/(tabs)/plan/index.tsx that showed
// the wrong panel for a segment (or the same one for two segments) would
// leave every assertion above green. This test reads each panel's own
// LOADING testID instead — `limits-loading` / `goals-loading` /
// `loans-loading` (UtangPanel keeps this name; see components/plan/
// utang_panel.tsx's header) / `bills-loading` — which is present the instant
// a fresh, unseeded panel mounts, before any query resolves, and is unique
// per panel regardless of the segment's own "utang" label.
test("each segment actually mounts its own panel, not just its own label", () => {
  renderScreen(<PlanScreen />);
  screen.getByTestId("limits-loading");

  fireEvent.press(screen.getByTestId("plan-segments-goals"));
  screen.getByTestId("goals-loading");
  expect(screen.queryByTestId("limits-loading")).toBeNull();

  fireEvent.press(screen.getByTestId("plan-segments-utang"));
  screen.getByTestId("loans-loading");
  expect(screen.queryByTestId("goals-loading")).toBeNull();

  fireEvent.press(screen.getByTestId("plan-segments-bills"));
  screen.getByTestId("bills-loading");
  expect(screen.queryByTestId("loans-loading")).toBeNull();
});

test("Income is a row inside the Limits panel, not a fifth segment", () => {
  renderScreen(<PlanScreen />);
  screen.getByTestId("plan-income-row");
  expect(screen.queryByTestId("plan-segments-income")).toBeNull();
});

test("the income row still routes to the income screen", () => {
  renderScreen(<PlanScreen />);
  fireEvent.press(screen.getByTestId("plan-income-row"));
  expect(mockPush).toHaveBeenCalledWith("/plan/income");
});
