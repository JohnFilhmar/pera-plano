# Mobile Control M2b — Goals, Savings and Loans Implementation Plan

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


**Goal:** Build the two features that turn a ledger into a plan — savings Goals with payday auto-allocation, and Loan tracking in both directions covering formal amortized debt and informal Filipino lending (utang, 5-6) with payments matched from the ledger.

**Architecture:** Goals and Loans each split into a repository, a pure math module, a service that composes them with the ledger, and screens under the Plan tab. Every calculation — pace, amortization, next due date — is a pure function taking `now`, so schedules are reproducible and testable to the centavo. Goals subscribe to the `payday:detected` event from the income service rather than polling for a payday.

**Tech Stack:** TypeScript ~5.9 strict · expo-sqlite via repositories · TanStack React Query · NativeWind · lucide-react-native · react-native-svg (progress rings) · jest + jest-expo + @testing-library/react-native.

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW. Behavior comes from `docs/04-features/05-goals-savings.md` and `docs/04-features/06-loans.md`; where this plan and a spec disagree, the spec wins and the plan is the bug.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** for all money. Format only via `AmountText` / `formatCentavos`.
- **Time:** epoch **milliseconds** for timestamps; calendar dates as `'YYYY-MM-DD'` strings.
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
| Foundation | Repositories (contract §3), `lib/entitlements.ts` (contract §7), `SoonGate` / `PlusGate` / `UpgradeSheet`, `queryClient`, app shell |
| M1c | `components/ui/*` primitives (`AmountText`, `Card`, `Chip`, `Button`, `ListRow`, `BottomSheet`, `EmptyState`, `ConfirmDialog`, `SectionHeader`), hooks pattern, ledger list components |
| M2 Task 1 | `lib/clock.ts`, `lib/money.ts`, `lib/dates.ts`, `lib/event_bus.ts`, `lib/db/db_handle.ts` → `setDbHandleForTests`, `test/db_harness.ts` → `createTestDb` |
| M2 Task 2 | `lib/alerts/` → `CHANNEL_REMINDERS`, `postAlert()`, `scheduleReminder()`, `cancelScheduled()` |
| M2 Task 8 | `controlQueryKeys` factory (`limits`, `income`, `goals`, `loans`, `bills` families) and the `/plan` hub |
| M2 Part 2 | `lib/income/income_service.ts` → `PAYDAY_EVENT`, `PaydayEvent`, `getIncomeSummary()` |

---

### Task 1: Goals repository

**Files:**
- Create: `mobile/lib/db/repos/goals_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/goals_repo.test.ts`

**Interfaces:**
```ts
type ContributionRule = { kind: "none" } | { kind: "fixed"; amount: Centavos } | { kind: "percent"; percent: number };
type NewGoal = { name: string; targetAmount: Centavos; targetDate?: string | null; linkedWalletId: string; contributionRule?: ContributionRule };
createGoal(input: NewGoal): Promise<Goal>;
getGoal(id: string): Promise<Goal | null>;
listGoals(opts?: { includeAchieved?: boolean }): Promise<Goal[]>;
updateGoal(id: string, patch: Partial<NewGoal>): Promise<Goal>;
deleteGoal(id: string): Promise<void>;
countGoals(): Promise<number>;                     // feeds the entitlement gate
```

**Rules:**
1. `linkedWalletId` must reference a wallet of type `savings`; creating a goal against any other type throws.
2. A wallet may back at most one goal — two goals sharing a wallet would each claim the same pesos. Enforce it and throw with a clear message.
3. Deleting a goal never touches the wallet or its transactions; the money is real, the goal is only a lens over it.
4. `targetDate` is a `'YYYY-MM-DD'` string or null (a goal with no deadline is valid).

- [ ] **Step 1: Write the failing tests:** create-then-get round-trips including the contribution rule · a non-savings wallet throws · a second goal on the same wallet throws · `listGoals` excludes achieved goals by default and includes them with the flag · delete removes the goal and leaves the wallet and its transactions intact · `countGoals` matches.
- [ ] **Step 2:** Run `npx jest --ci lib/db/repos/__tests__/goals_repo.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (6 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/db/repos
  git commit -m "feat(goals): add goals repository with savings wallet binding"
  ```

---

### Task 2: Goal math — progress and pace

**Files:**
- Create: `mobile/lib/goals/goal_math.ts`
- Test: `mobile/lib/goals/__tests__/goal_math.test.ts`

**Interfaces:**
```ts
type GoalPace = "no_deadline" | "ahead" | "on_track" | "behind" | "achieved" | "overdue";
type GoalProgress = {
  saved: Centavos;                 // the linked wallet's balance
  target: Centavos;
  remaining: Centavos;             // floored at 0
  fraction: number;                // 0..1, clamped
  pace: GoalPace;
  requiredPerMonth: Centavos | null;   // null when there is no deadline or the goal is achieved
  daysRemaining: number | null;
};
computeGoalProgress(goal: Goal, walletBalance: Centavos, now: number): GoalProgress;
```

**Rules:**
1. **Progress is the linked savings wallet's balance**, per the spec — not a sum of tagged contributions. This is deliberate: money that arrives in the savings wallet by any route counts, so the number always matches what the bank says.
2. `fraction` clamps to `[0, 1]`; a wallet holding more than the target reads as achieved, never 120%.
3. `pace` compares actual progress against linear expected progress between the goal's creation and `targetDate`, using the spec's tolerance band for `on_track`.
4. A goal past its `targetDate` and short of target is `overdue`, not `behind` — the distinction changes the copy and the action offered.
5. `requiredPerMonth` is what the user must set aside from now to hit the target by the deadline; it grows as they fall behind, which is the honest thing to show.
6. Timezone: dates are compared in device-local calendar days, so a deadline "today" does not read as overdue at 00:30.

- [ ] **Step 1: Write the failing tests:** a half-funded goal reports fraction 0.5 · an overfunded goal clamps to 1.0 and reports achieved · a goal with no deadline reports `no_deadline` and null `requiredPerMonth` · linear-on-schedule progress reports `on_track` · progress ahead of the line reports `ahead` · progress behind the line reports `behind` · past the deadline and short reports `overdue` · `remaining` floors at 0 · `requiredPerMonth` for a known worked vector is exact to the centavo · a deadline of today does not read as overdue.
- [ ] **Step 2:** Run `npx jest --ci lib/goals/__tests__/goal_math.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (10 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/goals
  git commit -m "feat(goals): add goal progress and pace math"
  ```

---

### Task 3: Goals service and payday auto-allocation (Plus)

**Files:**
- Create: `mobile/lib/goals/goals_service.ts`
- Test: `mobile/lib/goals/__tests__/goals_service.test.ts`

**Interfaces:**
```ts
type GoalStatus = { goal: Goal; progress: GoalProgress };
listGoalStatuses(now: number): Promise<GoalStatus[]>;
type AllocationProposal = { goalId: string; goalName: string; amount: Centavos; fromWalletId: string; toWalletId: string };
proposePaydayAllocations(event: PaydayEvent, now: number): Promise<AllocationProposal[]>;
applyAllocations(proposals: AllocationProposal[], now: number): Promise<string[]>;   // returns created transfer link ids
```

**Rules:**
1. **Auto-allocation is prompt-and-reconcile, never silent.** The spec is explicit: PeraPlano proposes the moves and the user confirms. The app does not move money — it records that the user did. Recording a transfer the user never made would corrupt the ledger and destroy trust.
2. Proposals are generated only for goals whose `contributionRule` is not `none`, and only on the free-of-double-fire payday event.
3. A `percent` rule is a percentage of the detected payday amount; a `fixed` rule is a flat amount. Proposals are capped so their total never exceeds the payday amount — a user cannot allocate ₱25,000 out of a ₱20,000 payday. Cap in goal-priority order (nearest deadline first) and mark the shortfall.
4. Applying an allocation writes **two** transactions (an out-leg from the income wallet, an in-leg to the savings wallet) and links them as a `TransferLink`, so the movement is excluded from spend and income totals exactly like any other internal transfer.
5. **Auto-allocation is a Plus capability.** Free-tier users see the goal and its progress, and can move money manually; the automatic proposal is gated. Use the entitlements layer, not an inline tier check.
6. Applying is atomic per proposal: both legs and the link, or nothing.

- [ ] **Step 1: Write the failing tests** against `createTestDb()` with a pinned clock:
  - `listGoalStatuses returns progress for every goal`
  - `proposePaydayAllocations skips goals with rule none`
  - `a fixed rule proposes its exact amount`
  - `a percent rule proposes the percentage of the payday amount`
  - `total proposals are capped at the payday amount, nearest deadline first`
  - `applying a proposal writes both legs and a transfer link`
  - `applied allocations are excluded from sumSpend` (regression on the transfer invariant)
  - `applying is atomic — a forced failure on the second leg leaves no first leg`
  - `nothing is written until applyAllocations is called` (prompt-and-reconcile regression)
  - `proposals are not generated on the free tier` (mock `getTier`)
- [ ] **Step 2:** Run `npx jest --ci lib/goals/__tests__/goals_service.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (10 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/goals
  git commit -m "feat(goals): add goals service with prompt-and-reconcile payday allocation"
  ```

---

### Task 4: Goals UI

**Files:**
- Create: `mobile/app/plan/goals/index.tsx`, `new.tsx`, `[id].tsx`
- Create: `mobile/components/goals/goal_card.tsx`, `progress_ring.tsx`, `goal_form.tsx`, `allocation_sheet.tsx`
- Create: `mobile/hooks/queries/use_goals.ts`, `mobile/hooks/mutations/use_create_goal.ts`, `use_apply_allocations.ts`
- Test: `mobile/components/goals/__tests__/goal_card.test.tsx`
- Test: `mobile/components/goals/__tests__/allocation_sheet.test.tsx`

**Rules:**
1. `progress_ring` is drawn with `react-native-svg` (no chart library) and shows the fraction plus the saved-of-target amounts in the center.
2. Pace states are colored from the contract §2 tokens: `ahead` and `on_track` brand, `behind` warn, `overdue` danger, `achieved` brand with a check.
3. The create form requires a name, a target amount, and a savings wallet; it offers to create a savings wallet inline when none exists, because a first-time user has no savings wallet yet and a dead end here loses them.
4. The entitlement gate (`canCreateGoal`) blocks a second goal on the free tier and opens the upgrade sheet; the existing goal is untouched.
5. The contribution-rule field is wrapped in `PlusGate` — visible and explained on free, active on Plus.
6. `allocation_sheet` lists each proposal with a toggle and an editable amount, shows the total against the payday amount, and commits only what remains checked. It never pre-commits.
7. Empty state: "No goals yet — name something you're saving for."

- [ ] **Step 1: Write the failing tests:** the card renders the ring fraction and both amounts · each pace state renders its token class (parametrized over six) · the form requires name, target, and wallet · the form offers inline savings-wallet creation when none exists · a second goal on the free tier opens the upgrade sheet · the contribution-rule field renders the Plus badge on free · the allocation sheet totals the checked proposals · unchecking a proposal excludes it from the commit · the sheet warns when the total exceeds the payday amount · the empty state renders.
- [ ] **Step 2:** Run `npx jest --ci components/goals` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/goals app/plan/goals hooks
  git commit -m "feat(goals): add goals screens with progress rings and allocation sheet"
  ```

---

### Task 5: Loans repository

**Files:**
- Create: `mobile/lib/db/repos/loans_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/loans_repo.test.ts`

**Interfaces:**
```ts
type LoanDirection = "i-owe" | "owed-to-me";
type ScheduleKind = "amortized" | "flat" | "free-form";
type LoanSchedule =
  | { kind: "amortized"; annualRatePercent: number; termMonths: number; firstDueDate: string }
  | { kind: "flat"; installmentAmount: Centavos; installments: number; firstDueDate: string; intervalDays: number }
  | { kind: "free-form" };
type NewLoan = { direction: LoanDirection; counterparty: string; principal: Centavos; schedule: LoanSchedule; linkedWalletId?: string | null; note?: string };
createLoan(input: NewLoan): Promise<Loan>;
getLoan(id: string): Promise<Loan | null>;
listLoans(opts?: { direction?: LoanDirection; includeClosed?: boolean }): Promise<Loan[]>;
updateLoan(id: string, patch: Partial<NewLoan>): Promise<Loan>;
closeLoan(id: string, now: number): Promise<void>;
countLoans(): Promise<number>;
recordPayment(input: { loanId: string; amount: Centavos; paidAt: number; transactionId?: string | null; note?: string }): Promise<LoanPayment>;
listPayments(loanId: string): Promise<LoanPayment[]>;
deletePayment(id: string): Promise<void>;
outstandingBalance(loanId: string): Promise<Centavos>;
```

**Rules:**
1. Both directions are first-class. "Owed to me" is not an afterthought — lending to family is a defining Filipino money flow and the spec treats it as a peer of borrowing.
2. `free-form` exists for informal utang with no agreed schedule. It has no due dates and no interest; the balance is principal minus payments. Forcing an interest formula onto a ₱500 loan from a cousin would be wrong.
3. `flat` covers 5-6 style lending and other fixed-installment arrangements: a stated installment amount repeated N times, with no interest formula applied — the interest is already baked into the installment.
4. `recordPayment` optionally links the ledger transaction that paid it; that link is what keeps loan payments out of the income detector (M2 Task 9's `listLoanPaymentTransactionIds`).
5. `outstandingBalance` never goes negative; an overpayment reads as zero and flags the loan as closable.
6. Closing a loan is reversible (reopen by updating), because people repay and re-borrow.

- [ ] **Step 1: Write the failing tests:** create-then-get round-trips each of the three schedule kinds · `listLoans` filters by direction · payments reduce `outstandingBalance` · an overpayment floors the balance at zero · `deletePayment` restores the balance · `listPayments` is chronological · `countLoans` matches · `closeLoan` excludes it from the default list.
- [ ] **Step 2:** Run `npx jest --ci lib/db/repos/__tests__/loans_repo.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (8 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/db/repos
  git commit -m "feat(loans): add loans repository with payments and balances"
  ```

---

### Task 6: Amortization and schedule math

**Files:**
- Create: `mobile/lib/loans/loan_math.ts`
- Test: `mobile/lib/loans/__tests__/loan_math.test.ts`

**Interfaces:**
```ts
type ScheduleRow = { index: number; dueDate: string; payment: Centavos; principal: Centavos; interest: Centavos; balanceAfter: Centavos };
monthlyPayment(principal: Centavos, annualRatePercent: number, termMonths: number): Centavos;
buildAmortizationSchedule(principal: Centavos, annualRatePercent: number, termMonths: number, firstDueDate: string): ScheduleRow[];
buildFlatSchedule(installmentAmount: Centavos, installments: number, firstDueDate: string, intervalDays: number): ScheduleRow[];
nextDue(loan: Loan, payments: LoanPayment[], now: number): { dueDate: string; amount: Centavos } | null;
```

**Rules:**
1. **The amortization formula**, with `i = annualRatePercent / 100 / 12` and `n = termMonths`:
   `payment = principal × i × (1 + i)^n / ((1 + i)^n − 1)`
   When `i === 0`, the formula divides by zero — fall back to `principal / n`. A zero-interest loan is common (family lending) and must not produce `NaN`.
2. All arithmetic in centavos. Round each row's payment to the nearest centavo, and **absorb the accumulated rounding drift into the final row** so the schedule's principal column sums to exactly the principal. A schedule that ends ₱0.03 short is a bug users notice.
3. `buildAmortizationSchedule` advances due dates by calendar month from `firstDueDate`, clamping month-end (a loan due the 31st is due the 28th in February).
4. `buildFlatSchedule` advances by `intervalDays` and splits nothing into interest — every peso is principal for balance purposes, because informal lending states a total, not a rate.
5. `nextDue` returns the earliest unpaid scheduled row, or `null` for `free-form` and for fully paid loans.
6. **Worked test vector (assert exactly):** principal ₱50,000.00 (`5_000_000`), 12% annual, 12 months → monthly payment ₱4,442.44 (`444_244`); the schedule has 12 rows; the principal column sums to exactly `5_000_000`; the final `balanceAfter` is exactly `0`.

- [ ] **Step 1: Write the failing tests:** the worked vector above passes exactly · a zero-rate loan returns `principal / n` and never `NaN` · the principal column always sums to the principal (parametrized over several principals and terms) · the final balance is exactly zero · month-end due dates clamp in February · a flat schedule produces N equal installments at the stated interval · `nextDue` returns the earliest unpaid row · `nextDue` returns null for free-form · `nextDue` returns null when fully paid · a partial payment does not skip the row it partially paid.
- [ ] **Step 2:** Run `npx jest --ci lib/loans/__tests__/loan_math.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (10 tests).
- [ ] **Step 5: Commit**
  ```
  git add lib/loans
  git commit -m "feat(loans): add amortization and flat schedule math"
  ```

---

### Task 7: Loan service — payment matching and reminders

**Files:**
- Create: `mobile/lib/loans/loans_service.ts`
- Test: `mobile/lib/loans/__tests__/loans_service.test.ts`

**Interfaces:**
```ts
type LoanStatus = { loan: Loan; outstanding: Centavos; nextDue: { dueDate: string; amount: Centavos } | null; overdue: boolean; paidCount: number };
listLoanStatuses(now: number): Promise<LoanStatus[]>;
type PaymentCandidate = { transactionId: string; amount: Centavos; occurredAt: number; merchant: string | null; score: number };
findPaymentCandidates(loanId: string, now: number): Promise<PaymentCandidate[]>;
confirmPaymentMatch(loanId: string, transactionId: string, now: number): Promise<LoanPayment>;
scheduleLoanReminders(now: number): Promise<void>;
```

**Rules:**
1. **Matching proposes, never auto-records.** A wrong auto-match silently corrupts both the loan balance and the spend total. Candidates are scored and shown; the user confirms.
2. Scoring combines amount proximity to the expected installment, closeness to the due date, and counterparty/merchant similarity. Return candidates above the spec's floor, best first, capped at a handful.
3. Only outbound transactions can pay an "i-owe" loan; only inbound can pay an "owed-to-me" loan. A direction mismatch is never a candidate.
4. A transaction already linked to any loan payment is never offered again.
5. `confirmPaymentMatch` records the payment linked to that transaction, which also removes it from income-detection candidates.
6. Reminders schedule through `scheduleReminder` on `CHANNEL_REMINDERS` at the spec's offsets before each due date, and cancel via `cancelScheduled` when the payment is recorded or the loan closes. A reminder for an already-paid installment is worse than no reminder.

- [ ] **Step 1: Write the failing tests:** statuses report outstanding, next due, and overdue correctly · an exact-amount transaction near the due date scores highest · a wrong-direction transaction is never a candidate · an already-linked transaction is never a candidate · a far-off amount falls below the floor · confirming records the payment linked to the transaction · a confirmed payment reduces the outstanding balance · a confirmed payment is excluded from income candidates · reminders are scheduled at the spec's offsets · recording a payment cancels that installment's reminder · closing a loan cancels all its reminders.
- [ ] **Step 2:** Run `npx jest --ci lib/loans/__tests__/loans_service.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS (11 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/loans
  git commit -m "feat(loans): add loan service with payment matching and reminders"
  ```

---

### Task 8: Loans UI

**Files:**
- Create: `mobile/app/plan/loans/index.tsx`, `new.tsx`, `[id].tsx`
- Create: `mobile/components/loans/loan_card.tsx`, `loan_form.tsx`, `schedule_table.tsx`, `payment_match_sheet.tsx`, `record_payment_sheet.tsx`
- Create: `mobile/hooks/queries/use_loans.ts`, `use_loan.ts`, `mobile/hooks/mutations/use_record_payment.ts`, `use_confirm_payment_match.ts`
- Test: `mobile/components/loans/__tests__/loan_card.test.tsx`
- Test: `mobile/components/loans/__tests__/loan_form.test.tsx`
- Test: `mobile/components/loans/__tests__/schedule_table.test.tsx`

**Rules:**
1. The index shows two clearly separated sections, **I owe** and **Owed to me**, each with its own total. Mixing them into one list would misrepresent the user's position.
2. `loan_card` shows counterparty, outstanding balance, and a next-due chip (`due in 3d`, `due today`, `overdue` in danger).
3. The form adapts to the schedule kind: `amortized` asks for rate and term and previews the computed monthly payment live; `flat` asks for installment, count, and interval; `free-form` asks for nothing beyond principal and counterparty. Default to `free-form` for "owed to me" — personal lending rarely has terms.
4. **`schedule_table` is wrapped in `PlusGate`.** Free tier sees the balance and the next due date; the full amortization schedule is a Plus capability per contract §7. Free users see a blurred preview with the upgrade prompt, not an empty screen.
5. `payment_match_sheet` appears when candidates exist, showing each with its amount, date, and why it matched; confirming records the payment.
6. The entitlement gate (`canCreateLoan`) blocks a second loan on the free tier.
7. Empty states differ per section: "You're not tracking any debts" and "No one owes you right now."

- [ ] **Step 1: Write the failing tests:** the index renders both sections with separate totals · a due-today loan renders the today chip and an overdue loan the danger chip · the form shows rate and term only for amortized · the amortized form previews the monthly payment live · the form defaults to free-form for owed-to-me · the schedule table renders the Plus gate on the free tier (mock `getTier`) · the schedule table renders full rows on plus · a second loan on free opens the upgrade sheet · the match sheet renders candidates with their reasons · confirming a match calls `confirmPaymentMatch` · both empty states render their own copy.
- [ ] **Step 2:** Run `npx jest --ci components/loans` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/loans app/plan/loans hooks
  git commit -m "feat(loans): add loan screens with gated amortization schedule"
  ```

---

### Task 9: Wire goals and loans into the app loop

**Files:**
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/app/plan/index.tsx` (the Plan hub)
- Modify: `mobile/constants/shipped_features.ts`
- Modify: `mobile/lib/bootstrap.ts`
- Test: `mobile/app/__tests__/plan_hub.test.tsx`

**Rules:**
1. Flip `goals` and `loans` from `"soon"` to `"shipped"` in `shipped_features.ts`. This is the only change this plan makes to that file, and it is what removes the grey Soon treatment from the Plan hub.
2. The root layout subscribes to `PAYDAY_EVENT` and presents `allocation_sheet` when proposals exist and the user is on Plus.
3. Bootstrap calls `scheduleLoanReminders(now)` after migrations so reminders survive reinstalls and OS reboots.
4. The Plan hub lists Limits, Income, Goals, Loans, and Bills; Bills remains `SoonGate`-wrapped until the bills plan ships.

- [ ] **Step 1: Write the failing tests:** the Plan hub renders Goals and Loans as active and Bills as Soon · a payday event with proposals presents the allocation sheet on plus · the same event presents nothing on free · bootstrap schedules loan reminders.
- [ ] **Step 2:** Run `npx jest --ci app/__tests__/plan_hub.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite `npx jest --ci` — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add app constants/shipped_features.ts lib/bootstrap.ts
  git commit -m "feat(plan): ship goals and loans in the plan hub"
  ```

---

## Plan completion checklist (for the executor)

- [ ] Tasks 1–9 committed; `npx jest --ci` green; `npx tsc --noEmit` clean.
- [ ] The amortization worked vector passes exactly: ₱50,000.00 at 12% over 12 months → ₱4,442.44/month, principal column sums to ₱50,000.00, final balance ₱0.00.
- [ ] A zero-interest loan never produces `NaN`.
- [ ] Payday allocation writes nothing until the user confirms, and writes both legs plus a transfer link atomically.
- [ ] Payment matching only proposes; no auto-recorded payments anywhere.
- [ ] Free-tier caps block creation without touching existing data; the amortization schedule is Plus-gated.
- [ ] `goals` and `loans` are flipped to `"shipped"`; Bills is still `"soon"`.
- [ ] No bare `Date.now()` in `lib/goals/` or `lib/loans/` (grep to confirm).
- [ ] Next plan unblocked: `2026-08-02-mobile-control-m2c-bills.md`.
