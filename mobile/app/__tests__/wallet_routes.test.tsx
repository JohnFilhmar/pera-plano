// app/__tests__/wallet_routes.test.tsx — m1c plan Task 5's two routes:
// app/wallet/new.tsx and app/wallet/[id]/edit.tsx.
//
// The components are tested in isolation next door; this file is about what the
// routes DO — the reads they wire together and the writes they commit against a
// real database. Three claims live here and nowhere else:
//
//   THE FREE CAP BLOCKS CREATION AND DELETES NOTHING. docs/05-monetization.md
//   §3.1: hitting a cap blocks a NEW record and never touches existing data.
//   A gate that hid or removed wallets would turn a pricing decision into data
//   loss, which is the one thing a gate must never be.
//
//   REASSIGNING A MATCHER PAIR MOVES IT. End-to-end, through the form and the
//   repository: after saving, exactly one wallet claims the pair. Two claimants
//   would make every capture from that provider unresolvable — routed to the
//   Review Queue forever, with no error and nothing that points at the cause.
//
//   RECONCILIATION IS OFFERED ONLY FOR CASH. The detail screen's action, not
//   just the sheet's own guard.
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
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
import { __setTierForTests } from "@/lib/entitlements";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { getTransaction, insertTransaction } from "@/lib/db/repos/transactions_repo";
import { listMatchers, setMatchers } from "@/lib/db/repos/wallet_matchers_repo";
import { archiveWallet, createWallet, getWallet, listWallets } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import NewWalletScreen from "../wallet/new";
import WalletDetailScreen from "../wallet/[id]";
import EditWalletScreen from "../wallet/[id]/edit";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: { id: string } = { id: "" };

const GCASH_PACKAGE = "com.globe.gcash.android";
const MAYA_PACKAGE = "com.paymaya";

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

function renderScreen(element: React.ReactElement): void {
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(element, { wrapper: Wrapper });
}

async function renderNew(): Promise<void> {
  renderScreen(<NewWalletScreen />);
  await waitFor(() => expect(screen.getByTestId("wallet-form-submit")).toBeTruthy());
}

async function renderEdit(walletId: string): Promise<void> {
  mockParams = { id: walletId };
  renderScreen(<EditWalletScreen />);
  await waitFor(() => expect(screen.getByTestId("wallet-form-submit")).toBeTruthy());
}

async function renderDetail(walletId: string): Promise<void> {
  mockParams = { id: walletId };
  renderScreen(<WalletDetailScreen />);
  await waitFor(() => expect(screen.getByTestId("wallet-detail")).toBeTruthy());
}

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
      {
        providerKey: "maya",
        packageNames: [MAYA_PACKAGE],
        version: 1,
        channel: "push",
        templates: [],
      },
    ],
  });
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// app/wallet/new.tsx — creation and the free-tier cap
// ---------------------------------------------------------------------------

describe("creating a wallet", () => {
  test("writes the wallet the form describes", async () => {
    await renderNew();

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "BPI");
    fireEvent.press(screen.getByTestId("wallet-form-type-bank"));
    fireEvent.changeText(screen.getByTestId("wallet-form-opening-balance"), "250000");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    await waitFor(async () => {
      expect(await listWallets()).toHaveLength(1);
    });
    const [created] = await listWallets();
    expect(created.name).toBe("BPI");
    expect(created.type).toBe("bank");
    expect(created.balance).toBe(250_000);
  });

  test("binds the matchers chosen in the form", async () => {
    await renderNew();

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "GCash");
    fireEvent.press(screen.getByTestId("wallet-form-type-e-wallet"));
    // The picker mounts only once `useRuleset` resolves — it has no providers
    // to offer until then, and rendering an empty one would invite a save that
    // binds nothing.
    await waitFor(() => expect(screen.getByTestId("matcher-provider-gcash")).toBeTruthy());
    fireEvent.press(screen.getByTestId("matcher-provider-gcash"));
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    await waitFor(async () => {
      expect(await listMatchers()).toHaveLength(1);
    });
    const [matcher] = await listMatchers();
    expect(matcher.packageName).toBe(GCASH_PACKAGE);
    expect(matcher.hint).toBeNull();
  });

  test("surfaces a duplicate name rather than swallowing it", async () => {
    await createWallet({ name: "GCash", type: "e-wallet" });
    await renderNew();

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "gcash");
    fireEvent.press(screen.getByTestId("wallet-form-type-e-wallet"));
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("wallet-form-error")).toHaveTextContent(/gcash/i);
    });
    expect(await listWallets()).toHaveLength(1);
  });
});

describe("the free-tier wallet cap", () => {
  async function seedThree(): Promise<Wallet[]> {
    return [
      await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 10_000 }),
      await createWallet({ name: "BPI", type: "bank", openingBalance: 20_000 }),
      await createWallet({ name: "Pocket", type: "cash", openingBalance: 30_000 }),
    ];
  }

  test("a fourth wallet on `free` opens the upgrade sheet instead of saving", async () => {
    await seedThree();
    __setTierForTests("free");
    await renderNew();

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "Maya");
    fireEvent.press(screen.getByTestId("wallet-form-type-e-wallet"));
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("upgrade-sheet")).toBeTruthy();
    });
    expect(await listWallets()).toHaveLength(3);
  });

  test("the same fourth wallet on `plus` simply succeeds", async () => {
    await seedThree();
    __setTierForTests("plus");
    await renderNew();

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "Maya");
    fireEvent.press(screen.getByTestId("wallet-form-type-e-wallet"));
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    await waitFor(async () => {
      expect(await listWallets()).toHaveLength(4);
    });
    expect(screen.queryByTestId("upgrade-sheet")).toBeNull();
  });

  test("the cap counts ACTIVE wallets, so archiving frees a slot", async () => {
    const [gcash] = await seedThree();
    await archiveWallet(gcash.id);
    __setTierForTests("free");
    await renderNew();

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "Maya");
    fireEvent.press(screen.getByTestId("wallet-form-type-e-wallet"));
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    // Spec §Free vs Plus: "The cap counts active (non-archived) Wallets only,
    // so archiving an old Wallet frees a slot; this keeps the gate about
    // breadth, never about data."
    await waitFor(async () => {
      expect(await listWallets()).toHaveLength(3);
    });
    expect(screen.queryByTestId("upgrade-sheet")).toBeNull();
  });

  test("the cap NEVER hides or deletes existing wallets", async () => {
    const seeded = await seedThree();
    const before = await listWallets();
    __setTierForTests("free");
    await renderNew();

    fireEvent.press(screen.getByTestId("wallet-form-submit"));
    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "Maya");
    fireEvent.press(screen.getByTestId("wallet-form-type-e-wallet"));
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("upgrade-sheet")).toBeTruthy();
    });
    // Every wallet, byte-identical, balances and all. The gate is about
    // breadth, never about data (docs/05-monetization.md §3.1 principle 1).
    expect(await listWallets()).toEqual(before);
    for (const wallet of seeded) {
      expect(await getWallet(wallet.id)).not.toBeNull();
    }
  });

  test("a user who lapses from Plus with four wallets keeps all four", async () => {
    await seedThree();
    await createWallet({ name: "Maya", type: "e-wallet", openingBalance: 40_000 });

    __setTierForTests("free");

    // Spec: "a user who lapses from Plus with more than 3 active Wallets keeps
    // them all read-and-track (ingest continues) but cannot add more."
    expect(await listWallets()).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// app/wallet/[id]/edit.tsx — editing, and the matcher move
// ---------------------------------------------------------------------------

describe("editing a wallet", () => {
  let gcash: Wallet;

  beforeEach(async () => {
    gcash = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100_000 });
  });

  test("prefills from the stored wallet and saves a rename", async () => {
    await renderEdit(gcash.id);
    expect(screen.getByTestId("wallet-form-name").props.value).toBe("GCash");

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "GCash Main");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    await waitFor(async () => {
      expect((await getWallet(gcash.id))?.name).toBe("GCash Main");
    });
  });

  test("a rename never touches the balance", async () => {
    await renderEdit(gcash.id);

    fireEvent.changeText(screen.getByTestId("wallet-form-name"), "GCash Main");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    await waitFor(async () => {
      expect((await getWallet(gcash.id))?.name).toBe("GCash Main");
    });
    // `updateWallet` refuses to patch `balance`; the form must not find another
    // way to. A balance is the ledger's running total, moved only by the
    // transaction that explains the move.
    expect((await getWallet(gcash.id))?.balance).toBe(100_000);
  });

  test("prefills the matchers the wallet already holds", async () => {
    await setMatchers(gcash.id, [{ packageName: GCASH_PACKAGE, hint: "GSave" }]);
    await renderEdit(gcash.id);

    await waitFor(() => {
      expect(screen.getByTestId("matcher-hint-gcash").props.value).toBe("GSave");
    });
  });
});

describe("a matcher pair belongs to exactly one wallet", () => {
  let gcash: Wallet;
  let savings: Wallet;

  beforeEach(async () => {
    gcash = await createWallet({ name: "GCash", type: "e-wallet" });
    savings = await createWallet({ name: "GSave", type: "savings" });
    await setMatchers(gcash.id, [{ packageName: GCASH_PACKAGE }]);
  });

  test("the edit screen warns before moving a pair off another wallet", async () => {
    await renderEdit(savings.id);
    await waitFor(() => expect(screen.getByTestId("matcher-provider-gcash")).toBeTruthy());

    fireEvent.press(screen.getByTestId("matcher-provider-gcash"));

    await waitFor(() => {
      const warning = screen.getByTestId("matcher-conflict-gcash");
      expect(warning).toHaveTextContent(/GCash/);
      expect(warning).toHaveTextContent(/move/i);
    });
  });

  test("saving MOVES the pair — one wallet claims it, never two", async () => {
    await renderEdit(savings.id);
    await waitFor(() => expect(screen.getByTestId("matcher-provider-gcash")).toBeTruthy());

    fireEvent.press(screen.getByTestId("matcher-provider-gcash"));
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    await waitFor(async () => {
      expect(await listMatchers(savings.id)).toHaveLength(1);
    });
    // The assertion the pipeline depends on. Two rows here and `resolveWallet`
    // sees two distinct targets, returns `walletId: null`, and every future
    // GCash capture hard-routes to the Review Queue.
    expect(await listMatchers()).toHaveLength(1);
    expect(await listMatchers(gcash.id)).toEqual([]);
  });

  test("a sub-account hint lets both wallets keep the provider", async () => {
    await renderEdit(savings.id);
    await waitFor(() => expect(screen.getByTestId("matcher-provider-gcash")).toBeTruthy());

    fireEvent.press(screen.getByTestId("matcher-provider-gcash"));
    fireEvent.changeText(screen.getByTestId("matcher-hint-gcash"), "GSave");
    fireEvent.press(screen.getByTestId("wallet-form-submit"));

    await waitFor(async () => {
      expect(await listMatchers()).toHaveLength(2);
    });
    // GCash main keeps the provider-wide row; GSave takes the hinted one. This
    // is the arrangement the `hint` column exists for, and the move rule must
    // not eat it.
    expect(await listMatchers(gcash.id)).toHaveLength(1);
    expect((await listMatchers(savings.id))[0].hint).toBe("GSave");
  });
});

// ---------------------------------------------------------------------------
// app/wallet/[id].tsx — the actions Task 4 deferred to here
// ---------------------------------------------------------------------------

describe("the wallet detail actions", () => {
  test("a cash wallet offers reconciliation", async () => {
    const cash = await createWallet({ name: "Pocket", type: "cash", openingBalance: 50_000 });

    await renderDetail(cash.id);

    expect(screen.getByTestId("wallet-detail-reconcile")).toBeTruthy();
  });

  test.each(["bank", "e-wallet", "credit", "savings"] as const)(
    "a %s wallet does not",
    async (type) => {
      const wallet = await createWallet({ name: `A ${type}`, type });

      await renderDetail(wallet.id);

      // Rule 6. A non-cash balance is re-anchored by the provider's own
      // reported figure; a typed adjustment there would fight the next snap.
      expect(screen.queryByTestId("wallet-detail-reconcile")).toBeNull();
    },
  );

  test("archiving from the detail screen keeps the transactions by default", async () => {
    const gcash = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100_000 });
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 10_000,
      direction: "out",
      occurredAt: 1_786_000_000_000,
      source: "manual",
      confidence: 1,
    });
    await renderDetail(gcash.id);

    fireEvent.press(screen.getByTestId("wallet-detail-archive"));
    fireEvent.press(screen.getByTestId("archive-confirm"));

    await waitFor(async () => {
      expect((await getWallet(gcash.id))?.isArchived).toBe(true);
    });
    // The wallet is retired; its history is exactly where it was. Nothing is
    // deleted and nothing has moved (invariant 4).
    expect((await getTransaction(tx.id))?.walletId).toBe(gcash.id);
  });

  test("archiving with a chosen destination moves the transactions there", async () => {
    const gcash = await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 100_000 });
    const bpi = await createWallet({ name: "BPI", type: "bank" });
    const tx = await insertTransaction({
      walletId: gcash.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 10_000,
      direction: "out",
      occurredAt: 1_786_000_000_000,
      source: "manual",
      confidence: 1,
    });
    await renderDetail(gcash.id);

    fireEvent.press(screen.getByTestId("wallet-detail-archive"));
    fireEvent.press(screen.getByTestId("archive-move-transactions"));
    fireEvent.press(screen.getByTestId(`archive-target-${bpi.id}`));
    fireEvent.press(screen.getByTestId("archive-confirm"));

    await waitFor(async () => {
      expect((await getTransaction(tx.id))?.walletId).toBe(bpi.id);
    });
    expect((await getWallet(gcash.id))?.isArchived).toBe(true);
  });

  test("the detail screen offers no delete", async () => {
    const gcash = await createWallet({ name: "GCash", type: "e-wallet" });

    await renderDetail(gcash.id);

    // Invariant 4, and there is no `deleteWallet` in the repository to call.
    expect(screen.queryByTestId("wallet-detail-delete")).toBeNull();
  });

  test("editing navigates to the edit route", async () => {
    const gcash = await createWallet({ name: "GCash", type: "e-wallet" });

    await renderDetail(gcash.id);
    fireEvent.press(screen.getByTestId("wallet-detail-edit"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/wallet/[id]/edit",
      params: { id: gcash.id },
    });
  });
});
