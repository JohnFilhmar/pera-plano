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
    list: () => ["wallets", "list"] as const,
    detail: (id: string) => ["wallets", "detail", id] as const,
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
  settings: {
    all: ["settings"] as const,
  },
} as const;
