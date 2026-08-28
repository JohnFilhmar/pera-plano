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
    /**
     * EVERY matcher on the device, for m1c Task 5's reassignment warning — the
     * picker has to name the wallet a pair is about to move off.
     *
     * A SIBLING of `detail`, not a child of it, because it belongs to no single
     * wallet. It still nests under `wallets.all`, which is what `setMatchers`
     * invalidates: a move rewrites TWO wallets' rows and the mutation cannot
     * know the loser's id without a read, so the family root is the narrowest
     * key that reliably reaches both. Naming only the saving wallet's key would
     * leave the other wallet's detail screen showing chips for a provider it no
     * longer catches — a screen disagreeing with the pipeline about where money
     * lands.
     */
    allMatchers: () => ["wallets", "matchers"] as const,
  },
  transactions: {
    all: ["transactions"] as const,
    list: (filters?: object) => ["transactions", "list", filters] as const,
    detail: (id: string) => ["transactions", "detail", id] as const,
    /**
     * The Home hero's seven-bar strip (mobile-ui-revamp Part 2 Task 1) —
     * `dailySpend`'s per-day outflow totals, keyed on the window length so a
     * seven-day strip and any other window a future screen asks for cache
     * separately.
     */
    dailySpend: (days: number) => ["transactions", "daily_spend", days] as const,
  },
  reviewQueue: {
    all: ["review_queue"] as const,
    open: () => ["review_queue", "open"] as const,
    /**
     * One paged cache entry PER FILTER. `kinds` is normalized by the caller
     * (sorted, or `null` for "all") so that two selections of the same kinds
     * share an entry instead of splitting the cache on array order.
     *
     * Deliberately NOT nested under `open()`: a mutation invalidating
     * `reviewQueue.all` still catches both, and keeping them siblings means
     * the unpaged `open()` list — still the contract-shaped read — never
     * has its own entry evicted by a filter change.
     */
    page: (kinds: readonly string[] | null) => ["review_queue", "page", kinds] as const,
    count: () => ["review_queue", "count"] as const,
    kindCounts: () => ["review_queue", "kind_counts"] as const,
  },
  categories: {
    all: ["categories"] as const,
    list: () => ["categories", "list"] as const,
  },
  limits: {
    all: ["limits"] as const,
    list: () => ["limits", "list"] as const,
    /**
     * The archived tail, read only while a "Show archived" toggle is open.
     *
     * A SIBLING OF `list()`, NOT A FLAG ON IT. The two answer different
     * questions and return different shapes (raw rows here, resolved statuses
     * there), so folding them into one key would make every cache read branch
     * on what it got back. Both still nest under the family root, so archiving
     * or restoring invalidates the pair together.
     */
    archived: () => ["limits", "archived"] as const,
    /**
     * The limits AS THE PLAN TAB SEES THEM — each one resolved against the
     * current period, with its spend, effective limit and UX state
     * (`getLimitStatuses`, m2 Task 7).
     *
     * A SIBLING OF `list()`, not a replacement for it. `list()` is the raw
     * configuration rows; this is a derived view that also depends on the
     * ledger and on the IncomeProfile, so a screen showing progress bars and a
     * screen showing an edit form go stale for different reasons. Both nest
     * under `limits.all`, which every limit mutation invalidates.
     *
     * NOT KEYED ON `now`. The window is resolved inside the query function from
     * the system clock; putting the instant in the key would make every render
     * a cache miss.
     */
    statuses: () => ["limits", "statuses"] as const,
    detail: (id: string) => ["limits", "detail", id] as const,
  },
  /**
   * The IncomeProfile and what detection currently believes about it
   * (m2-part2 Task 13).
   *
   * ONE ENTRY, because there is exactly one income profile (invariant I9) —
   * there is no list to page and no id to key on. `summary()` is the derived
   * view `getIncomeSummary` returns, which folds the profile row, the detection
   * notes and the monthly-equivalent conversion into the single shape the
   * screen renders.
   *
   * EVERY LIMIT MUTATION SHOULD NOT INVALIDATE THIS, and this family should not
   * invalidate limits by prefix — but income changes DO move a
   * percent-of-income limit's base, so the income mutations name
   * `queryKeys.limits.all` explicitly alongside their own root. Nesting one
   * family under the other instead would make every limit edit refetch income.
   */
  income: {
    all: ["income"] as const,
    summary: () => ["income", "summary"] as const,
  },
  goals: {
    all: ["goals"] as const,
    list: () => ["goals", "list"] as const,
    /** The deleted tail — see `limits.archived` for why it is its own key. */
    archived: () => ["goals", "archived"] as const,
    detail: (id: string) => ["goals", "detail", id] as const,
  },
  loans: {
    all: ["loans"] as const,
    list: () => ["loans", "list"] as const,
    /** The archived tail — see `limits.archived` for why it is its own key. */
    archived: () => ["loans", "archived"] as const,
    detail: (id: string) => ["loans", "detail", id] as const,
    /**
     * The transactions that might pay this loan, keyed on WHETHER THE SCORE
     * FLOOR APPLIES — the suggested few and the browse-everything fallback are
     * two different answers to two different questions, and a shared key would
     * let whichever resolved first answer for both (the same reasoning
     * `wallets.list`'s archived flag carries).
     *
     * Nested under `detail(id)` so confirming a match, which invalidates
     * `loans.all`, drops both lists: a confirmed candidate must stop being
     * offered.
     */
    candidates: (id: string, includeBelowFloor: boolean = false) =>
      ["loans", "detail", id, "candidates", includeBelowFloor] as const,
    /**
     * This loan's payments and balance adjustments as one list
     * (`listLoanHistory`, spec rules 7 and 13).
     *
     * UNDER `detail(id)` for the same reason `candidates` is: every write that
     * can change it — a confirmed match, a manually recorded payment, an
     * adjustment — already invalidates `loans.all`, and prefix matching carries
     * that straight through. A sibling root would need each of those three
     * mutations to remember a second key, and the failure would be a history
     * section that still shows the balance's old story right underneath the new
     * balance.
     */
    history: (id: string) => ["loans", "detail", id, "history"] as const,
  },
  bills: {
    all: ["bills"] as const,
    list: () => ["bills", "list"] as const,
    /** The archived tail — see `limits.archived` for why it is its own key. */
    archived: () => ["bills", "archived"] as const,
    detail: (id: string) => ["bills", "detail", id] as const,
  },
  /**
   * The home screen's headline number (lib/safe_to_spend_service.ts).
   *
   * ITS OWN ROOT, not a child of `limits`, even though a limit drives it.
   * Safe-to-Spend is derived from limits AND bills AND goals AND income AND
   * the ledger, so nesting it under any one of those would mean the other four
   * have to remember to reach across and invalidate a foreign prefix. A root
   * of its own is invalidated explicitly by everything that moves it — spec
   * rule 13 lists nine such triggers, and an unlisted one showing a stale
   * headline is the single most visible bug this app can have.
   */
  safeToSpend: {
    all: ["safe_to_spend"] as const,
    today: () => ["safe_to_spend", "today"] as const,
  },
  /**
   * Native listener health (modules/notification_listener). Not persisted and
   * not derived from the database — it is a live read of whether capture is
   * actually working, which is what makes the tracking banner trustworthy.
   */
  listenerHealth: {
    all: ["listener_health"] as const,
    current: () => ["listener_health", "current"] as const,
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
  /**
   * The captured notification text behind m1c Task 7's "Why was this recorded?"
   * panel (lib/db/repos/raw_notifications_repo.ts).
   *
   * TWO KEYS OVER ONE ROW, and the expiry nests under the capture's own
   * `detail` key rather than sitting beside it. `purgeExpiredRawCaptures`
   * removes the text and the expiry in the same DELETE, so anything that
   * invalidates one has to reach the other — a sibling key would let the panel
   * keep counting down to a deletion that has already happened, which is the
   * single most damaging thing this panel can get wrong.
   */
  rawCaptures: {
    all: ["raw_captures"] as const,
    detail: (id: string) => ["raw_captures", "detail", id] as const,
    expiry: (id: string) => ["raw_captures", "detail", id, "expiry"] as const,
    /**
     * Every unexpired capture, newest-captured first — the Privacy centre's
     * "What PeraPlano captured" list (m3b Task 6 rule 3). A SIBLING of
     * `detail`, not a parent of it: the two `WhyRecordedPanel` keys above are
     * per-Transaction reads keyed on a Transaction's `rawNotificationRef`,
     * while this is every raw_notifications row on the device — different
     * questions over the same table, so nesting one under the other would
     * make either's own invalidation over-reach into the other's cache.
     */
    list: () => ["raw_captures", "list"] as const,
  },
  /**
   * The corrections the user has taught the pipeline
   * (lib/db/repos/user_rules_repo.ts).
   *
   * NOTHING READS THIS FAMILY YET — the Categorizer asks the repository
   * directly, mid-parse, outside React Query entirely. The key exists so
   * `useCreateUserRule` names a real one instead of invalidating nothing, and
   * so the settings screen that lists rules (m3b) inherits an invalidation that
   * already fires on every correction rather than having to retrofit it into
   * every write that has shipped by then.
   */
  userRules: {
    all: ["user_rules"] as const,
    list: () => ["user_rules", "list"] as const,
  },
  settings: {
    all: ["settings"] as const,
    /**
     * The master capture pause (m3b Task 6 rule 1). Its OWN key rather than a
     * bare read off `settings.all` because the Privacy centre's capture
     * toggle and the Home tracking banner (`useListenerHealth`) both need to
     * invalidate precisely this value without refetching every other setting
     * on the same write.
     */
    captureEnabled: () => ["settings", "capture_enabled"] as const,
    /**
     * The per-provider pause list (m3b Task 6 rule 2; docs
     * §04-features/11-settings-privacy.md Flow B) — package names, not
     * provider keys; see `AppSettings.paused_provider_packages`'s own doc in
     * lib/db/repos/app_settings_repo.ts for why.
     */
    pausedProviderPackages: () => ["settings", "paused_provider_packages"] as const,
  },
  /**
   * RecurringPatterns — the Subscriptions screen and the locked-in figure
   * (M3 Part 2 Task 6). ONE list, not split by acknowledged/dismissed: the
   * screen needs both the suggested and the already-locked-in patterns to
   * compute Reports rule 17's total, and `listPatterns({ includeAcknowledged })`
   * is a query-time filter over the same underlying rows rather than a
   * separately-cached view — splitting the key would let the two disagree
   * about the same pattern the moment one write updates it.
   */
  recurring: {
    all: ["recurring"] as const,
    list: () => ["recurring", "list"] as const,
  },
  /**
   * Reports (M3b Task 3). `report(scope)` is keyed on the scope object itself
   * — a month or a custom range — the same way `transactions.list(filters)`
   * already keys on a plain filter object: React Query's default hash
   * function compares by structural equality, so an equal (not identical)
   * scope shares one cache entry and a DIFFERENT month or range is a genuine
   * miss rather than a stale reuse. `scopes()` is a sibling, not a child of
   * `report()` — the range picker's month list and `customAllowed` flag
   * depend only on tier and today, never on which scope is currently open.
   */
  reports: {
    all: ["reports"] as const,
    scopes: () => ["reports", "scopes"] as const,
    report: (scope: object) => ["reports", "report", scope] as const,
  },
  /**
   * Parse-outcome counts behind the Parser diagnostics screen (m3b Task 7,
   * `lib/diagnostics/parse_stats_repo.ts`).
   *
   * NOT KEYED ON `sinceMs`, the same reasoning as `limits.statuses()`: the
   * rolling window's start is resolved inside the query function from the
   * system clock, so putting the instant in the key would make every render
   * a cache miss instead of a cache hit that occasionally goes stale.
   */
  parseStats: {
    all: ["parse_stats"] as const,
    stats: () => ["parse_stats", "stats"] as const,
  },
  /**
   * The offline problem-report outbox (`lib/support/support_reports_repo.ts`).
   *
   * `unsent()` is the only list, because it is the only one anything renders:
   * a delivered report has a ticket number and no further story on the phone,
   * while a queued or rejected one is a thing the user is still waiting on.
   *
   * INVALIDATED FROM OUTSIDE THE MUTATION LAYER TOO, which is unusual for a
   * family here. The outbox runner sends in the background — on launch, on
   * foreground, on a timer — so rows change with no user action and no
   * mutation to hang an `onSuccess` off. `hooks/queries/use_support_reports.ts`
   * subscribes to `support:outbox_changed` (lib/events/app_events.ts) and
   * invalidates this key when it fires; without that, a report that sent
   * itself while the user watched the list would stay listed as waiting until
   * the screen was left and re-entered.
   */
  supportReports: {
    all: ["support_reports"] as const,
    unsent: () => ["support_reports", "unsent"] as const,
  },
} as const;
