// app/__tests__/wallet_detail.test.tsx — m1c plan Task 4, rule 4.
//
// The detail screen shows one wallet's balance, the drift badge, its matcher
// chips ("Catches: GCash"), and its transactions.
//
// TWO THINGS IT DELIBERATELY DOES NOT SHOW, both asserted below so a later
// change has to argue with a test rather than with a comment:
//
//   NO LEDGER LIST. Rule 4 says the detail reuses "the ledger list from Task
//   6", and Task 6 has not happened. The rows here are a plain list from
//   `useTransactions({ walletId })`; building a second ledger now would mean
//   deleting it in two tasks' time.
//
//   NO DRIFT DISMISSAL. Spec rule 3 offers "record the gap as an adjustment,
//   or dismiss (accept the snap silently)", and there is still no
//   acknowledged/dismissed flag anywhere in the schema — so a dismissed drift
//   would re-render on the next open, forever. m1c Task 5 examined this and
//   left it deferred: doing it properly needs a third migration, which is the
//   project owner's decision to make, as migration 002 was.
//
// THE EDIT / RECONCILE / ARCHIVE ACTIONS ARRIVED WITH TASK 5, which owns the
// wallet form, the cash reconciliation sheet and the archive flow's "what
// happens to this wallet's transactions?" prompt. Their behaviour is tested in
// app/__tests__/wallet_routes.test.tsx, against a real database; what this file
// still asserts is WHICH of them a non-cash wallet is offered.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { closeDatabase, getDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { archiveWallet, createWallet } from "@/lib/db/repos/wallets_repo";
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import WalletDetailScreen from "../wallet/[id]";

let mockParams: { id: string } = { id: "" };
const mockPush = jest.fn();

const GCASH_PACKAGE = "com.globe.gcash.android";

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

function renderDetail(walletId: string): void {
  mockParams = { id: walletId };
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<WalletDetailScreen />, { wrapper: Wrapper });
}

async function insertMatcher(walletId: string, packageName: string, hint: string | null) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO wallet_matchers (id, wallet_id, package_name, hint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`m-${walletId}-${hint ?? "main"}`, walletId, packageName, hint, 1_000, 1_000],
  );
}

let gcash: Wallet;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  await upsertRuleset({
    version: 1,
    providers: [
      {
        providerKey: "gcash",
        packageNames: [GCASH_PACKAGE],
        version: 1,
        channel: "push",
        templates: [],
      },
    ],
    tunables: {
      balanceDriftToleranceCentavos: DEFAULT_TUNABLES.balanceDriftToleranceCentavos,
    },
  });
  gcash = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100_000 });
});

afterEach(async () => {
  await closeDatabase();
});

describe("opening a transaction from the wallet's ledger", () => {
  test("tapping a row navigates to that transaction's detail route", async () => {
    // The SECOND screen rendering the one ledger list (m1c Task 7). Both have
    // to wire the tap, or the same row opens on one screen and is dead on the
    // other — with nothing about the row itself explaining the difference.
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 25_000,
      direction: "out",
      occurredAt: Date.now(),
      merchant: "Jollibee",
      source: "notification",
      confidence: 0.9,
    });

    renderDetail(gcash.id);
    await screen.findByText("Jollibee");

    fireEvent.press(screen.getByTestId(`transaction-row-${tx.id}`));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/transaction/[id]",
      params: { id: tx.id },
    });
  });
});

describe("the balance header", () => {
  test("renders the wallet's name and balance", async () => {
    renderDetail(gcash.id);

    expect(await screen.findByText("GCash")).toBeTruthy();
    expect(screen.getByTestId("wallet-detail-balance")).toHaveTextContent("₱1,000.00");
  });

  test("a credit wallet's balance is labelled as owed, not as money held", async () => {
    const visa = await createWallet({ name: "Visa", type: "credit", openingBalance: 1_234_500 });

    renderDetail(visa.id);

    expect(await screen.findByText("Visa")).toBeTruthy();
    expect(screen.getByTestId("wallet-detail-balance")).toHaveTextContent("₱12,345.00");
    expect(screen.getByText("Owed")).toBeTruthy();
  });

  test("an archived wallet still opens, and says it is archived", async () => {
    // Archiving removes a wallet from the list, not from the app: its
    // transactions are still attached to it and still have to be readable.
    await archiveWallet(gcash.id);

    renderDetail(gcash.id);

    expect(await screen.findByText("GCash")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
  });

  test("an id with no wallet behind it says so rather than rendering a blank screen", async () => {
    renderDetail("no-such-wallet");

    expect(await screen.findByTestId("wallet-detail-missing")).toBeTruthy();
  });
});

describe("the drift badge", () => {
  test("a drift beyond tolerance shows both figures", async () => {
    await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 15_000,
      direction: "out",
      occurredAt: 1_000,
      source: "notification",
      confidence: 0.9,
      balanceAfter: 900_000,
    });

    renderDetail(gcash.id);

    expect(await screen.findByTestId("wallet-detail-drift")).toBeTruthy();
    // Each figure against its own label. The header balance has snapped to the
    // reported ₱9,000.00 too, so a bare text query would not tell a badge
    // showing both figures from one showing the reported figure twice.
    expect(screen.getByTestId("wallet-detail-drift-reported")).toHaveTextContent("₱9,000.00");
    expect(screen.getByTestId("wallet-detail-drift-computed")).toHaveTextContent("₱850.00");
  });

  test("a wallet with no reported balance shows no badge", async () => {
    renderDetail(gcash.id);
    await screen.findByText("GCash");

    expect(screen.queryByTestId("wallet-detail-drift")).toBeNull();
  });
});

describe("matcher chips", () => {
  test('reads "Catches: GCash"', async () => {
    await insertMatcher(gcash.id, GCASH_PACKAGE, null);

    renderDetail(gcash.id);

    expect(await screen.findByText("Catches: GCash")).toBeTruthy();
  });

  test("shows the sub-account hint that separates GCash main from GSave", async () => {
    const gsave = await createWallet({ name: "GSave", type: "savings", openingBalance: 0 });
    await insertMatcher(gsave.id, GCASH_PACKAGE, "GSave");

    renderDetail(gsave.id);

    expect(await screen.findByText("Catches: GCash · GSave")).toBeTruthy();
  });

  test("shows only THIS wallet's matchers", async () => {
    const gsave = await createWallet({ name: "GSave", type: "savings", openingBalance: 0 });
    await insertMatcher(gcash.id, GCASH_PACKAGE, null);
    await insertMatcher(gsave.id, GCASH_PACKAGE, "GSave");

    renderDetail(gcash.id);

    expect(await screen.findByText("Catches: GCash")).toBeTruthy();
    expect(screen.queryByText("Catches: GCash · GSave")).toBeNull();
  });

  test("a CASH wallet shows no matcher section at all (rule 4)", async () => {
    // Cash wallets have empty matchers by rule and the matcher UI is hidden
    // for them; money enters by manual entry, transfer legs and reconciliation.
    const pocket = await createWallet({ name: "Pocket", type: "cash", openingBalance: 5_000 });

    renderDetail(pocket.id);
    await screen.findByText("Pocket");

    expect(screen.queryByTestId("wallet-detail-matchers")).toBeNull();
  });
});

describe("the wallet's transactions", () => {
  async function seedLedger(): Promise<void> {
    const other = await createWallet({ name: "BPI", type: "bank", openingBalance: 500_000 });
    await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 15_000,
      direction: "out",
      occurredAt: 2_000,
      merchant: "Jollibee",
      source: "notification",
      confidence: 0.9,
    });
    await insertTransaction({
      walletId: other.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 99_900,
      direction: "out",
      occurredAt: 3_000,
      merchant: "Meralco",
      source: "notification",
      confidence: 0.9,
    });
  }

  test("lists this wallet's transactions", async () => {
    await seedLedger();

    renderDetail(gcash.id);

    expect(await screen.findByText("Jollibee")).toBeTruthy();
  });

  test("does NOT list another wallet's transactions", async () => {
    // The filter has to reach the repository AND the cache key, or a
    // wallet-scoped screen quietly shows another wallet's money.
    await seedLedger();

    renderDetail(gcash.id);
    await screen.findByText("Jollibee");

    expect(screen.queryByText("Meralco")).toBeNull();
  });

  test("says so plainly when the wallet has no transactions yet", async () => {
    renderDetail(gcash.id);
    await screen.findByText("GCash");

    expect(await screen.findByTestId("wallet-detail-no-transactions")).toBeTruthy();
  });

  test("renders them through the app's ONE ledger list, not a second one (Task 6)", async () => {
    // The placeholder this screen used to carry is gone. Two ledger
    // implementations is how a transfer leg ends up muted on one screen and
    // counted as spending on the other, so the day header and the transfer row
    // state are asserted HERE too — on the screen that reuses them.
    const bpi = await createWallet({ name: "BPI", type: "bank", openingBalance: 0 });
    const leg = await insertTransaction({
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
    await linkTransfer(leg.id, inLeg.id, 0);

    renderDetail(gcash.id);

    expect(await screen.findByTestId("wallet-detail-ledger")).toBeTruthy();
    expect(screen.getAllByTestId(/^day-group-\d{4}-\d{2}-\d{2}$/).length).toBe(1);
    expect(screen.getByTestId(`transaction-transfer-${leg.id}`)).toHaveTextContent(
      "Transfer — not counted as spending",
    );
    expect(String(screen.getByTestId(`transaction-amount-${leg.id}`).props.className)).toContain(
      "text-fg-2",
    );
  });
});

describe("the actions m1c Task 5 added", () => {
  test("edit and archive are offered; reconcile is not, because this is not cash", async () => {
    await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 15_000,
      direction: "out",
      occurredAt: 1_000,
      source: "notification",
      confidence: 0.9,
      balanceAfter: 900_000,
    });

    renderDetail(gcash.id);
    await screen.findByTestId("wallet-detail-drift");

    expect(screen.getByTestId("wallet-detail-edit")).toBeTruthy();
    expect(screen.getByTestId("wallet-detail-archive")).toBeTruthy();
    // Task 5 rule 6: cash only. An e-wallet re-anchors itself from the
    // provider's reported balance-after, and a typed adjustment would fight
    // the next snap.
    expect(screen.queryByTestId("wallet-detail-reconcile")).toBeNull();
  });

  test("still offers no DELETE, at any transaction count", async () => {
    // Invariant 4, and there is no `deleteWallet` in the repository to call.
    renderDetail(gcash.id);
    await screen.findByText("GCash");

    expect(screen.queryByTestId("wallet-detail-delete")).toBeNull();
  });

  test("STILL no dismiss action on the drift — nothing in the schema can remember it", async () => {
    // Spec rule 3 offers "record the gap as an adjustment, or dismiss". There
    // is still no acknowledged/dismissed flag anywhere in the schema, so a
    // dismissed drift would re-render on the next open, forever.
    //
    // TASK 5 LOOKED AT THIS AND LEFT IT ALONE, deliberately. The honest fix is
    // a third migration — most likely `wallets.drift_dismissed_transaction_id`,
    // so a NEWER drift shows again while the acknowledged one stays quiet; a
    // bare boolean would silence the next real drift too. That is a schema
    // decision for the project owner, exactly as migration 002 was, and this
    // test is what keeps a half-version of it from being added quietly.
    await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 15_000,
      direction: "out",
      occurredAt: 1_000,
      source: "notification",
      confidence: 0.9,
      balanceAfter: 900_000,
    });

    renderDetail(gcash.id);
    await screen.findByTestId("wallet-detail-drift");

    expect(screen.queryByText(/dismiss/i)).toBeNull();
  });
});
