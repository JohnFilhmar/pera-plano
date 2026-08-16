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

import { queryKeys } from "@/constants/query_keys";
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

function renderScreen(ui: ReactNode) {
  const client = makeTestClient();
  const utils = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
  return { client, ...utils };
}

beforeEach(async () => {
  await freshDb();
  __setTierForTests(null);
  await seedDefaultCategories();
  await createWallet({ name: "GCash", type: "e-wallet" });
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

  await screen.findByTestId("range-picker-months", {}, { timeout: 30_000 });
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

test("PLUS TIER SEES THE EXPORT BUTTON WITH NO PLUS BADGE", async () => {
  __setTierForTests("plus");
  renderScreen(<ReportsScreen />);

  await screen.findByTestId("reports-empty", {}, { timeout: 30_000 });
  const exportSection = within(screen.getByTestId("reports-export"));
  exportSection.getByTestId("export-csv-button");
  expect(exportSection.queryByTestId("plus-badge")).toBeNull();
});
