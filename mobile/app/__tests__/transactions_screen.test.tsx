// app/__tests__/transactions_screen.test.tsx — m1c plan Task 6.
//
// The ledger end to end, against a REAL database: the filter bar builds a
// `TxFilter`, `useTransactions` keys the cache on it, `listTransactions` ANDs
// its clauses, and `LedgerList` groups whatever comes back.
//
// THE COMPOSITION TEST IS WHY THIS FILE EXISTS. Whether two filters narrow to
// the intersection or quietly replace each other cannot be decided in
// components/transactions/__tests__/filter_bar.test.tsx — that file proves the
// bar EMITS both, and this one proves the emitted filter reaches the SQL and
// comes back with one row rather than three.
//
// It also pins the two empty states as the screen actually reaches them, with
// each case asserting the other's copy is absent.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

import { reviewQueueEntrySubtitle } from "@/components/review/review_queue_entry";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { enqueue } from "@/lib/db/repos/review_queue_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  LEDGER_EMPTY_TITLE,
  LEDGER_FILTERED_EMPTY_TITLE,
} from "@/components/transactions/ledger_list";

import TransactionsScreen from "../(tabs)/transactions";

const mockPush = jest.fn();

const FOOD = "cat_food_dining";
const TRANSPORT = "cat_transport";

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

/**
 * Waits for the ledger's pending read to resolve.
 *
 * Every filter change is a new React Query key, so `data` is `undefined` for a
 * beat and the list renders its loading placeholder. Assertions made during
 * that gap ("Grab is gone!") pass just as happily on a filter bar that dropped
 * every filter, which is the bug these tests exist to catch.
 */
async function settled(): Promise<void> {
  // The timeout is raised from RNTL's 1s default deliberately: two chip presses
  // start two reads against a real (in-memory) database, and under the full
  // suite's parallelism that has overrun a one-second budget. A longer wait
  // costs nothing when the read is fast and is the difference between a
  // deterministic assertion and a flake that reads as a filter bug.
  //
  // RAISED AGAIN, 10s -> 30s (m2c Task 2). Ten seconds was still not enough:
  // this suite runs in ~18s in isolation and 59-135s inside a saturated full
  // run, and it failed three consecutive full runs here while passing every
  // time on its own. The wait is starved of event-loop time, not waiting on a
  // slow query — so the fix is a budget that survives the worst observed
  // scheduling, not a faster read.
  await waitFor(() => expect(screen.queryByTestId("ledger-list-loading")).toBeNull(), {
    timeout: 30_000,
  });
}

function renderScreen(): void {
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<TransactionsScreen />, { wrapper: Wrapper });
}

let gcash: Wallet;
let bpi: Wallet;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  gcash = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100_000 });
  bpi = await createWallet({ name: "BPI", type: "bank", openingBalance: 500_000 });
});

afterEach(async () => {
  await closeDatabase();
});

/** Four rows across two wallets and two categories — one per combination. */
async function seedGrid(): Promise<void> {
  const now = Date.now();
  const rows = [
    { walletId: gcash.id, categoryId: FOOD, merchant: "Jollibee" },
    { walletId: gcash.id, categoryId: TRANSPORT, merchant: "Grab" },
    { walletId: bpi.id, categoryId: FOOD, merchant: "Mang Inasal" },
    { walletId: bpi.id, categoryId: TRANSPORT, merchant: "Angkas" },
  ];
  for (const [index, row] of rows.entries()) {
    await insertTransaction({
      ...row,
      amount: 10_000 + index,
      direction: "out",
      occurredAt: now - index * 60_000,
      source: "notification",
      confidence: 0.9,
    });
  }
}

describe("the ledger", () => {
  test("renders the tracked rows, grouped under a day header", async () => {
    await seedGrid();

    renderScreen();

    expect(await screen.findByText("Jollibee")).toBeTruthy();
    expect(screen.getAllByTestId(/^day-group-\d{4}-\d{2}-\d{2}$/).length).toBe(1);
  });

  test("a transfer leg is muted and labelled, on this screen and not just in isolation", async () => {
    // The rule the whole task exists for has to survive the wiring, not just
    // the component test.
    const outLeg = await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 500_000,
      direction: "out",
      occurredAt: Date.now(),
      merchant: "Transfer to BPI",
      source: "notification",
      confidence: 0.9,
    });
    const inLeg = await insertTransaction({
      walletId: bpi.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 500_000,
      direction: "in",
      occurredAt: Date.now(),
      merchant: "Transfer from GCash",
      source: "notification",
      confidence: 0.9,
    });
    // The real linking path, so the stamp on both legs is the one the pipeline
    // writes rather than a hand-rolled UPDATE this screen might not recognise.
    await linkTransfer(outLeg.id, inLeg.id, 0, { detectedBy: "auto", confidence: 0.95 });

    renderScreen();

    await screen.findByText("Transfer from GCash");
    for (const leg of [outLeg, inLeg]) {
      expect(screen.getByTestId(`transaction-transfer-${leg.id}`)).toHaveTextContent(
        "Transfer — not counted as spending",
      );
      expect(String(screen.getByTestId(`transaction-amount-${leg.id}`).props.className)).toContain(
        "text-fg-2",
      );
    }
    // …and neither leg reaches the day's net (invariant I2).
    expect(screen.getByTestId(/^day-group-\d{4}-\d{2}-\d{2}-net$/)).toHaveTextContent("₱0.00");
  });
});

describe("filters compose (AND), all the way to the SQL", () => {
  test("wallet AND category narrows to the intersection, not to their union", async () => {
    // A bar that replaced the filter instead of merging it would show two rows
    // here — the list WIDENING when the user asked for something narrower.
    await seedGrid();

    renderScreen();
    await screen.findByText("Jollibee");

    fireEvent.press(screen.getByTestId(`filter-wallet-${gcash.id}`));
    fireEvent.press(screen.getByTestId(`filter-category-${FOOD}`));

    // Each filter change is a new cache key, so the list is briefly empty while
    // the new read resolves. Asserting through that gap would pass on a bar
    // that dropped BOTH filters just as readily.
    await settled();
    expect(screen.getByText("Jollibee")).toBeTruthy();
    expect(screen.queryByText("Grab")).toBeNull();
    expect(screen.queryByText("Mang Inasal")).toBeNull();
    expect(screen.queryByText("Angkas")).toBeNull();
  });

  test("clearing the category chip restores the wallet-only list, keeping the wallet", async () => {
    await seedGrid();

    renderScreen();
    await screen.findByText("Jollibee");

    fireEvent.press(screen.getByTestId(`filter-wallet-${gcash.id}`));
    fireEvent.press(screen.getByTestId(`filter-category-${FOOD}`));
    await settled();
    expect(screen.queryByText("Grab")).toBeNull();

    fireEvent.press(screen.getByTestId("filter-chip-categoryId"));

    // Grab is back (same wallet, other category); BPI's rows are still gone.
    await settled();
    expect(screen.getByText("Grab")).toBeTruthy();
    expect(screen.queryByText("Mang Inasal")).toBeNull();
  });

  test("direction filters to one side of the ledger", async () => {
    await seedGrid();
    await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 250_000,
      direction: "in",
      occurredAt: Date.now(),
      merchant: "Sweldo",
      source: "notification",
      confidence: 0.9,
    });

    renderScreen();
    await screen.findByText("Sweldo");

    fireEvent.press(screen.getByTestId("filter-direction-in"));

    await settled();
    expect(screen.getByText("Sweldo")).toBeTruthy();
    expect(screen.queryByText("Jollibee")).toBeNull();
  });
});

describe("search", () => {
  test("narrows over the rows on screen, matching merchant and note", async () => {
    await seedGrid();

    renderScreen();
    await screen.findByText("Jollibee");

    fireEvent.changeText(screen.getByTestId("filter-search"), "angkas");

    await waitFor(() => expect(screen.queryByText("Jollibee")).toBeNull());
    expect(screen.getByText("Angkas")).toBeTruthy();
  });
});

describe("the two empty states, reached through the screen", () => {
  test("an untouched ledger says nothing has been tracked yet", async () => {
    renderScreen();

    expect(await screen.findByTestId("ledger-empty")).toBeTruthy();
    expect(screen.getByText(LEDGER_EMPTY_TITLE)).toBeTruthy();
    expect(screen.queryByText(LEDGER_FILTERED_EMPTY_TITLE)).toBeNull();
  });

  test("a filter matching nothing NEVER claims nothing was tracked", async () => {
    // The alarming false statement: a user with a full ledger being told the
    // app recorded nothing, because they tapped a category chip.
    await insertTransaction({
      walletId: gcash.id,
      categoryId: FOOD,
      amount: 10_000,
      direction: "out",
      occurredAt: Date.now(),
      merchant: "Jollibee",
      source: "notification",
      confidence: 0.9,
    });

    renderScreen();
    await screen.findByText("Jollibee");

    fireEvent.press(screen.getByTestId(`filter-category-${TRANSPORT}`));

    expect(await screen.findByTestId("ledger-empty-filtered")).toBeTruthy();
    expect(screen.getByText(LEDGER_FILTERED_EMPTY_TITLE)).toBeTruthy();
    expect(screen.queryByText(LEDGER_EMPTY_TITLE)).toBeNull();
    expect(screen.queryByTestId("ledger-empty")).toBeNull();
  });

  test("a SEARCH matching nothing is also a filtered empty", async () => {
    await seedGrid();

    renderScreen();
    await screen.findByText("Jollibee");

    fireEvent.changeText(screen.getByTestId("filter-search"), "meralco");

    expect(await screen.findByTestId("ledger-empty-filtered")).toBeTruthy();
    expect(screen.queryByText(LEDGER_EMPTY_TITLE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Opening a row (m1c Task 7)
// ---------------------------------------------------------------------------

describe("opening a transaction", () => {
  test("tapping a row navigates to that transaction's detail route", async () => {
    // Task 6 shipped these rows inert because app/transaction/[id].tsx did not
    // exist. It does now, and the WIRING is what this asserts: `LedgerList`
    // reporting the pressed row proves nothing on its own if the screen
    // rendering it forgets to send that row anywhere.
    await seedGrid();
    renderScreen();
    await screen.findByText("Jollibee");

    const row = screen.getAllByTestId(/^transaction-row-/)[0];
    fireEvent.press(row);

    expect(mockPush).toHaveBeenCalledTimes(1);
    // The id travels as a PARAM, not spliced into a path string: a merchant id
    // with a slash in it would silently route somewhere else.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/transaction/[id]",
      params: { id: String(row.props.testID).replace("transaction-row-", "") },
    });
  });
});

// ---------------------------------------------------------------------------
// The Review Queue entry point (m1c Task 10)
// ---------------------------------------------------------------------------
//
// WITHOUT THIS ROW THE WHOLE REVIEW QUEUE IS DEAD CODE. Task 9 shipped
// app/review/index.tsx and nothing anywhere links to it; neither Task 9's nor
// Task 10's file list touches this screen. The spec puts the queue at the top of
// the Transactions tab (§UX states), and this is that entry point.
describe("the review queue entry point", () => {
  async function queueItems(count: number): Promise<void> {
    for (let index = 0; index < count; index++) {
      await enqueue({
        kind: "low-confidence",
        payload: { amount: 1000 + index, direction: "out", confidence: 0.4 },
      });
    }
  }

  test("is absent when the queue is empty", async () => {
    await seedGrid();

    renderScreen();
    await screen.findByText("Jollibee");
    await settled();

    // An empty queue advertising itself is the opposite of the reward state the
    // spec asks for ("absence of work is the reward"), and a row that is always
    // there is a row the user stops seeing on the day it matters.
    await waitFor(() => expect(screen.queryByTestId("review-queue-entry")).toBeNull());
  });

  test("appears with the open count once something needs review", async () => {
    await seedGrid();
    await queueItems(3);

    renderScreen();

    expect(await screen.findByTestId("review-queue-entry")).toBeTruthy();
    expect(screen.getByText(reviewQueueEntrySubtitle(3))).toBeTruthy();
  });

  test("counts one item in the singular", async () => {
    await queueItems(1);

    renderScreen();

    expect(await screen.findByText(reviewQueueEntrySubtitle(1))).toBeTruthy();
  });

  test("opens the queue", async () => {
    await queueItems(2);

    renderScreen();
    fireEvent.press(await screen.findByTestId("review-queue-entry"));

    expect(mockPush).toHaveBeenCalledWith("/review");
  });

  test("is still offered when the ledger itself is empty", async () => {
    // The two states are independent: a brand-new install whose very first
    // captures all landed in the queue has nothing in the ledger and everything
    // to triage. A row rendered inside the ledger list would vanish exactly then.
    //
    // The ledger's OWN empty state here is the queue-aware variant
    // (task-7-brief.md), not the plain "ledger-empty" one -- "Nothing tracked
    // yet" directly under "Needs your review — 1 item needs a second look"
    // read as a broken app even though both sentences were true.
    await queueItems(1);

    renderScreen();

    expect(await screen.findByTestId("review-queue-entry")).toBeTruthy();
    expect(screen.getByTestId("ledger-empty-review-pending")).toBeTruthy();
    expect(screen.queryByTestId("ledger-empty")).toBeNull();
  });
});
