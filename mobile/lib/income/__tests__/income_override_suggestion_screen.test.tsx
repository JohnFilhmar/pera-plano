// lib/income/__tests__/income_override_suggestion_screen.test.tsx — income
// rule 14's suggestion AS THE USER SEES IT.
//
// WHY A RENDERED TEST AND NOT ANOTHER SERVICE ASSERTION. `hasPendingSuggestion`
// is a boolean on a summary object. A build can set it perfectly and still show
// the user nothing, and every service-level test in this feature would go on
// passing: the flag is not the feature, the card is. So this file drives the
// real screen, with the real service and the real database behind it, and
// asserts on what is on the glass.
//
// It also asserts the DETECTED figure is on that card. Over a declared income
// every other number on the screen is the user's own, so a prompt without the
// new one asks them to accept something they cannot see.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { getIncomeProfile } from "@/lib/db/repos/income_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { refreshIncomeDetection, setManualIncome } from "@/lib/income/income_service";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import IncomeScreen from "../../../app/(tabs)/plan/income";

/** 20,000.00 declared, so rule 14's boundary sits at a 4,000.00 gap. */
const DECLARED = 2000000;
/** 24,200.00 detected: a 21% divergence, the first figure that must speak up. */
const DETECTED = 2420000;
/** 23,800.00 detected: 19%, which must stay quiet. */
const DETECTED_QUIETLY = 2380000;

let payroll: Wallet;

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
      <KeypadProvider>
        <KeypadHost />
        {ui}
      </KeypadProvider>
    </QueryClientProvider>,
  );
}

async function credit(amount: number, at: number): Promise<void> {
  await insertTransaction({
    walletId: payroll.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "in",
    occurredAt: at,
    merchant: "ACME PAYROLL",
    source: "notification",
    confidence: 1,
  });
}

/**
 * The six most recent kinsenas paydays that have ALREADY HAPPENED, all at
 * `amount` — rule 6's confirmed threshold, and six identical amounts make rule
 * 9's median exactly `amount`.
 *
 * Relative to the real clock, because the screen reads it through
 * `useIncomeSummary`. A fixed calendar here would drift out of the detector's
 * trailing 120 days as the file ages, and anchors that have not happened yet
 * are skipped rather than counted, so the seed lands six CONSECUTIVE windows
 * whatever day of the month the suite runs on.
 */
async function seedRecentKinsenas(amount: number): Promise<void> {
  const now = Date.now();
  const today = new Date(now);
  const anchors: number[] = [];

  for (let monthsBack = 0; monthsBack < 8 && anchors.length < 6; monthsBack++) {
    const month = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (const day of [lastDay, 15]) {
      if (anchors.length >= 6) break;
      const at = new Date(month.getFullYear(), month.getMonth(), day, 10, 0).getTime();
      if (at < now) anchors.push(at);
    }
  }

  for (const at of anchors) await credit(amount, at);
}

/** A user who typed their income in, and a ledger that has since disagreed. */
async function declareThenDetect(detected: number): Promise<void> {
  await setManualIncome(
    { cadence: "kinsenas", averageAmount: DECLARED, sourceWalletIds: [payroll.id] },
    Date.now(),
  );
  await seedRecentKinsenas(detected);
  await refreshIncomeDetection(Date.now());
}

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  payroll = await createWallet({ name: "BPI Payroll" });
});

afterEach(async () => {
  await closeDatabase();
});

test("THE USER SEES THE SUGGESTION, WITH THE DETECTED FIGURE ON IT", async () => {
  await declareThenDetect(DETECTED);

  renderScreen(<IncomeScreen />);

  await screen.findByTestId("income-suggestion");
  // The new figure, on the glass. This is the assertion a service-level
  // `hasPendingSuggestion` check cannot make.
  screen.getByText(/24,200\.00/);
  screen.getByText(/looks like it changed/);
  // And it does not pretend to have just discovered a payday the user told it
  // about themselves.
  expect(screen.queryByText(/spotted your payday/)).toBeNull();
  // Their own declaration is still the headline figure and still labelled as
  // theirs.
  screen.getByText(/20,000\.00/);
  screen.getByTestId("income-manual-note");
});

test("a 19% divergence leaves the screen quiet", async () => {
  // The other side of rule 14's threshold, rendered: if the card appeared here
  // too, the test above would prove only that this screen always shows it.
  await declareThenDetect(DETECTED_QUIETLY);

  renderScreen(<IncomeScreen />);

  await screen.findByTestId("income-manual-note");
  expect(screen.queryByTestId("income-suggestion")).toBeNull();
});

test("TAKING THE SUGGESTION FROM THE SCREEN UPDATES THE PROFILE AND KEEPS THE OVERRIDE", async () => {
  // Override flow step 3, end to end: "applying it updates the values but keeps
  // isManualOverride true (the user made the change)".
  await declareThenDetect(DETECTED);
  renderScreen(<IncomeScreen />);
  await screen.findByTestId("income-confirm");

  fireEvent.press(screen.getByTestId("income-confirm"));

  await waitFor(async () => expect((await getIncomeProfile())?.averageAmount).toBe(DETECTED));
  expect((await getIncomeProfile())?.isManualOverride).toBe(true);
  // Answered, so it stops asking.
  await waitFor(() => expect(screen.queryByTestId("income-suggestion")).toBeNull());
});

test("dismissing it from the screen keeps the declared figure", async () => {
  // Rule 14: "Suggestions are dismissible and never auto-apply."
  await declareThenDetect(DETECTED);
  renderScreen(<IncomeScreen />);
  await screen.findByTestId("income-dismiss");

  fireEvent.press(screen.getByTestId("income-dismiss"));

  await waitFor(() => expect(screen.queryByTestId("income-suggestion")).toBeNull());
  expect((await getIncomeProfile())?.averageAmount).toBe(DECLARED);
  expect((await getIncomeProfile())?.isManualOverride).toBe(true);
});
