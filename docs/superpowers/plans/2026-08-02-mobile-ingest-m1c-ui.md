# Mobile Ingest M1c — User Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the automatically-tracked ledger visible and correctable — the shared UI kit, the Wallets tab, the Transactions ledger with its "why was this recorded?" transparency view, manual cash entry, and the Review Queue that turns every parser gap into a user correction the pipeline learns from.

**Architecture:** Presentational components under `mobile/components/` never touch repositories directly; they consume React Query hooks in `mobile/hooks/queries/` and `mobile/hooks/mutations/`, which wrap the foundation repositories using the shared query-key factory. Screens under `mobile/app/(tabs)/` compose those components. All styling comes from NativeWind classes bound to the contract §2 palette, so light and dark mode follow automatically.

**Tech Stack:** Expo Router ~6 · React 19.1 · NativeWind ^4.2 · TanStack React Query ~5.90 · lucide-react-native · react-native-svg ^15 · jest + jest-expo + @testing-library/react-native.

## Global Constraints

These apply to EVERY task. The interface contract at `docs/superpowers/plans/2026-08-02-00-interface-contract.md` is LAW. Feature behavior comes from `docs/04-features/02-wallets.md` and `docs/04-features/08-review-queue.md`; visual treatment from `docs/11-mobile-app-design-prompt.md`. Where this plan and a spec disagree, the spec wins.

- **Naming:** snake_case for ALL file and directory names and ALL database identifiers. TypeScript symbols keep TS idioms: `camelCase` variables/functions, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** in state and props; format to `₱1,234.56` only in `AmountText`. Never format money anywhere else.
- **Time:** epoch **milliseconds** for timestamps; calendar dates as `'YYYY-MM-DD'` strings.
- **IDs:** UUIDv4 strings via `newId()` from `@/lib/ids`.
- **Colors:** contract §2 tokens only, through NativeWind classes with `dark:` siblings (`bg-surface dark:bg-surface-dark`). No hard-coded hex anywhere in components.
- **Commits:** Conventional Commits. **No AI-attribution trailer or footer of any kind.**
- **TDD:** named failing test → run it and watch it fail → minimal implementation → run it green → commit.
- **Test commands:** all tests `npx jest --ci`; a single file `npx jest --ci <path>`; typecheck `npx tsc --noEmit`. Both must pass before every commit.
- **Working directory:** all commands run from `mobile/`.
- **DB access:** screens and components call hooks; hooks call repositories. No SQL and no repository import inside a component.
- **Density:** exact files, exact interfaces, the rules and named tests that matter — you write the test bodies and the implementation.

### What earlier plans already delivered (consume, do not redo)

| From | You get |
|---|---|
| Foundation Tasks 1–18 | Palette + theme, `types/domain.ts`, all repositories (contract §3 names), `lib/entitlements.ts`, `SoonGate` / `PlusGate` / `UpgradeSheet`, `queryClient` + `queryKeys`, five-tab app shell with placeholder screens |
| M1a Tasks 1–9 | `modules/notification_listener` — `RawCapture`, `getListenerHealth()`, `setCaptureEnabled()`, `setProviderFilter()` |
| M1b Tasks 1–11 | `lib/ingest/*` (pipeline running at startup), `raw_notifications_repo`, `transfer_links_repo` (`linkTransfer`, `unlinkTransfer`), `user_rules_repo`, `review_queue_repo` |

---

### Task 1: Test harness for components + `AmountText`

**Files:**
- Modify: `mobile/package.json` (add `@testing-library/react-native` as a dev dependency)
- Modify: `mobile/test_support/jest_setup.ts`
- Create: `mobile/components/ui/amount_text.tsx`
- Test: `mobile/components/ui/__tests__/amount_text.test.tsx`

**Interfaces:**
```ts
type AmountTextProps = {
  amount: Centavos;
  direction?: "in" | "out";
  size?: "sm" | "md" | "lg" | "hero";
  showSign?: boolean;          // default true when direction is given
  muted?: boolean;             // transfer legs render muted — excluded from spend
};
formatCentavos(amount: Centavos): string;    // 123456 → "₱1,234.56"
```

**Rules:**
1. `formatCentavos` is the ONLY money formatter in the app. Always two decimal places, always a thousands separator, always the `₱` prefix. Negative input renders as `-₱1,234.56`.
2. Direction colors: `in` → `brand` (with `dark:` sibling), `out` → `fg`. Not red — ordinary spending is not an error state. `muted` overrides both with `fg-2`.
3. `showSign` renders `+` for `in` and `−` for `out` (U+2212 minus, not a hyphen — it aligns with digits).
4. `hero` size is the Safe-to-Spend number on Home; it must remain legible at very large sizes.

- [ ] **Step 1: Write the failing tests:** `formatCentavos(123456)` is `"₱1,234.56"` · `formatCentavos(0)` is `"₱0.00"` · `formatCentavos(5)` is `"₱0.05"` (centavo-precision regression) · `formatCentavos(-123456)` is `"-₱1,234.56"` · `formatCentavos(100000000)` is `"₱1,000,000.00"` · an `in` amount renders with a `+` and the brand color class · an `out` amount renders with `−` · `muted` renders the `fg-2` class regardless of direction · `showSign={false}` renders no sign.
- [ ] **Step 2:** Install `@testing-library/react-native`, register its matchers in `jest_setup.ts`. Run `npx jest --ci components/ui/__tests__/amount_text.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement `amount_text.tsx`.
- [ ] **Step 4:** Run — expected PASS (9 tests). `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add package.json package-lock.json test_support components/ui
  git commit -m "feat(ui): add component test harness and amount text primitive"
  ```

---

### Task 2: Remaining UI primitives

**Files:**
- Create: `mobile/components/ui/card.tsx`, `chip.tsx`, `button.tsx`, `list_row.tsx`, `bottom_sheet.tsx`, `empty_state.tsx`, `confirm_dialog.tsx`, `section_header.tsx`
- Test: `mobile/components/ui/__tests__/primitives.test.tsx`

**Interfaces:**
```ts
<Card variant="default" | "flat">                                   // rounded-2xl, surface bg, soft shadow
<Chip label tone="neutral" | "brand" | "warn" | "danger" | "soon" onPress?>
<Button title onPress variant="primary" | "secondary" | "ghost" | "destructive" loading? disabled? icon?>
<ListRow title subtitle? left? right? onPress? destructive?>
<BottomSheet visible onDismiss title?>{children}</BottomSheet>
<EmptyState icon title body action?>                                 // lucide icon, brand-tinted
<ConfirmDialog visible title body confirmLabel destructive? onConfirm onCancel>
<SectionHeader title action?>
```

**Rules:**
1. Every primitive supports light and dark through `dark:` classes; no component reads the theme imperatively.
2. `Button` with `loading` shows a spinner, keeps its width (no layout jump), and is non-interactive.
3. `ConfirmDialog` with `destructive` styles the confirm action with `danger` and requires an explicit `confirmLabel` — never a bare "OK" for a destructive action.
4. `EmptyState` uses the paper-airplane brand mark (lucide `Send`) as its default icon.
5. `BottomSheet` dismisses on backdrop press and on Android back.

- [ ] **Step 1: Write the failing tests:** each primitive renders its required content (parametrized) · `Button` with `loading` is non-interactive and shows the spinner · `Button` `disabled` does not fire `onPress` · `ConfirmDialog` fires `onConfirm` from the confirm action and `onCancel` from the backdrop · `BottomSheet` hidden renders nothing · `Chip` with tone `soon` renders the grey token class.
- [ ] **Step 2:** Run `npx jest --ci components/ui/__tests__/primitives.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement all eight primitives.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/ui
  git commit -m "feat(ui): add shared component primitives"
  ```

---

### Task 3: Query and mutation hooks

**Files:**
- Create: `mobile/hooks/queries/use_wallets.ts`, `use_wallet.ts`, `use_transactions.ts`, `use_transaction.ts`, `use_categories.ts`, `use_review_queue.ts`, `use_review_count.ts`
- Create: `mobile/hooks/mutations/use_create_wallet.ts`, `use_update_wallet.ts`, `use_archive_wallet.ts`, `use_create_transaction.ts`, `use_update_transaction.ts`, `use_resolve_review_item.ts`, `use_link_transfer.ts`, `use_unlink_transfer.ts`, `use_reconcile_cash.ts`
- Test: `mobile/hooks/__tests__/hooks.test.tsx`

**Rules:**
1. Each hook is thin: a `queryKey` from `constants/query_keys.ts` plus a repository call. No business logic in hooks.
2. Every mutation invalidates the narrowest sufficient key set. A new transaction invalidates `transactions.all`, the affected `wallets.detail`, and `reviewQueue.count` — not the whole cache.
3. Mutations inherit `retry: 0` from the client (foundation Task 16). Never override it: a retried write double-posts money.
4. `use_review_count` powers the tab badge and is the only hook that polls; give it a 30 s `refetchInterval`.

- [ ] **Step 1: Write the failing tests** with a `QueryClientProvider` wrapper and a `freshDb()`: `useWallets` returns seeded wallets · `useCreateWallet` inserts and invalidates `wallets.all` · `useCreateTransaction` invalidates transactions AND the affected wallet detail · `useResolveReviewItem` decrements `useReviewCount` · every mutation hook has `retry` resolving to 0 · `useTransactions` passes its filter through to the repository.
- [ ] **Step 2:** Run `npx jest --ci hooks/__tests__/hooks.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement all hooks.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add hooks
  git commit -m "feat(ui): add react query hooks over the repositories"
  ```

---

### Task 4: Wallets tab — list and detail

**Files:**
- Create: `mobile/components/wallets/wallet_card.tsx`, `wallet_type_icon.tsx`, `balance_mismatch_badge.tsx`, `matcher_chip_list.tsx`
- Modify: `mobile/app/(tabs)/wallets.tsx`
- Create: `mobile/app/wallet/[id].tsx`
- Test: `mobile/components/wallets/__tests__/wallet_card.test.tsx`
- Test: `mobile/app/__tests__/wallets_screen.test.tsx`

**Rules (from `docs/04-features/02-wallets.md`):**
1. The list groups by type in this order: bank, e-wallet, savings, credit, cash. A total row sits at the top; **credit wallets are excluded from the positive total** and shown as amounts owed.
2. `wallet_type_icon` maps each of the five types to a lucide icon: bank `Landmark`, e-wallet `Smartphone`, savings `PiggyBank`, credit `CreditCard`, cash `Banknote`.
3. **Balance mismatch:** when a notification reported a `balanceAfter` that disagrees with the computed running balance, show the badge with both figures and a "reconcile" action. Silent disagreement is the one thing a money app may never do.
4. Detail shows the wallet's transactions (reusing the ledger list from Task 6), its matcher chips ("Catches: GCash"), and actions for edit, reconcile, and archive.
5. Archived wallets are hidden from the list by default with a "Show archived" toggle.
6. Empty state: the paper-airplane mark with "No wallets yet — add the bank or e-wallet you use most."

- [ ] **Step 1: Write the failing tests:** the list groups by type in the specified order · the total excludes credit wallets · each type renders its mapped icon (parametrized over five) · a mismatch renders the badge with both figures · no mismatch renders no badge · archived wallets are hidden until the toggle is on · the empty state renders when there are no wallets · tapping a card navigates to the detail route.
- [ ] **Step 2:** Run `npx jest --ci components/wallets app/__tests__/wallets_screen.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement the components and both screens.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/wallets app/(tabs)/wallets.tsx app/wallet
  git commit -m "feat(wallets): add wallet list and detail screens"
  ```

---

### Task 5: Wallet create/edit, matchers, archive, cash reconciliation

**Files:**
- Create: `mobile/app/wallet/new.tsx`, `mobile/app/wallet/[id]/edit.tsx`
- Create: `mobile/components/wallets/wallet_form.tsx`, `matcher_picker.tsx`, `cash_reconcile_sheet.tsx`
- Create: `mobile/lib/db/repos/wallet_matchers_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/wallet_matchers_repo.test.ts`
- Test: `mobile/components/wallets/__tests__/wallet_form.test.tsx`
- Test: `mobile/components/wallets/__tests__/cash_reconcile_sheet.test.tsx`

**Interfaces:**
```ts
// wallet_matchers_repo.ts
listMatchers(walletId?: string): Promise<WalletMatcher[]>;
setMatchers(walletId: string, matchers: NewWalletMatcher[]): Promise<void>;   // replaces the wallet's set
findWalletForPackage(packageName: string, hint?: string): Promise<string | null>;  // shipped wallet_matchers has package_name + hint, NO provider_key column
```

**Rules:**
1. **One provider may feed two wallets** — GCash main vs GSave is the canonical case. The matcher picker therefore binds `providerKey` **plus an optional `walletHint`**, and the form explains this in plain language.
2. A matcher pair (`providerKey`, `walletHint`) may belong to exactly one wallet. Assigning it to a second wallet moves it and warns, rather than silently creating an ambiguity the pipeline cannot resolve.
3. **Free-tier cap:** creating a fourth wallet is blocked by `canCreateWallet` (contract §7) and opens the `UpgradeSheet`. Existing wallets are never deleted or hidden by the cap.
4. **Archive, never orphan:** archiving prompts for what happens to the wallet's transactions (keep them attached to the archived wallet, which is the default, or move them to another wallet). Deleting a wallet with transactions is not offered at all.
5. **Cash reconciliation:** the sheet asks "How much is in your physical wallet right now?" and writes the difference as an adjustment transaction categorized to Fees & Charges with `source: "manual"` and a note. It never edits past transactions.
6. Only `type: "cash"` wallets offer reconciliation.

- [ ] **Step 1: Write the failing tests** for `wallet_matchers_repo`: set-then-list round-trips · `setMatchers` replaces rather than appends · `findWalletForPackage` resolves with and without a hint · reassigning a pair moves it to the new wallet. Run, implement, green, commit.
- [ ] **Step 2: Write the failing tests** for the form and sheet: the form requires a name and a type · the matcher picker binds provider plus hint · assigning an already-bound pair warns · creating a fourth wallet on the free tier opens the upgrade sheet (mock `getTier` to `"free"`) · creating a fourth wallet on `plus` succeeds · archiving offers the transaction-handling choice and defaults to keeping them · reconciliation writes a single adjustment transaction of the exact difference · reconciling with no difference writes nothing · reconciliation is offered only for cash wallets.
- [ ] **Step 3:** Run `npx jest --ci components/wallets` — expected FAIL.
- [ ] **Step 4:** Implement the form, picker, sheet, and both routes.
- [ ] **Step 5:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit**
  ```
  git add components/wallets app/wallet lib/db/repos
  git commit -m "feat(wallets): add wallet form, provider matchers and cash reconciliation"
  ```

---

### Task 6: Transactions tab — the ledger

**Files:**
- Create: `mobile/components/transactions/transaction_row.tsx`, `day_group_header.tsx`, `ledger_list.tsx`, `filter_bar.tsx`
- Modify: `mobile/app/(tabs)/transactions.tsx`
- Test: `mobile/components/transactions/__tests__/ledger_list.test.tsx`
- Test: `mobile/components/transactions/__tests__/filter_bar.test.tsx`

**Rules:**
1. Rows group by calendar day, newest day first, newest transaction first within a day. Each day header shows the day's net in/out.
2. A row shows: merchant or counterparty (falling back to the category name), a category chip, the wallet name, and the signed amount.
3. **Transfer legs render muted with a link glyph** (lucide `ArrowLeftRight`) and the label "Transfer — not counted as spending". This is the single most important row state: a user who thinks moving money is spending will not trust any total in the app.
4. Filter bar: wallet, category, date range, and direction, plus free-text search over merchant and note. Filters compose (AND) and are reflected in the list header as removable chips.
5. Free tier shows the last 90 days and ends with a "See your full history with Plus" row driven by `historyWindowDays()`.
6. Empty states differ and must not be conflated: no transactions at all ("Nothing tracked yet — grant notification access to start") versus no matches for the current filter ("No transactions match these filters").

- [ ] **Step 1: Write the failing tests:** rows group by day, newest first · a day header shows the day's net · a transfer leg renders muted with the not-counted label · a normal out row renders the amount with a minus · filters compose (wallet AND category) · search matches merchant and note · clearing a filter chip removes that filter only · the free tier renders the 90-day cutoff row (mock `getTier`) · the two empty states render distinct copy.
- [ ] **Step 2:** Run `npx jest --ci components/transactions` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/transactions app/(tabs)/transactions.tsx
  git commit -m "feat(ledger): add grouped transaction list with filters"
  ```

---

### Task 7: Transaction detail + "Why was this recorded?"

**Files:**
- Create: `mobile/app/transaction/[id].tsx`
- Create: `mobile/components/transactions/why_recorded_panel.tsx`, `category_picker.tsx`, `transfer_link_actions.tsx`
- Test: `mobile/components/transactions/__tests__/why_recorded_panel.test.tsx`
- Test: `mobile/app/__tests__/transaction_detail.test.tsx`

**Rules:**
1. Detail shows amount, direction, date and time, wallet, category (editable), merchant, reference number, note (editable), and source.
2. **"Why was this recorded?"** expands to the captured notification text via `rawNotificationRef`, with the provider name and a countdown to its 30-day expiry ("This capture is deleted in 12 days"). This panel is the app's honesty mechanism — it is what makes reading notifications defensible to a user.
3. When the raw capture has already expired, the panel says so plainly rather than showing an empty box.
4. Manual transactions show "You added this manually" instead of the panel.
5. Transfer actions: an unlinked transaction offers "Link as transfer" (choosing a counterpart from nearby opposite-direction transactions); a linked one offers "Unlink". Both write via the M1b repository.
6. Editing the category creates a `UserRule` of kind `merchant_category` when the transaction has a merchant, so the correction teaches the pipeline — with a checkbox, checked by default, saying "Always categorize <merchant> as <category>".

- [ ] **Step 1: Write the failing tests:** detail renders every field · the panel shows the captured text and the provider · the expiry countdown renders the correct remaining days for a pinned clock · an expired capture renders the expired message · a manual transaction renders the manual note instead of the panel · changing the category with the checkbox checked creates a `UserRule` · unchecking it changes only this transaction · "Link as transfer" offers only opposite-direction candidates from other wallets · unlinking removes the `TransferLink` and restores both legs to spend totals.
- [ ] **Step 2:** Run `npx jest --ci components/transactions/__tests__/why_recorded_panel.test.tsx app/__tests__/transaction_detail.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/transactions app/transaction
  git commit -m "feat(ledger): add transaction detail with capture transparency panel"
  ```

---

### Task 8: Manual entry for cash

**Files:**
- Create: `mobile/app/transaction/new.tsx`
- Create: `mobile/components/transactions/amount_numpad.tsx`, `manual_entry_form.tsx`
- Test: `mobile/components/transactions/__tests__/amount_numpad.test.tsx`
- Test: `mobile/components/transactions/__tests__/manual_entry_form.test.tsx`

**Rules:**
1. **Amount first.** The numpad is the landing state; everything else is secondary. Cash entry competes with not-bothering, so it must take seconds.
2. The numpad builds centavos directly from keystrokes (`1`,`2`,`3`,`4` → `1234` → displays `₱12.34`). Never parse a display string back into a number.
3. Defaults: direction `out`, wallet = the most recently used cash wallet, date = today, category = last used for that merchant, else Uncategorized.
4. Saving writes `source: "manual"` and `confidence: 1`, and never enters the pipeline — a manual entry is ground truth.
5. Backspace removes the last digit; long-press clears. Save is disabled at zero.

- [ ] **Step 1: Write the failing tests:** keystrokes `1`,`2`,`3`,`4` display `₱12.34` and yield `1234` centavos · backspace removes the last digit · save is disabled at zero · the form defaults to `out` and the last-used cash wallet · saving writes `source: "manual"` and `confidence: 1` · saving a duplicate amount seconds later is NOT deduplicated (manual entries bypass the pipeline).
- [ ] **Step 2:** Run `npx jest --ci components/transactions/__tests__/amount_numpad.test.tsx components/transactions/__tests__/manual_entry_form.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/transactions app/transaction/new.tsx
  git commit -m "feat(ledger): add amount-first manual cash entry"
  ```

---

### Task 9: Review Queue — badge and triage list

**Files:**
- Create: `mobile/app/review/index.tsx`
- Create: `mobile/components/review/review_card.tsx`, `review_badge.tsx`, `confidence_meter.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx` (badge on the Transactions tab)
- Test: `mobile/components/review/__tests__/review_card.test.tsx`
- Test: `mobile/app/__tests__/review_queue.test.tsx`

**Rules (from `docs/04-features/08-review-queue.md`):**
1. The badge shows `countOpen()` on the Transactions tab icon, capped at "9+". Zero renders no badge at all.
2. Cards are oldest-first (FIFO) so nothing rots at the bottom.
3. Each card states **why it is here** in one plain sentence, taken from the gate's `reason`. No card is ever unexplained.
4. Card layout by kind:
   - `low-confidence` — parsed fields prefilled, a confidence meter, **Confirm** (primary) and **Correct**.
   - `unknown-provider` — the raw text, "Is this a money notification?" with **Yes, it is** / **No, ignore this app**.
   - `ambiguous-transfer` — both legs side by side with **Link as transfer** / **Keep separate**.
   - `possible-duplicate` — both candidates with **Merge** / **Keep both**.
5. Every action is one tap from the list; **Correct** is the only one that opens a form.
6. Empty state: "All caught up" with the paper-airplane mark — this is a reward state, so it should feel good rather than blank.

- [ ] **Step 1: Write the failing tests:** the badge shows the open count · a zero count renders no badge · a count over nine renders "9+" · cards render oldest-first · each of the four kinds renders its own action pair (parametrized) · every card renders a non-empty reason sentence · the confidence meter reflects the score · the empty state renders when the queue is clear.
- [ ] **Step 2:** Run `npx jest --ci components/review app/__tests__/review_queue.test.tsx` — expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add components/review app/review app/(tabs)/_layout.tsx
  git commit -m "feat(review): add review queue list with per-kind triage cards"
  ```

---

### Task 10: Review Queue actions — corrections that teach the pipeline

**Files:**
- Create: `mobile/components/review/correct_sheet.tsx`, `merge_sheet.tsx`, `link_transfer_sheet.tsx`
- Create: `mobile/lib/review/resolve_actions.ts`
- Test: `mobile/lib/review/__tests__/resolve_actions.test.ts`
- Test: `mobile/components/review/__tests__/correct_sheet.test.tsx`

**Interfaces:**
```ts
confirmItem(itemId: string, now: number): Promise<string>;                    // returns the committed transactionId
correctItem(itemId: string, patch: CorrectionPatch, now: number): Promise<string>;
ignoreProvider(itemId: string, packageName: string): Promise<void>;
linkAsTransfer(itemId: string, outTransactionId: string, inTransactionId: string): Promise<string>;
mergeDuplicate(itemId: string, keepTransactionId: string, dropTransactionId: string): Promise<void>;
type CorrectionPatch = { amount?: Centavos; direction?: "in" | "out"; walletId?: string; categoryId?: string; merchant?: string; createRule?: boolean };
```

**Rules:**
1. **Every correction creates a `UserRule`** unless the user opts out per-correction. This is the mechanism that turns parser gaps into training data instead of bug reports — a wallet correction creates `provider_wallet`, a category correction creates `merchant_category`, ignoring an app creates `ignore_pattern`.
2. Each action is atomic: commit the transaction, create the rule, and resolve the queue item together. A partial failure must leave nothing behind.
3. `confirmItem` commits exactly the prefilled values with `source: "notification"`.
4. `mergeDuplicate` keeps one transaction, deletes the other, and preserves the kept transaction's `rawNotificationRef`.
5. Resolving an already-resolved item is a no-op (double-tap safety), matching `review_queue_repo.resolve`.
6. After any action the list advances to the next card without a full re-render — triage is a rhythm, and losing your place breaks it.

- [ ] **Step 1: Write the failing tests** for `resolve_actions.ts` against a real `freshDb()`: `confirmItem` commits the transaction and resolves the item · `correctItem` with a changed category creates a `merchant_category` rule · `correctItem` with a changed wallet creates a `provider_wallet` rule · `createRule: false` creates no rule · `ignoreProvider` creates an `ignore_pattern` rule and resolves · `linkAsTransfer` creates the `TransferLink` and excludes both legs from `sumSpend` · `mergeDuplicate` leaves exactly one transaction and keeps its raw reference · resolving twice is a no-op · a failure mid-action leaves no partial write (force the repository to throw and assert the ledger is unchanged).
- [ ] **Step 2:** Run `npx jest --ci lib/review/__tests__/resolve_actions.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement `resolve_actions.ts`, then the three sheets.
- [ ] **Step 4:** Run `npx jest --ci lib/review components/review` — expected PASS. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**
  ```
  git add lib/review components/review
  git commit -m "feat(review): add triage actions that create user rules"
  ```

---

### Task 11: M1 green-gate and on-device walkthrough

**Files:** none created — this task proves M1 is a coherent, usable product slice.

- [ ] **Step 1:** Run the full suite `npx jest --ci` — expected PASS, zero failures, zero skipped.
- [ ] **Step 2:** Run `npx tsc --noEmit` — expected clean.
- [ ] **Step 3:** Grep for violations and fix any hit: hard-coded hex colors in `components/` and `app/` · `Date.now()` in `lib/ingest/` · repository imports inside `components/`.
- [ ] **Step 4: On-device walkthrough** (real device, dev client). Record the outcome of each: grant notification access from the app · create a GCash wallet and bind its matcher · trigger or post an illustrative GCash notification and confirm it lands in the ledger within seconds · confirm the "Why was this recorded?" panel shows the captured text · post a twin SMS-style notification and confirm it does NOT double-count · move money between two wallets and confirm the transfer is linked and excluded from spend · confirm a low-confidence capture appears in the Review Queue and that correcting it creates a rule · add a cash transaction manually · reconcile the cash wallet · confirm the whole flow renders correctly in dark mode.
- [ ] **Step 5: Commit**
  ```
  git commit --allow-empty -m "test(mobile): record M1 on-device walkthrough results"
  ```

---

## Plan completion checklist (for the executor)

- [ ] Tasks 1–11 committed; `npx jest --ci` green; `npx tsc --noEmit` clean.
- [ ] `formatCentavos` is the only money formatter in the codebase (grep to confirm).
- [ ] Transfer legs are visually muted and labeled as not counted, everywhere they appear.
- [ ] Every Review Queue card states why it is there; every correction creates a `UserRule` unless explicitly opted out.
- [ ] The free-tier wallet cap blocks creation and opens the upgrade sheet without deleting or hiding existing data.
- [ ] No hard-coded colors in components; light and dark both verified on device.
- [ ] M1 is shippable on its own: notifications become a trustworthy, correctable ledger.
- [ ] Next plans unblocked: `2026-08-02-mobile-control-m2.md` and its continuations.
