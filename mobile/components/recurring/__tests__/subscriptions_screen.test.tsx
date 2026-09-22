// components/recurring/__tests__/subscriptions_screen.test.tsx — M3 Part 2
// Task 6, step 4.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

// This file mounts the More hub for its Subscriptions row, and that hub grew
// a "Turn on alerts" row (GAP-003) which reads the notification permission and
// calls `requestAlertPermission`. The service reaches the native
// `NotificationListener` module, which cannot be required under Jest at all,
// so it is stubbed the same way app/__tests__/bills_screen.test.tsx stubs it.
// The permission read is left PENDING: the row stays hidden and every
// assertion below sees the hub it always did.
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(() => new Promise(() => {})),
}));

jest.mock("@/lib/alerts/alerts_service", () => ({
  requestAlertPermission: jest.fn(),
}));

import { QueryClientProvider } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { closeDatabase } from "@/lib/db/database";
import { listBills } from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { dismissPattern, listPatterns, upsertPattern } from "@/lib/db/repos/recurring_patterns_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";

import { LockedInHeader } from "../locked_in_header";
import { PatternCard } from "../pattern_card";
import MoreScreen from "../../../app/(tabs)/more";
import SubscriptionsScreen from "../../../app/(tabs)/more/subscriptions";

const mockPush = jest.fn();
const NOW = new Date(2026, 7, 16, 10, 0).getTime();
const DAY_MS = 86_400_000;

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

async function seedNetflix() {
  return upsertPattern({
    merchant: "NETFLIX",
    amount: 54_900,
    periodDays: 30,
    occurrences: 6,
    confidence: 0.9,
    firstSeenAt: NOW - 150 * DAY_MS,
    lastSeenAt: NOW,
    nextExpectedAt: NOW + 30 * DAY_MS,
    transactionIds: [],
  });
}

/** Three live patterns — a monthly, a cheaper monthly and an annual. */
async function seedThree() {
  const netflix = await seedNetflix();
  const spotify = await upsertPattern({
    merchant: "SPOTIFY",
    amount: 14_900,
    periodDays: 30,
    occurrences: 5,
    confidence: 0.85,
    firstSeenAt: NOW - 150 * DAY_MS,
    lastSeenAt: NOW,
    nextExpectedAt: NOW + 30 * DAY_MS,
    transactionIds: [],
  });
  const prime = await upsertPattern({
    merchant: "AMAZON PRIME",
    amount: 200_000,
    periodDays: 365,
    occurrences: 3,
    confidence: 0.8,
    firstSeenAt: NOW - 730 * DAY_MS,
    lastSeenAt: NOW,
    nextExpectedAt: NOW + 365 * DAY_MS,
    transactionIds: [],
  });
  return [netflix, spotify, prime];
}

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  __setTierForTests(null);
  await seedDefaultCategories();
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// LockedInHeader — renders the monthly total
// ---------------------------------------------------------------------------
test("the locked-in header renders the monthly total", () => {
  renderScreen(<LockedInHeader testID="header" monthlyTotal={154_800} />);

  const amount = screen.getByTestId("header-amount");
  expect(amount.props.accessibilityLabel).toBe("₱1,548.00");
});

// ---------------------------------------------------------------------------
// PatternCard — amount, cadence, next expected date
// ---------------------------------------------------------------------------
test("each card renders amount, cadence and next expected date", async () => {
  const pattern = await seedNetflix();
  renderScreen(<PatternCard testID="card" pattern={pattern} />);

  screen.getByText("NETFLIX");
  expect(screen.getByTestId("card-amount").props.accessibilityLabel).toBe("−₱549.00");
  // "Monthly" from a 30-day cadence, and the next-expected date rendered.
  screen.getByText(/Monthly/);
  screen.getByText(/next/);
});

// ---------------------------------------------------------------------------
// The screen — promote, dismiss, empty state
// ---------------------------------------------------------------------------
test("promote calls the mutation and the pattern becomes a bill", async () => {
  __setTierForTests("plus");
  const pattern = await seedNetflix();

  renderScreen(<SubscriptionsScreen />);
  const promoteButton = await screen.findByTestId(`pattern-card-${pattern.id}-promote`);
  fireEvent.press(promoteButton);

  await waitFor(async () => expect(await listBills()).toHaveLength(1));
  const [bill] = await listBills();
  expect(bill.name).toBe("NETFLIX");
});

test("dismiss removes the card", async () => {
  __setTierForTests("plus");
  const pattern = await seedNetflix();

  renderScreen(<SubscriptionsScreen />);
  const dismissButton = await screen.findByTestId(`pattern-card-${pattern.id}-dismiss`);
  fireEvent.press(dismissButton);

  await waitFor(() => expect(screen.queryByTestId(`pattern-card-${pattern.id}`)).not.toBeOnTheScreen());
  expect(await listPatterns()).toHaveLength(0);
});

test("the empty state renders on plus with no patterns", async () => {
  __setTierForTests("plus");

  renderScreen(<SubscriptionsScreen />);

  await screen.findByTestId("subscriptions-empty");
  screen.getByText("Nothing recurring spotted yet");
  screen.getByText("We'll flag subscriptions as they repeat.");
});

test("free tier sees a count-only locked preview, never the merchant or amount", async () => {
  __setTierForTests("free");
  await seedNetflix();

  renderScreen(<SubscriptionsScreen />);

  await screen.findByText("1 recurring payment spotted");
  expect(screen.queryByText("NETFLIX")).toBeNull();
  expect(screen.queryByText(/549/)).toBeNull();
});

// GAP-122's acceptance criterion, asserted on the SCREEN rather than only at
// the More-tab row: now that a free tap actually lands here, "the count and
// nothing else" (Reports rule 19) has to be true of everything this render
// produces, not just of the two strings the test above happened to name.
test("A FREE USER WITH THREE PATTERNS SEES THE COUNT AND NO MERCHANT, AMOUNT OR TOTAL ANYWHERE", async () => {
  __setTierForTests("free");
  const seeded = await seedThree();

  renderScreen(<SubscriptionsScreen />);

  // The frame renders before the query resolves, so wait on the COUNT — the
  // one thing rule 19 actually promises — not on the frame around it.
  await screen.findByText("3 recurring payments spotted");
  screen.getByTestId("subscriptions-locked-preview");

  for (const merchant of ["NETFLIX", "SPOTIFY", "AMAZON PRIME"]) {
    expect(screen.queryByText(merchant)).toBeNull();
  }
  // No amount in any form: not the raw centavos, not the pesos, not a currency
  // symbol at all. `AmountText` is the only thing in this feature that renders
  // one, so a stray "₱" means gated money reached a free render.
  expect(screen.queryAllByText(/₱/)).toEqual([]);
  for (const digits of [/549/, /149/, /2,000/, /54900/]) {
    expect(screen.queryByText(digits)).toBeNull();
  }
  // The locked-in total, the list and every card: absent, not merely covered.
  expect(screen.queryByTestId("subscriptions-locked-in")).toBeNull();
  expect(screen.queryByTestId("subscriptions-list")).toBeNull();
  for (const pattern of seeded) {
    expect(screen.queryByTestId(`pattern-card-${pattern.id}`)).toBeNull();
  }
});

// Design F1 sweep: "See what's included" is `mt-2` (margin only) around
// unpadded, unstyled Text — the same bare-Pressable shape
// app/wallet/[id].tsx's "Edit" shipped with, and no hitSlop to compensate.
// Pins the slop VALUE, not tap behaviour — Jest has no real hit-testing.
test("'See what's included' carries a hitSlop compensating for its unpadded touch target", async () => {
  __setTierForTests("free");
  await seedNetflix();

  renderScreen(<SubscriptionsScreen />);

  await screen.findByText("1 recurring payment spotted");
  expect(screen.getByTestId("subscriptions-upgrade").props.hitSlop).toEqual({
    top: 16,
    bottom: 16,
    left: 16,
    right: 16,
  });
});

test("a dismissed pattern does not re-appear after being dismissed once", async () => {
  __setTierForTests("plus");
  const pattern = await seedNetflix();
  await dismissPattern(pattern.id);

  renderScreen(<SubscriptionsScreen />);

  await screen.findByTestId("subscriptions-empty");
});

// ---------------------------------------------------------------------------
// The More-tab entry
// ---------------------------------------------------------------------------
test("the More-tab entry renders the Plus gate on free", () => {
  __setTierForTests("free");

  renderScreen(<MoreScreen />);

  expect(screen.getByTestId("plus-badge")).toBeTruthy();
  screen.getByText("Subscriptions");
});

test("ON FREE, PRESSING THE MORE-TAB ENTRY REACHES THE COUNT INSTEAD OF BEING SWALLOWED", () => {
  // GAP-122: the badge stays, the interception goes. The screen it lands on is
  // the one asserted above to render a count and nothing else, which is what
  // makes passing the press through safe (app/(tabs)/more/index.tsx).
  __setTierForTests("free");

  renderScreen(<MoreScreen />);
  fireEvent.press(screen.getByTestId("more-subscriptions"));

  expect(mockPush).toHaveBeenCalledWith("/more/subscriptions");
  expect(screen.getByTestId("plus-badge")).toBeTruthy();
});

test("on plus, pressing the More-tab entry navigates to /more/subscriptions", () => {
  __setTierForTests("plus");

  renderScreen(<MoreScreen />);
  fireEvent.press(screen.getByTestId("more-subscriptions"));

  expect(mockPush).toHaveBeenCalledWith("/more/subscriptions");
});
