// app/__tests__/reports_screen.test.tsx — M3b Task 3.
//
// The charts' own states are tested next door in components/reports; this
// file is about what the SCREEN does against a real database: whether zero
// transactions renders the spec's own empty-state copy rather than a blank
// chart, and whether a scope the current tier can no longer honor explains
// itself instead of silently dropping the request.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ScrollView } from "react-native";

import { KeypadHost } from "@/components/ui/keypad_host";
import { queryKeys } from "@/constants/query_keys";
import { KeypadProvider } from "@/contexts/keypad_context";
import { ThemeProvider } from "@/contexts/theme_context";
import { systemClock } from "@/lib/clock";
import { addMonthsClampedIso, toDateIso } from "@/lib/dates";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";

import ReportsScreen from "../(tabs)/more/reports";

const TODAY = toDateIso(new Date(systemClock.now()));
const LAST_MONTH = addMonthsClampedIso(`${TODAY.slice(0, 7)}-01`, -1).slice(0, 7);

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

// KeypadProvider AND A ROOT HOST (numeric-input-system Task 14). The screen
// scrolls through FormScreen now, whose `useKeypad()` throws with no provider
// above it. The host goes BEFORE the subject: the context gives the panel to
// the highest live token and effects flush in completion order, so a host
// mounted after would outrank one nested in a Modal inside the screen.
function renderScreen(ui: ReactNode) {
  const client = makeTestClient();
  const utils = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <KeypadProvider>
          <KeypadHost />
          {ui}
        </KeypadProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { client, ...utils };
}

beforeEach(async () => {
  await freshDb();
  __setTierForTests(null);
  await seedDefaultCategories();
  await createWallet({ name: "GCash" });
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

test("THE EMPTY STATE RENDERS WHEN NOTHING IS TRACKED THIS PERIOD", async () => {
  renderScreen(<ReportsScreen />);

  await screen.findByTestId("reports-empty", {}, { timeout: 30_000 });
  screen.getByText("No transactions in this period.");
});

test("A SCOPE THE TIER CAN NO LONGER HONOR EXPLAINS ITSELF RATHER THAN FAILING SILENTLY", async () => {
  // reports_service.ts's resolveScope: Free clamps ANY non-current-month
  // scope back to the current month and sets `truncatedByTier` rather than
  // erroring. Reached here the way it would happen for real — pick a past
  // month as Plus, then lose Plus mid-session (a lapsed subscription) — and
  // refresh the same cached scope, rather than contriving the flag directly.
  __setTierForTests("plus");
  const { client } = renderScreen(<ReportsScreen />);

  await screen.findByTestId("range-picker-month-trigger", {}, { timeout: 30_000 });
  fireEvent.press(screen.getByTestId("range-picker-month-trigger"));
  // The sheet opens on the SELECTED month's year, so reaching last month needs
  // a year step every January and none of the other eleven months.
  if (LAST_MONTH.slice(0, 4) !== TODAY.slice(0, 4)) {
    fireEvent.press(screen.getByTestId("range-picker-year-prev"));
  }
  fireEvent.press(screen.getByTestId(`range-picker-month-${LAST_MONTH}`));
  await waitFor(() => expect(screen.queryByTestId("reports-truncated-notice")).toBeNull(), {
    timeout: 30_000,
  });

  __setTierForTests("free");
  await client.invalidateQueries({ queryKey: queryKeys.reports.all });

  await screen.findByTestId("reports-truncated-notice", {}, { timeout: 30_000 });
});

// ---------------------------------------------------------------------------
// The export button — components/reports/export_button.tsx is self-gated
// (wraps its own PlusGate); this screen must mount it bare, never wrap it in
// a second PlusGate, or two `plus-badge` views would render at once.
// ---------------------------------------------------------------------------
test("THE EXPORT BUTTON RENDERS ON THE SCREEN", async () => {
  renderScreen(<ReportsScreen />);

  await screen.findByTestId("reports-empty", {}, { timeout: 30_000 });
  screen.getByTestId("export-csv-button");
});

test("FREE TIER SEES EXACTLY ONE PLUS BADGE ON THE EXPORT BUTTON, NOT TWO", async () => {
  // Scoped to the `reports-export` wrapper, not the whole screen — RangePicker
  // above renders its OWN independent `plus-badge` on Free for the custom-range
  // row, so a screen-wide count would always read >= 2 regardless of whether
  // ExportButton itself is double-wrapped. Two badges *inside this wrapper*
  // would mean this screen wrapped an already self-gated ExportButton in a
  // second PlusGate — the exact mistake the task brief calls out.
  __setTierForTests("free");
  renderScreen(<ReportsScreen />);

  await screen.findByTestId("reports-empty", {}, { timeout: 30_000 });
  const exportSection = within(screen.getByTestId("reports-export"));
  exportSection.getByTestId("export-csv-button");
  expect(exportSection.getAllByTestId("plus-badge")).toHaveLength(1);
});

test("PLUS TIER SEES THE EXPORT BUTTON WITH THE UNLOCKED BADGE, NOT A GATE", async () => {
  __setTierForTests("plus");
  renderScreen(<ReportsScreen />);

  await screen.findByTestId("reports-empty", {}, { timeout: 30_000 });
  const exportSection = within(screen.getByTestId("reports-export"));
  exportSection.getByTestId("export-csv-button");
  // Scoped to `reports-export` for the same reason as the free-tier count
  // above: RangePicker carries its own independent `plus-badge`/`plus-gate`
  // for the custom-range row, and this assertion is about ExportButton's own
  // gate only.
  exportSection.getByTestId("plus-badge");
  expect(exportSection.queryByTestId("plus-gate")).toBeNull();
});

// ---------------------------------------------------------------------------
// One vertical scrolling surface, and it is FormScreen's own
// ---------------------------------------------------------------------------

test("THE SCREEN SCROLLS THROUGH FormScreen, NOT A PLAIN ScrollView", async () => {
  // numeric-input-system Task 14. This route was a plain vertical ScrollView,
  // the same shape Task 10 found on the loans route: the outer scroller — the
  // one that knows nothing about the keypad panel — keeps all the scroll
  // range, and any keypad-aware surface below it becomes a no-op. Fixed here
  // before a numeric field could land on this screen and inherit the defect.
  renderScreen(<ReportsScreen />);

  await screen.findByTestId("reports-empty", {}, { timeout: 30_000 });

  const surface = screen.getByTestId("reports-screen");
  expect(surface.props.contentContainerStyle).toEqual(
    expect.objectContaining({ flexGrow: 1, paddingBottom: expect.any(Number) }),
  );

  // EXACTLY ONE scrolling surface: FormScreen's own (the keyboard-controller
  // jest mock renders a real ScrollView underneath KeyboardAwareScrollView).
  // A SECOND is the nesting regression.
  //
  // It used to be two, the other being RangePicker's HORIZONTAL month strip —
  // a different axis, so it stole no vertical range. That strip is gone: it
  // opened at scroll offset 0, which in an oldest-first month list is a month
  // from last year rather than the one being reported on, and it is now a
  // sheet (components/reports/month_picker.tsx) with no scroller at all.
  const scrollers = screen.UNSAFE_queryAllByType(ScrollView);
  expect(scrollers).toHaveLength(1);
  expect(scrollers.filter((node) => node.props.horizontal === true)).toHaveLength(0);
});
