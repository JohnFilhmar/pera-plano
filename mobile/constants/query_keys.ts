// constants/query_keys.ts — hierarchical React Query key factory (interface
// contract: STACK_BASIS §6). One entry per server-state family this app
// caches. Every family's `all` key is the root every other key in that family
// starts with, so `invalidateQueries({ queryKey: queryKeys.<family>.all })`
// cascades to every list()/detail()/etc. query for that family. Key segments
// mirror the underlying table/domain name (`review_queue`, snake_case) while
// the object property exposing them stays camelCase (`reviewQueue`) per the
// house TS-idiom-for-symbols rule.
//
// Every leaf is `as const` so the array literal types are exact tuples
// (`readonly ["wallets", "list"]`, not `string[]`) — that's what keeps
// `queryKeys.wallets.detail("x")` narrowed to a specific tuple type instead of
// widening to `(string | undefined)[]`.

export const queryKeys = {
  wallets: {
    all: ["wallets"] as const,
    /**
     * The prefix every list variant nests under, and the key MUTATIONS
     * invalidate. Naming a concrete toggle state instead would refresh one of
     * the two lists below and leave the other showing pre-write balances.
     */
    lists: () => ["wallets", "list"] as const,
    /**
     * THE ARCHIVED TOGGLE IS PART OF THE KEY (m1c Task 4, wallets rule 5).
     *
     * The Wallets tab's "Show archived" switch changes WHICH WALLETS the
     * repository returns, so the two states are two different server-state
     * values and need two cache entries. Keyed on `["wallets","list"]` alone,
     * whichever of them resolved first would answer for both — the toggle
     * would appear to do nothing on a warm cache, or leave archived rows on
     * screen after being switched off.
     *
     * The parameter has a DEFAULT rather than being optional, so `list()` and
     * `list(false)` are the same key. Left optional it would produce
     * `["wallets","list",undefined]` for the bare call and
     * `["wallets","list",false]` for the explicit one: two entries holding the
     * same list, which a single invalidation can leave disagreeing.
     */
    list: (includeArchived: boolean = false) => ["wallets", "list", includeArchived] as const,
    detail: (id: string) => ["wallets", "detail", id] as const,
    /**
     * The reported-vs-computed balance pair behind the drift badge, and the
     * wallet's matcher rows. Both nest UNDER `detail(id)` on purpose: a
     * committed transaction already invalidates `wallets.detail(walletId)`
     * (hooks/mutations/use_create_transaction.ts), and prefix matching carries
     * that straight through to the figures and chips rendered beside the
     * balance. A sibling key like `["wallets","drift",id]` would need every
     * existing mutation to remember it, and the failure would be a badge
     * quoting a balance the wallet no longer holds.
     */
    drift: (id: string) => ["wallets", "detail", id, "drift"] as const,
    matchers: (id: string) => ["wallets", "detail", id, "matchers"] as const,
  },
  transactions: {
    all: ["transactions"] as const,
    list: (filters?: object) => ["transactions", "list", filters] as const,
    detail: (id: string) => ["transactions", "detail", id] as const,
  },
  reviewQueue: {
    all: ["review_queue"] as const,
    open: () => ["review_queue", "open"] as const,
    count: () => ["review_queue", "count"] as const,
  },
  categories: {
    all: ["categories"] as const,
    list: () => ["categories", "list"] as const,
  },
  limits: {
    all: ["limits"] as const,
    list: () => ["limits", "list"] as const,
    detail: (id: string) => ["limits", "detail", id] as const,
  },
  goals: {
    all: ["goals"] as const,
    list: () => ["goals", "list"] as const,
    detail: (id: string) => ["goals", "detail", id] as const,
  },
  loans: {
    all: ["loans"] as const,
    list: () => ["loans", "list"] as const,
    detail: (id: string) => ["loans", "detail", id] as const,
  },
  bills: {
    all: ["bills"] as const,
    list: () => ["bills", "list"] as const,
    detail: (id: string) => ["bills", "detail", id] as const,
  },
  /**
   * The installed parser ruleset (lib/db/repos/parser_rulesets_repo.ts).
   *
   * Not a "settings" key: this is server-owned data the device installs and
   * the server can replace, and the UI reads two things off it — the provider
   * catalogue behind a matcher chip's human name, and
   * `tunables.balanceDriftToleranceCentavos`, the threshold the drift badge
   * compares against. That tolerance is ruleset data precisely BECAUSE
   * docs/04-features/02-wallets.md §14 lists its value as an open question, so
   * the number can be corrected without an app release.
   */
  ruleset: {
    all: ["ruleset"] as const,
    active: () => ["ruleset", "active"] as const,
  },
  settings: {
    all: ["settings"] as const,
  },
} as const;
