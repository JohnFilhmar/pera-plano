// app/__tests__/wallets_screen.test.tsx — m1c plan Task 4, the Wallets tab.
//
// The first real screen in the app, and the first place it states a number the
// user did not type. Three of the tests below defend claims the app must never
// get wrong:
//
//   THE TOTAL EXCLUDES CREDIT. docs/04-features/02-wallets.md rule 23: a credit
//   balance is money owed. The credit fixture holds ₱12,345.00 precisely so
//   that counting it changes the headline figure by an amount no rounding
//   error could explain.
//
//   THE ARCHIVED TOGGLE IS PART OF THE CACHE KEY. `useWallets` and
//   `queryKeys.wallets.list(includeArchived)` were widened together in this
//   task. This suite runs on the SHIPPED five-minute staleTime (only `retry` is
//   overridden), so a single shared cache entry would serve the already-fetched
//   unarchived list to the toggled-on view and the archived wallet would never
//   appear — which is exactly what the toggle test fails on.
//
//   THE DRIFT TOLERANCE COMES FROM THE RULESET. The same drifting wallet is
//   rendered against two installed rulesets; the badge appears under the ₱1.00
//   default and vanishes under a retuned one. An inlined literal fails the
//   second.
//
// expo-router is mocked rather than driven through `renderRouter`: this file's
// subject is what the screen renders and where it says it is going, not
// navigation itself. The push assertion therefore checks the href the screen
// builds, which is the part a typo breaks.
jest.mock("expo-router", () => ({
  // Wrapped in an arrow so the factory only CLOSES OVER `mockPush` — reading
  // it at factory time would hit the temporal dead zone, since babel-jest
  // hoists jest.mock above the const below.
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { queryKeys } from "@/constants/query_keys";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { archiveWallet, createWallet } from "@/lib/db/repos/wallets_repo";
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Centavos, Wallet } from "@/types/domain";

import WalletsScreen from "../(tabs)/wallets";

const mockPush = jest.fn();

/**
 * The app's own defaults, with ONE override: `queries.retry: 0`, so a failing
 * read fails the test instead of burning three exponential backoffs.
 *
 * `staleTime` is deliberately left at the shipped five minutes. It is what
 * makes the archived-toggle test discriminating — under a test-only
 * `staleTime: 0` a shared cache key would refetch on every toggle and the
 * missing key parameter would pass unnoticed.
 */
function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

function renderScreen(): QueryClient {
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<WalletsScreen />, { wrapper: Wrapper });
  return client;
}

/**
 * Waits until the drift and ruleset reads have actually RESOLVED.
 *
 * Every "renders no badge" assertion below is a negative, and a negative
 * passes trivially while the query behind it is still in flight — the badge is
 * absent because nothing has been decided yet, not because the rule works.
 * Awaiting the query status is the only thing that tells those two apart:
 * `getBalanceDrift` legitimately resolves to `null`, so the cached value
 * cannot.
 */
async function waitForDriftDecision(client: QueryClient, walletId: string): Promise<void> {
  await waitFor(() => {
    expect(client.getQueryState(queryKeys.wallets.drift(walletId))?.status).toBe("success");
    expect(client.getQueryState(queryKeys.ruleset.active())?.status).toBe("success");
  });
}

/** The bundled ruleset shape, with only the drift tolerance varied. */
async function installRuleset(
  version: number,
  balanceDriftToleranceCentavos: Centavos,
): Promise<void> {
  await upsertRuleset({
    version,
    providers: [],
    tunables: { balanceDriftToleranceCentavos },
  });
}

async function seedDrifting(reported: Centavos): Promise<Wallet> {
  const bpi = await createWallet({ name: "BPI", type: "bank", openingBalance: 100_000 });
  await insertTransaction({
    walletId: bpi.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 15_000,
    direction: "out",
    occurredAt: 1_000,
    source: "notification",
    confidence: 0.9,
    // computed lands at 100_000 - 15_000 = 85_000; `reported` is what the
    // provider claimed, and the gap between them is the drift.
    balanceAfter: reported,
  });
  return bpi;
}

beforeEach(async () => {
  mockPush.mockClear();
  await freshDb();
  await seedDefaultCategories();
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Rule 1 — grouping and the total
// ---------------------------------------------------------------------------

describe("grouping", () => {
  test("groups by type in the order bank, e-wallet, savings, credit, cash", async () => {
    // SEEDED IN A DIFFERENT ORDER THAN THEY MUST RENDER. `listWallets` returns
    // oldest-first, so an implementation that renders insertion order — or
    // sorts alphabetically (Bank, Cash, Credit, E-wallet, Savings) — produces a
    // different sequence than the one asserted.
    await createWallet({ name: "Pocket", type: "cash", openingBalance: 5_000 });
    await createWallet({ name: "Visa", type: "credit", openingBalance: 1_234_500 });
    await createWallet({ name: "BPI", type: "bank", openingBalance: 10_000 });
    await createWallet({ name: "GSave", type: "savings", openingBalance: 20_000 });
    await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 30_000 });

    renderScreen();
    await screen.findByTestId("wallet-group-bank");

    expect(screen.getAllByTestId(/^wallet-group-/).map((g) => g.props.testID)).toEqual([
      "wallet-group-bank",
      "wallet-group-e-wallet",
      "wallet-group-savings",
      "wallet-group-credit",
      "wallet-group-cash",
    ]);
  });

  test("shows no heading for a type the user has no wallet of", async () => {
    await createWallet({ name: "BPI", type: "bank", openingBalance: 10_000 });

    renderScreen();
    await screen.findByTestId("wallet-group-bank");

    expect(screen.queryByTestId("wallet-group-cash")).toBeNull();
    expect(screen.queryByTestId("wallet-group-credit")).toBeNull();
  });
});

describe("the total row", () => {
  test("EXCLUDES credit wallets — a ₱12,345.00 card does not inflate the headline", async () => {
    await createWallet({ name: "BPI", type: "bank", openingBalance: 10_000 });
    await createWallet({ name: "Visa", type: "credit", openingBalance: 1_234_500 });

    renderScreen();
    await screen.findByTestId("wallets-total-amount");

    // ₱100.00, the bank wallet alone.
    expect(screen.getByTestId("wallets-total-amount")).toHaveTextContent("₱100.00");
    // The figure a reduce over every wallet would print.
    expect(screen.getByTestId("wallets-total-amount")).not.toHaveTextContent("₱12,445.00");
  });

  test("still shows the credit wallet's own balance, labelled as owed", async () => {
    const visa = await createWallet({
      name: "Visa",
      type: "credit",
      openingBalance: 1_234_500,
    });

    renderScreen();
    await screen.findByTestId(`wallet-card-${visa.id}`);

    expect(screen.getByText("₱12,345.00")).toBeTruthy();
    expect(screen.getByText("Owed")).toBeTruthy();
  });

  test("EXCLUDES archived wallets even while the toggle is showing them (rule 17)", async () => {
    await createWallet({ name: "BPI", type: "bank", openingBalance: 10_000 });
    const closed = await createWallet({
      name: "Closed BDO",
      type: "bank",
      openingBalance: 999_900,
    });
    await archiveWallet(closed.id);

    renderScreen();
    await screen.findByTestId("wallets-total-amount");
    fireEvent.press(screen.getByTestId("wallets-archived-toggle"));
    await screen.findByText("Closed BDO");

    expect(screen.getByTestId("wallets-total-amount")).toHaveTextContent("₱100.00");
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — the archived toggle, and the cache key it needs
// ---------------------------------------------------------------------------

describe("Show archived", () => {
  async function seedOneOfEach(): Promise<void> {
    await createWallet({ name: "BPI", type: "bank", openingBalance: 10_000 });
    const closed = await createWallet({ name: "Closed BDO", type: "bank", openingBalance: 0 });
    await archiveWallet(closed.id);
  }

  test("hides archived wallets by default", async () => {
    await seedOneOfEach();

    renderScreen();
    await screen.findByText("BPI");

    expect(screen.queryByText("Closed BDO")).toBeNull();
  });

  test("reveals them when toggled on, WITHOUT being served the cached unarchived list", async () => {
    // The discriminating case for the widened key. With
    // `queryKeys.wallets.list()` taking no parameter, both toggle states share
    // one cache entry: the unarchived list is already cached and fresh for the
    // shipped five-minute staleTime, so toggling refetches nothing and the
    // archived wallet never appears.
    await seedOneOfEach();

    renderScreen();
    await screen.findByText("BPI");
    fireEvent.press(screen.getByTestId("wallets-archived-toggle"));

    expect(await screen.findByText("Closed BDO")).toBeTruthy();
    // The active wallets are still there — this is a WIDER list, not a
    // different one.
    expect(screen.getByText("BPI")).toBeTruthy();
  });

  test("hides them again when toggled off, WITHOUT being served the cached archived list", async () => {
    await seedOneOfEach();

    renderScreen();
    await screen.findByText("BPI");
    fireEvent.press(screen.getByTestId("wallets-archived-toggle"));
    await screen.findByText("Closed BDO");
    fireEvent.press(screen.getByTestId("wallets-archived-toggle"));

    await waitFor(() => expect(screen.queryByText("Closed BDO")).toBeNull());
    expect(screen.getByText("BPI")).toBeTruthy();
  });

  test("puts archived rows in their own section and labels the row itself", async () => {
    await seedOneOfEach();

    renderScreen();
    await screen.findByText("BPI");
    fireEvent.press(screen.getByTestId("wallets-archived-toggle"));
    const archivedRow = await screen.findByText("Closed BDO");

    // The section at the bottom of the list…
    expect(screen.getByTestId("wallets-archived-section")).toBeTruthy();
    // …and the row's own label, which is what a screen reader announces. Both
    // matter: an archived balance sitting unmarked in the "Bank" group reads
    // as live money.
    expect(archivedRow).toBeTruthy();
    const rows = screen.getAllByTestId(/^wallet-card-/);
    const labels = rows.map((row) => row.props.accessibilityLabel);
    expect(labels).toContain("Closed BDO, Archived");
    expect(labels).toContain("BPI");
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — the balance-drift badge
// ---------------------------------------------------------------------------

describe("balance drift", () => {
  test("a drift beyond tolerance renders the badge WITH BOTH FIGURES", async () => {
    await installRuleset(1, DEFAULT_TUNABLES.balanceDriftToleranceCentavos);
    const bpi = await seedDrifting(900_000);

    renderScreen();

    expect(await screen.findByTestId(`wallet-card-${bpi.id}-drift`)).toBeTruthy();
    // The provider's figure and the ledger's, both on screen, each against its
    // own label — the wallet's own balance has ALSO snapped to ₱9,000.00, so a
    // bare text query would pass on a badge that showed only one of them.
    expect(screen.getByTestId(`wallet-card-${bpi.id}-drift-reported`)).toHaveTextContent(
      "₱9,000.00",
    );
    expect(screen.getByTestId(`wallet-card-${bpi.id}-drift-computed`)).toHaveTextContent(
      "₱850.00",
    );
  });

  test("a drift WITHIN tolerance renders no badge", async () => {
    await installRuleset(1, DEFAULT_TUNABLES.balanceDriftToleranceCentavos);
    // ₱0.50 off the computed ₱850.00 — under the ₱1.00 tolerance.
    const bpi = await seedDrifting(85_050);

    const client = renderScreen();
    await screen.findByTestId(`wallet-card-${bpi.id}`);
    await waitForDriftDecision(client, bpi.id);

    expect(screen.queryByTestId(`wallet-card-${bpi.id}-drift`)).toBeNull();
  });

  test("a wallet that has NEVER reported a balance renders no badge", async () => {
    // getBalanceDrift returns null here, not `drift: 0`. A badge saying the
    // bank and the ledger agree, on a wallet the app has never had a bank
    // figure for, is a claim with nothing behind it.
    await installRuleset(1, DEFAULT_TUNABLES.balanceDriftToleranceCentavos);
    const cash = await createWallet({ name: "Pocket", type: "cash", openingBalance: 50_000 });

    const client = renderScreen();
    await screen.findByTestId(`wallet-card-${cash.id}`);
    await waitForDriftDecision(client, cash.id);

    expect(client.getQueryData(queryKeys.wallets.drift(cash.id))).toBeNull();
    expect(screen.queryByTestId(`wallet-card-${cash.id}-drift`)).toBeNull();
  });

  test("THE TOLERANCE IS READ FROM THE RULESET — a retuned one silences the same drift", async () => {
    // Same ₱81.50 gap, a ruleset that calls it acceptable. The tolerance ships
    // as remotely-retunable ruleset data because the spec lists its value as an
    // open question (§14 item 1); an inlined ₱1.00 passes the test above and
    // fails this one.
    await installRuleset(1, DEFAULT_TUNABLES.balanceDriftToleranceCentavos);
    await installRuleset(2, 10_000_000);
    const bpi = await seedDrifting(900_000);

    const client = renderScreen();
    await screen.findByTestId(`wallet-card-${bpi.id}`);
    await waitForDriftDecision(client, bpi.id);

    // The drift itself is real and loaded — only the threshold changed. Matched
    // on the FIGURES alone: 003 added the reporting/dismissed transaction ids to
    // this payload, and this test is about the tolerance, not the shape (which
    // lib/db/repos/__tests__/wallets_repo.test.ts pins exactly).
    expect(client.getQueryData(queryKeys.wallets.drift(bpi.id))).toMatchObject({
      reported: 900_000,
      computed: 85_000,
      drift: 815_000,
    });
    expect(screen.queryByTestId(`wallet-card-${bpi.id}-drift`)).toBeNull();
  });

  test("no installed ruleset means no threshold, and therefore no badge", async () => {
    // Nothing is seeded here on purpose: with no ruleset the app does not know
    // what counts as a drift, and guessing would flash a warning it cannot
    // justify. bootstrapApp() always seeds one on a real device.
    const bpi = await seedDrifting(900_000);

    const client = renderScreen();
    await screen.findByTestId(`wallet-card-${bpi.id}`);
    await waitForDriftDecision(client, bpi.id);

    expect(client.getQueryData(queryKeys.ruleset.active())).toBeNull();
    expect(screen.queryByTestId(`wallet-card-${bpi.id}-drift`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — the empty state, and navigation
// ---------------------------------------------------------------------------

describe("empty state", () => {
  test("renders when there are no wallets", async () => {
    renderScreen();

    // Title is the SPEC's string (UX-states table); the plan's wording survives
    // as the body. Global Constraints: where the plan and a spec disagree, the
    // spec wins -- and they disagree on exactly this line.
    expect(await screen.findByText("Add your first Wallet")).toBeTruthy();
    expect(screen.getByText("Start with the bank or e-wallet you use most.")).toBeTruthy();
  });

  test("renders no total row when there is nothing to total", async () => {
    renderScreen();
    await screen.findByText("Add your first Wallet");

    expect(screen.queryByTestId("wallets-total-amount")).toBeNull();
  });

  test("does NOT render before the wallets have loaded", async () => {
    // An empty state that flashes on every cold start reads as data loss.
    await createWallet({ name: "BPI", type: "bank", openingBalance: 10_000 });

    renderScreen();

    expect(screen.queryByText("Add your first Wallet")).toBeNull();
    await screen.findByText("BPI");
  });

  // task-3-brief: a user who skips onboarding entirely used to hit a dead
  // end here — no button anywhere on the screen. The action now routes to
  // the same app/wallet/new.tsx destination the populated view's own flows
  // use (transaction/new.tsx, plan/goals/new.tsx).
  test("offers an action that opens the new-wallet screen", async () => {
    renderScreen();
    await screen.findByText("Add your first Wallet");

    fireEvent.press(screen.getByTestId("empty-state-action"));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/wallet/new");
  });
});

describe("navigation", () => {
  test("tapping a card opens that wallet's detail route", async () => {
    const bpi = await createWallet({ name: "BPI", type: "bank", openingBalance: 10_000 });
    await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 30_000 });

    renderScreen();
    await screen.findByTestId(`wallet-card-${bpi.id}`);
    fireEvent.press(screen.getByTestId(`wallet-card-${bpi.id}`));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/wallet/[id]",
      params: { id: bpi.id },
    });
  });
});
