// app/__tests__/parser_diagnostics_screen.test.tsx — m3b Task 7.
//
// Drives a real freshDb() through `recordParseResult` (the same repository
// the ingest pipeline calls) rather than mocking `useParseStats` — this file
// is about what the SCREEN does with real local stats, not about the query
// hook's own plumbing.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import { recordParseResult } from "@/lib/diagnostics/parse_stats_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { systemClock } from "@/lib/clock";
import { freshDb } from "@/test_support/db";

import ParserDiagnosticsScreen from "../(tabs)/more/parser_diagnostics";

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

beforeEach(async () => {
  await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

test("no activity yet renders the empty state, not a blank screen", async () => {
  renderScreen(<ParserDiagnosticsScreen />);

  await screen.findByTestId("provider-success-meter-empty");
});

test("real recorded results reach the screen through the same repository the pipeline writes to", async () => {
  const now = systemClock.now();
  await recordParseResult("gcash", true, now);
  await recordParseResult("gcash", true, now);
  await recordParseResult("gcash", false, now);

  renderScreen(<ParserDiagnosticsScreen />);

  await screen.findByText("gcash");
  screen.getByText("2 parsed · 1 failed");
});

test("pressing report this confirms locally, with only the aggregate as the payload", async () => {
  const now = systemClock.now();
  await recordParseResult("bpi-sms", true, now);

  renderScreen(<ParserDiagnosticsScreen />);
  await screen.findByTestId("provider-success-bpi-sms-report");

  fireEvent.press(screen.getByTestId("provider-success-bpi-sms-report"));

  await screen.findByTestId("parser-diagnostics-report-confirmation");
  screen.getByText(/Thanks — reported bpi-sms/);
});

test("a provider past the 30-day window is not shown — the rolling window is real", async () => {
  const now = systemClock.now();
  const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
  await recordParseResult("old-provider", true, now - THIRTY_ONE_DAYS_MS);

  renderScreen(<ParserDiagnosticsScreen />);

  await screen.findByTestId("provider-success-meter-empty");
  expect(screen.queryByText("old-provider")).toBeNull();
});
