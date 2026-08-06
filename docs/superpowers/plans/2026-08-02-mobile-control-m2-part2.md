# Mobile Control M2 Part 2 — Income Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue `docs/superpowers/plans/2026-08-02-mobile-control-m2.md` (which ends at Task 9) by finishing the income half of M2 — cadence detection tuned for Philippine payroll, the income profile service that manual override always wins over, the monthly-equivalent figure that percent-of-income Limits depend on, the payday event later features subscribe to, and the Income screen.

**Architecture:** Detection is a pure function over candidate income events, separated from the service that persists a profile and from the UI that presents it. Nothing infers income from a live clock: every function takes `now`, so the same fixtures produce the same answers in tests and in production. The service publishes `payday:detected` on the shared event bus rather than calling goals or limits directly, so later plans subscribe without this one knowing they exist.

**Tech Stack:** TypeScript ~5.9 strict · expo-sqlite via repositories · TanStack React Query · NativeWind · jest + jest-expo + @testing-library/react-native.

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW. Behavior comes from `docs/04-features/04-income.md`; where this plan and that spec disagree, the spec wins and the plan is the bug.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** for all money. Format to `₱1,234.56` only via `AmountText` / `formatCentavos`.
- **Time:** epoch **milliseconds** for timestamps; calendar dates as `'YYYY-MM-DD'` strings.
- **IDs:** UUIDv4 strings via `newId()`.
- **Clock:** no bare `Date.now()` in any testable path — every function takes `now: number`.
- **Commits:** Conventional Commits. **No AI-attribution trailer or footer of any kind.**
- **TDD:** named failing test → run it and watch it fail → minimal implementation → run it green → commit.
- **Test commands:** all tests `npx jest --ci`; a single file `npx jest --ci <path>`; typecheck `npx tsc --noEmit`.
- **Working directory:** all commands run from `mobile/`.
- **Density:** exact files, exact interfaces, the rules and named tests that matter — you write the test bodies and the implementation.

### What Tasks 1–9 already delivered (consume, do not redo)

| From | You get |
|---|---|
| Task 1 | `mobile/lib/clock.ts`, `mobile/lib/money.ts`, `mobile/lib/dates.ts`, `mobile/lib/event_bus.ts`, `mobile/lib/db/db_handle.ts` → `setDbHandleForTests`, `mobile/test/db_harness.ts` → `createTestDb` |
| Task 2 | `mobile/lib/alerts/` → `CHANNEL_LIMITS`, `CHANNEL_REMINDERS`, `ensureNotificationChannels()`, `requestAlertPermission()`, `postAlert()`, `scheduleReminder()`, `cancelScheduled()` |
| Tasks 3–7 | `limits_repo`, `mobile/lib/limits/limit_engine.ts` (`baseFor`, `carryoverFor`, `effectiveLimitFor`, `crossedThreshold`, `coalesceAlerts`, `expandCategoryIds`), `limit_service.ts` (`recomputeLimits`, `getLimitStatuses`, `muteLimitForPeriod`, **`refreshLimitBase`**) |
| Task 8 | Routes `/plan/limits`, `/plan/limits/new`, `/plan/limits/[id]`; `LimitCard`; **`controlQueryKeys`** factory (`limits`, `income`, `goals`, `loans`, `bills` families) |
| Task 9 | `income_repo` → `getIncomeProfile`, `saveIncomeProfile`, `clearIncomeProfile`, `getIncomeDetectionState`, `setIncomeDetectionState`, `listLoanPaymentTransactionIds`; types `Cadence`, `IncomeDetectionState`, `CandidateEvent`; `selectCandidates()`, `primaryStream()` |

---

### Task 10: Cadence detection — the pure classifier

**Files:**
- Create: `mobile/lib/income/cadence_detector.ts`
- Test: `mobile/lib/income/__tests__/cadence_detector.test.ts`

**Interfaces:**
```ts
type CadenceEvidence = {
  cadence: Cadence;
  confidence: number;              // 0..1
  matchedEventIds: string[];
  expectedNextAt: number | null;   // epoch ms; null for "irregular"
};
detectCadence(events: CandidateEvent[], now: number): CadenceEvidence;
```

**Rules (from `docs/04-features/04-income.md`):**
1. **Kinsenas is the default hypothesis** — Philippine payroll overwhelmingly lands on the 15th and the last day of the month. Test it first, and only fall through when the evidence does not support it.
2. **Payday-window tolerance:** a payment counts as landing on its expected day when it falls within the spec's tolerance window around it. Payroll slides earlier for weekends and holidays and later for processing delays, so the window is asymmetric — earlier tolerance is wider than later. Use the exact values in the spec.
3. **Month-end handling:** "the 30th" means the last day of the month. February pays on the 28th or 29th; a 31-day month pays on the 31st. A detector that hard-codes 30 will mis-classify a third of the year.
4. **Evidence threshold:** a cadence is only proposed once the spec's minimum number of matching events is present. Below it the result is `irregular` with low confidence — never guess a cadence from a single deposit.
5. **Weekly** requires matching events at a consistent weekday and interval; **monthly** requires one consistent day-of-month that is not the kinsenas pattern.
6. **Irregular** is a legitimate answer, not a failure. Gig workers genuinely have no cadence, and the app must say so rather than inventing one.
7. `expectedNextAt` projects the next payday from the detected pattern, and is what the payday event and the goals auto-allocation prompt key off.

- [ ] **Step 1: Write the failing tests** with fixed timestamps (build fixtures with explicit ISO dates, never a live clock):
  - `six deposits on the 15th and month-end detect kinsenas with high confidence`
  - `kinsenas is detected when a payday slides earlier across a weekend` (within tolerance)
  - `kinsenas is detected in February where month-end is the 28th`
  - `kinsenas is detected in a 31-day month where month-end is the 31st`
  - `a payday outside the tolerance window does not count as a match`
  - `four weekly deposits on the same weekday detect weekly`
  - `four deposits on the same day of month detect monthly, not kinsenas`
  - `scattered deposits with no pattern detect irregular with low confidence`
  - `a single deposit detects irregular` (evidence threshold regression)
  - `expectedNextAt for kinsenas points at the next 15th or month-end after now`
  - `expectedNextAt is null for irregular`
  - `detection is pure — the same fixtures and now always produce the same result`
- [ ] **Step 2:** Run `npx jest --ci lib/income/__tests__/cadence_detector.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement `cadence_detector.ts`.
- [ ] **Step 4:** Run — expected PASS (12 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/income
  git commit -m "feat(income): add cadence detector with PH payday tolerances"
  ```

---

### Task 11: Average amount and monthly-equivalent conversion

**Files:**
- Create: `mobile/lib/income/income_math.ts`
- Test: `mobile/lib/income/__tests__/income_math.test.ts`

**Interfaces:**
```ts
averageAmountFor(events: CandidateEvent[]): Centavos;          // median, not mean
monthlyEquivalent(cadence: Cadence, averageAmount: Centavos): Centavos;
```

**Rules:**
1. **Median, not mean.** A 13th-month pay or a one-off bonus would drag a mean upward and silently inflate every percent-of-income Limit for months. The spec calls for a median; take it over the most recent window it specifies.
2. Even-count medians average the two middle values and round to the nearest centavo — never truncate, or repeated recomputation drifts downward.
3. Monthly equivalents: `kinsenas` → `averageAmount × 2`; `weekly` → `averageAmount × 52 / 12` rounded to the nearest centavo; `monthly` → `averageAmount`; `irregular` → the spec's fallback (a trailing average over its stated window).
4. Rounding is to the nearest centavo, half away from zero, applied once at the end — never compound intermediate rounding.

- [ ] **Step 1: Write the failing tests:** the median ignores a single large outlier (assert a mean would differ) · an even count averages the two middle values · an odd count takes the middle · an empty list returns 0 · kinsenas doubles · weekly converts with the 52/12 factor and rounds to the centavo · monthly passes through · irregular uses the trailing-average fallback · conversion is exact at the centavo for a known worked vector.
- [ ] **Step 2:** Run `npx jest --ci lib/income/__tests__/income_math.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (9 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/income
  git commit -m "feat(income): add median average and monthly equivalent conversion"
  ```

---

### Task 12: Income service — detection state, override, and the payday event

**Files:**
- Create: `mobile/lib/income/income_service.ts`
- Test: `mobile/lib/income/__tests__/income_service.test.ts`

**Interfaces:**
```ts
type IncomeSummary = {
  cadence: Cadence | null;
  averageAmount: Centavos | null;
  monthlyEquivalent: Centavos | null;      // consumed by percent-of-income Limits
  status: IncomeDetectionState["status"];  // unknown | provisional | confirmed | lapsed
  isManualOverride: boolean;
  expectedNextAt: number | null;
  sourceWalletIds: string[];
};
refreshIncomeDetection(now: number): Promise<IncomeSummary>;
getIncomeSummary(now: number): Promise<IncomeSummary>;
confirmDetectedIncome(now: number): Promise<IncomeSummary>;      // provisional → confirmed
dismissDetectedIncome(now: number): Promise<void>;               // records the dismissed signature
setManualIncome(input: { cadence: Cadence; averageAmount: Centavos; sourceWalletIds: string[] }, now: number): Promise<IncomeSummary>;
clearManualIncome(now: number): Promise<IncomeSummary>;          // reverts to detection
maybeEmitPayday(now: number): Promise<boolean>;                  // true when it emitted
const PAYDAY_EVENT = "payday:detected";
type PaydayEvent = { at: number; amount: Centavos; walletId: string; cadence: Cadence };
```

**Rules:**
1. **Manual override always wins.** When `isManualOverride` is true, detection still runs and still records its state, but `getIncomeSummary` returns the manual values. Detection must never quietly overwrite what the user typed.
2. Status transitions: `unknown` → `provisional` when the evidence threshold is first met → `confirmed` when the user accepts → `lapsed` when `missedWindows` exceeds the spec's allowance. A lapsed profile keeps its last known values (so percent Limits do not collapse to zero) but surfaces a "has your pay changed?" prompt.
3. **A dismissed suggestion stays dismissed** for the same signature. Re-prompting a user who already said no is how apps get uninstalled.
4. `maybeEmitPayday` fires `PAYDAY_EVENT` at most once per expected payday window, deduplicated by the matched transaction id — a retry or a re-render must not double-fire and cause a double auto-allocation.
5. Any change to the effective income (manual set, cleared, or a confirmed detection) calls `refreshLimitBase` for every percent-of-income Limit, per the immediate-recompute exception in the limits spec.
6. When income is unknown, `monthlyEquivalent` is `null` and percent-of-income Limits show as **Paused**, per `baseFor` (M2 Task 5). Never substitute zero — a zero base reads as "you have spent infinity percent of your limit".

- [ ] **Step 1: Write the failing tests** against a real `createTestDb()` with a pinned clock:
  - `detection reaching the evidence threshold sets status provisional`
  - `confirmDetectedIncome moves provisional to confirmed`
  - `a manual override wins over a conflicting detection`
  - `clearManualIncome reverts to the detected values`
  - `a dismissed suggestion is not re-proposed for the same signature`
  - `a changed signature does propose again`
  - `missing more than the allowed windows marks the profile lapsed but keeps its values`
  - `setManualIncome triggers refreshLimitBase for percent-of-income limits`
  - `monthlyEquivalent is null when income is unknown`
  - `maybeEmitPayday emits once inside the window`
  - `maybeEmitPayday does not emit twice for the same payday`
  - `maybeEmitPayday does not emit outside the window`
  - `the emitted PaydayEvent carries at, amount, walletId and cadence`
- [ ] **Step 2:** Run `npx jest --ci lib/income/__tests__/income_service.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (13 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/income
  git commit -m "feat(income): add income service with override precedence and payday events"
  ```

---

### Task 13: Income screen

**Files:**
- Create: `mobile/app/plan/income.tsx`
- Create: `mobile/components/income/income_summary_card.tsx`, `cadence_picker.tsx`, `income_form.tsx`, `payday_detected_sheet.tsx`
- Create: `mobile/hooks/queries/use_income_summary.ts`, `mobile/hooks/mutations/use_set_manual_income.ts`
- Test: `mobile/components/income/__tests__/income_screen.test.tsx`

**Rules:**
1. The summary card leads with the plain-language sentence the user cares about: "You're paid twice a month, around ₱18,500 each time" — not a cadence enum.
2. Detection status is honest and visible: provisional shows "We think we spotted your payday" with Confirm and Not right actions; confirmed shows a quiet checkmark; lapsed shows the "has your pay changed?" prompt.
3. The manual form offers the four cadences, an amount, and source wallets, and states plainly that manual values override detection.
4. When income is unknown, the screen explains what depends on it — percent-of-income Limits are paused until income is known — with a direct link to set it manually.
5. `payday_detected_sheet` is presented by the app shell when `PAYDAY_EVENT` fires; it summarizes the detected payday and hands off to goals auto-allocation (built in the goals plan, which subscribes to the same event).
6. Route lives under the Plan tab: `/plan/income`.

- [ ] **Step 1: Write the failing tests:** the summary renders the plain-language sentence for each cadence (parametrized) · provisional renders Confirm and Not right · confirming calls `confirmDetectedIncome` · dismissing calls `dismissDetectedIncome` · lapsed renders the changed-pay prompt · unknown renders the paused-limits explanation and the manual link · submitting the manual form calls `setManualIncome` with the entered values · the manual form states that it overrides detection · the payday sheet renders the amount and date from the event.
- [ ] **Step 2:** Run `npx jest --ci components/income` — expected FAIL.
- [ ] **Step 3:** Implement the hooks, components, and route.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/income app/plan/income.tsx hooks
  git commit -m "feat(income): add income screen with detection status and manual override"
  ```

---

### Task 14: Wire income into startup and the ledger loop

**Files:**
- Modify: `mobile/lib/bootstrap.ts`
- Modify: `mobile/app/_layout.tsx`
- Test: `mobile/lib/__tests__/bootstrap.test.ts` (extend)

**Rules:**
1. On bootstrap, run `refreshIncomeDetection(now)` and then `maybeEmitPayday(now)` — once, after migrations and the ingest start.
2. Subscribe to the `ledger:committed` event emitted by the ingest pipeline (M1b Task 10 rule 7): an incoming credit may complete the evidence for detection, so re-run detection on commit, debounced so a burst of drained captures triggers one pass.
3. Income work must never block or break startup: wrap it so a throw is logged and the app still renders.
4. The root layout presents `payday_detected_sheet` when `PAYDAY_EVENT` fires while the app is foregrounded.

- [ ] **Step 1: Extend the failing tests:** bootstrap runs income detection after migrations · a `ledger:committed` burst triggers exactly one debounced detection pass · a throwing detection does not prevent bootstrap from resolving · `PAYDAY_EVENT` while foregrounded shows the sheet.
- [ ] **Step 2:** Run `npx jest --ci lib/__tests__/bootstrap.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite `npx jest --ci` — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/bootstrap.ts app/_layout.tsx lib/__tests__
  git commit -m "feat(income): run income detection on bootstrap and ledger commits"
  ```

---

## Plan completion checklist (for the executor)

- [ ] Tasks 10–14 committed; `npx jest --ci` green; `npx tsc --noEmit` clean.
- [ ] Kinsenas detection handles February and 31-day months correctly (the month-end tests pass).
- [ ] Averages use the median; a single bonus cannot inflate percent-of-income Limits.
- [ ] Manual override wins over detection everywhere, and a dismissed suggestion stays dismissed.
- [ ] Unknown income yields `null`, never zero, and percent-of-income Limits read as Paused.
- [ ] `PAYDAY_EVENT` fires at most once per payday, deduplicated by transaction id.
- [ ] No bare `Date.now()` in `lib/income/` (grep to confirm).
- [ ] Next plans unblocked: `2026-08-02-mobile-control-m2b-goals-loans.md` (subscribes to `PAYDAY_EVENT`) and `-m2c-bills.md`.
