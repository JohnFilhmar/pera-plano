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
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
 * The key that encrypts the persisted cache — module-level, mirroring
 * key_manager.ts's own `dek` and lib/db/database.ts's `dbPromise`: set once
 * by whoever wires the app's unlock flow (Task 9), read fresh on every
 * serialize/deserialize call below rather than captured once at module load,
 * since `setCacheEncryptionKey` is necessarily called AFTER this module has
 * already been imported and the persister already built.
 *
 * NEVER logged; NEVER exported directly — only through the setter below, so
 * every write site is grep-able.
 */
let cacheEncryptionKey: Uint8Array | null = null;

/**
 * MUST be called with the unwrapped DEK once the app unlocks, and before
 * anything reads or writes the persisted query cache — see this file's
 * header comment. Calling it again (e.g. on every unlock) simply replaces
 * the key; there is no lifecycle beyond "set" here because — like
 * key_manager.ts's own `dek` — the value itself is owned and zeroed by
 * key_manager.ts's `lock()`, not by this module.
 */
export function setCacheEncryptionKey(key: Uint8Array): void {
  cacheEncryptionKey = key;
}

/** Companion to setCacheEncryptionKey, for the app's own lock action and for
 * test teardown — mirrors key_manager.ts's lock() clearing its DEK. Does NOT
 * zero the underlying bytes (this module never owned that buffer; see the
 * doc above), only drops this module's reference to it. */
export function clearCacheEncryptionKey(): void {
  cacheEncryptionKey = null;
}

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  // A fresh codec per call, not one built once at module scope, so each
  // call sees whatever `cacheEncryptionKey` currently holds — see the
  // variable's own doc for why that must stay dynamic.
  serialize: (client) => createCacheCodec(cacheEncryptionKey).serialize(client),
  // The real return value can genuinely be `undefined` (a discarded,
  // unreadable cache — cache_cipher.ts's createCacheCodec) even though the
  // library's own published type for `deserialize` doesn't admit that,
  // mirroring how its default (`JSON.parse`, typed `any`) already permits
  // it silently. persistQueryClientRestore (verified against its source)
  // treats a falsy result as "nothing to hydrate", which is exactly the
  // intended behavior here.
  deserialize: (cached) => createCacheCodec(cacheEncryptionKey).deserialize(cached) as PersistedClient,
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
