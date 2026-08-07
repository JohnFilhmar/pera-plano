# Mobile Control M2c — Bills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ### ⚠️ Amended by the encryption plan (2026-08-07)
> `2026-08-07-encryption-foundation.md` Task 9b makes **amount-free alert copy on the lock screen
> mandatory**. Every notification this plan posts must supply BOTH variants:
> - **locked** — no amount, no balance, no counterparty, no parsed merchant. A bill or wallet name
>   the user chose is fine. "You've reached 80% of your monthly limit."
> - **unlocked** — the full figure. "You've spent ₱8,400 of your ₱10,000 monthly limit."
>
> Select with `selectAlertCopy(copy, await isKeyguardLocked())` **at post time**, never at schedule
> time — a reminder queued days earlier cannot know the phone's state when it fires. A task that
> supplies one string instead of two is incomplete.


**Goal:** Track recurring obligations — Meralco, Maynilad, rent, tuition, subscriptions — with Philippine-shaped due rules, amounts that learn from payment history, reminders that fire before the due date, and payments matched from the ledger instead of typed in.

**Architecture:** A pure due-rule engine computes occurrence dates from a rule plus a clock; a pure estimator derives the expected amount from matched history; a service composes both with the ledger and the alerts layer; screens live under the Plan tab. Bills also expose the promotion entry point that the M3 recurring-pattern detector calls when a detected subscription is turned into a tracked Bill.

**Tech Stack:** TypeScript ~5.9 strict · expo-sqlite via repositories · TanStack React Query · NativeWind · lucide-react-native · jest + jest-expo + @testing-library/react-native.

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW. Behavior comes from `docs/04-features/07-bills.md`; where this plan and that spec disagree, the spec wins and the plan is the bug.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** for all money. Format only via `AmountText` / `formatCentavos`.
- **Time:** epoch **milliseconds** for timestamps; calendar dates as `'YYYY-MM-DD'` strings. Due dates are calendar dates, never timestamps — "due the 20th" has no time of day.
- **IDs:** UUIDv4 strings via `newId()`.
- **Clock:** no bare `Date.now()` in any testable path — every function takes `now: number`.
- **Commits:** Conventional Commits. **No AI-attribution trailer or footer of any kind.**
- **TDD:** named failing test → run it and watch it fail → minimal implementation → run it green → commit.
- **Test commands:** all tests `npx jest --ci`; a single file `npx jest --ci <path>`; typecheck `npx tsc --noEmit`.
- **Working directory:** all commands run from `mobile/`.
- **Density:** exact files, exact interfaces, the rules and named tests that matter — you write the test bodies and the implementation.

### What earlier plans already delivered (consume, do not redo)

| From | You get |
|---|---|
| Foundation | Repositories (contract §3), entitlements, gates, `queryClient`, app shell |
| M1c | `components/ui/*` primitives, hooks pattern, ledger components |
| M2 Task 1 | `lib/clock.ts`, `lib/money.ts`, `lib/dates.ts`, `lib/event_bus.ts`, `lib/db/db_handle.ts`, `test/db_harness.ts` → `createTestDb` |
| M2 Task 2 | `lib/alerts/` → `CHANNEL_REMINDERS`, `postAlert()`, `scheduleReminder()`, `cancelScheduled()` |
| M2 Task 8 | `controlQueryKeys` factory and the `/plan` hub |
| M2b | Payment-matching pattern to mirror (`findPaymentCandidates` / `confirmPaymentMatch` in `lib/loans/loans_service.ts`) |

---

### Task 1: Bills repository

**Files:**
- Create: `mobile/lib/db/repos/bills_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/bills_repo.test.ts`

**Interfaces:**
```ts
type DueRule =
  | { kind: "day_of_month"; day: number; weekdayAdjust?: "none" | "before" | "after" }
  | { kind: "kinsenas" }                                    // the 15th and the last day of the month
  | { kind: "last_day" }
  | { kind: "every_n_days"; days: number; anchorDate: string }
  | { kind: "annual"; month: number; day: number };
type AmountMode = { kind: "fixed"; amount: Centavos } | { kind: "estimated"; seed: Centavos };
type NewBill = {
  name: string; categoryId: string; dueRule: DueRule; amountMode: AmountMode;
  reminderOffsetsDays: number[];                            // e.g. [3, 0]
  walletId?: string | null; autoMatch?: boolean; note?: string;
};
createBill(input: NewBill): Promise<Bill>;
getBill(id: string): Promise<Bill | null>;
listBills(opts?: { includeArchived?: boolean }): Promise<Bill[]>;
updateBill(id: string, patch: Partial<NewBill>): Promise<Bill>;
archiveBill(id: string): Promise<void>;
recordBillPayment(input: { billId: string; dueDate: string; amount: Centavos; paidAt: number; transactionId?: string | null }): Promise<BillPayment>;
listBillPayments(billId: string): Promise<BillPayment[]>;
deleteBillPayment(id: string): Promise<void>;
```

**Rules:**
1. One `BillPayment` per (`billId`, `dueDate`) — paying the same occurrence twice is a correction, not a second payment. Recording again for the same due date updates the existing row.
2. `reminderOffsetsDays` are whole days before the due date; `0` means on the due date itself. Store sorted descending and deduplicated.
3. Archiving preserves payment history; bills are never hard-deleted, because history feeds the estimator.
4. `day_of_month` with a day greater than the month's length clamps to the last day (see Task 2).

- [ ] **Step 1: Write the failing tests:** create-then-get round-trips every `DueRule` variant (parametrized over five) · both `AmountMode` variants round-trip · a second payment for the same due date updates rather than duplicates · reminder offsets are stored sorted and deduplicated · archiving hides the bill but keeps its payments · `listBillPayments` is chronological.
- [ ] **Step 2:** Run `npx jest --ci lib/db/repos/__tests__/bills_repo.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (6 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/db/repos
  git commit -m "feat(bills): add bills repository with payment history"
  ```

---

### Task 2: Due-rule engine

The calendar is where date code goes wrong. Every rule below has a test because every one of them has bitten a real app.

**Files:**
- Create: `mobile/lib/bills/due_rules.ts`
- Test: `mobile/lib/bills/__tests__/due_rules.test.ts`

**Interfaces:**
```ts
nextOccurrence(rule: DueRule, afterDate: string): string;              // 'YYYY-MM-DD', strictly after afterDate
occurrencesBetween(rule: DueRule, fromDate: string, toDate: string): string[];   // inclusive bounds
isOverdue(dueDate: string, paid: boolean, today: string): boolean;
daysUntil(dueDate: string, today: string): number;                     // negative when past
```

**Rules:**
1. **Month-length clamping.** `day_of_month: 31` is the 28th in February (29th in a leap year), the 30th in April. Never roll into the next month — a bill due the 31st is not due on March 3rd.
2. **Leap years** are handled by real calendar arithmetic, not a 365-day assumption.
3. `kinsenas` yields two occurrences per month: the 15th and the last day.
4. **Weekday adjustment** applies only when `weekdayAdjust` is not `"none"`: `"before"` moves a Saturday or Sunday due date back to the preceding Friday; `"after"` moves it forward to the following Monday. Adjustment happens **after** clamping, and an adjustment must never cross into another month — if it would, fall back to the nearest weekday inside the month.
5. `every_n_days` counts from `anchorDate` in whole days, immune to daylight-saving shifts (Philippines has none, but the arithmetic must not depend on that).
6. **Year rollover:** December's next occurrence is in January of the following year. `annual` rolls the year correctly, and February 29th in a non-leap year falls back to the 28th.
7. All comparisons are on calendar dates in device-local time. A bill due today is never overdue.

- [ ] **Step 1: Write the failing tests:**
  - `day_of_month 31 clamps to 28 in a non-leap February`
  - `day_of_month 31 clamps to 29 in a leap February`
  - `day_of_month 31 clamps to 30 in April`
  - `day_of_month 15 in a 31-day month is unchanged`
  - `kinsenas yields the 15th and the last day of the month`
  - `last_day yields 28, 29, 30 or 31 depending on the month`
  - `weekdayAdjust before moves a Sunday due date to the preceding Friday`
  - `weekdayAdjust after moves a Saturday due date to the following Monday`
  - `weekday adjustment never crosses a month boundary`
  - `every_n_days counts whole days from the anchor`
  - `December rolls over into January of the next year`
  - `annual on February 29 falls back to February 28 in a non-leap year`
  - `occurrencesBetween is inclusive of both bounds`
  - `a bill due today is not overdue`
  - `an unpaid bill due yesterday is overdue`
  - `a paid bill is never overdue`
  - `daysUntil is negative for a past date`
- [ ] **Step 2:** Run `npx jest --ci lib/bills/__tests__/due_rules.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (17 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/bills
  git commit -m "feat(bills): add due rule engine with calendar clamping"
  ```

---

### Task 3: Amount estimator

**Files:**
- Create: `mobile/lib/bills/amount_estimator.ts`
- Test: `mobile/lib/bills/__tests__/amount_estimator.test.ts`

**Interfaces:**
```ts
type AmountEstimate = { amount: Centavos; basis: "fixed" | "seed" | "history"; sampleSize: number; spread: Centavos };
estimateAmount(bill: Bill, payments: BillPayment[]): AmountEstimate;
```

**Rules:**
1. A `fixed` bill returns its amount with basis `"fixed"`. No estimation, no drift.
2. An `estimated` bill with fewer than the spec's minimum sample returns the `seed` with basis `"seed"`.
3. At or above the minimum sample, return the **median** of the most recent payments within the spec's window, with basis `"history"`. Median, not mean: a single summer electricity spike must not permanently raise every future estimate.
4. `spread` reports the interquartile range, which the UI uses to say "usually ₱1,800–₱2,400" instead of a false-precision single figure. Variable utilities are honest about being variable.
5. Estimates never go negative and never return zero from a non-empty history.

- [ ] **Step 1: Write the failing tests:** a fixed bill returns its amount with basis fixed · an estimated bill below the minimum sample returns the seed · at the minimum sample it switches to history · the median ignores a single spike (assert a mean would differ) · `spread` reflects the interquartile range · `sampleSize` reports the payments actually used · payments outside the window are excluded · an empty history never returns zero when a seed exists.
- [ ] **Step 2:** Run `npx jest --ci lib/bills/__tests__/amount_estimator.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (8 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/bills
  git commit -m "feat(bills): add median-based amount estimator"
  ```

---

### Task 4: Bills service — status, matching, reminders, promotion

**Files:**
- Create: `mobile/lib/bills/bills_service.ts`
- Test: `mobile/lib/bills/__tests__/bills_service.test.ts`

**Interfaces:**
```ts
type BillStatus = {
  bill: Bill; dueDate: string; estimate: AmountEstimate;
  state: "upcoming" | "due_today" | "overdue" | "paid";
  daysUntil: number; paidPayment: BillPayment | null;
};
listUpcomingBills(now: number, horizonDays: number): Promise<BillStatus[]>;
findBillPaymentCandidates(billId: string, dueDate: string, now: number): Promise<PaymentCandidate[]>;
confirmBillPaymentMatch(billId: string, dueDate: string, transactionId: string, now: number): Promise<BillPayment>;
scheduleBillReminders(now: number): Promise<void>;
promoteRecurringPatternToBill(input: {
  merchant: string; amount: Centavos; periodDays: number; categoryId: string; firstSeenAt: number;
}, now: number): Promise<Bill>;
totalDueInPeriod(fromDate: string, toDate: string, now: number): Promise<Centavos>;   // consumed by Safe-to-Spend
```

**Rules:**
1. **The auto-match confirmation ladder** from the spec: a candidate matching the expected amount closely, in the right category or wallet, within the due window, is proposed with high confidence and one-tap confirm. Weaker matches are proposed with the differences shown. Nothing is recorded without confirmation — the same discipline as loans.
2. Only outbound transactions are candidates, and a transaction already linked to any bill or loan payment is never offered.
3. Reminders schedule at each `reminderOffsetsDays` entry before the due date, on `CHANNEL_REMINDERS`, using the current estimate in the body ("Meralco is usually around ₱2,100 — due in 3 days"). Recording the payment cancels that occurrence's remaining reminders.
4. **Overdue is stateful, not cosmetic:** an unpaid occurrence past its due date stays in the list until paid or explicitly skipped, and does not silently roll into the next occurrence.
5. `promoteRecurringPatternToBill` is the entry point M3's detector calls. It converts a detected cadence in days into the closest `DueRule` (roughly monthly → `day_of_month` at the observed day; roughly 15-day → `kinsenas`; otherwise `every_n_days`), seeds the amount as `estimated`, defaults reminders to the spec's defaults, and returns the created Bill. **This plan builds and tests the function; the detector that calls it ships in M3.**
6. `totalDueInPeriod` sums the estimates of unpaid occurrences in a date range, and is what Safe-to-Spend subtracts. It must exclude already-paid occurrences or the user's spendable figure will be wrong twice over.

- [ ] **Step 1: Write the failing tests** against `createTestDb()` with a pinned clock:
  - `listUpcomingBills reports upcoming, due_today, overdue and paid states`
  - `an overdue unpaid occurrence stays listed and does not roll forward`
  - `an exact-amount outbound transaction in the due window is a high-confidence candidate`
  - `an inbound transaction is never a candidate`
  - `a transaction already linked to a loan payment is never a candidate`
  - `confirming a match records the payment for that due date`
  - `confirming twice for the same due date updates rather than duplicates`
  - `reminders are scheduled at each configured offset`
  - `recording a payment cancels that occurrence's reminders`
  - `promoteRecurringPatternToBill maps a ~30-day cadence to day_of_month`
  - `promoteRecurringPatternToBill maps a ~15-day cadence to kinsenas`
  - `promoteRecurringPatternToBill maps an odd cadence to every_n_days`
  - `totalDueInPeriod sums unpaid occurrences only`
  - `totalDueInPeriod excludes paid occurrences` (Safe-to-Spend regression)
- [ ] **Step 2:** Run `npx jest --ci lib/bills/__tests__/bills_service.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (14 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/bills
  git commit -m "feat(bills): add bills service with matching, reminders and promotion"
  ```

---

### Task 5: Bills UI

**Files:**
- Create: `mobile/app/plan/bills/index.tsx`, `new.tsx`, `[id].tsx`
- Create: `mobile/components/bills/bill_row.tsx`, `due_chip.tsx`, `bill_form.tsx`, `due_rule_picker.tsx`, `bill_match_sheet.tsx`
- Create: `mobile/hooks/queries/use_bills.ts`, `use_bill.ts`, `mobile/hooks/mutations/use_record_bill_payment.ts`
- Test: `mobile/components/bills/__tests__/due_chip.test.tsx`
- Test: `mobile/components/bills/__tests__/bill_form.test.tsx`
- Test: `mobile/app/__tests__/bills_screen.test.tsx`

**Rules:**
1. The list is ordered by urgency: overdue first, then due today, then upcoming by date. A header shows the total due in the next 30 days.
2. `due_chip` states: `overdue` danger, `due today` warn, `due in Nd` neutral, `paid` brand with a check.
3. An estimated amount renders as a range with a "usually" qualifier when `spread` is meaningful, and as a single figure when the history is tight. Never present an estimate as if it were a bill you have received.
4. `due_rule_picker` offers the five rule kinds in plain language — "Every month on the 20th", "Every 15th and month-end", "Last day of the month", "Every N days", "Once a year" — with a live preview of the next three occurrence dates. The preview is what catches a misconfigured rule before it silently misfires for months.
5. The detail screen shows payment history with each occurrence's due date, paid date, and amount, plus the current estimate and its basis.
6. Bills are not capped by tier — an untracked bill is a missed payment, and the free tier must remain genuinely useful.
7. Empty state: "No bills tracked yet — add the ones you never want to miss."

- [ ] **Step 1: Write the failing tests:** the list orders overdue, then due today, then upcoming · the header totals the next 30 days · each chip state renders its token class (parametrized over four) · a wide-spread estimate renders as a range with "usually" · a tight-spread estimate renders a single figure · the rule picker previews the next three occurrences · changing the rule updates the preview · the detail renders payment history and the estimate basis · the match sheet renders candidates and confirming records the payment · the empty state renders.
- [ ] **Step 2:** Run `npx jest --ci components/bills app/__tests__/bills_screen.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/bills app/plan/bills hooks
  git commit -m "feat(bills): add bills screens with due rule preview"
  ```

---

### Task 6: Ship bills and close out M2

**Files:**
- Modify: `mobile/constants/shipped_features.ts`
- Modify: `mobile/lib/bootstrap.ts`
- Modify: `mobile/app/plan/index.tsx`
- Test: `mobile/app/__tests__/plan_hub.test.tsx` (extend)

**Rules:**
1. Flip `bills` to `"shipped"`. With Limits, Income, Goals, Loans and Bills all shipped, the Plan tab has no Soon items left — verify that visually.
2. Bootstrap calls `scheduleBillReminders(now)` alongside the loan reminders.
3. Re-scheduling is idempotent: bootstrap runs on every launch and must not stack duplicate OS notifications for the same occurrence.

- [ ] **Step 1: Extend the failing tests:** the Plan hub renders all five features as active with no Soon chip · bootstrap schedules bill reminders · running bootstrap twice does not duplicate scheduled reminders.
- [ ] **Step 2:** Run `npx jest --ci app/__tests__/plan_hub.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite `npx jest --ci` — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5:** On-device check: create a bill due in three days, confirm the reminder fires at the configured offset, pay it from the ledger and confirm the match sheet proposes the right transaction.
- [ ] **Step 6: Commit**
  ```
  git add constants/shipped_features.ts lib/bootstrap.ts app
  git commit -m "feat(plan): ship bills and complete the M2 control features"
  ```

---

## Plan completion checklist (for the executor)

- [ ] Tasks 1–6 committed; `npx jest --ci` green; `npx tsc --noEmit` clean.
- [ ] All 17 due-rule tests pass, including February clamping, leap years, weekday adjustment, and year rollover.
- [ ] Estimates use the median and present a range when the spread is wide.
- [ ] No bill payment is ever auto-recorded; every match is confirmed by the user.
- [ ] Overdue occurrences persist until paid or skipped and never silently roll forward.
- [ ] `promoteRecurringPatternToBill` is implemented and tested, ready for M3's detector to call.
- [ ] `totalDueInPeriod` excludes paid occurrences (Safe-to-Spend depends on this).
- [ ] All five Plan-tab features are `"shipped"`; no Soon chips remain in the Plan tab.
- [ ] No bare `Date.now()` in `lib/bills/` (grep to confirm).
- [ ] Next plans unblocked: the M3 insight plans.
