// app/__tests__/wallet_detail.test.tsx — m1c plan Task 4, rule 4.
//
// The detail screen shows one wallet's balance, the drift badge, its matcher
// chips ("Catches: GCash"), and its transactions.
//
// TWO THINGS IT ONCE DELIBERATELY DID NOT SHOW. Both were asserted here as
// absences, so that adding either had to argue with a test rather than with a
// comment, and both have since arrived:
//
//   THE LEDGER LIST arrived with Task 6. Rule 4 says the detail reuses "the
//   ledger list from Task 6"; until that existed the screen carried a plain list
//   from `useTransactions({ walletId })`, because building a second ledger would
//   have meant deleting it two tasks later.
//
//   DRIFT DISMISSAL arrived with migration 003 (2026-08-15). Spec rule 3 offers
//   "record the gap as an adjustment, or dismiss (accept the snap silently)",
//   and nothing in the schema could remember a dismissal — so a dismissed drift
//   re-rendered on the next open, forever. Doing it properly needed a third
//   migration, which was the project owner's decision to make, as 002 was. The
//   last describe in this file is that feature, and it opens with the full
//   reasoning the absence-test carried.
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
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { queryKeys } from "@/constants/query_keys";
import { BALANCE_CORRECTION_NOTE } from "@/hooks/mutations/use_correct_wallet_balance";
import { closeDatabase, getDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { archiveWallet, createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Centavos, Wallet } from "@/types/domain";

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

/** The screen plus the cache behind it, so a test can wait on a read or close it. */
type DetailView = ReturnType<typeof render> & { client: QueryClient };

function renderDetail(walletId: string): DetailView {
  mockParams = { id: walletId };
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Object.assign(render(<WalletDetailScreen />, { wrapper: Wrapper }), { client });
}

/**
 * Waits until the drift read has RESOLVED, which is the only honest anchor for
 * asserting that no badge is showing: `queryByTestId` on a screen whose drift
 * query is still in flight passes for the wrong reason, every time.
 *
 * `getBalanceDrift` legitimately resolves to `null`, so the cached value cannot
 * distinguish "no drift" from "not read yet" — only the query state can.
 */
async function waitForDriftDecision(view: DetailView, walletId: string): Promise<void> {
  await waitFor(() =>
    expect(view.client.getQueryState(queryKeys.wallets.drift(walletId))?.status).toBe("success"),
  );
}

/**
 * Closes a screen the way a user leaving it does, and lets its reads finish
 * first. An unmount with refetches still in flight lands a React update on a
 * torn-down tree, which react-test-renderer raises from inside the NEXT render —
 * an error about the wrong screen entirely.
 */
async function closeDetail(view: DetailView): Promise<void> {
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
  view.unmount();
  view.client.clear();
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
});

// ---------------------------------------------------------------------------
// Task 4 (device-testing fix, 2026-08-18) — a non-cash wallet had no way to
// say "this already has ₱3,000 in it" after creation. Rule 3 keeps
// CashReconcileSheet cash-only and unmodified, so this is a SEPARATE sheet
// (BalanceCorrectionSheet) writing a SEPARATE, honestly-labelled ledger entry
// through the ordinary commit path — never a direct write to `wallets.balance`.
// ---------------------------------------------------------------------------

describe("correcting a non-cash wallet's balance (Task 4)", () => {
  test("a non-cash wallet offers a balance adjustment", async () => {
    renderDetail(gcash.id);
    await screen.findByText("GCash");

    expect(screen.getByTestId("wallet-detail-adjust-balance")).toBeTruthy();
    // Rule 3: this is not reconciliation, and cash's action is not offered
    // beside it.
    expect(screen.queryByTestId("wallet-detail-reconcile")).toBeNull();
  });

  test("the adjustment writes a ledger entry rather than setting the balance directly", async () => {
    // gcash opens at ₱1,000.00 (beforeEach). The user says it actually holds
    // ₱1,500.00 — ₱500.00 the app never saw arrive.
    renderDetail(gcash.id);
    await screen.findByText("GCash");

    fireEvent.press(screen.getByTestId("wallet-detail-adjust-balance"));
    fireEvent.changeText(screen.getByTestId("balance-correction-amount"), "150000");
    fireEvent.press(screen.getByTestId("balance-correction-confirm"));

    await waitFor(async () => {
      expect(await listTransactions({ walletId: gcash.id })).toHaveLength(1);
    });

    const written = (await listTransactions({ walletId: gcash.id }))[0]!;
    expect(written.direction).toBe("in");
    expect(written.amount).toBe(50_000);
    expect(written.note).toBe(BALANCE_CORRECTION_NOTE);
    // The balance moved BECAUSE of that transaction's signed effect, not
    // because anything patched the row directly — the same anchor
    // `useReconcileCash` lands cash on via the ordinary commit path.
    await waitFor(async () => {
      expect((await getWallet(gcash.id))?.balance).toBe(150_000);
    });
    // No `balanceAfter`: nothing here is a provider's reported figure, and
    // setting one would make the drift badge treat a guess as a bank-confirmed
    // anchor.
    expect(written.balanceAfter).toBeNull();
  });

  test("cash wallets still use the reconcile sheet (regression on rule 3)", async () => {
    const pocket = await createWallet({ name: "Pocket", type: "cash", openingBalance: 5_000 });

    renderDetail(pocket.id);
    await screen.findByText("Pocket");

    expect(screen.getByTestId("wallet-detail-reconcile")).toBeTruthy();
    expect(screen.queryByTestId("wallet-detail-adjust-balance")).toBeNull();

    // And the sheet that opens is still the unmodified cash one.
    fireEvent.press(screen.getByTestId("wallet-detail-reconcile"));
    expect(screen.getByTestId("cash-reconcile-sheet")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Rule 3's second offer — dismissing a drift (migration 003)
//
// THIS BLOCK REPLACES "STILL no dismiss action on the drift — nothing in the
// schema can remember it", which stood here from Task 5 until 2026-08-15. That
// test existed to stop a HALF-version of this feature being added quietly, and
// its reasoning is the reason these tests are shaped the way they are, so it is
// carried forward rather than deleted:
//
//   Spec rule 3 offers "record the gap as an adjustment ..., or dismiss (accept
//   the snap silently)". Reconciliation shipped; dismissal could not, because
//   nothing in the schema could remember a dismissal — so a dismissed drift
//   re-rendered on the next open, forever. The honest fix was a third migration,
//   and the note left here named the shape it would need:
//   `wallets.drift_dismissed_transaction_id`, so a NEWER drift shows again while
//   the acknowledged one stays quiet, because A BARE BOOLEAN WOULD SILENCE THE
//   NEXT REAL DRIFT TOO. That was a schema decision for the project owner, as
//   migration 002 was; the owner made it on 2026-08-15 and 003 is that column.
//
// So the discriminating test below is "a NEWER reporting transaction brings the
// badge back". Every other test in this block passes against the boolean the old
// test was written to prevent.
// ---------------------------------------------------------------------------

describe("dismissing a balance drift", () => {
  /** A reporting notification: the provider states `balanceAfter` and disagrees. */
  async function reportBalance(walletId: string, amount: Centavos, balanceAfter: Centavos) {
    return insertTransaction({
      walletId,
      categoryId: UNCATEGORIZED_ID,
      amount,
      direction: "out",
      occurredAt: 1_000,
      source: "notification",
      confidence: 0.9,
      balanceAfter,
    });
  }

  async function dismissTheVisibleDrift(): Promise<void> {
    await screen.findByTestId("wallet-detail-drift");
    fireEvent.press(screen.getByTestId("wallet-detail-dismiss-drift"));
    await waitFor(() => expect(screen.queryByTestId("wallet-detail-drift")).toBeNull());
  }

  test("the action is offered beside the other wallet actions when a drift is showing", async () => {
    await reportBalance(gcash.id, 15_000, 900_000);

    renderDetail(gcash.id);
    await screen.findByTestId("wallet-detail-drift");

    expect(screen.getByTestId("wallet-detail-dismiss-drift")).toBeTruthy();
  });

  test("dismissing hides the badge, and the action with it", async () => {
    await reportBalance(gcash.id, 15_000, 900_000);

    renderDetail(gcash.id);
    await dismissTheVisibleDrift();

    // The action goes too. A "Dismiss" button with nothing left to dismiss is a
    // control that does nothing, on the screen where a user has just learned
    // that pressing it means something.
    expect(screen.queryByTestId("wallet-detail-dismiss-drift")).toBeNull();
  });

  test("the dismissal survives a remount — it is in the database, not in this screen", async () => {
    // The exact bug being fixed. A dismissal held in component state passes the
    // test above and comes straight back on the next open of the wallet.
    await reportBalance(gcash.id, 15_000, 900_000);

    const first = renderDetail(gcash.id);
    await dismissTheVisibleDrift();
    await closeDetail(first);

    // A brand-new screen AND a brand-new cache: nothing carries over except the
    // database, which is the whole claim.
    const reopened = renderDetail(gcash.id);
    await waitForDriftDecision(reopened, gcash.id);

    expect(screen.queryByTestId("wallet-detail-drift")).toBeNull();
  });

  test("A NEWER REPORTING TRANSACTION BRINGS THE BADGE BACK", async () => {
    // THE test in this task. Everything else here passes against a boolean
    // `drift_dismissed` column — and a boolean silences the NEXT genuine drift
    // too, so a real reconciliation problem becomes permanently invisible with
    // no way for the user to notice.
    //
    // The dismissal names the reporting transaction the user actually looked at.
    // A newer one is a different row with a different id, so it has never been
    // acknowledged and says so, with no clearing step for anyone to forget.
    const firstReport = await reportBalance(gcash.id, 15_000, 900_000);

    const first = renderDetail(gcash.id);
    await dismissTheVisibleDrift();
    await closeDetail(first);

    // A second notification lands, and the bank disagrees again — by a different
    // amount, in the opposite direction, about money that is really there.
    const second = await reportBalance(gcash.id, 20_000, 700_000);
    expect(second.id).not.toBe(firstReport.id);

    renderDetail(gcash.id);

    expect(await screen.findByTestId("wallet-detail-drift")).toBeTruthy();
    expect(screen.getByTestId("wallet-detail-drift-reported")).toHaveTextContent("₱7,000.00");
    expect(screen.getByTestId("wallet-detail-drift-computed")).toHaveTextContent("₱8,800.00");
    // And it is dismissible in its own right, not stuck on screen.
    expect(screen.getByTestId("wallet-detail-dismiss-drift")).toBeTruthy();
  });

  test("dismissing one wallet's drift leaves another wallet's badge alone", async () => {
    // A flag stored per app rather than per wallet passes every single-wallet
    // test above and silences a bank the user has never opened.
    const bpi = await createWallet({ name: "BPI", type: "bank", openingBalance: 100_000 });
    await reportBalance(gcash.id, 15_000, 900_000);
    await reportBalance(bpi.id, 15_000, 900_000);

    const first = renderDetail(gcash.id);
    await dismissTheVisibleDrift();
    await closeDetail(first);

    renderDetail(bpi.id);

    expect(await screen.findByTestId("wallet-detail-drift")).toBeTruthy();
  });

  test("a drift WITHIN tolerance is offered no dismissal, and gains no badge from one", async () => {
    // ₱0.50 against the ₱1.00 default: rounding, not a disagreement. The
    // dismissal path must never be a way for a quiet wallet to start speaking.
    await reportBalance(gcash.id, 15_000, 85_050);

    const view = renderDetail(gcash.id);
    await waitForDriftDecision(view, gcash.id);

    expect(screen.queryByTestId("wallet-detail-drift")).toBeNull();
    expect(screen.queryByTestId("wallet-detail-dismiss-drift")).toBeNull();
  });

  test("a wallet that has NEVER reported a balance is offered no dismissal either", async () => {
    // `drift === null` is not a drift of zero and not a dismissed one. Treating
    // "never reported" as either would put a control on a cash wallet for a
    // disagreement no provider has ever claimed.
    const pocket = await createWallet({ name: "Pocket", type: "cash", openingBalance: 5_000 });

    const view = renderDetail(pocket.id);
    await waitForDriftDecision(view, pocket.id);

    expect(screen.queryByTestId("wallet-detail-drift")).toBeNull();
    expect(screen.queryByTestId("wallet-detail-dismiss-drift")).toBeNull();
  });
});
