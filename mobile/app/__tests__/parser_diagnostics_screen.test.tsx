// app/__tests__/parser_diagnostics_screen.test.tsx — m3b Task 7.
//
// Drives a real freshDb() through `recordParseResult` (the same repository
// the ingest pipeline calls) rather than mocking `useParseStats` — this file
// is about what the SCREEN does with real local stats, not about the query
// hook's own plumbing.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import { recordParseResult } from "@/lib/diagnostics/parse_stats_repo";
import { createUserRule } from "@/lib/db/repos/user_rules_repo";
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

// NO "REPORT THIS" ANYMORE. This screen used to show a per-row "Report
// this" button and, once pressed, a "Thanks — reported {provider}'s
// counts" banner (testID "parser-diagnostics-report-confirmation") — but
// `handleReport` was a bare `useState` write with no network call behind
// it, so the confirmation was false for an opted-in user (nothing had
// actually left the device yet) and permanently false for anyone who had
// turned off "Share anonymous parser health" in Settings
// (rest-state-promise-audit.md Finding 1). Removed the control and the
// confirmation; see the screen's own header comment for the full story.
//
// This guard is deliberately narrower than a blanket "no pressable
// anywhere on this screen" sweep (the technique
// app/__tests__/shared_budgets_screen.test.tsx uses for its fully static
// Soon screen). Parser diagnostics is real, populated content, not a Soon
// placeholder, so it may legitimately grow other interactive elements later
// (e.g. a retry action if `useParseStats` surfaces a fetch error) — a
// blanket sweep would fail on those for a reason that has nothing to do
// with this defect. What it DOES cover: (1) the button's exact visible
// label never appears anywhere in the tree, (2) no element carries a
// testID following the removed button's `-report` convention, and (3) the
// confirmation banner's testID and its "Thanks — reported" copy never
// appear. What it does NOT cover: any other future control this screen
// might legitimately grow, or a report-shaped control that both drops this
// exact copy AND invents an unrelated testID — this guard trades that
// residual gap for not being a tripwire on unrelated future UI.
test("renders no control that claims to report or send a provider's counts", async () => {
  const now = systemClock.now();
  await recordParseResult("bpi-sms", true, now);

  renderScreen(<ParserDiagnosticsScreen />);
  await screen.findByText("bpi-sms");

  expect(screen.queryByText("Report this")).toBeNull();
  expect(screen.queryByText(/Thanks — reported/)).toBeNull();
  expect(screen.queryByTestId("parser-diagnostics-report-confirmation")).toBeNull();
  expect(JSON.stringify(screen.toJSON())).not.toMatch(/-report"/);
});

test("a provider past the 30-day window is not shown — the rolling window is real", async () => {
  const now = systemClock.now();
  const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
  await recordParseResult("old-provider", true, now - THIRTY_ONE_DAYS_MS);

  renderScreen(<ParserDiagnosticsScreen />);

  await screen.findByTestId("provider-success-meter-empty");
  expect(screen.queryByText("old-provider")).toBeNull();
});

// ---------------------------------------------------------------------------
// The rules list — GAP-128, review-queue rule 16. Driven through the real
// `createUserRule` for the same reason the stats above are: this is about what
// the SCREEN shows for a rule that genuinely exists on the device.
// ---------------------------------------------------------------------------

test("a rule the user created is visible on this screen, in words", async () => {
  // The whole of rule 16's first promise. Before GAP-128 no screen or hook read
  // `listUserRules` at all, so a rule created from a correction could never be
  // seen again.
  await createUserRule({
    matcher: { merchantPattern: "JOLLIBEE" },
    action: { kind: "ignore" },
  });

  renderScreen(<ParserDiagnosticsScreen />);

  await screen.findByText(/JOLLIBEE/);
  screen.getByText("Ignore it");
});

test("a device with no rules explains where rules come from", async () => {
  renderScreen(<ParserDiagnosticsScreen />);

  await screen.findByTestId("user-rules-empty");
});
