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
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
});

/** Bump on any change to the persisted cache's shape (query keys, dehydrated
 * data structure) so an old on-disk blob is discarded instead of misread. */
const CACHE_BUSTER = "peraplano-query-cache-v1";

export const persistOptions = {
  persister,
  maxAge: Infinity,
  buster: CACHE_BUSTER,
};
