// lib/query_client.ts — the single central QueryClient (interface contract;
// STACK_BASIS §6) plus the AsyncStorage persist options for
// PersistQueryClientProvider (see app/_layout.tsx per §16). This app is
// local-first with no login — there is no auth boundary, so unlike the
// multi-account guidance in STACK_BASIS §6 this file does NOT build a
// session-reset/cache-purge mechanism. The cache persists indefinitely
// (`maxAge: Infinity`) and that's the whole story.
//
// The one option here that is correctness, not tuning: `mutations.retry: 0`.
// React Query's own default is already 0 — set it explicitly anyway. Every
// mutation in this app is a side effect against the ledger (a transaction
// insert, a goal contribution, a loan payment). A silent auto-replay of any
// of those double-writes real money data. Do not raise this above 0.
//
// ENCRYPTION (docs/12-encryption-and-app-lock.md §8): the persisted cache
// holds transaction amounts, merchant names and wallet balances, so it is
// encrypted with AES-256-GCM (lib/crypto/cache_cipher.ts) under the same key
// as the database — the DEK itself (key_manager.ts), never a separately
// derived value; see cache_cipher.ts's header comment for why that reuse is
// safe. `setCacheEncryptionKey` below MUST be called with the unwrapped DEK
// once the app unlocks and BEFORE PersistQueryClientProvider's persister
// reads or writes anything — concretely, before it mounts. This module only
// makes that requirement explicit (a dedicated setter; a clear, typed
// failure — CacheCipherKeyMissingError — if it's skipped) and fails safely
// if it is; it does NOT wire the actual call site into the app's render
// gate. That is Task 9's job (the fourth render-gate condition, alongside
// fonts/bootstrap/theme in app/_layout.tsx — see that file's header
// comment), exactly as lib/db/database.ts's unlockDatabase(dek) was added by
// Task 7 without Task 7 itself calling it from the app.
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { queryKeys } from "@/constants/query_keys";

import { createCacheCodec, CacheCipherKeyMissingError } from "./crypto/cache_cipher";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FIVE_MINUTES_MS,
      gcTime: THIRTY_MINUTES_MS,
      // React Query's default retryDelay is already exponential backoff
      // (min(1000 * 2^attempt, 30000)) — a bare `retry: 3` inherits it.
      retry: 3,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

/**
 * The families Safe-to-Spend is DERIVED FROM — docs/04-features/09-safe-to-spend.md
 * rule 13's recompute triggers expressed as the roots those triggers actually
 * invalidate. A ledger commit and a transfer link/unlink both land on
 * `transactions`; a bill pay on `bills` and `transactions`; a review
 * confirmation on `review_queue`.
 *
 * Local-midnight rollover is deliberately absent: no query is invalidated at
 * midnight, so it is a clock concern rather than a cache one.
 */
const SAFE_TO_SPEND_SOURCE_ROOTS: readonly QueryKey[] = [
  queryKeys.transactions.all,
  queryKeys.reviewQueue.all,
  queryKeys.bills.all,
  queryKeys.goals.all,
  queryKeys.limits.all,
  queryKeys.income.all,
];

/**
 * Makes the Safe-to-Spend root follow its sources, so the hero and the Plus
 * projection curve under it cannot outlive the numbers they are computed from.
 *
 * ON THE CACHE, NOT IN EACH MUTATION. Safe-to-Spend reads limits, bills,
 * goals, income, the review queue and the ledger, so "the mutations that move
 * it" is every hook touching any of those — a list ~20 long today that the
 * hook written next month silently drops off, and a stale headline is the
 * single most visible bug this app can have. Subscribing to the cache states
 * the derivation ONCE: invalidate a source, and what is derived from it is
 * invalidated too, whoever did the invalidating (a mutation's
 * `invalidateKeys`, the Home screen's `ledger:committed` handler, a future
 * background drain).
 *
 * STILL AN EXPLICIT KEY LIST, not the blanket `invalidateQueries()` that
 * hooks/mutations/invalidate_keys.ts exists to prevent: six named source roots
 * in, one named key out. A settings toggle or a ruleset install moves neither.
 *
 * The `isInvalidated` guard is what keeps ONE `invalidateQueries` call over a
 * family holding four cached entries from cancelling and restarting the hero's
 * fetch four times over — the queries are already marked stale after the first
 * cascade, and a refetch that lands clears the flag so the next source change
 * cascades again.
 *
 * LIMIT WORTH KNOWING: this reacts to a query being invalidated, so a source
 * family with nothing cached cascades nothing. Every rule 13 trigger is fired
 * from a screen that has the family it invalidates on screen, and the ledger
 * path is covered a second time by app/(tabs)/index.tsx's `ledger:committed`
 * handler, which names `safeToSpend.all` directly.
 */
export function installSafeToSpendCascade(client: QueryClient): () => void {
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "invalidate") return;

    const key = event.query.queryKey;
    const fromSource = SAFE_TO_SPEND_SOURCE_ROOTS.some((root) =>
      root.every((segment, index) => key[index] === segment),
    );
    if (!fromSource) return;

    const derived = client.getQueryCache().findAll({ queryKey: queryKeys.safeToSpend.all });
    if (derived.length === 0 || derived.every((query) => query.state.isInvalidated)) return;

    void client.invalidateQueries({ queryKey: queryKeys.safeToSpend.all });
  });
}

installSafeToSpendCascade(queryClient);

/**
 * The key that encrypts the persisted cache — module-level, mirroring
 * key_manager.ts's own `dek` and lib/db/database.ts's `dbPromise`: set once
 * by whoever wires the app's unlock flow (Task 9), read fresh on every
 * serialize/deserialize call below rather than captured once at module load,
 * since `setCacheEncryptionKey` is necessarily called AFTER this module has
 * already been imported and the persister already built.
 *
 * NEVER logged; NEVER exported directly — only through the setter below, so
 * every write site is grep-able.
 *
 * This buffer is this module's OWN COPY of the DEK, not the caller's. Sharing
 * the caller's buffer aliased this variable to the exact array
 * key_manager.ts's `lock()` zeroes in place, so a lock could mutate the key
 * out from under a cache write that was already running — see the setter and
 * cache_cipher.ts's ORDERING GUARANTEE header.
 */
let cacheEncryptionKey: Uint8Array | null = null;

/**
 * MUST be called with the unwrapped DEK once the app unlocks, and before
 * anything reads or writes the persisted query cache — see this file's
 * header comment. Calling it again (e.g. on every unlock) simply replaces
 * the key.
 *
 * COPIES the bytes rather than retaining the caller's array. key_manager.ts
 * owns the DEK and destroys it by zeroing the buffer in place, and
 * lib/security/wipe.ts's wipeKeys() does that without going through
 * clearCacheEncryptionKey() at all — with a shared buffer, that zeroing would
 * silently turn this module's key into 32 zero bytes while it still looked
 * present. Owning a copy makes this module's key live exactly as long as this
 * module says it does, and clearCacheEncryptionKey() below is what ends it.
 */
export function setCacheEncryptionKey(key: Uint8Array): void {
  const previous = cacheEncryptionKey;
  cacheEncryptionKey = new Uint8Array(key);
  previous?.fill(0);
}

/** Companion to setCacheEncryptionKey, for the app's own lock action and for
 * test teardown — mirrors key_manager.ts's lock(), zeroing the bytes before
 * dropping the reference, because the buffer above is this module's own copy
 * and nothing else will ever scrub it. */
export function clearCacheEncryptionKey(): void {
  cacheEncryptionKey?.fill(0);
  cacheEncryptionKey = null;
}

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  // A getter, not the key: the codec must read `cacheEncryptionKey` at the
  // moment it encrypts, not at the moment the persister calls it — see the
  // variable's own doc and cache_cipher.ts's ORDERING GUARANTEE header.
  serialize: (client) => createCacheCodec(() => cacheEncryptionKey).serialize(client),
  // The real return value can genuinely be `undefined` (a discarded,
  // unreadable cache — cache_cipher.ts's createCacheCodec) even though the
  // library's own published type for `deserialize` doesn't admit that,
  // mirroring how its default (`JSON.parse`, typed `any`) already permits
  // it silently. persistQueryClientRestore (verified against its source)
  // treats a falsy result as "nothing to hydrate", which is exactly the
  // intended behavior here.
  deserialize: (cached) => createCacheCodec(() => cacheEncryptionKey).deserialize(cached) as PersistedClient,
});

/** Bump on any change to the persisted cache's shape (query keys, dehydrated
 * data structure) — OR, as of this encrypted version, the on-disk encoding
 * itself: every cache written before this change is plaintext JSON, and
 * handing it to the new AES-256-GCM deserialize would either fail to decrypt
 * on every launch (harmless, just a cold cache) or, if some future format
 * ever collided, worse — silently trust stale plaintext. Bumping the buster
 * makes persistQueryClientRestore discard any old blob unconditionally,
 * before it is ever handed to deserialize at all. NEVER revert this string
 * to the pre-encryption value. */
const CACHE_BUSTER = "peraplano-query-cache-v2-encrypted";

export const persistOptions = {
  persister,
  maxAge: Infinity,
  buster: CACHE_BUSTER,
};

export { CacheCipherKeyMissingError };
