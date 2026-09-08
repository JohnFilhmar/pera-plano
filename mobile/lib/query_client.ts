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
// FAILURE SURFACE: the client is built with a `MutationCache` whose `onError`
// is the app's ONLY guarantee that a failed write is visible at all — see
// `createMutationErrorCache` below, and the notice queue above it that
// `components/ui/mutation_error_toast.tsx` renders. Anything constructing its
// own QueryClient (screen suites do) must pass `createMutationErrorCache()`
// to inherit it; a bare `new QueryClient()` is silent on failure again.
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
import { MutationCache, QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { queryKeys } from "@/constants/query_keys";

import { createCacheCodec, CacheCipherKeyMissingError } from "./crypto/cache_cipher";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

/**
 * THE APP'S TRANSIENT NOTICE QUEUE — the store behind
 * `components/ui/mutation_error_toast.tsx`.
 *
 * WHY IT LIVES IN THIS FILE AND NOT BESIDE THE COMPONENT. The producer that
 * matters is the mutation cache two blocks below, and `lib/` must not import
 * from `components/`: a React Native tree pulled into a module every hook and
 * lib suite already imports is both a dependency inversion and a load-time
 * cost for suites that render nothing. The component reads this store; nothing
 * here reads the component.
 *
 * A QUEUE, NOT A SLOT. Two writes can fail inside one tick — a sheet chaining
 * a second mutation in `onSuccess`, a screen firing three toggles — and a
 * single slot silently drops all but the last, which is the same class of
 * silence this whole mechanism exists to end. `dedupeKey` is what keeps a
 * queue from becoming three identical stacked cards: a repeat REPLACES the
 * entry already queued under that key, in place, so the notice refreshes
 * without the stack growing or the card jumping. A different producer (a
 * triage undo, a sheet naming its own field) passes its own key and gets its
 * own line.
 *
 * NO TIMERS HERE. Expiry belongs to whatever is mounted: the host owns one
 * `setTimeout` per visible card and clears it on unmount, so a headless
 * process — a Jest suite, a background drain — never leaves a timer running,
 * and this module stays synchronous end to end.
 */
export type AppToastTone = "failure" | "neutral";

export type AppToast = {
  readonly id: string;
  readonly tone: AppToastTone;
  /** One line, sentence case: the user's words for what happened. */
  readonly title: string;
  /** What it means for their data, and what to do next. */
  readonly body: string;
  /** Repeats under the same key replace rather than stack. */
  readonly dedupeKey: string;
  readonly durationMs: number;
  /** Rendered as a second control only when both halves are present. */
  readonly actionLabel?: string;
  readonly onAction?: () => void;
};

export type AppToastInput = Omit<AppToast, "id" | "durationMs"> & { durationMs?: number };

/** Long enough to read two short lines without pinning the top of the screen. */
export const TOAST_DURATION_MS = 6000;

/** Beyond this the oldest is dropped: the notice that has been on screen
 * longest is the one the user has most likely already acted on, and a tower of
 * cards hides the screen the message is about. */
export const MAX_QUEUED_TOASTS = 3;

let toasts: readonly AppToast[] = [];
let nextToastId = 0;
const toastListeners = new Set<() => void>();

/** Iterated over a copy, so a listener unsubscribing from inside its own call
 * cannot make the Set skip the next one — the same care
 * lib/events/app_events.ts takes with its handler set. */
function notifyToastListeners(): void {
  for (const listener of [...toastListeners]) listener();
}

/** `useSyncExternalStore`'s subscribe half. */
export function subscribeToToasts(listener: () => void): () => void {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}

/** `useSyncExternalStore`'s snapshot half — the SAME array reference until
 * something actually changes, which is what keeps React from re-rendering the
 * host on every unrelated store read. */
export function getToasts(): readonly AppToast[] {
  return toasts;
}

/** Queues one notice and returns its id, so a caller that owns the action on
 * it (an undo whose window has closed) can take it back down. */
export function publishToast(input: AppToastInput): string {
  const toast: AppToast = {
    ...input,
    id: `toast-${(nextToastId += 1)}`,
    durationMs: input.durationMs ?? TOAST_DURATION_MS,
  };

  const at = toasts.findIndex((queued) => queued.dedupeKey === toast.dedupeKey);
  toasts =
    at === -1
      ? [...toasts, toast].slice(-MAX_QUEUED_TOASTS)
      : toasts.map((queued, index) => (index === at ? toast : queued));

  notifyToastListeners();
  return toast.id;
}

/** Dismissing an id that is no longer queued is a no-op, so the host's expiry
 * timer and the user's own tap can both fire without ordering rules. */
export function dismissToast(id: string): void {
  const remaining = toasts.filter((queued) => queued.id !== id);
  if (remaining.length === toasts.length) return;
  toasts = remaining;
  notifyToastListeners();
}

/** For test teardown, and for a wipe: nothing about one session's failures
 * should survive into the next. */
export function clearToasts(): void {
  if (toasts.length === 0) return;
  toasts = [];
  notifyToastListeners();
}

/**
 * WHAT A FAILED WRITE SAYS. Human copy, and deliberately not the error.
 *
 * `error.message` here would be a SQLite constraint string, or a repository
 * error carrying the merchant, wallet or amount that failed — ledger content,
 * which docs/12 keeps off every surface that is not the ledger itself. The
 * user cannot act on "UNIQUE constraint failed" anyway.
 *
 * IT DOES NOT PROMISE THE LEDGER IS UNTOUCHED, unlike app/review/index.tsx's
 * `triageFailureMessage`, which can: that screen knows its writes run in one
 * unit of work that rolls back whole. This handler fires for every hook in the
 * app, including the two-step wallet save whose first half really can have
 * landed, so it says only what is true of all of them — the change the user
 * just made was not recorded — and sends them to look.
 */
export const MUTATION_FAILURE_TOAST = {
  title: "That didn't save",
  body: "The change wasn't recorded. Check the screen, then try again.",
} as const;

export const MUTATION_FAILURE_DEDUPE_KEY = "mutation:failure";

/**
 * ONE HANDLER FOR EVERY MUTATION IN THE APP, on the cache rather than in each
 * hook — the same call `installSafeToSpendCascade` below makes, for the same
 * reason. All 49 hooks under hooks/mutations/ shipped with no `onError`, so a
 * failed write left the sheet closed, the row absent and the user told
 * nothing; the list of hooks needing one is every hook there today plus every
 * hook written after, and the one written next month is exactly the one that
 * gets missed.
 *
 * ON THE CACHE, NOT `defaultOptions.mutations.onError`. A default is REPLACED
 * by a hook that declares its own `onError`, so the day any hook adds one for
 * its own reasons it silently opts out of the app's only failure surface. The
 * cache handler runs for every mutation regardless.
 *
 * NOTHING IS SWALLOWED. This runs in addition to, never instead of, a
 * mutation's own error handling: `state.error` is still set, `isError` is
 * still true and `mutateAsync` still rejects, so a screen rendering its own
 * inline failure (app/review/index.tsx) keeps doing it unchanged.
 *
 * `meta.errorToast: false` opts a hook out, for the one case where a second
 * message is worse than one — see hooks/mutations/use_review_action.ts.
 */
export function createMutationErrorCache(): MutationCache {
  return new MutationCache({
    onError: (_error, _variables, _onMutateResult, mutation) => {
      if (mutation.meta?.errorToast === false) return;

      publishToast({
        tone: "failure",
        dedupeKey: MUTATION_FAILURE_DEDUPE_KEY,
        title: MUTATION_FAILURE_TOAST.title,
        body: MUTATION_FAILURE_TOAST.body,
      });
    },
  });
}

export const queryClient = new QueryClient({
  mutationCache: createMutationErrorCache(),
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
 * Local-midnight rollover is deliberately absent from this list, and always
 * will be: it is a clock concern rather than a cache one — no write happens, so
 * there is no invalidation here for the cascade to mirror. It is not
 * unimplemented, though. `hooks/use_day_rollover.ts` owns it per screen, and
 * app/(tabs)/index.tsx is the screen that uses it today.
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
