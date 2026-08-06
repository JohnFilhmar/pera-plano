# Mobile Insight M3 Part 2 — Home, Projection and Recurring Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue `docs/superpowers/plans/2026-08-02-mobile-insight-m3.md` (which ends at Task 1) by putting the Safe-to-Spend number on the Home screen with all its states, adding the Plus projection curve, and detecting recurring spending so users can see what is already committed each month.

**Architecture:** The pure `computeSafeToSpend` engine from Task 1 stays untouched; this plan adds a data-gathering layer that assembles its input from the limits, bills and goals services, a projection function that walks the same engine forward day by day, and a recurring-pattern detector that clusters ledger history. Screens consume services through React Query hooks and never compute money themselves.

**Tech Stack:** TypeScript ~5.9 strict · expo-sqlite via repositories · TanStack React Query · NativeWind · react-native-svg (sparkline) · lucide-react-native · jest + jest-expo + @testing-library/react-native.

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW. Behavior comes from `docs/04-features/09-safe-to-spend.md`; visual treatment from `docs/11-mobile-app-design-prompt.md`. Where this plan and a spec disagree, the spec wins.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** for all money. Format only via `formatPhp` / `AmountText`.
- **Time:** epoch **milliseconds** for timestamps; calendar dates as `'YYYY-MM-DD'` strings.
- **IDs:** UUIDv4 strings via `newId()`.
- **Clock:** no bare `Date.now()` in any testable path — every function takes `now` or `today`.
- **Commits:** Conventional Commits. **No AI-attribution trailer or footer of any kind.**
- **TDD:** named failing test → run it and watch it fail → minimal implementation → run it green → commit.
- **Test commands:** all tests `npx jest --ci`; a single file `npx jest --ci <path>`; typecheck `npx tsc --noEmit`.
- **Working directory:** all commands run from `mobile/`.
- **Density:** exact files, exact interfaces, the rules and named tests that matter — you write the test bodies and the implementation.

### What earlier plans already delivered (consume, do not redo)

| From | You get |
|---|---|
| Foundation | Repositories, entitlements (`hasProjection`, `hasRecurringDetection`), `SoonGate` / `PlusGate`, `queryClient`, app shell |
| M1c | `components/ui/*` primitives, hooks pattern, ledger components |
| M1b | `lib/ingest/pipeline.ts`, the `ledger:committed` event |
| M2 + M2b + M2c | `lib/limits/limit_service.ts` (`getLimitStatuses`), `lib/income/income_service.ts` (`getIncomeSummary`), `lib/goals/goals_service.ts` (`listGoalStatuses`), `lib/bills/bills_service.ts` (`listUpcomingBills`, **`totalDueInPeriod`**, **`promoteRecurringPatternToBill`**) |
| M3 Task 1 | `mobile/lib/period.ts` (`LimitScope`, `parseDate`, `formatDate`, `addDays`, `daysBetweenInclusive`, `lastDayOfMonth`, `periodForScope`) · `mobile/lib/safe_to_spend.ts` (`CandidateLimit`, `UpcomingBill`, `PlannedContribution`, `SafeToSpendInput`, `SafeToSpendResult`, `computeSafeToSpend`) · `mobile/utils/money.ts` (`formatPhp`) |

---

### Task 2: Safe-to-Spend data assembly

**Files:**
- Create: `mobile/lib/safe_to_spend_service.ts`
- Test: `mobile/lib/__tests__/safe_to_spend_service.test.ts`

**Interfaces:**
```ts
buildSafeToSpendInput(today: string, now: number): Promise<SafeToSpendInput>;
getSafeToSpend(today: string, now: number): Promise<SafeToSpendResult>;
```

**Rules:**
1. This module's only job is assembling `SafeToSpendInput` correctly. All arithmetic stays in `computeSafeToSpend` — do not recompute anything here, or the two will drift and the tests in Task 1 will stop protecting the number users actually see.
2. `limits` comes from `getLimitStatuses`, mapped to `CandidateLimit`. **Paused percent-of-income limits are excluded before the engine sees them** (Task 1 rule 10) — a paused limit has no usable value and must not drive the number.
3. `unpaidBills` includes overdue-unresolved cycles as well as upcoming ones, sourced from `listUpcomingBills`. Paid and skipped cycles never appear — `totalDueInPeriod` already enforces this and the same exclusion applies here.
4. `plannedContributions` comes from goals with a contribution rule, forecast within the driving period. Goals with rule `none` contribute nothing.
5. `reviewQueueCount` comes from `review_queue_repo.countOpen()` and only drives the caption; unconfirmed items are never subtracted from the number, per the spec's accepted simplification.
6. Assembly must tolerate an empty app: no limits, no bills, no goals returns a valid input yielding `state: "no_limit"`, never a throw.

- [ ] **Step 1: Write the failing tests** against `createTestDb()` with a pinned `today`:
  - `an empty app yields state no_limit and does not throw`
  - `an active fixed limit becomes a CandidateLimit with its spend in period`
  - `a paused percent-of-income limit is excluded from candidates`
  - `overdue unpaid bills are included in unpaidBills`
  - `paid bill cycles are excluded from unpaidBills`
  - `goals with a contribution rule produce planned contributions inside the period`
  - `goals with rule none produce none`
  - `reviewQueueCount is passed through from countOpen`
  - `getSafeToSpend returns the same result as computeSafeToSpend on the assembled input` (proves no duplicate arithmetic)
- [ ] **Step 2:** Run `npx jest --ci lib/__tests__/safe_to_spend_service.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (9 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/safe_to_spend_service.ts lib/__tests__
  git commit -m "feat(insight): assemble safe-to-spend input from limits, bills and goals"
  ```

---

### Task 3: Projection to end of period (Plus)

**Files:**
- Create: `mobile/lib/safe_to_spend_projection.ts`
- Test: `mobile/lib/__tests__/safe_to_spend_projection.test.ts`

**Interfaces:**
```ts
type ProjectionPoint = { date: string; perDay: Centavos; cumulativeAllowance: Centavos; billsDue: Centavos };
projectToPeriodEnd(input: SafeToSpendInput, result: SafeToSpendResult): ProjectionPoint[];
```

**Rules:**
1. Walk each remaining day of the driving limit's period, recomputing the per-day allowance as bills fall due and days elapse. Assume no unplanned spending — this is a forecast of allowance, not of behavior.
2. The projection's **first point must equal today's `perDay` exactly**. A curve that disagrees with the hero number on day one destroys confidence in both.
3. Days on which a bill falls due show a visible dip: that day's `billsDue` is non-zero and the following days' allowance rises again as the bill leaves the remaining obligations.
4. `state: "no_limit"` and `state: "over"` return an empty array — there is nothing coherent to project.
5. Pure function: same inputs, same curve. No I/O, no clock.

- [ ] **Step 1: Write the failing tests:** the first point equals today's `perDay` · the curve has one point per remaining day inclusive of today · a bill due mid-period produces a dip on its date · allowance rises after a bill is passed · `no_limit` returns an empty array · `over` returns an empty array · a daily-scope limit returns exactly one point · the projection is deterministic across repeated calls.
- [ ] **Step 2:** Run `npx jest --ci lib/__tests__/safe_to_spend_projection.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (8 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/safe_to_spend_projection.ts lib/__tests__
  git commit -m "feat(insight): add safe-to-spend projection curve"
  ```

---

### Task 4: Home tab

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`
- Create: `mobile/components/home/safe_to_spend_hero.tsx`, `limit_progress_list.tsx`, `upcoming_bills_strip.tsx`, `alerts_feed.tsx`, `tracking_banner.tsx`, `projection_sparkline.tsx`
- Create: `mobile/hooks/queries/use_safe_to_spend.ts`, `use_limit_statuses.ts`, `use_listener_health.ts`
- Test: `mobile/components/home/__tests__/safe_to_spend_hero.test.tsx`
- Test: `mobile/app/__tests__/home_screen.test.tsx`

**Rules:**
1. The hero is the largest element on the screen and shows one number. Its four states, per the design brief:
   - `healthy` — brand green, "Safe to spend today".
   - `tight` — warn amber, same label, at or past 80% consumption of the driving limit.
   - `over` — danger, shows `₱0.00` with "You're ₱X over for this period" beneath. Never render a negative number.
   - `no_limit` — a prompt to set a limit, with a direct action. This is the first-run state, so it must invite rather than scold.
2. Beneath the hero, a caption names the driving limit and its scope ("from your monthly limit"), and when `reviewQueueCount > 0` adds "N items awaiting review aren't counted yet" linking to the queue. Users must never wonder why the number looks off.
3. `limit_progress_list` shows each active limit's bar colored by the 50/80/100 thresholds from the limits spec.
4. `projection_sparkline` renders with `react-native-svg` and is wrapped in `PlusGate` — free tier sees today only, per contract §7.
5. `tracking_banner` has two variants driven by `getListenerHealth()`: **interrupted** (danger, states the gap honestly and offers reconciliation) and **paused** (neutral pill, offers resume). Silence about a tracking gap would make every number on the screen a lie.
6. The screen refetches on focus and on the `ledger:committed` event, so a notification captured seconds ago is reflected without a manual pull.

- [ ] **Step 1: Write the failing tests:** each of the four hero states renders its copy and token class (parametrized) · the over state renders ₱0.00 and the over-by line, never a negative · the caption names the driving limit and scope · a non-zero review count renders the not-counted caption linking to the queue · the sparkline renders the Plus gate on free (mock `getTier`) and the curve on plus · limit bars color by threshold band · the interrupted banner renders when the listener reports a gap · the paused pill renders when capture is disabled · a `ledger:committed` event triggers a refetch.
- [ ] **Step 2:** Run `npx jest --ci components/home app/__tests__/home_screen.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/home app/(tabs)/index.tsx hooks
  git commit -m "feat(home): add safe-to-spend hero with all states and projection"
  ```

---

### Task 5: Recurring pattern detector

**Files:**
- Create: `mobile/lib/recurring/pattern_detector.ts`
- Test: `mobile/lib/recurring/__tests__/pattern_detector.test.ts`

**Interfaces:**
```ts
type DetectedPattern = {
  merchant: string; amount: Centavos; periodDays: number; occurrences: number;
  confidence: number; firstSeenAt: number; lastSeenAt: number; nextExpectedAt: number;
  transactionIds: string[];
};
detectPatterns(transactions: Transaction[], now: number): DetectedPattern[];
```

**Rules:**
1. Cluster committed outbound transactions by normalized merchant, then look for a consistent interval and a consistent amount.
2. **Minimum evidence:** the spec's minimum occurrences before a pattern is proposed. Two charges are a coincidence, not a subscription.
3. **Amount tolerance:** amounts within the spec's tolerance band count as the same recurring charge — a subscription that rises by ₱10 is still that subscription. A wildly different amount breaks the cluster.
4. **Interval tolerance:** monthly billing lands on slightly different day gaps (28–31); the detector must treat those as one cadence rather than four.
5. Transfer-linked transactions are excluded — moving money to your own savings every payday is not a subscription.
6. Confidence rises with occurrence count and falls with amount and interval variance.
7. `nextExpectedAt` projects the next charge and is what the UI uses for "next charge in 6 days".
8. Deterministic ordering: highest monthly cost first, so the most useful line is at the top.

- [ ] **Step 1: Write the failing tests:** six identical monthly charges detect one pattern · charges at the minimum-evidence count detect · one below it do not · amounts inside the tolerance band stay one cluster · an amount far outside breaks the cluster · 28-to-31 day gaps are treated as one monthly cadence · weekly charges detect a weekly period · transfer-linked transactions are excluded · inbound transactions are excluded · confidence increases with more occurrences · variance lowers confidence · results are ordered by monthly cost descending · `nextExpectedAt` projects from the last occurrence.
- [ ] **Step 2:** Run `npx jest --ci lib/recurring/__tests__/pattern_detector.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (13 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/recurring
  git commit -m "feat(recurring): add subscription pattern detector"
  ```

---

### Task 6: Recurring service and Subscriptions screen (Plus)

**Files:**
- Create: `mobile/lib/recurring/recurring_service.ts`
- Create: `mobile/lib/db/repos/recurring_patterns_repo.ts`
- Create: `mobile/app/more/subscriptions.tsx`
- Create: `mobile/components/recurring/pattern_card.tsx`, `locked_in_header.tsx`
- Create: `mobile/hooks/queries/use_recurring_patterns.ts`, `mobile/hooks/mutations/use_promote_to_bill.ts`, `use_acknowledge_pattern.ts`
- Test: `mobile/lib/db/repos/__tests__/recurring_patterns_repo.test.ts`
- Test: `mobile/lib/recurring/__tests__/recurring_service.test.ts`
- Test: `mobile/components/recurring/__tests__/subscriptions_screen.test.tsx`

**Interfaces:**
```ts
// recurring_patterns_repo.ts
upsertPattern(p: DetectedPattern): Promise<RecurringPattern>;      // keyed on merchant + periodDays
listPatterns(opts?: { includeAcknowledged?: boolean }): Promise<RecurringPattern[]>;
acknowledgePattern(id: string): Promise<void>;
dismissPattern(id: string): Promise<void>;
// recurring_service.ts
refreshPatterns(now: number): Promise<RecurringPattern[]>;
monthlyLockedIn(patterns: RecurringPattern[]): Centavos;
promotePatternToBill(patternId: string, now: number): Promise<Bill>;
```

**Rules:**
1. `monthlyLockedIn` normalizes every pattern to a monthly cost (weekly × 52/12, and so on) and sums them. This single figure — "₱1,548 a month locked in" — is the whole point of the feature.
2. `promotePatternToBill` delegates to `promoteRecurringPatternToBill` from the bills service (M2c Task 4). Do not reimplement the cadence-to-rule mapping here; call it and mark the pattern acknowledged on success.
3. Dismissed patterns stay dismissed and are not re-proposed unless their amount or cadence changes materially.
4. `refreshPatterns` runs on the `ledger:committed` event, debounced, and on app foreground.
5. **The whole feature is Plus.** Wrap the More-tab entry in `PlusGate` driven by `hasRecurringDetection()`. Free users see the row and a one-line explanation of what it does — a locked door they can see through converts better than a hidden one.
6. Empty state on Plus: "Nothing recurring spotted yet — we'll flag subscriptions as they repeat."

- [ ] **Step 1: Write the failing tests** for the repo: upsert keyed on merchant plus period does not duplicate · acknowledge and dismiss filter correctly · list ordering is stable. Run, implement, green, commit.
- [ ] **Step 2: Write the failing tests** for the service: `monthlyLockedIn` normalizes weekly and monthly to a monthly total · `promotePatternToBill` calls the bills promotion and acknowledges the pattern · promoting twice does not create two bills · a dismissed pattern is not re-proposed on refresh · a materially changed dismissed pattern is proposed again · `refreshPatterns` is debounced across a burst of ledger events.
- [ ] **Step 3:** Run `npx jest --ci lib/recurring` — expected FAIL. Implement. Run — expected PASS.
- [ ] **Step 4: Write the failing tests** for the screen: the locked-in header renders the monthly total · each card renders amount, cadence and next expected date · promote calls the mutation · dismiss removes the card · the More-tab entry renders the Plus gate on free · the empty state renders on plus with no patterns.
- [ ] **Step 5:** Run `npx jest --ci components/recurring` — expected FAIL. Implement. Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit**
  ```
  git add lib/recurring lib/db/repos app/more components/recurring hooks
  git commit -m "feat(recurring): add subscriptions screen with promote-to-bill"
  ```

---

### Task 7: Ship home and recurring

**Files:**
- Modify: `mobile/constants/shipped_features.ts`
- Modify: `mobile/lib/bootstrap.ts`
- Modify: `mobile/app/_layout.tsx`
- Test: `mobile/app/__tests__/home_screen.test.tsx` (extend)

**Rules:**
1. Flip `safe_to_spend` and `recurring` to `"shipped"`.
2. Bootstrap calls `refreshPatterns(now)` once after migrations, and the layout subscribes it to debounced `ledger:committed` events.
3. Pattern detection must never block startup or the ingest loop; wrap it so a throw is logged and everything else proceeds.

- [ ] **Step 1: Extend the failing tests:** Home renders without a Soon wrapper · bootstrap refreshes patterns · a throwing refresh does not break bootstrap · a burst of ledger events triggers one debounced refresh.
- [ ] **Step 2:** Run `npx jest --ci app/__tests__/home_screen.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite `npx jest --ci` — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add constants/shipped_features.ts lib/bootstrap.ts app
  git commit -m "feat(insight): ship home safe-to-spend and recurring detection"
  ```

---

## Plan completion checklist (for the executor)

- [ ] Tasks 2–7 committed; `npx jest --ci` green; `npx tsc --noEmit` clean.
- [ ] No money arithmetic was duplicated outside `computeSafeToSpend` — the service only assembles input.
- [ ] Paused percent-of-income limits never drive the number; paid bill cycles never subtract from it.
- [ ] The projection's first point equals today's per-day figure exactly.
- [ ] The over state renders ₱0.00 plus an over-by line, never a negative number.
- [ ] The review-queue caption appears whenever unconfirmed items exist.
- [ ] Recurring detection requires the spec's minimum occurrences and excludes transfers.
- [ ] Promotion to a Bill calls the M2c function rather than reimplementing cadence mapping.
- [ ] `safe_to_spend` and `recurring` are `"shipped"`.
- [ ] Next plans unblocked: `2026-08-02-mobile-insight-m3b-reports-settings.md`, then `-m3c-onboarding-client.md`.
