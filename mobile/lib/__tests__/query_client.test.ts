// lib/__tests__/query_client.test.ts — every default asserted individually
// against the exact STACK_BASIS §6 numbers, especially `mutations.retry: 0`.
// React Query's own default for mutations is already 0, which is exactly why
// this is easy to leave unset and easy for someone later to "improve" by
// adding retries uniformly — a retried mutation double-writes (a duplicate
// ledger transaction, a goal contribution applied twice, a loan payment
// recorded twice). This suite asserts each value, not just "is a number", so
// a millisecond typo or a dropped option fails a specific, named test.
//
// The "encrypted persistence" block below is this file's Task 8 addition:
// it exercises `persistOptions.persister` (the ACTUAL object app/_layout.tsx
// hands to PersistQueryClientProvider) end to end against the real
// AsyncStorage mock, rather than re-testing cache_cipher.ts's own primitives
// (that's cache_cipher.test.ts's job) — the property that matters here is
// that query_client.ts wired the codec in correctly, under the right key,
// with the buster actually bumped.
//
// The two GAP-049 blocks — "only an allowlisted set is dehydrated to disk"
// and "the persisted blob expires with the local day" — are about what
// `persistOptions` lets OUT of the app rather than how it encodes it. They run
// the library's real `dehydrate` and `persistQueryClientRestore` against the
// real exported `persistOptions`, because the whole defect was that this file
// passed no `dehydrateOptions` at all and a test that built its own options
// object would have proven nothing about the app.
//
// The "failure surface" block at the bottom is GAP-013's addition, and it is
// deliberately exercised against the EXPORTED `queryClient` — the same object
// app/_layout.tsx hands to PersistQueryClientProvider — rather than a fresh
// client built for the test. The defect being fixed was not "the handler is
// wrong", it was "there is no handler", and a test that builds its own cache
// would stay green if someone dropped `mutationCache:` from the constructor.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { dehydrate, QueryClient } from "@tanstack/react-query";
import { persistQueryClientRestore } from "@tanstack/react-query-persist-client";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

import { queryKeys } from "@/constants/query_keys";

import {
  persistOptions,
  queryClient,
  setCacheEncryptionKey,
  clearCacheEncryptionKey,
  CacheCipherKeyMissingError,
  clearToasts,
  createMutationErrorCache,
  dismissToast,
  getToasts,
  publishToast,
  subscribeToToasts,
  MAX_QUEUED_TOASTS,
  MUTATION_FAILURE_DEDUPE_KEY,
  MUTATION_FAILURE_TOAST,
  TOAST_DURATION_MS,
} from "../query_client";

// query-async-storage-persister's own documented default `key` option --
// query_client.ts never overrides it, so this is the real on-disk key.
const STORAGE_KEY = "REACT_QUERY_OFFLINE_CACHE";

const KEY = new Uint8Array(32).fill(3);
const MERCHANT = "Jollibee SM Megamall";

function fakePersistedClient(merchant: string): PersistedClient {
  return {
    buster: persistOptions.buster,
    timestamp: Date.now(),
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ["wallets"],
          queryHash: JSON.stringify(["wallets"]),
          state: {
            data: { merchant, balanceCents: 543210 },
            dataUpdateCount: 1,
            dataUpdatedAt: Date.now(),
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: "success",
            fetchStatus: "idle",
          },
        },
      ],
    },
  } as unknown as PersistedClient;
}

describe("query defaults match STACK_BASIS §6", () => {
  const queries = queryClient.getDefaultOptions().queries;

  test("staleTime is exactly 5 minutes in milliseconds", () => {
    expect(queries?.staleTime).toBe(5 * 60 * 1000);
  });

  test("gcTime is exactly 30 minutes in milliseconds", () => {
    expect(queries?.gcTime).toBe(30 * 60 * 1000);
  });

  test("retry is exactly 3", () => {
    expect(queries?.retry).toBe(3);
  });

  test("refetchOnWindowFocus is false", () => {
    expect(queries?.refetchOnWindowFocus).toBe(false);
  });

  test("refetchOnReconnect is true", () => {
    expect(queries?.refetchOnReconnect).toBe(true);
  });
});

test("mutations.retry is exactly 0 — a retried mutation double-writes the ledger", () => {
  expect(queryClient.getDefaultOptions().mutations?.retry).toBe(0);
});

describe("persistOptions", () => {
  test("buster is a non-empty version string for cache-shape breaks", () => {
    expect(typeof persistOptions.buster).toBe("string");
    expect(persistOptions.buster.length).toBeGreaterThan(0);
  });

  test("buster is bumped from the pre-encryption plaintext-cache value -- an old plaintext blob must never be handed to the new encrypted deserialize", () => {
    expect(persistOptions.buster).not.toBe("peraplano-query-cache-v1");
  });

  test("buster is bumped from the persist-everything value -- a v2 blob is the OLD, WIDE set and hydrates perfectly, which is exactly why it must be discarded rather than trusted", () => {
    expect(persistOptions.buster).not.toBe("peraplano-query-cache-v2-encrypted");
  });

  test("persister implements the Persister contract", () => {
    expect(typeof persistOptions.persister.persistClient).toBe("function");
    expect(typeof persistOptions.persister.restoreClient).toBe("function");
    expect(typeof persistOptions.persister.removeClient).toBe("function");
  });
});

/**
 * WHAT MUST NEVER REACH DISK — a real captured notification body, not a
 * placeholder, because every assertion below is a substring search for exactly
 * this string in the dehydrated output.
 */
const RAW_NOTIFICATION_TEXT =
  "GCash: You sent P1,250.00 to JUAN D**A on 08 Sep. Ref 1234567890. Bal P4,310.55";
const CAPTURE_ID = "cap-49";

/**
 * A cache holding one entry from every family that USED to be persisted —
 * populated with `setQueryData`, so each one lands in a SUCCESS state and the
 * library's own `defaultShouldDehydrateQuery` would take every one of them.
 *
 * THIS FIXTURE IS THE ANSWER TO "the test passes with the fix deleted". The
 * acceptance criterion for GAP-049 is "the persisted blob contains no
 * `raw_captures` key", which is trivially true of an empty cache and of a
 * cache that never held one. The first test below is the WITNESS: it proves
 * the raw capture is genuinely in this cache and genuinely in the blob the
 * DEFAULT filter produces. Only then do the rest assert that
 * `persistOptions`' own filter drops it.
 */
function cacheHoldingEverything(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(queryKeys.rawCaptures.detail(CAPTURE_ID), { text: RAW_NOTIFICATION_TEXT });
  client.setQueryData(queryKeys.rawCaptures.expiry(CAPTURE_ID), 1_800_000_000_000);
  client.setQueryData(queryKeys.rawCaptures.list(), [
    { id: CAPTURE_ID, text: RAW_NOTIFICATION_TEXT },
  ]);
  client.setQueryData(queryKeys.transactions.list({}), [{ id: "t1", merchant: MERCHANT }]);
  client.setQueryData(queryKeys.transactions.dailySpend(7), [100, 200, 300]);
  client.setQueryData(queryKeys.limits.statuses(), [{ id: "l1" }]);
  client.setQueryData(queryKeys.bills.list(), [{ id: "b1" }]);
  client.setQueryData(queryKeys.goals.list(), [{ id: "g1" }]);
  client.setQueryData(queryKeys.loans.list(), [{ id: "n1" }]);
  client.setQueryData(queryKeys.listenerHealth.current(), { running: true });
  client.setQueryData(queryKeys.settings.captureEnabled(), true);
  client.setQueryData(queryKeys.reports.scopes(), [{ month: "2026-09" }]);
  client.setQueryData(queryKeys.safeToSpend.today(), { amountCentavos: 123_456 });
  client.setQueryData(queryKeys.wallets.list(false), [{ id: "w1", balanceCentavos: 1 }]);
  client.setQueryData(queryKeys.wallets.list(true), [{ id: "w2", balanceCentavos: 2 }]);
  client.setQueryData(queryKeys.wallets.detail("w1"), { id: "w1", merchant: MERCHANT });
  client.setQueryData(queryKeys.wallets.drift("w1"), { deltaCentavos: 500 });
  client.setQueryData(queryKeys.wallets.allMatchers(), [{ id: "m1" }]);
  return client;
}

describe("only an allowlisted set is dehydrated to disk (GAP-049)", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = cacheHoldingEverything();
  });

  afterEach(() => {
    // Every entry above schedules a real gc timeout in its own constructor;
    // `clear()` removes them, which is what stops Jest reporting a worker that
    // "failed to exit gracefully" — the same care `failOneMutation` takes.
    client.clear();
  });

  test("WITNESS: the raw capture really is in this cache, and the library's own default filter really would write it to disk", () => {
    expect(
      client.getQueryCache().find({ queryKey: queryKeys.rawCaptures.detail(CAPTURE_ID) }),
    ).toBeDefined();
    expect(JSON.stringify(dehydrate(client))).toContain(RAW_NOTIFICATION_TEXT);
  });

  test("no raw_captures key, and no notification text at all, survives persistOptions' dehydrate", () => {
    const persisted = dehydrate(client, persistOptions.dehydrateOptions);

    expect(persisted.queries.some((query) => query.queryKey[0] === "raw_captures")).toBe(false);
    expect(JSON.stringify(persisted)).not.toContain(RAW_NOTIFICATION_TEXT);
    expect(JSON.stringify(persisted)).not.toContain(CAPTURE_ID);
  });

  test("exactly three entries reach disk: the hero and the two wallet lists — nothing else, including the ledger, the listener health read and the wallet detail siblings", () => {
    const persisted = dehydrate(client, persistOptions.dehydrateOptions);
    const keys = persisted.queries.map((query) => query.queryKey);

    expect(keys).toHaveLength(3);
    expect(keys).toContainEqual([...queryKeys.safeToSpend.today()]);
    expect(keys).toContainEqual([...queryKeys.wallets.list(false)]);
    expect(keys).toContainEqual([...queryKeys.wallets.list(true)]);
    // `wallets.lists()` is a PREFIX, not the whole family: detail, drift and
    // the all-matchers list stay off disk even though they share a root.
    expect(keys).not.toContainEqual([...queryKeys.wallets.detail("w1")]);
    expect(keys).not.toContainEqual([...queryKeys.wallets.drift("w1")]);
    expect(keys).not.toContainEqual([...queryKeys.wallets.allMatchers()]);
    expect(new Set(keys.map((key) => key[0]))).toEqual(new Set(["safe_to_spend", "wallets"]));
  });

  test("an allowlisted query that FAILED is still not persisted — the default filter is composed with, not replaced by, the key test", async () => {
    const failing = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Present and successful, so a filter that forgot the allowlist entirely
    // (i.e. the library default, i.e. the un-fixed file) takes it...
    failing.setQueryData(queryKeys.rawCaptures.detail(CAPTURE_ID), {
      text: RAW_NOTIFICATION_TEXT,
    });
    // ...and allowlisted but errored, so a filter that kept the allowlist and
    // dropped `defaultShouldDehydrateQuery` takes THIS one. Only the composed
    // filter takes neither, which is why both live in one assertion.
    await expect(
      failing.fetchQuery({
        queryKey: queryKeys.safeToSpend.today(),
        queryFn: () => Promise.reject(new Error("database is locked")),
      }),
    ).rejects.toThrow("database is locked");
    expect(
      failing.getQueryCache().find({ queryKey: queryKeys.safeToSpend.today() })?.state.status,
    ).toBe("error");

    expect(dehydrate(failing, persistOptions.dehydrateOptions).queries).toHaveLength(0);

    failing.clear();
  });
});

describe("the persisted blob expires with the local day (GAP-049)", () => {
  const MIDNIGHT_TODAY = new Date(2026, 8, 8, 0, 0).getTime();
  const LAST_NIGHT = new Date(2026, 8, 7, 23, 58).getTime();
  const JUST_AFTER_MIDNIGHT = new Date(2026, 8, 8, 0, 1).getTime();
  const EARLY_TODAY = new Date(2026, 8, 8, 0, 5).getTime();
  const LATE_TONIGHT = new Date(2026, 8, 8, 23, 59).getTime();

  let nowSpy: jest.SpyInstance;

  beforeEach(async () => {
    // A `Date.now` spy rather than fake timers, the same way
    // contexts/__tests__/lock_context.test.tsx pins its lock window: the
    // persister's own promises must keep resolving normally underneath.
    nowSpy = jest.spyOn(Date, "now");
    clearCacheEncryptionKey();
    await AsyncStorage.clear();
  });

  afterEach(async () => {
    nowSpy.mockRestore();
    clearCacheEncryptionKey();
    await AsyncStorage.clear();
  });

  test("maxAge is finite, and is the milliseconds elapsed since local midnight", () => {
    nowSpy.mockReturnValue(JUST_AFTER_MIDNIGHT);
    expect(persistOptions.maxAge).not.toBe(Infinity);
    expect(persistOptions.maxAge).toBe(JUST_AFTER_MIDNIGHT - MIDNIGHT_TODAY);

    nowSpy.mockReturnValue(LATE_TONIGHT);
    expect(persistOptions.maxAge).toBe(LATE_TONIGHT - MIDNIGHT_TODAY);
  });

  test("a blob written at 23:58 is discarded and deleted, not hydrated, on a launch at 00:01 — the hero must not paint yesterday's number", async () => {
    setCacheEncryptionKey(KEY);
    nowSpy.mockReturnValue(LAST_NIGHT);
    await persistOptions.persister.persistClient(fakePersistedClient(MERCHANT));
    expect(await AsyncStorage.getItem(STORAGE_KEY)).not.toBeNull();

    nowSpy.mockReturnValue(JUST_AFTER_MIDNIGHT);
    const client = new QueryClient();
    // Read field by field rather than spread, but read at THIS instant, which
    // is exactly what PersistQueryClientProvider does inside its own effect.
    await persistQueryClientRestore({
      queryClient: client,
      persister: persistOptions.persister,
      maxAge: persistOptions.maxAge,
      buster: persistOptions.buster,
    });

    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    client.clear();
  });

  test("a blob written earlier the SAME local day is still restored — persistence is narrowed, not disabled", async () => {
    setCacheEncryptionKey(KEY);
    nowSpy.mockReturnValue(EARLY_TODAY);
    await persistOptions.persister.persistClient(fakePersistedClient(MERCHANT));

    nowSpy.mockReturnValue(LATE_TONIGHT);
    const client = new QueryClient();
    await persistQueryClientRestore({
      queryClient: client,
      persister: persistOptions.persister,
      maxAge: persistOptions.maxAge,
      buster: persistOptions.buster,
    });

    expect(client.getQueryCache().getAll()).toHaveLength(1);
    expect(await AsyncStorage.getItem(STORAGE_KEY)).not.toBeNull();
    client.clear();
  });
});

describe("encrypted persistence (docs/12-encryption-and-app-lock.md §8)", () => {
  beforeEach(async () => {
    clearCacheEncryptionKey();
    await AsyncStorage.clear();
  });

  afterEach(async () => {
    clearCacheEncryptionKey();
    await AsyncStorage.clear();
  });

  test("persistClient writes a blob that does not contain the plaintext merchant string, and restoreClient reads it back intact", async () => {
    setCacheEncryptionKey(KEY);
    const client = fakePersistedClient(MERCHANT);

    await persistOptions.persister.persistClient(client);

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw as string).not.toContain(MERCHANT);

    const restored = await persistOptions.persister.restoreClient();
    expect(restored).toEqual(client);
  });

  test("persistClient never writes anything to storage when no cache key has been set -- fail safe, never plaintext", async () => {
    const client = fakePersistedClient(MERCHANT);

    await persistOptions.persister.persistClient(client);

    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("restoreClient returns undefined (an empty cache), not a throw, when the stored blob predates encryption or is otherwise unreadable", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fakePersistedClient(MERCHANT)));
    setCacheEncryptionKey(KEY);

    await expect(persistOptions.persister.restoreClient()).resolves.toBeUndefined();
  });

  test("restoreClient resolves to undefined, not a throw, when no cache key has ever been set and a blob exists", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "some-blob-that-is-not-even-encrypted");

    await expect(persistOptions.persister.restoreClient()).resolves.toBeUndefined();
  });

  test("setCacheEncryptionKey / clearCacheEncryptionKey and CacheCipherKeyMissingError are exported for Task 9 to wire into the render gate", () => {
    expect(typeof setCacheEncryptionKey).toBe("function");
    expect(typeof clearCacheEncryptionKey).toBe("function");
    expect(CacheCipherKeyMissingError).toBeDefined();
  });
});

/**
 * A message shaped like the ones that actually reach this handler: a SQLite
 * constraint string with a merchant name inside it. Every assertion below
 * about what the user is NOT shown is written against these substrings.
 */
const LEDGER_ERROR = new Error(
  "UNIQUE constraint failed: transactions.external_ref (Jollibee SM Megamall)",
);

/**
 * Drives one mutation to failure through the APP'S OWN mutation cache, which
 * is the object under test — `build` runs it through
 * `queryClient.defaultMutationOptions`, so `retry: 0` and the cache's
 * `onError` both apply exactly as they do for a hook under hooks/mutations/.
 */
async function failOneMutation(meta?: Record<string, unknown>): Promise<void> {
  const mutation = queryClient.getMutationCache().build(queryClient, {
    meta,
    mutationFn: (): Promise<void> => Promise.reject(LEDGER_ERROR),
  });

  await expect(mutation.execute(undefined)).rejects.toBe(LEDGER_ERROR);

  // Every Mutation schedules a five-minute garbage-collection timeout in its
  // own constructor (query-core's Removable). Left alone, each one built here
  // keeps a real timer alive long after the test that made it has finished,
  // which is what makes Jest report a worker that "failed to exit gracefully"
  // and then sit waiting for it. Nothing below reads the mutation again.
  mutation.destroy();
}

describe("the mutation failure surface (GAP-013)", () => {
  beforeEach(() => {
    clearToasts();
  });

  afterEach(() => {
    clearToasts();
  });

  test("a rejected mutation on the app's own client leaves the user something to see", async () => {
    expect(getToasts()).toHaveLength(0);

    await failOneMutation();

    const notices = getToasts();
    expect(notices).toHaveLength(1);
    expect(notices[0].tone).toBe("failure");
    expect(notices[0].title).toBe(MUTATION_FAILURE_TOAST.title);
    expect(notices[0].body).toBe(MUTATION_FAILURE_TOAST.body);
    expect(notices[0].dedupeKey).toBe(MUTATION_FAILURE_DEDUPE_KEY);
  });

  test("the notice carries no part of the error — not the message, not the constraint, not the merchant", async () => {
    await failOneMutation();

    const queued = JSON.stringify(getToasts());
    expect(queued).not.toContain("UNIQUE constraint");
    expect(queued).not.toContain("transactions.external_ref");
    expect(queued).not.toContain("Jollibee");
    expect(queued).not.toContain(LEDGER_ERROR.message);
  });

  test("nothing is swallowed: the mutation still rejects and still records its own error", async () => {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: (): Promise<void> => Promise.reject(LEDGER_ERROR),
    });

    await expect(mutation.execute(undefined)).rejects.toBe(LEDGER_ERROR);
    expect(mutation.state.status).toBe("error");
    expect(mutation.state.error).toBe(LEDGER_ERROR);

    mutation.destroy();
  });

  test("a hook whose screen renders its own inline failure opts out with meta.errorToast: false", async () => {
    await failOneMutation({ errorToast: false });

    expect(getToasts()).toHaveLength(0);
  });

  test("two failures in a row are ONE notice, not a stack of identical cards", async () => {
    await failOneMutation();
    await failOneMutation();
    await failOneMutation();

    expect(getToasts()).toHaveLength(1);
  });

  test("a repeat reissues the id, so the host restarts the countdown instead of inheriting the first one's remains", async () => {
    await failOneMutation();
    const first = getToasts()[0].id;

    await failOneMutation();

    expect(getToasts()[0].id).not.toBe(first);
  });

  test("createMutationErrorCache is exported so a suite building its own QueryClient inherits the same surface", () => {
    expect(typeof createMutationErrorCache().config.onError).toBe("function");
  });
});

describe("the transient notice queue", () => {
  beforeEach(() => {
    clearToasts();
  });

  afterEach(() => {
    clearToasts();
  });

  test("publishToast returns the id it queued under, so its owner can take it back down", () => {
    const id = publishToast({
      tone: "neutral",
      title: "Item reopened",
      body: "It is back at the top of the queue.",
      dedupeKey: "review:undo",
    });

    expect(getToasts().map((notice) => notice.id)).toEqual([id]);

    dismissToast(id);
    expect(getToasts()).toHaveLength(0);
  });

  test("dismissing an id that is already gone is a no-op, so a timer and a tap need no ordering rule", () => {
    const id = publishToast({ tone: "failure", title: "a", body: "b", dedupeKey: "one" });
    dismissToast(id);
    dismissToast(id);

    expect(getToasts()).toHaveLength(0);
  });

  test("two producers queue side by side — a slot would have dropped one of them", () => {
    publishToast({ tone: "failure", title: "a", body: "b", dedupeKey: "one" });
    publishToast({ tone: "neutral", title: "c", body: "d", dedupeKey: "two" });

    expect(getToasts().map((notice) => notice.title)).toEqual(["a", "c"]);
  });

  test(`the queue holds at most ${MAX_QUEUED_TOASTS}, dropping the oldest rather than the newest`, () => {
    for (let index = 0; index < MAX_QUEUED_TOASTS + 2; index += 1) {
      publishToast({ tone: "failure", title: `n${index}`, body: "b", dedupeKey: `k${index}` });
    }

    const titles = getToasts().map((notice) => notice.title);
    expect(titles).toHaveLength(MAX_QUEUED_TOASTS);
    expect(titles[0]).toBe("n2");
    expect(titles[titles.length - 1]).toBe(`n${MAX_QUEUED_TOASTS + 1}`);
  });

  test("a repeat under one dedupeKey replaces IN PLACE, so the card does not jump past its neighbours", () => {
    publishToast({ tone: "failure", title: "first", body: "b", dedupeKey: "one" });
    publishToast({ tone: "neutral", title: "second", body: "d", dedupeKey: "two" });
    publishToast({ tone: "failure", title: "first again", body: "b", dedupeKey: "one" });

    expect(getToasts().map((notice) => notice.title)).toEqual(["first again", "second"]);
  });

  test("subscribers hear a publish and a dismiss, and stop hearing anything after unsubscribing", () => {
    const heard = jest.fn();
    const unsubscribe = subscribeToToasts(heard);

    const id = publishToast({ tone: "failure", title: "a", body: "b", dedupeKey: "one" });
    dismissToast(id);
    expect(heard).toHaveBeenCalledTimes(2);

    unsubscribe();
    publishToast({ tone: "failure", title: "a", body: "b", dedupeKey: "one" });
    expect(heard).toHaveBeenCalledTimes(2);
  });

  test("getToasts holds the same reference until something changes — useSyncExternalStore loops without it", () => {
    publishToast({ tone: "failure", title: "a", body: "b", dedupeKey: "one" });

    expect(getToasts()).toBe(getToasts());
  });

  test("an action and its label survive onto the queued notice, which is what an undo affordance needs", () => {
    const undo = jest.fn();
    publishToast({
      tone: "neutral",
      title: "Dismissed",
      body: "It will not come back on its own.",
      dedupeKey: "review:undo",
      actionLabel: "Undo",
      onAction: undo,
      durationMs: 10_000,
    });

    const notice = getToasts()[0];
    expect(notice.actionLabel).toBe("Undo");
    expect(notice.durationMs).toBe(10_000);
    notice.onAction?.();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  test("durationMs defaults to TOAST_DURATION_MS when the caller does not name one", () => {
    publishToast({ tone: "failure", title: "a", body: "b", dedupeKey: "one" });

    expect(getToasts()[0].durationMs).toBe(TOAST_DURATION_MS);
  });
});
