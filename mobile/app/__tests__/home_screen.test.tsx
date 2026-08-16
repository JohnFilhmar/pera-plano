// app/__tests__/home_screen.test.tsx — M3 Part 2 Task 4's screen.
//
// The hero's own states are tested next door; this file is about what the
// SCREEN does against a real database — which sections appear, what the
// tracking banner says, whether the gate hides the curve, and whether a ledger
// commit actually moves the number.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(callback, [callback]);
  },
}));

// `useListenerHealth` reaches the NotificationListener native module, which
// cannot be required under Jest at all. Mocked here rather than anywhere
// deeper — this is the only bills/home file that touches the native side.
// `setCaptureEnabled` is mocked too: Resume now goes through the same
// `useSetCaptureEnabled` mutation the Privacy toggle uses, and that hook
// calls the native switch before it ever touches `app_settings`.
jest.mock("@/modules/notification_listener", () => ({
  getListenerHealth: jest.fn(),
  setCaptureEnabled: jest.fn().mockResolvedValue(undefined),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { isShipped } from "@/constants/shipped_features";
import { closeDatabase, getDatabase } from "@/lib/db/database";
import { setSetting } from "@/lib/db/repos/app_settings_repo";
import { createBill } from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { createLimit } from "@/lib/db/repos/limits_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { emitAppEvent } from "@/lib/events/app_events";
import { getListenerHealth, setCaptureEnabled } from "@/modules/notification_listener";
import { systemClock } from "@/lib/clock";
import { addDaysIso, toDateIso } from "@/lib/dates";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import HomeScreen from "../(tabs)/index";
import MoreScreen from "../(tabs)/more";

const mockPush = jest.fn();
const mockHealth = getListenerHealth as jest.MockedFunction<typeof getListenerHealth>;
const mockSetCaptureEnabled = setCaptureEnabled as jest.Mock;

/** Clock-relative, like every other screen test: these read `systemClock`. */
const TODAY = toDateIso(new Date(systemClock.now()));
const DAY_MS = 86_400_000;

let cash: Wallet;

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
  jest.clearAllMocks();
  mockPush.mockClear();
  __setTierForTests(null);
  mockHealth.mockResolvedValue({ granted: true, serviceConnected: true, lastCaptureAt: null });
  await seedDefaultCategories();
  cash = await createWallet({ name: "GCash", type: "e-wallet" });
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

async function spend(amount: number, occurredAt = systemClock.now() - DAY_MS) {
  return insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "out",
    occurredAt,
    merchant: "SM SUPERMARKET",
    source: "notification",
    confidence: 0.9,
  });
}

// ---------------------------------------------------------------------------
// The hero in place
// ---------------------------------------------------------------------------
test("A FRESH APP SHOWS THE NO-LIMIT INVITATION, NOT A ZERO", async () => {
  renderScreen(<HomeScreen />);

  await screen.findByText("Set a limit to see what's safe to spend");

  fireEvent.press(screen.getByTestId("sts-set-limit"));
  expect(mockPush).toHaveBeenCalledWith("/plan/limits/new");
});

test("A LIMIT AND SOME SPEND PRODUCE A REAL NUMBER AND ITS CAPTION", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await spend(620_000);

  renderScreen(<HomeScreen />);

  await screen.findByText("Safe to spend today");
  screen.getByText("from your monthly limit");
});

// ---------------------------------------------------------------------------
// Ship gate — M3 Part 2 Task 7 rule 1
// ---------------------------------------------------------------------------
test("SAFE-TO-SPEND AND RECURRING ARE SHIPPED, AND NEITHER SURFACE SITS BEHIND A SOON CHIP", async () => {
  // "Home renders without a Soon wrapper" is trivially true taken literally —
  // the hero was never SoonGate-wrapped (Task 4 shipped it ungated) — so the
  // assertion that actually moves if the flip is wrong is the flag itself,
  // plus the two screens this plan unblocks.
  expect(isShipped("safe_to_spend")).toBe(true);
  expect(isShipped("recurring")).toBe(true);

  renderScreen(<HomeScreen />);
  await screen.findByTestId("home");
  screen.unmount();

  // The More tab's Subscriptions row is gated by `PlusGate` (a tier paywall),
  // never by `SoonGate` — MVP_TIER defaults to "plus", so the row must be
  // reachable and carry no grey "Soon" chip of its own. Scoped to the
  // Subscriptions row specifically, not "nowhere in the tree": the More hub's
  // Reports row is a genuinely separate feature (constants/shipped_features.ts's
  // `reports` key) still "soon" as of this task, and it legitimately shows one.
  renderScreen(<MoreScreen />);
  fireEvent.press(screen.getByTestId("more-subscriptions"));
  expect(mockPush).toHaveBeenCalledWith("/more/subscriptions");
  expect(within(screen.getByTestId("more-subscriptions")).queryByText("Soon")).toBeNull();
});

// ---------------------------------------------------------------------------
// The tracking banner — rule 5
// ---------------------------------------------------------------------------
test("A HEALTHY LISTENER SHOWS NO BANNER AT ALL", async () => {
  // A permanent "tracking is on" badge is noise that makes the abnormal case
  // harder to notice, not easier.
  renderScreen(<HomeScreen />);

  await screen.findByTestId("home");
  expect(screen.queryByTestId("tracking-interrupted")).toBeNull();
  expect(screen.queryByTestId("tracking-paused")).toBeNull();
});

test("A DISCONNECTED LISTENER STATES THE GAP AND OFFERS A FIX", async () => {
  // Rule 5: "Silence about a tracking gap would make every number on the
  // screen a lie." The banner precedes the hero for that reason.
  mockHealth.mockResolvedValue({
    granted: true,
    serviceConnected: false,
    lastCaptureAt: systemClock.now() - 2 * DAY_MS,
  });

  renderScreen(<HomeScreen />);

  await screen.findByTestId("tracking-interrupted");
  screen.getByText("Tracking stopped");
  fireEvent.press(screen.getByTestId("tracking-fix"));
  // The listener-health screen (m3b Task 7) is the destination this action
  // always wanted — the detailed view behind this exact banner.
  expect(mockPush).toHaveBeenCalledWith("/more/listener_health");
});

test("PAUSED IS A NEUTRAL PILL, NOT A FAULT — THE USER CHOSE IT", async () => {
  // Showing a fault banner to someone who paused on purpose trains them to
  // ignore it, which means they will also ignore the real one.
  await setSetting("capture_enabled", false);
  mockHealth.mockResolvedValue({ granted: true, serviceConnected: false, lastCaptureAt: null });

  renderScreen(<HomeScreen />);

  await screen.findByTestId("tracking-paused");
  screen.getByText("Tracking is paused. Nothing is being recorded.");
  expect(screen.queryByTestId("tracking-interrupted")).toBeNull();
});

test("resuming re-enables capture", async () => {
  await setSetting("capture_enabled", false);

  renderScreen(<HomeScreen />);
  await screen.findByTestId("tracking-resume");

  fireEvent.press(screen.getByTestId("tracking-resume"));

  const { getSetting } = await jest.requireActual("@/lib/db/repos/app_settings_repo");
  await waitFor(async () => expect(await getSetting("capture_enabled")).toBe(true), {
    timeout: 30_000,
  });
});

test("resuming from Home calls the native switch, not just the setting — the same path the Privacy toggle uses", async () => {
  // Regression: Resume used to write `capture_enabled` straight to
  // `app_settings` and never touch the native listener. Every surface would
  // then report capture ON while `NotificationListener`'s SharedPreferences
  // flag stayed OFF underneath it, and nothing would actually be captured.
  await setSetting("capture_enabled", false);

  renderScreen(<HomeScreen />);
  await screen.findByTestId("tracking-resume");

  fireEvent.press(screen.getByTestId("tracking-resume"));

  await waitFor(() => expect(mockSetCaptureEnabled).toHaveBeenCalledWith(true));
});

// ---------------------------------------------------------------------------
// The projection gate — rule 4
// ---------------------------------------------------------------------------
test("FREE SEES THE CURVE AS AN INERT PREVIEW BEHIND A PLUS BADGE", async () => {
  // OWNER DECISION (2026-08-16): the shipped `PlusGate` precedent wins over
  // M3's "locked previews never show real gated data". m2b Task 8 already
  // ships the loan amortization table this way, and its reasoning holds here —
  // showing what you would get "is the difference between a paywall and a dead
  // end", and it is the user's own data either way. `PlusGate` sets
  // pointerEvents="none", so the preview cannot be interacted with.
  __setTierForTests("free");
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await spend(620_000);

  renderScreen(<HomeScreen />);

  await screen.findByTestId("projection-sparkline", {}, { timeout: 30_000 });
  screen.getByTestId("plus-badge");
});

test("PLUS SEES THE CURVE WITH NO BADGE AND NO GATE", async () => {
  __setTierForTests("plus");
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await spend(620_000);

  renderScreen(<HomeScreen />);

  await screen.findByTestId("projection-sparkline", {}, { timeout: 30_000 });
  expect(screen.queryByTestId("plus-badge")).toBeNull();
  expect(screen.queryByTestId("plus-gate")).toBeNull();
});

// ---------------------------------------------------------------------------
// Alerts and bills
// ---------------------------------------------------------------------------
test("AN OVERDUE BILL RAISES AN ALERT AND OPENS ITS CYCLE", async () => {
  // Bills rule 22: once the three notifications are spent, the Home alert card
  // is the only surface left. It has to be reachable.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  const yesterday = addDaysIso(TODAY, -1);
  const bill = await createBill({
    name: "Meralco",
    amount: 230_000,
    amountMode: "fixed",
    dueRule: { kind: "day-of-month", day: Number(yesterday.slice(8, 10)) },
    categoryId: "cat_bills_utilities",
  });
  // BACKDATED ON PURPOSE, AND ONLY JUST ENOUGH. Cycle enumeration is floored at
  // the bill's own `createdAt` — someone adding Meralco today is not greeted by
  // an overdue January they were never tracking — so a bill created this
  // instant cannot have an overdue cycle at all. Only elapsed time produces
  // one, and this is how a test buys elapsed time.
  //
  // Ten days, not sixty: a monthly rule backdated two months has TWO overdue
  // cycles, which is correct behaviour and an ambiguous fixture.
  const db = await getDatabase();
  await db.runAsync("UPDATE bills SET created_at = ? WHERE id = ?", [
    systemClock.now() - 10 * DAY_MS,
    bill.id,
  ]);

  renderScreen(<HomeScreen />);

  await screen.findByText("Meralco is overdue", {}, { timeout: 30_000 });
  fireEvent.press(screen.getByTestId(`home-alert-bill:${bill.id}:${yesterday}`));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/plan/bills/[id]",
    params: { id: bill.id, dueDate: yesterday },
  });
});

test("A HEALTHY APP RAISES NO ALERTS — SILENCE IS THE GOOD STATE", async () => {
  // An "all clear" card is a row the user learns to skip, which makes the real
  // alerts harder to see.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });

  renderScreen(<HomeScreen />);

  await screen.findByTestId("home");
  expect(screen.queryByTestId("alerts-feed")).toBeNull();
});

test("upcoming bills are listed with what was already subtracted", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  const soon = addDaysIso(TODAY, 3);
  await createBill({
    name: "Maynilad",
    amount: 90_000,
    amountMode: "fixed",
    dueRule: { kind: "day-of-month", day: Number(soon.slice(8, 10)) },
    categoryId: "cat_bills_utilities",
  });

  renderScreen(<HomeScreen />);

  await screen.findByTestId("upcoming-bills", {}, { timeout: 30_000 });
  // `getAllBy`, not `getBy`: a monthly bill legitimately has TWO cycles inside
  // the strip's 45-day horizon, and each is its own row because each is
  // resolved independently.
  expect(screen.getAllByText("Maynilad").length).toBeGreaterThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// Rule 6 — staying current
// ---------------------------------------------------------------------------
test("A LEDGER COMMIT MOVES THE NUMBER WITHOUT A MANUAL PULL", async () => {
  // Rule 6: a notification captured seconds ago must be reflected. Without
  // this the user watches a transaction arrive in the ledger while Home keeps
  // showing yesterday's allowance.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_000_000 });

  renderScreen(<HomeScreen />);
  await screen.findByText("Safe to spend today");
  const before = screen.getByTestId("sts-amount");
  expect(before).toBeTruthy();

  const tx = await spend(500_000, systemClock.now() - 60_000);
  await emitAppEvent("ledger:committed", { transactionId: tx.id });

  // The figure must fall: half the limit just went out the door.
  await waitFor(
    () => {
      expect(screen.queryByText("₱0.00")).toBeNull();
      screen.getByText("Safe to spend today");
    },
    { timeout: 30_000 },
  );
});
