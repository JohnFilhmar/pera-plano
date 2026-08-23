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

// A `waitFor` budget must be STRICTLY LESS than the test budget it runs inside.
//
// Every wait in this file allows 30 s, which was also the global `testTimeout`
// in package.json — so the two deadlines expired together. Under worker
// contention (a full run on a cold cache) that is a race the test can only win
// by finishing early: Jest kills the test at the same instant `waitFor` would
// have reported what it was still waiting for, so the failure arrives as a bare
// "Exceeded timeout" naming no element. It cost one 117 s cold-cache run here
// and passed on every warm run afterwards, which is the signature of a flake
// that will reappear in CI rather than one that got fixed.
//
// Raising only this file's budget keeps the waits at 30 s — long enough for the
// real work, which is a full screen render over an in-memory database — while
// leaving Jest 30 s of headroom to let `waitFor` lose first and say why.
jest.setTimeout(60_000);
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
// The header, tiles and FAB — mobile-ui-revamp Part 2 Task 3
// ---------------------------------------------------------------------------
test("Home greets the beta user and names the period", async () => {
  renderScreen(<HomeScreen />);

  await screen.findByText("Kumusta, Beta User");
});

test("Home shows the three stat tiles", async () => {
  renderScreen(<HomeScreen />);

  await screen.findByTestId("home-stat-balance");
  screen.getByTestId("home-stat-spent");
  screen.getByTestId("home-stat-saved");
});

test("Home has a floating add button that opens manual entry", async () => {
  renderScreen(<HomeScreen />);
  await screen.findByTestId("home-add");

  fireEvent.press(screen.getByTestId("home-add"));
  expect(mockPush).toHaveBeenCalledWith("/transaction/new");
});

test("the weekday labels end on today, not on a hardcoded Sunday", async () => {
  // The bar strip only draws once the hero leaves its no_limit branch — a
  // fresh app draws no bars at all, and no labels with them — so this needs a
  // real limit to reach the labelled strip in the first place.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });

  renderScreen(<HomeScreen />);

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  await screen.findByText(weekdays[new Date().getDay()]);
});

// Both wraparound edges, PINNED, not left to whatever day the suite happens
// to run on. `(todayIndex + 1) % 7` is the one piece of real arithmetic Task
// 3 added — it is provably correct by hand, but a regression in it would only
// ever surface on the 2 days in 7 that actually exercise the wrap (Saturday
// rolling to Sunday, Sunday rolling to Monday). That is the exact "right
// some fraction of the time" shape the hardcoded Mon/Sun this task replaced
// had — just relocated from the component into the test's own coverage if
// left to the real calendar. Pinned via `systemClock`, the same clock-mocking
// pattern `lib/alerts/__tests__/alerts_service.test.ts` uses (`jest.spyOn`
// rather than a whole-module `jest.mock`, since this file's OTHER tests —
// `spend()`'s default `occurredAt`, `TODAY` — all lean on `systemClock`
// resolving to the real current instant; a blanket module mock would pin
// every one of them, not just these two). Local noon, a local constructor —
// lib/clock.ts's own convention for a fixed instant, never a UTC string
// parse. Restored in `finally` so a thrown assertion can't leak the pin into
// a later test.
test("the weekday strip wraps Saturday to Sunday — getDay() 6, the top edge", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  const saturday = new Date(2026, 0, 3, 12, 0).getTime(); // a known Saturday
  const nowSpy = jest.spyOn(systemClock, "now").mockReturnValue(saturday);

  try {
    renderScreen(<HomeScreen />);
    // (6 + 1) % 7 === 0: the oldest bar is Sunday, the newest is today, Saturday.
    await screen.findByText("Sat");
    screen.getByText("Sun");
  } finally {
    nowSpy.mockRestore();
  }
});

test("the weekday strip wraps Sunday to Monday — getDay() 0, the bottom edge", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  const sunday = new Date(2026, 0, 4, 12, 0).getTime(); // a known Sunday
  const nowSpy = jest.spyOn(systemClock, "now").mockReturnValue(sunday);

  try {
    renderScreen(<HomeScreen />);
    // (0 + 1) % 7 === 1: the oldest bar is Monday, the newest is today, Sunday.
    await screen.findByText("Sun");
    screen.getByText("Mon");
  } finally {
    nowSpy.mockRestore();
  }
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
  // Subscriptions row specifically rather than a screen-wide "no Soon
  // anywhere" claim, since that broader claim belongs to
  // app/__tests__/more_tab.test.tsx and app/__tests__/more_hub.test.tsx, not
  // this file's job of proving the hero and this one row.
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

// ---------------------------------------------------------------------------
// The Home empty state — IA §5's row this task's audit found missing
// ---------------------------------------------------------------------------
test("A HEALTHY LISTENER WITH NOTHING CAPTURED YET SHOWS THE WATCHING CARD", async () => {
  renderScreen(<HomeScreen />);

  await screen.findByTestId("home-empty");
  screen.getByText("Watching for your first transaction");
});

test("THE WATCHING CARD CLEARS ONCE A TRANSACTION LANDS, WITHOUT A MANUAL PULL", async () => {
  renderScreen(<HomeScreen />);
  await screen.findByTestId("home-empty");

  const tx = await spend(200_000, systemClock.now() - 60_000);
  await emitAppEvent("ledger:committed", { transactionId: tx.id });

  await waitFor(() => expect(screen.queryByTestId("home-empty")).toBeNull(), {
    timeout: 30_000,
  });
});

test("A DISCONNECTED LISTENER SHOWS ITS OWN BANNER, NOT THE WATCHING CARD", async () => {
  // IA §5: "If Notification Access missing: setup card instead" — the two
  // never both apply at once, and TrackingBanner's fault state wins.
  mockHealth.mockResolvedValue({
    granted: true,
    serviceConnected: false,
    lastCaptureAt: systemClock.now() - 2 * DAY_MS,
  });

  renderScreen(<HomeScreen />);

  await screen.findByTestId("tracking-interrupted");
  expect(screen.queryByTestId("home-empty")).toBeNull();
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
  const beforeAmount = screen.getByTestId("sts-amount").props.children;
  expect(beforeAmount).toBeTruthy();

  const tx = await spend(500_000, systemClock.now() - 60_000);
  await emitAppEvent("ledger:committed", { transactionId: tx.id });

  // The figure must fall: half the limit just went out the door. Scoped to
  // `sts-amount` itself, not a screen-wide text search — mobile-ui-revamp
  // Part 2 Task 3 put two more money figures on this screen (the Balance and
  // Saved stat tiles), and this fixture never creates a goal, so "Saved"
  // legitimately reads a permanent ₱0.00 regardless of the ledger commit. A
  // bare `queryByText("₱0.00")` would be asserting something about a tile
  // this test never touches, rather than about the hero this test is for.
  await waitFor(
    () => {
      expect(screen.getByTestId("sts-amount").props.children).not.toBe(beforeAmount);
      expect(screen.getByTestId("sts-amount")).not.toHaveTextContent("₱0.00");
      screen.getByText("Safe to spend today");
    },
    { timeout: 30_000 },
  );
});
