// app/__tests__/more_hub.test.tsx — chart-colours-and-integration task
// (2026-08-16); updated by m3b Task 8, which flipped `reports` (along with
// the rest of the rollout table) to "shipped" for good. Reports and
// Subscriptions were both finished, working screens with no way to reach
// them from the UI; this file is about the wiring the More hub adds — both
// rows render, and pressing each reaches the route it names. Each screen's
// OWN behavior (Reports' charts, Subscriptions' locked preview) is covered
// next door — this file stops at "does the hub get you there".
//
// Reports' SoonGate wrapping stays in the row even though `reports` now
// ships (app/(tabs)/more/index.tsx's header comment records why, following
// the same call m2c Task 6 made on the Plan hub). One test below still
// forces the key back to "soon" to prove that composition would correctly
// block a press if a feature ever shipped ahead of its own rollout again —
// SHIPPED_FEATURES is exported readonly, so it uses the same contained
// "cast away readonly" seam components/gates/__tests__/gates.test.tsx uses.
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
  // The real, current default — every FeatureKey is "shipped" as of m3b
  // Task 8 — not "soon", which was only ever this file's OLD default.
  setShipState("reports", "shipped");
  __setTierForTests(null);
});

test("SUBTITLES DO NOT CLIP TO ONE LINE (branch-review-correctness.md F2)", () => {
  // fix-round-1 already paid this exact bug down on
  // app/(tabs)/more/settings.tsx and components/privacy/capture_toggle.tsx;
  // this hub's own rows were missed and are fixed here (fix-round-2). RNTL
  // never simulates a device's line-clamp — `getByText` below matches the
  // FULL string either way, on this branch's own fix-round-1 rows too — so
  // only the rendered node's own `numberOfLines` proves the clamp would not
  // fire on a real phone.
  renderScreen(<MoreScreen />);

  const clippableSubtitles = [
    "Spending by category, top merchants, and the trend behind them.",
    "We flag recurring charges and total what's locked in every month.",
    "Split a household budget — one pool, separate phones.",
    "Whether tracking is actually connected right now, and since when.",
    "What's parsing per provider, and what's landing in the unknown bin.",
    "Export everything, wipe everything, and see exactly what's tracked.",
    "Appearance, alerts, and what leaves this device.",
    "Ask about what's already in your ledger. Runs on this phone only.",
  ];
  for (const text of clippableSubtitles) {
    expect(screen.getByText(text).props.numberOfLines).toBeGreaterThan(1);
  }

  // About is the one row deliberately left at the default: the shortest
  // subtitle (28 characters) AND the one row with no right chevron at all
  // (see the file's own "ABOUT GETS NO CHEVRON" header note), so it has more
  // room than every row above it. A positive assertion, not just an absence
  // of a change — proves the row actually rendered before pinning its
  // numberOfLines.
  const about = screen.getByText(/^PeraPlano v/);
  expect(about).toBeTruthy();
  expect(about.props.numberOfLines).toBe(1);
});

test("BOTH ROWS RENDER", () => {
  renderScreen(<MoreScreen />);

  screen.getByTestId("more-reports");
  screen.getByTestId("more-subscriptions");
  screen.getByText("Reports");
  screen.getByText("Subscriptions");
});

test("THE ASSISTANT ROW RENDERS AND REACHES /more/ai", () => {
  // The assistant plan's Task 25. Until this row exists the route is
  // unreachable from the UI — `app/(tabs)/more/ai/index.tsx` ships, and
  // nothing in the app links to it.
  //
  // NO GATE, following the Settings row rather than the Reports row: the
  // destination is a real screen whose no-model state is the model picker, so
  // there is no window in which the row promises something that is not there.
  // A `SoonGate` would also swallow the press, which is the one thing this
  // row has to do.
  renderScreen(<MoreScreen />);

  screen.getByTestId("more-assistant");
  screen.getByText("Assistant");

  fireEvent.press(screen.getByTestId("more-assistant"));
  expect(mockPush).toHaveBeenCalledWith("/more/ai");
});

test("EXACTLY ONE ROW IS SOON — Shared budgets, the only key not yet flipped", () => {
  // Every OTHER FeatureKey is "shipped" as of m3b Task 8, so SoonGate renders
  // each of THOSE wrapped rows' children verbatim, with no chip.
  // `shared_budgets` (mobile UI revamp Part 3 Task 3) is the first key seeded
  // "soon" since that rollout table closed, so its row is the one exception
  // — this test used to read "no row carries the grey chip", which this key
  // is precisely what makes no longer true. `soon-chip` is SoonGate's own
  // sibling to its children (components/gates/soon_gate.tsx), not nested
  // inside the Pressable itself, so this checks a total count rather than
  // scoping inside a testID it isn't nested under.
  renderScreen(<MoreScreen />);

  expect(screen.queryAllByTestId("soon-chip")).toHaveLength(1);
  // The cross-gate invariant that does NOT depend on rollout state at all:
  // Subscriptions is PlusGate, never SoonGate, so it never gets the grey
  // chip — the two gates are deliberately coloured opposite ways (SoonGate's
  // own header comment) so a user can never confuse "not built yet" with
  // "needs Plus".
  expect(within(screen.getByTestId("more-subscriptions")).queryByTestId("soon-chip")).toBeNull();
});

test("SHARED BUDGETS CARRIES THE SOON CHIP AND DOES NOT NAVIGATE", () => {
  // Unlike `reports` below (forced back to "soon" only for the next test),
  // `shared_budgets` really is "soon" by default — nothing has flipped it —
  // so this is the row-level counterpart to the hub-wide chip count above:
  // proof that the one row carrying the chip is also the one row whose press
  // the gate actually swallows.
  renderScreen(<MoreScreen />);

  fireEvent.press(screen.getByTestId("more-shared-budgets"));
  expect(mockPush).not.toHaveBeenCalledWith("/more/shared_budgets");
});

test("IF REPORTS WERE EVER SOON AGAIN, ITS ROW WOULD STILL BLOCK THE PRESS", () => {
  // Reports' SoonGate wrapping is left in the row on purpose even though the
  // key ships today (app/(tabs)/more/index.tsx's header comment) — so this
  // proves that wrapping still does its job through the real hub
  // composition, not only in components/gates/__tests__/gates.test.tsx's
  // isolated unit test. `reports` is forced back to "soon" for this one test
  // and restored by the file's own afterEach. `soon-chip` is SoonGate's own
  // sibling to its children, not nested inside the Pressable itself (see the
  // note on the test above), so this checks the chip exists at all rather
  // than scoping inside a testID it isn't nested under — and now counts TWO,
  // not one: `shared_budgets` carries its own permanent chip regardless of
  // what this test does to `reports`, so `getByTestId` (which requires a
  // single match) would throw here even though nothing is wrong.
  setShipState("reports", "soon");
  renderScreen(<MoreScreen />);

  expect(screen.getAllByTestId("soon-chip")).toHaveLength(2);
  fireEvent.press(screen.getByTestId("more-reports"));
  expect(mockPush).not.toHaveBeenCalled();
});

test("REPORTS ROW NAVIGATES TO /more/reports", () => {
  renderScreen(<MoreScreen />);

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
