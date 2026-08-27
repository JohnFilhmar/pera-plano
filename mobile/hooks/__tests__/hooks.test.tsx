// hooks/__tests__/hooks.test.tsx — m1c plan Task 3.
//
// Every hook here is a thin wrapper: one key from constants/query_keys.ts plus
// one repository call. That thinness is what these tests defend, and two of the
// properties below are money-correctness rules rather than tidiness:
//
//   RETRY 0. A retried write double-posts money. lib/query_client.ts sets
//   `mutations.retry: 0` and no hook may override it. The retry suite asserts
//   the value RESOLVES to 0 through the real client's defaults — the test
//   client is built from `queryClient.getDefaultOptions()`, so raising the
//   shipped default later breaks these tests instead of silently shipping.
//
//   NARROWEST SUFFICIENT INVALIDATION. `invalidateQueries()` with no key makes
//   every screen refetch on every notification — visible jank on a mid-range
//   phone at the exact moment a user is watching a balance move. Each mutation
//   names its keys, and the suite asserts both what IS invalidated and what is
//   deliberately left alone.
//
// `use_reconcile_cash` is NOT here. Every other hook is a thin wrapper; cash
// reconciliation is not — adjusting a cash balance has to write an adjustment
// transaction so the ledger still explains the number, and that shape is m1c
// Task 5's design work. A thin hook over an unspecified `reconcileCash` would
// be a guess with a nice name.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { queryKeys } from "@/constants/query_keys";
import { closeDatabase, getDatabase } from "@/lib/db/database";
import {
  listCategories,
  seedDefaultCategories,
  UNCATEGORIZED_ID,
} from "@/lib/db/repos/categories_repo";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import {
  RAW_CAPTURE_TTL_MS,
  storeRawCapture,
} from "@/lib/db/repos/raw_notifications_repo";
import { countOpen, enqueue } from "@/lib/db/repos/review_queue_repo";
import * as transactionsRepo from "@/lib/db/repos/transactions_repo";
import { getTransaction, insertTransaction } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import {
  archiveWallet,
  getWallet,
  createWallet,
  listWallets,
} from "@/lib/db/repos/wallets_repo";
import { DEFAULT_TUNABLES } from "@/lib/ingest/ruleset_types";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { Transaction, Wallet } from "@/types/domain";

import { useBalanceDrift, useBalanceDrifts } from "../queries/use_balance_drift";
import { useCategories } from "../queries/use_categories";
import { useReviewCount, REVIEW_COUNT_POLL_MS } from "../queries/use_review_count";
import { useReviewKindCounts } from "../queries/use_review_kind_counts";
import { useReviewQueue } from "../queries/use_review_queue";
import { useReviewQueuePage } from "../queries/use_review_queue_page";
import { useRuleset } from "../queries/use_ruleset";
import { useRawCapture, useRawCaptureExpiry } from "../queries/use_raw_capture";
import { useTransaction } from "../queries/use_transaction";
import { useTransactions } from "../queries/use_transactions";
import { useWallet } from "../queries/use_wallet";
import { useWalletMatchers } from "../queries/use_wallet_matchers";
import { useWallets } from "../queries/use_wallets";

import { useArchiveWallet } from "../mutations/use_archive_wallet";
import { useCreateTransaction } from "../mutations/use_create_transaction";
import { useCreateWallet } from "../mutations/use_create_wallet";
import { useDismissDrift } from "../mutations/use_dismiss_drift";
import { useLinkTransfer } from "../mutations/use_link_transfer";
import { useResolveReviewItem } from "../mutations/use_resolve_review_item";
import { useUnlinkTransfer } from "../mutations/use_unlink_transfer";
import { useCreateUserRule } from "../mutations/use_create_user_rule";
import { useUpdateTransaction } from "../mutations/use_update_transaction";
import { useUpdateWallet } from "../mutations/use_update_wallet";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * A fresh cache carrying THE APP'S OWN default options, spread in from
 * `lib/query_client.ts`. `mutations.retry` is inherited, never restated — that
 * inheritance is the whole point of the retry suite below, so raising the
 * shipped default has to break these tests. NEVER hand-write
 * `mutations: { retry: 0 }` here; it would turn the suite into a tautology.
 *
 * The overrides are test-harness concerns only:
 *   - `queries.retry: 0` — a failing read must fail fast, not burn three
 *     exponential-backoff retries.
 *   - `queries.staleTime: 0` — an invalidated read must count as stale.
 *   - `queries.gcTime: Infinity` — no collection timer at all (React Query
 *     skips scheduling for a non-finite gcTime).
 *   - `mutations.gcTime: 0` — the default is five MINUTES, and every fired
 *     mutation schedules a collection timeout that long. Across this file that
 *     is dozens of live timers at teardown, which makes the Jest worker hang
 *     past the end of the run and get force-exited.
 */
function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    ...defaults,
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, staleTime: 0, gcTime: Infinity },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** The `retry` the client actually resolved for the most recent mutation. */
function resolvedRetryOfLastMutation(client: QueryClient): unknown {
  const mutations = client.getMutationCache().getAll();
  expect(mutations.length).toBeGreaterThan(0);
  return mutations[mutations.length - 1].options.retry;
}

/** The `refetchInterval` the client resolved for a rendered query. */
function resolvedRefetchInterval(client: QueryClient, key: readonly unknown[]): unknown {
  const query = client.getQueryCache().find({ queryKey: key });
  expect(query).toBeDefined();
  return query?.observers[0]?.options.refetchInterval;
}

function wasInvalidated(client: QueryClient, key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated === true;
}

let client: QueryClient;
let walletA: Wallet;
let walletB: Wallet;
let txA: Transaction;
let categoryId: string;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  categoryId = UNCATEGORIZED_ID;
  walletA = await createWallet({ name: "GCash", openingBalance: 100000 });
  walletB = await createWallet({ name: "Maya", openingBalance: 50000 });
  txA = await insertTransaction({
    walletId: walletA.id,
    categoryId,
    amount: 15000,
    direction: "out",
    occurredAt: 1000,
    merchant: "Jollibee",
    source: "notification",
    confidence: 0.9,
  });
  client = makeTestClient();
});

afterEach(async () => {
  jest.restoreAllMocks();
  client.clear();
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

describe("query hooks read through the repositories under the shared key factory", () => {
  test("useWallets returns the seeded wallets", async () => {
    const { result } = renderHook(() => useWallets(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((w) => w.id)).toEqual([walletA.id, walletB.id]);
  });

  test("useWallets caches under queryKeys.wallets.list(), not a hand-rolled array", async () => {
    // Every mutation below invalidates by the factory's key. A hook that built
    // its own array would read fine and then never refresh after a write.
    const { result } = renderHook(() => useWallets(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(queryKeys.wallets.list())).toBeDefined();
  });

  test("useWallet returns one wallet, cached under its own detail key", async () => {
    const { result } = renderHook(() => useWallet(walletA.id), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(walletA.id);
    expect(client.getQueryData(queryKeys.wallets.detail(walletA.id))).toBeDefined();
    expect(client.getQueryData(queryKeys.wallets.detail(walletB.id))).toBeUndefined();
  });

  test("useTransactions passes its filter through to the repository", async () => {
    // A dropped filter shows OTHER wallets' money on a wallet-filtered screen —
    // silently, and with every number looking plausible. Asserted at the
    // repository boundary (the filter reached the SQL) AND on the result.
    const spy = jest.spyOn(transactionsRepo, "listTransactions");
    const filter = { walletId: walletA.id, direction: "out" } as const;

    const { result } = renderHook(() => useTransactions(filter), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledWith(filter);
    expect(result.current.data?.map((t) => t.id)).toEqual([txA.id]);
  });

  test("useTransactions filters actually filter — another wallet's rows stay out", async () => {
    const txB = await insertTransaction({
      walletId: walletB.id,
      categoryId,
      amount: 999,
      direction: "out",
      occurredAt: 2000,
      source: "manual",
      confidence: 1,
    });

    const { result } = renderHook(() => useTransactions({ walletId: walletB.id }), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((t) => t.id)).toEqual([txB.id]);
  });

  test("useTransactions keys the cache BY the filter, so two filters cannot collide", async () => {
    const first = renderHook(() => useTransactions({ walletId: walletA.id }), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const second = renderHook(() => useTransactions({ walletId: walletB.id }), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    // Two distinct cache entries. A filter left out of the key would give both
    // screens whichever answer landed first.
    expect(client.getQueryData(queryKeys.transactions.list({ walletId: walletA.id }))).toBeDefined();
    expect(client.getQueryData(queryKeys.transactions.list({ walletId: walletB.id }))).toBeDefined();
    expect(first.result.current.data).not.toEqual(second.result.current.data);
  });

  test("useTransaction returns one transaction by id", async () => {
    const { result } = renderHook(() => useTransaction(txA.id), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.merchant).toBe("Jollibee");
  });

  test("useCategories returns the seeded categories", async () => {
    const { result } = renderHook(() => useCategories(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.length).toBe((await listCategories()).length);
    expect(result.current.data?.some((c) => c.id === UNCATEGORIZED_ID)).toBe(true);
  });

  test("useReviewQueue returns the open items, oldest first", async () => {
    const older = await enqueue({ kind: "low-confidence", payload: { n: 1 } });
    const newer = await enqueue({ kind: "unknown-provider", payload: { n: 2 } });

    const { result } = renderHook(() => useReviewQueue(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((i) => i.id)).toEqual([older.id, newer.id]);
  });

  test("useReviewCount returns the open count", async () => {
    await enqueue({ kind: "low-confidence", payload: {} });
    await enqueue({ kind: "low-confidence", payload: {} });

    const { result } = renderHook(() => useReviewCount(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The archived toggle is part of the cache key (m1c Task 4 widened both)
// ---------------------------------------------------------------------------

describe("useWallets(includeArchived) and queryKeys.wallets.list(includeArchived)", () => {
  // Task 3 shipped `useWallets()` with no options BECAUSE the key took no
  // parameter, and a toggled and untoggled list sharing one cache entry would
  // show each other's data. Task 4 widened the hook and the key together; this
  // block is what keeps them widened.
  let archived: Wallet;

  beforeEach(async () => {
    archived = await createWallet({ name: "Closed BDO" });
    await archiveWallet(archived.id);
  });

  test("defaults to the active wallets only", async () => {
    const { result } = renderHook(() => useWallets(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((w) => w.id)).toEqual([walletA.id, walletB.id]);
  });

  test("includeArchived: true appends the archived tail", async () => {
    const { result } = renderHook(() => useWallets({ includeArchived: true }), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((w) => w.id)).toEqual([walletA.id, walletB.id, archived.id]);
  });

  test("BOTH LISTS DIFFER IN THE SAME RENDER — two cache entries, not one", async () => {
    // The failure this catches is not a wrong list; it is the SAME list twice.
    // Keyed without the flag, whichever query resolved first answers for both,
    // and the Wallets tab's toggle silently does nothing (or, worse, leaves the
    // archived rows on screen after being switched off).
    const { result } = renderHook(
      () => ({ active: useWallets(), all: useWallets({ includeArchived: true }) }),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => {
      expect(result.current.active.isSuccess).toBe(true);
      expect(result.current.all.isSuccess).toBe(true);
    });

    expect(result.current.active.data?.map((w) => w.id)).toEqual([walletA.id, walletB.id]);
    expect(result.current.all.data?.map((w) => w.id)).toEqual([
      walletA.id,
      walletB.id,
      archived.id,
    ]);
    expect(result.current.active.data).not.toEqual(result.current.all.data);
    expect(client.getQueryData(queryKeys.wallets.list(false))).toBeDefined();
    expect(client.getQueryData(queryKeys.wallets.list(true))).toBeDefined();
  });

  test("useWallets() and useWallets({ includeArchived: false }) share ONE entry", async () => {
    // The other half of the key design. A key of `["wallets","list",undefined]`
    // for the bare call and `["wallets","list",false]` for the explicit one
    // means the same list is fetched and stored twice — two rows of the same
    // balances that can disagree after a write invalidates only one of them.
    const { result } = renderHook(
      () => ({ bare: useWallets(), explicit: useWallets({ includeArchived: false }) }),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => {
      expect(result.current.bare.isSuccess).toBe(true);
      expect(result.current.explicit.isSuccess).toBe(true);
    });

    expect(queryKeys.wallets.list()).toEqual(queryKeys.wallets.list(false));
    expect(client.getQueryCache().findAll({ queryKey: queryKeys.wallets.lists() })).toHaveLength(1);
  });

  test("a wallet mutation invalidates BOTH toggle states", async () => {
    // Mutations invalidate the `lists()` PREFIX, not one concrete toggle
    // state. Naming `list(false)` alone would leave a user who is looking at
    // the archived view staring at a list the write already changed.
    client.setQueryData(queryKeys.wallets.list(false), []);
    client.setQueryData(queryKeys.wallets.list(true), []);

    const { result } = renderHook(() => useCreateWallet(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({ name: "Cash on hand" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(wasInvalidated(client, queryKeys.wallets.list(false))).toBe(true);
    expect(wasInvalidated(client, queryKeys.wallets.list(true))).toBe(true);
    // Still narrow: a wallet's own detail is untouched by a different wallet
    // being created.
    expect(wasInvalidated(client, queryKeys.wallets.detail(walletA.id))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Drift, matchers and the ruleset — the Wallets tab's other three reads
// ---------------------------------------------------------------------------

describe("useBalanceDrift", () => {
  /** Returns the reporting transaction, which IS the drift's identity (003). */
  async function commitReporting(reported: number): Promise<Transaction> {
    return insertTransaction({
      walletId: walletA.id,
      categoryId,
      amount: 5_000,
      direction: "out",
      occurredAt: 2_000,
      source: "notification",
      confidence: 0.9,
      balanceAfter: reported,
    });
  }

  test("returns null — NOT a zero drift — for a wallet that never reported a balance", async () => {
    const { result } = renderHook(() => useBalanceDrift(walletB.id), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  test("returns both figures and the gap between them", async () => {
    // walletA opened at 100_000 and txA took 15_000 out, so the computed
    // expectation after another 5_000 out is 80_000.
    const report = await commitReporting(900_000);

    const { result } = renderHook(() => useBalanceDrift(walletA.id), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      reported: 900_000,
      computed: 80_000,
      drift: 820_000,
      // 003: the row the figures came from, and the one the user has already
      // accepted. The badge compares the two rather than reading a flag.
      reportingTransactionId: report.id,
      dismissedTransactionId: null,
    });
  });

  test("hangs off the wallet's DETAIL key, so committing a transaction refreshes it", async () => {
    // A drift that does not refetch after a commit describes a balance the
    // wallet no longer holds. Nesting the key under `wallets.detail(id)` is
    // what makes the mutations Task 3 already wrote reach it, with no new
    // invalidation to remember.
    expect(queryKeys.wallets.drift(walletA.id).slice(0, 3)).toEqual(
      queryKeys.wallets.detail(walletA.id),
    );

    client.setQueryData(queryKeys.wallets.drift(walletA.id), null);
    const { result } = renderHook(() => useCreateTransaction(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({
        walletId: walletA.id,
        categoryId,
        amount: 1_000,
        direction: "out",
        occurredAt: 6_000,
        source: "manual",
        confidence: 1,
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(wasInvalidated(client, queryKeys.wallets.drift(walletA.id))).toBe(true);
  });

  test("useBalanceDrifts maps each id to its own drift, or to null", async () => {
    const report = await commitReporting(900_000);

    const { result } = renderHook(() => useBalanceDrifts([walletA.id, walletB.id]), {
      wrapper: wrapperFor(client),
    });
    // Awaited on the QUERY STATE, not on the mapped value: a still-loading
    // entry deliberately maps to `null` (never render a disagreement you have
    // not confirmed), which is indistinguishable from a wallet that has no
    // reported balance. Only the cache can tell those two apart.
    await waitFor(() => {
      expect(client.getQueryState(queryKeys.wallets.drift(walletA.id))?.status).toBe("success");
      expect(client.getQueryState(queryKeys.wallets.drift(walletB.id))?.status).toBe("success");
    });

    expect(result.current[walletA.id]).toEqual({
      reported: 900_000,
      computed: 80_000,
      drift: 820_000,
      reportingTransactionId: report.id,
      dismissedTransactionId: null,
    });
    expect(result.current[walletB.id]).toBeNull();
  });

  test("useBalanceDrifts with no ids issues no queries", async () => {
    const { result } = renderHook(() => useBalanceDrifts([]), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current).toEqual({}));
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe("useRuleset", () => {
  test("returns null when the device has no ruleset installed", async () => {
    const { result } = renderHook(() => useRuleset(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  test("returns the installed bundle with its tunables completed from the defaults", async () => {
    // The drift tolerance is the tunable the Wallets tab reads. A payload that
    // overrides nothing still has to arrive with a usable value.
    await upsertRuleset({ version: 1, providers: [] });

    const { result } = renderHook(() => useRuleset(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tunables.balanceDriftToleranceCentavos).toBe(
      DEFAULT_TUNABLES.balanceDriftToleranceCentavos,
    );
  });

  test("carries a retuned tolerance through unchanged", async () => {
    await upsertRuleset({
      version: 2,
      providers: [],
      tunables: { balanceDriftToleranceCentavos: 12_345 },
    });

    const { result } = renderHook(() => useRuleset(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tunables.balanceDriftToleranceCentavos).toBe(12_345);
  });
});

describe("useWalletMatchers", () => {
  async function insertMatcher(walletId: string, hint: string | null): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO wallet_matchers (id, wallet_id, package_name, hint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`m-${walletId}-${hint ?? "main"}`, walletId, "com.globe.gcash.android", hint, 1_000, 1_000],
    );
  }

  test("returns only the given wallet's matchers", async () => {
    await insertMatcher(walletA.id, null);
    await insertMatcher(walletB.id, "GSave");

    const { result } = renderHook(() => useWalletMatchers(walletA.id), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((m) => m.walletId)).toEqual([walletA.id]);
  });

  test("hangs off the wallet's detail key too", async () => {
    expect(queryKeys.wallets.matchers(walletA.id).slice(0, 3)).toEqual(
      queryKeys.wallets.detail(walletA.id),
    );
  });
});

// ---------------------------------------------------------------------------
// Only ONE hook may poll
// ---------------------------------------------------------------------------

const QUERY_HOOK_NAMES = [
  "useWallets",
  "useWallet",
  "useBalanceDrift",
  "useWalletMatchers",
  "useRuleset",
  "useTransactions",
  "useTransaction",
  "useCategories",
  "useReviewQueue",
  "useReviewQueuePage",
  "useReviewKindCounts",
  "useReviewCount",
] as const;

type QueryHookName = (typeof QUERY_HOOK_NAMES)[number];

/** Built inside a test body, because the detail keys need the seeded ids. */
function queryHookCases(): Record<QueryHookName, { key: readonly unknown[]; render: () => { isSuccess: boolean } }> {
  return {
    useWallets: { key: queryKeys.wallets.list(), render: () => useWallets() },
    useWallet: { key: queryKeys.wallets.detail(walletA.id), render: () => useWallet(walletA.id) },
    useBalanceDrift: {
      key: queryKeys.wallets.drift(walletA.id),
      render: () => useBalanceDrift(walletA.id),
    },
    useWalletMatchers: {
      key: queryKeys.wallets.matchers(walletA.id),
      render: () => useWalletMatchers(walletA.id),
    },
    useRuleset: { key: queryKeys.ruleset.active(), render: () => useRuleset() },
    useTransactions: { key: queryKeys.transactions.list({}), render: () => useTransactions({}) },
    useTransaction: {
      key: queryKeys.transactions.detail(txA.id),
      render: () => useTransaction(txA.id),
    },
    useCategories: { key: queryKeys.categories.list(), render: () => useCategories() },
    useReviewQueue: { key: queryKeys.reviewQueue.open(), render: () => useReviewQueue() },
    // The queue screen's own two reads. They back chips and cards on a screen
    // the user is already looking at, and every change to their numbers comes
    // from a triage action that invalidates `reviewQueue.all` on success — so
    // neither may ever grow a timer of its own.
    useReviewQueuePage: {
      key: queryKeys.reviewQueue.page(null),
      render: () => useReviewQueuePage(),
    },
    useReviewKindCounts: {
      key: queryKeys.reviewQueue.kindCounts(),
      render: () => useReviewKindCounts(),
    },
    useReviewCount: { key: queryKeys.reviewQueue.count(), render: () => useReviewCount() },
  };
}

describe("useReviewCount is the ONLY hook that polls", () => {
  // Rule 4: the review count drives the tab badge, so it alone gets a 30 s
  // refetchInterval. Every extra poller wakes the database behind a lock
  // screen, on battery, forever — a cost paid by every user for a screen
  // nobody is looking at.
  test.each(QUERY_HOOK_NAMES)("%s", async (name) => {
    const testCase = queryHookCases()[name];
    const { result } = renderHook(testCase.render, { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const interval = resolvedRefetchInterval(client, testCase.key);
    if (name === "useReviewCount") {
      expect(interval).toBe(REVIEW_COUNT_POLL_MS);
      expect(REVIEW_COUNT_POLL_MS).toBe(30_000);
    } else {
      expect(interval).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Mutations — behavior
// ---------------------------------------------------------------------------

describe("useCreateWallet", () => {
  test("inserts the wallet AND invalidates the wallet list", async () => {
    // Inserting without invalidating leaves the list showing stale data until
    // something unrelated happens to refetch it — the new wallet simply is not
    // there, and nothing looks broken.
    client.setQueryData(queryKeys.wallets.list(), []);

    const { result } = renderHook(() => useCreateWallet(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({ name: "Cash on hand" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect((await listWallets()).map((w) => w.name)).toContain("Cash on hand");
    expect(wasInvalidated(client, queryKeys.wallets.list())).toBe(true);
  });
});

describe("useUpdateWallet", () => {
  test("renames the wallet and invalidates the list and THAT wallet's detail only", async () => {
    client.setQueryData(queryKeys.wallets.list(), []);
    client.setQueryData(queryKeys.wallets.detail(walletA.id), walletA);
    client.setQueryData(queryKeys.wallets.detail(walletB.id), walletB);

    const { result } = renderHook(() => useUpdateWallet(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({ id: walletA.id, patch: { name: "GCash Main" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect((await getWallet(walletA.id))?.name).toBe("GCash Main");
    expect(wasInvalidated(client, queryKeys.wallets.list())).toBe(true);
    expect(wasInvalidated(client, queryKeys.wallets.detail(walletA.id))).toBe(true);
    expect(wasInvalidated(client, queryKeys.wallets.detail(walletB.id))).toBe(false);
  });
});

describe("useArchiveWallet", () => {
  test("archives without deleting and invalidates the wallets the user can see", async () => {
    client.setQueryData(queryKeys.wallets.list(), []);
    client.setQueryData(queryKeys.wallets.detail(walletA.id), walletA);

    const { result } = renderHook(() => useArchiveWallet(), { wrapper: wrapperFor(client) });
    await act(async () => {
      // Task 5 widened the variables to carry the transaction choice; an
      // omitted `moveTransactionsTo` is the default "keep them here".
      result.current.mutate({ id: walletA.id });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Archived, not gone — and its transaction is still attached to it.
    expect((await getWallet(walletA.id))?.isArchived).toBe(true);
    expect((await getTransaction(txA.id))?.walletId).toBe(walletA.id);
    expect(wasInvalidated(client, queryKeys.wallets.list())).toBe(true);
    expect(wasInvalidated(client, queryKeys.wallets.detail(walletA.id))).toBe(true);
  });
});

describe("useDismissDrift", () => {
  async function reportingTransaction(walletId: string): Promise<Transaction> {
    return insertTransaction({
      walletId,
      categoryId,
      amount: 5_000,
      direction: "out",
      occurredAt: 2_000,
      source: "notification",
      confidence: 0.9,
      balanceAfter: 900_000,
    });
  }

  test("records the dismissal and refreshes the badge's own cache slot", async () => {
    // The drift key nests UNDER the wallet's detail key, so naming the detail
    // key reaches it — and reaches the SAME per-wallet slot `useBalanceDrifts`
    // uses for the Wallets-tab row, which is why both badges go quiet together.
    const report = await reportingTransaction(walletA.id);
    client.setQueryData(queryKeys.wallets.drift(walletA.id), null);
    client.setQueryData(queryKeys.wallets.detail(walletB.id), walletB);

    const { result } = renderHook(() => useDismissDrift(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({ walletId: walletA.id, transactionId: report.id });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect((await getWallet(walletA.id))?.driftDismissedTransactionId).toBe(report.id);
    expect(wasInvalidated(client, queryKeys.wallets.drift(walletA.id))).toBe(true);
    // Still narrow: another wallet's screen has no reason to refetch because
    // this one's warning was acknowledged.
    expect(wasInvalidated(client, queryKeys.wallets.detail(walletB.id))).toBe(false);
  });

  test("stores the id it was GIVEN, not whatever is newest at the moment it runs", async () => {
    // The user dismisses the drift they were shown. If a notification commits
    // between the render and the tap, re-reading here would silence a
    // disagreement they were never shown; storing the older id they did see
    // leaves the newer one to speak for itself.
    const seen = await reportingTransaction(walletA.id);
    const arrivedAfterTheRender = await reportingTransaction(walletA.id);

    const { result } = renderHook(() => useDismissDrift(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({ walletId: walletA.id, transactionId: seen.id });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect((await getWallet(walletA.id))?.driftDismissedTransactionId).toBe(seen.id);
    expect((await getWallet(walletA.id))?.driftDismissedTransactionId).not.toBe(
      arrivedAfterTheRender.id,
    );
  });
});

describe("useCreateTransaction", () => {
  async function createTransactionInto(walletId: string): Promise<void> {
    const { result } = renderHook(() => useCreateTransaction(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({
        walletId,
        categoryId,
        amount: 25000,
        direction: "out",
        occurredAt: 5000,
        source: "manual",
        confidence: 1,
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  }

  function seedCache(): void {
    client.setQueryData(queryKeys.transactions.list({}), []);
    client.setQueryData(queryKeys.wallets.list(), []);
    client.setQueryData(queryKeys.wallets.detail(walletA.id), walletA);
    client.setQueryData(queryKeys.wallets.detail(walletB.id), walletB);
    client.setQueryData(queryKeys.reviewQueue.count(), 0);
    client.setQueryData(queryKeys.categories.list(), []);
  }

  test("inserts the transaction and moves the wallet balance", async () => {
    await createTransactionInto(walletA.id);
    expect((await getWallet(walletA.id))?.balance).toBe(100000 - 15000 - 25000);
  });

  test("invalidates the ledger AND the affected wallet's detail", async () => {
    seedCache();
    await createTransactionInto(walletA.id);

    expect(wasInvalidated(client, queryKeys.transactions.list({}))).toBe(true);
    expect(wasInvalidated(client, queryKeys.wallets.detail(walletA.id))).toBe(true);
  });

  test("leaves an UNAFFECTED wallet's detail alone", async () => {
    // The narrowness half of Rule 2, and the half a blanket invalidation
    // passes by accident: money moved in wallet A, so only wallet A refetches.
    seedCache();
    await createTransactionInto(walletA.id);

    expect(wasInvalidated(client, queryKeys.wallets.detail(walletB.id))).toBe(false);
  });

  test("invalidates the wallet list, whose rows carry the balance that just moved", async () => {
    seedCache();
    await createTransactionInto(walletA.id);
    expect(wasInvalidated(client, queryKeys.wallets.list())).toBe(true);
  });

  test("invalidates the review-queue count", async () => {
    seedCache();
    await createTransactionInto(walletA.id);
    expect(wasInvalidated(client, queryKeys.reviewQueue.count())).toBe(true);
  });

  test("does NOT invalidate the whole cache", async () => {
    // The specific failure this catches is `invalidateQueries()` with no key at
    // all: every screen in the app refetches on every incoming notification.
    // Categories cannot be changed by committing a transaction, so a category
    // cache entry that went stale here can only have been carpet-bombed.
    seedCache();
    await createTransactionInto(walletA.id);

    expect(wasInvalidated(client, queryKeys.categories.list())).toBe(false);
    expect(client.getQueryData(queryKeys.categories.list())).toEqual([]);
  });
});

describe("useUpdateTransaction", () => {
  test("edits the transaction and invalidates the ledger and the wallet family", async () => {
    client.setQueryData(queryKeys.transactions.list({}), []);
    client.setQueryData(queryKeys.categories.list(), []);
    client.setQueryData(queryKeys.wallets.detail(walletA.id), walletA);

    const { result } = renderHook(() => useUpdateTransaction(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({ id: txA.id, patch: { amount: 20000 } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect((await getTransaction(txA.id))?.amount).toBe(20000);
    expect((await getWallet(walletA.id))?.balance).toBe(100000 - 20000);
    expect(wasInvalidated(client, queryKeys.transactions.list({}))).toBe(true);
    expect(wasInvalidated(client, queryKeys.wallets.detail(walletA.id))).toBe(true);
    expect(wasInvalidated(client, queryKeys.categories.list())).toBe(false);
  });

  test("a wallet move invalidates BOTH wallets — the origin id is not on the row it returns", async () => {
    client.setQueryData(queryKeys.wallets.detail(walletA.id), walletA);
    client.setQueryData(queryKeys.wallets.detail(walletB.id), walletB);

    const { result } = renderHook(() => useUpdateTransaction(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({ id: txA.id, patch: { walletId: walletB.id } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect((await getWallet(walletA.id))?.balance).toBe(100000);
    expect((await getWallet(walletB.id))?.balance).toBe(50000 - 15000);
    expect(wasInvalidated(client, queryKeys.wallets.detail(walletA.id))).toBe(true);
    expect(wasInvalidated(client, queryKeys.wallets.detail(walletB.id))).toBe(true);
  });
});

describe("useResolveReviewItem", () => {
  test("decrements useReviewCount", async () => {
    await enqueue({ kind: "low-confidence", payload: {} });
    const second = await enqueue({ kind: "unknown-provider", payload: {} });

    const wrapper = wrapperFor(client);
    const count = renderHook(() => useReviewCount(), { wrapper });
    await waitFor(() => expect(count.result.current.data).toBe(2));

    const resolveItem = renderHook(() => useResolveReviewItem(), { wrapper });
    await act(async () => {
      resolveItem.result.current.mutate({ id: second.id, resolution: "confirmed" });
    });
    await waitFor(() => expect(resolveItem.result.current.isSuccess).toBe(true));

    expect(await countOpen()).toBe(1);
    // The badge itself must move, not just the database behind it.
    await waitFor(() => expect(count.result.current.data).toBe(1));
  });

  test("leaves the ledger alone — resolving an item commits nothing by itself", async () => {
    const item = await enqueue({ kind: "low-confidence", payload: {} });
    client.setQueryData(queryKeys.transactions.list({}), []);

    const { result } = renderHook(() => useResolveReviewItem(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({ id: item.id, resolution: "dismissed" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(wasInvalidated(client, queryKeys.transactions.list({}))).toBe(false);
  });
});

describe("useLinkTransfer / useUnlinkTransfer", () => {
  async function makeInLeg(): Promise<Transaction> {
    return insertTransaction({
      walletId: walletB.id,
      categoryId,
      amount: 15000,
      direction: "in",
      occurredAt: 1001,
      source: "notification",
      confidence: 0.9,
    });
  }

  test("useLinkTransfer stamps both legs and invalidates the ledger", async () => {
    const inLeg = await makeInLeg();
    client.setQueryData(queryKeys.transactions.list({}), []);
    client.setQueryData(queryKeys.wallets.detail(walletA.id), walletA);

    const { result } = renderHook(() => useLinkTransfer(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({
        outTransactionId: txA.id,
        inTransactionId: inLeg.id,
        feeAmount: 0,
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect((await getTransaction(txA.id))?.transferLinkId).not.toBeNull();
    expect((await getTransaction(inLeg.id))?.transferLinkId).not.toBeNull();
    expect(wasInvalidated(client, queryKeys.transactions.list({}))).toBe(true);
    // Linking moves no money — it only takes both legs out of spend totals —
    // so the wallet balances, and their cache entries, are untouched.
    expect(wasInvalidated(client, queryKeys.wallets.detail(walletA.id))).toBe(false);
  });

  test("useUnlinkTransfer restores both legs and invalidates the ledger", async () => {
    const inLeg = await makeInLeg();
    const link = renderHook(() => useLinkTransfer(), { wrapper: wrapperFor(client) });
    await act(async () => {
      link.result.current.mutate({
        outTransactionId: txA.id,
        inTransactionId: inLeg.id,
        feeAmount: 0,
      });
    });
    await waitFor(() => expect(link.result.current.isSuccess).toBe(true));
    const linkId = (await getTransaction(txA.id))?.transferLinkId;
    expect(linkId).toBeTruthy();

    client.setQueryData(queryKeys.transactions.list({}), []);
    const unlink = renderHook(() => useUnlinkTransfer(), { wrapper: wrapperFor(client) });
    await act(async () => {
      unlink.result.current.mutate(linkId as string);
    });
    await waitFor(() => expect(unlink.result.current.isSuccess).toBe(true));

    expect((await getTransaction(txA.id))?.transferLinkId).toBeNull();
    expect((await getTransaction(inLeg.id))?.transferLinkId).toBeNull();
    expect(wasInvalidated(client, queryKeys.transactions.list({}))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mutations — the two rules, parametrized over EVERY mutation hook
// ---------------------------------------------------------------------------

const MUTATION_HOOK_NAMES = [
  "useCreateWallet",
  "useUpdateWallet",
  "useArchiveWallet",
  "useDismissDrift",
  "useCreateTransaction",
  "useUpdateTransaction",
  "useResolveReviewItem",
  "useLinkTransfer",
  "useUnlinkTransfer",
  "useCreateUserRule",
] as const;

type MutationHookName = (typeof MUTATION_HOOK_NAMES)[number];

/**
 * Renders one mutation hook and fires it with valid arguments against the
 * seeded database. Built inside a test body — the arguments need the ids the
 * fixture created.
 */
function mutationCases(): Record<MutationHookName, () => Promise<void>> {
  const wrapper = wrapperFor(client);

  async function fire<TVariables>(
    use: () => { mutate: (variables: TVariables) => void; isSuccess: boolean },
    variables: TVariables,
  ): Promise<void> {
    const { result } = renderHook(use, { wrapper });
    await act(async () => {
      result.current.mutate(variables);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  }

  return {
    useCreateWallet: () => fire(useCreateWallet, { name: "Cash on hand" as const }),
    useUpdateWallet: () => fire(useUpdateWallet, { id: walletA.id, patch: { name: "Renamed" } }),
    useArchiveWallet: () => fire(useArchiveWallet, { id: walletB.id }),
    useDismissDrift: async () => {
      const report = await insertTransaction({
        walletId: walletA.id,
        categoryId,
        amount: 5_000,
        direction: "out",
        occurredAt: 2_000,
        source: "notification",
        confidence: 0.9,
        balanceAfter: 900_000,
      });
      await fire(useDismissDrift, { walletId: walletA.id, transactionId: report.id });
    },
    useCreateTransaction: () =>
      fire(useCreateTransaction, {
        walletId: walletA.id,
        categoryId,
        amount: 1000,
        direction: "out" as const,
        occurredAt: 5000,
        source: "manual" as const,
        confidence: 1,
      }),
    useUpdateTransaction: () => fire(useUpdateTransaction, { id: txA.id, patch: { amount: 111 } }),
    useResolveReviewItem: async () => {
      const item = await enqueue({ kind: "low-confidence", payload: {} });
      await fire(useResolveReviewItem, { id: item.id, resolution: "confirmed" as const });
    },
    useLinkTransfer: async () => {
      const inLeg = await insertTransaction({
        walletId: walletB.id,
        categoryId,
        amount: 15000,
        direction: "in",
        occurredAt: 1001,
        source: "manual",
        confidence: 1,
      });
      await fire(useLinkTransfer, {
        outTransactionId: txA.id,
        inTransactionId: inLeg.id,
        feeAmount: 0,
      });
    },
    useUnlinkTransfer: async () => {
      const inLeg = await insertTransaction({
        walletId: walletB.id,
        categoryId,
        amount: 15000,
        direction: "in",
        occurredAt: 1001,
        source: "manual",
        confidence: 1,
      });
      const link = await linkTransfer(txA.id, inLeg.id, 0);
      await fire(useUnlinkTransfer, link.id);
    },
    useCreateUserRule: () =>
      fire(useCreateUserRule, {
        matcher: { merchantPattern: "Jollibee" },
        action: { kind: "set-category" as const, categoryId },
        createdFrom: txA.id,
      }),
  };
}

describe("Rule 3 — every mutation hook resolves retry to 0", () => {
  // A retried write double-posts money. This asserts the RESOLVED value, not
  // the absence of an override, and the test client inherits its mutation
  // defaults straight from lib/query_client.ts — so raising the shipped
  // default breaks these eight tests rather than shipping quietly.
  test.each(MUTATION_HOOK_NAMES)("%s", async (name) => {
    await mutationCases()[name]();
    expect(resolvedRetryOfLastMutation(client)).toBe(0);
  });
});

describe("Rule 2 — no mutation hook invalidates the whole cache", () => {
  // `invalidateQueries()` with no argument matches every query there is. One
  // hook doing it undoes the narrow keying of all the others.
  test.each(MUTATION_HOOK_NAMES)("%s names its keys", async (name) => {
    const spy = jest.spyOn(client, "invalidateQueries");
    await mutationCases()[name]();

    expect(spy).toHaveBeenCalled();
    for (const [filters] of spy.mock.calls) {
      expect(filters?.queryKey).toBeDefined();
      expect(filters?.queryKey?.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The raw-capture reads behind the "Why was this recorded?" panel (m1c Task 7)
//
// TWO HOOKS OVER ONE ROW, ON PURPOSE. `RawCapture` is interface-contract §4 —
// the shape the Kotlin listener hands across the native bridge — and carries no
// expiry. Rather than widening a native contract for one screen, the expiry has
// its own accessor and its own hook.
// ---------------------------------------------------------------------------

describe("useRawCapture / useRawCaptureExpiry", () => {
  const CAPTURE_ID = "cap-detail-1";
  const STORED_AT = 1_800_000_000_000;

  async function storeOne(): Promise<void> {
    await storeRawCapture(
      {
        id: CAPTURE_ID,
        packageName: "com.globe.gcash.android",
        title: "GCash",
        text: "You have sent PHP 500.00 to JUAN D.",
        subText: null,
        bigText: null,
        postedAt: STORED_AT - 30 * 24 * 60 * 60 * 1000,
        capturedAt: STORED_AT - 30 * 24 * 60 * 60 * 1000,
      },
      STORED_AT,
    );
  }

  test("useRawCapture reads the stored capture under its own key", async () => {
    await storeOne();
    const { result } = renderHook(() => useRawCapture(CAPTURE_ID), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.text).toBe("You have sent PHP 500.00 to JUAN D.");
    expect(client.getQueryCache().find({ queryKey: queryKeys.rawCaptures.detail(CAPTURE_ID) })).toBeDefined();
  });

  test("useRawCaptureExpiry reads the STORED expiry, not capturedAt + the TTL", async () => {
    // The capture is 30 days old and was stored today — a replayed or
    // late-drained batch. Derived from `capturedAt` the panel would announce a
    // deletion that already happened; the stored column is the one the purge
    // actually deletes on.
    await storeOne();
    const { result } = renderHook(() => useRawCaptureExpiry(CAPTURE_ID), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(STORED_AT + RAW_CAPTURE_TTL_MS);
  });

  test("a null id fetches nothing — a transaction with no capture is not an error", async () => {
    // Every manual entry, and every notification row past the 30-day purge.
    const capture = renderHook(() => useRawCapture(null), { wrapper: wrapperFor(client) });
    const expiry = renderHook(() => useRawCaptureExpiry(null), { wrapper: wrapperFor(client) });

    expect(capture.result.current.fetchStatus).toBe("idle");
    expect(expiry.result.current.fetchStatus).toBe("idle");
    expect(capture.result.current.data).toBeUndefined();
  });

  test("a purged id resolves to null rather than throwing", async () => {
    const { result } = renderHook(() => useRawCapture("never-stored"), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
