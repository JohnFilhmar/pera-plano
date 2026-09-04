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
// The "failure surface" block at the bottom is GAP-013's addition, and it is
// deliberately exercised against the EXPORTED `queryClient` — the same object
// app/_layout.tsx hands to PersistQueryClientProvider — rather than a fresh
// client built for the test. The defect being fixed was not "the handler is
// wrong", it was "there is no handler", and a test that builds its own cache
// would stay green if someone dropped `mutationCache:` from the constructor.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
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
  test("maxAge is Infinity — this app has no login, so the on-disk cache is never age-expired", () => {
    expect(persistOptions.maxAge).toBe(Infinity);
  });

  test("buster is a non-empty version string for cache-shape breaks", () => {
    expect(typeof persistOptions.buster).toBe("string");
    expect(persistOptions.buster.length).toBeGreaterThan(0);
  });

  test("buster is bumped from the pre-encryption plaintext-cache value -- an old plaintext blob must never be handed to the new encrypted deserialize", () => {
    expect(persistOptions.buster).not.toBe("peraplano-query-cache-v1");
  });

  test("persister implements the Persister contract", () => {
    expect(typeof persistOptions.persister.persistClient).toBe("function");
    expect(typeof persistOptions.persister.restoreClient).toBe("function");
    expect(typeof persistOptions.persister.removeClient).toBe("function");
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
