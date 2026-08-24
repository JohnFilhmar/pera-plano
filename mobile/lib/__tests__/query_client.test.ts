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
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import {
  persistOptions,
  queryClient,
  setCacheEncryptionKey,
  clearCacheEncryptionKey,
  CacheCipherKeyMissingError,
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
