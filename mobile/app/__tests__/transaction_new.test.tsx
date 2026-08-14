// app/__tests__/transaction_new.test.tsx — m1c plan Task 8's route,
// app/transaction/new.tsx, against a REAL database.
//
// The numpad and the form are pinned next door
// (components/transactions/__tests__/). What lives HERE is rule 4, which is the
// rule with teeth: A MANUAL ENTRY IS GROUND TRUTH.
//
//   IT CARRIES `source: "manual"` AND `confidence: 1`, and no raw capture —
//   there is no notification behind it to be transparent about, and the
//   detail screen's "Why was this recorded?" panel reads those fields to say
//   "you added this manually" instead of showing an empty box.
//
//   IT NEVER ENTERS THE PIPELINE. Not routed, not parsed, not deduped, not
//   transfer-detected, not gated. The proving test is the duplicate one: ₱100
//   entered twice within seconds must leave TWO rows. The DedupeGate exists to
//   suppress a push/SMS twin describing ONE real event; two manual entries are
//   two deliberate statements by a human, and merging them tells the user they
//   did not do something they just did. The assertion is the ROW COUNT, not the
//   absence of an error — a swallowed duplicate throws nothing.
//
//   THE WALLET BALANCE MOVES BY EXACTLY THE AMOUNT. `insertTransaction` settles
//   it in the same SQL transaction; a screen that "helpfully" adjusted the
//   balance itself would double every entry, and one that bypassed the
//   repository would move nothing while the ledger filled up.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
    replace: (...args: unknown[]) => mockReplace(...args),
  }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { countOpen } from "@/lib/db/repos/review_queue_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Transaction, Wallet } from "@/types/domain";

import NewTransactionScreen from "../transaction/new";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

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

async function renderNew(): Promise<void> {
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<NewTransactionScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId("manual-entry-form")).toBeTruthy());
}

/** Taps the amount in, digit by digit, exactly as a thumb would. */
function type(keys: string): void {
  for (const key of keys) {
    fireEvent.press(screen.getByTestId(`numpad-key-${key}`));
  }
}

function save(): void {
  fireEvent.press(screen.getByTestId("manual-entry-save"));
}

async function ledger(walletId?: string): Promise<Transaction[]> {
  return listTransactions(walletId === undefined ? {} : { walletId });
}

let pocket: Wallet;

beforeEach(async () => {
  jest.clearAllMocks();
  await freshDb();
  await seedDefaultCategories();
  pocket = await createWallet({ name: "Pocket", type: "cash", openingBalance: 100_000 });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Rule 4 — a manual entry is ground truth
// ---------------------------------------------------------------------------

describe("what saving writes", () => {
  test("`source: manual`, `confidence: 1`, and no raw capture behind it", async () => {
    await renderNew();

    type("1234");
    save();

    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(1);
    });
    const [written] = await ledger(pocket.id);
    expect(written.source).toBe("manual");
    expect(written.confidence).toBe(1);
    // Not a parse the app is 100% sure of — a fact the user stated. There is no
    // notification to point at, and inventing a reference would make the
    // transparency panel lie about where the row came from.
    expect(written.rawNotificationId).toBeNull();
    expect(written.amount).toBe(1234);
    expect(written.direction).toBe("out");
    expect(written.walletId).toBe(pocket.id);
    expect(written.categoryId).toBe(UNCATEGORIZED_ID);
  });

  test("the wallet balance moves by exactly the amount", async () => {
    await renderNew();

    type("30000");
    save();

    // ₱1,000.00 opening, ₱300.00 spent → ₱700.00. Not a snap to a reported
    // figure (cash never reports one), and not zero.
    await waitFor(async () => {
      expect((await getWallet(pocket.id))?.balance).toBe(70_000);
    });
    const [written] = await ledger(pocket.id);
    expect(written.balanceAfter).toBeNull();
  });

  test("an `in` entry adds to the balance instead", async () => {
    await renderNew();

    type("30000");
    fireEvent.press(screen.getByTestId("manual-entry-direction-in"));
    save();

    await waitFor(async () => {
      expect((await getWallet(pocket.id))?.balance).toBe(130_000);
    });
  });

  test("the entry closes the screen once it is committed", async () => {
    await renderNew();

    type("1234");
    save();

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
    // Committed BEFORE the screen closes — a `back()` fired optimistically
    // would leave a failed write with nobody on screen to be told.
    expect(await ledger(pocket.id)).toHaveLength(1);
  });
});

describe("a manual entry never enters the pipeline", () => {
  test("the SAME amount entered twice seconds apart leaves TWO rows", async () => {
    await renderNew();
    type("10000");
    save();
    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(1);
    });

    // The user goes back, taps add again, and enters the same ₱100.00 — two
    // jeepney rides, two rounds of drinks, two of anything.
    //
    // Modelled as a second save on the SAME mounted screen rather than a
    // cleanup-and-remount: `router.back` is mocked, so the screen never
    // actually unmounts here, and re-rendering after `cleanup()` throws
    // "Can't access .root on unmounted test renderer". The amount is still
    // typed in, which is exactly the state a returning user would land in.
    save();

    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(2);
    });
    const rows = await ledger(pocket.id);
    expect(rows.map((row) => row.amount)).toEqual([10_000, 10_000]);
    expect(rows[0].id).not.toBe(rows[1].id);
    // And both moved the wallet. A deduped second entry would leave ₱900.00
    // here — money the user watched themselves spend, still in their pocket
    // according to the app.
    expect((await getWallet(pocket.id))?.balance).toBe(80_000);
  });

  test("a matching notification-sourced row does not suppress it either", async () => {
    // The DedupeGate's real job: one event, two notifications. This is the
    // opposite case — the user typing what the listener also heard is still a
    // second statement, and the ledger is where they will see and fix it.
    await insertTransaction({
      walletId: pocket.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 10_000,
      direction: "out",
      occurredAt: Date.now(),
      source: "notification",
      confidence: 0.9,
    });
    await renderNew();

    type("10000");
    save();

    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(2);
    });
  });

  test("nothing is queued for review", async () => {
    await renderNew();

    type("1234");
    save();

    await waitFor(async () => {
      expect(await ledger(pocket.id)).toHaveLength(1);
    });
    // Not routed, not parsed, not gated. A manual entry has no confidence to
    // doubt and no provider to resolve, so nothing about it can need triage.
    expect(await countOpen()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The wallet the entry lands in
// ---------------------------------------------------------------------------

describe("the cash wallet", () => {
  test("defaults to the cash wallet the ledger touched most recently", async () => {
    const jar = await createWallet({ name: "Jar", type: "cash", openingBalance: 50_000 });
    await insertTransaction({
      walletId: jar.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 5_000,
      direction: "out",
      occurredAt: Date.now(),
      source: "manual",
      confidence: 1,
    });
    await renderNew();

    type("1234");
    save();

    await waitFor(async () => {
      expect(await ledger(jar.id)).toHaveLength(2);
    });
    expect(await ledger(pocket.id)).toHaveLength(0);
  });

  test("with no cash wallet it offers to create one and writes nothing", async () => {
    await freshDb();
    await seedDefaultCategories();
    const bpi = await createWallet({ name: "BPI", type: "bank", openingBalance: 500_000 });
    await renderNew();

    type("1234");
    save();

    // Cash in a bank wallet corrupts both balances, so the screen stops and
    // asks rather than picking the only wallet it has.
    expect(screen.getByTestId("manual-entry-no-cash")).toBeTruthy();
    expect(await ledger()).toHaveLength(0);
    expect((await getWallet(bpi.id))?.balance).toBe(500_000);

    fireEvent.press(screen.getByTestId("manual-entry-create-cash"));
    expect(mockPush).toHaveBeenCalledWith("/wallet/new");
  });
});
