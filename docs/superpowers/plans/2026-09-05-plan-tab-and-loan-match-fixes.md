# Plan Tab Lock and Loan Match Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four defects the owner reported from the A54 on 2026-09-05: a Plan tab captured by a card opened from Home, a "None of these" button that remembers nothing, a payment list that cannot scroll, and a detected loan payment that can only be declined once the same payment was recorded elsewhere.

**Architecture:** Four independent root causes, four tasks, no shared state between them. Task 1 is navigator configuration. Task 2 moves a scroll container into the shared `BottomSheet` so every sheet inherits it. Task 3 adds one narrow table so a rejection survives the sheet closing. Task 4 makes the review-queue card and the loan-detail match sheet agree about a transaction that is already recorded, by closing the stale card instead of throwing at the user.

**Tech Stack:** Expo SDK 54 (`expo ~54.0.36`), `expo-router ~6.0.24`, React Native 0.81.5, expo-sqlite with the project's own migration runner, TanStack Query, NativeWind, Jest 29 with `@testing-library/react-native`.

**Spec:** This document's "Defects and root causes" section below. The rules it argues from live in `docs/04-features/06-loans.md` (loans rules 5, 9, 10, 13, 17, 20), `docs/02-domain-model.md` (invariant I12) and `docs/13-on-device-verification.md:1384` (the sheet clipping trade this task settles).

## Global Constraints

- Branch and worktree: `worktree-fix-plan-tab-and-loan-match`, already created. Base and PR target: `master`.
- No AI attribution anywhere in a commit message, PR body, issue or tag. No `Co-Authored-By: Claude`, no "Generated with" line.
- New file and directory names are `snake_case`. Existing files keep their own style: no drive-by renames, no reformatting a file you are only adding four lines to.
- Comment density: this codebase documents WHY at length, in full sentences, above the code the reason belongs to. Every non-obvious change in this plan ships with that comment. A silent one-line fix here is a regression waiting to be undone by the next reader.
- Tests are Jest with `@testing-library/react-native`. Integration over mocking: drive the real service and repository through the real migration runner wherever the existing suite next door does.
- The full mobile Jest suite takes about 25 minutes and has pre-existing flaky failures. Run the named suites per task, and the full suite once at the end.
- Do not touch `.env*`, `*.enc`, key material, or any file under `mobile/android/`.

---

## Defects and root causes

All four were verified read-only against `master` at `48619e8` on 2026-09-05. None is fixed there.

### D1. Opening a card from Home locks the Plan tab to that card

`mobile/app/(tabs)/plan/_layout.tsx` is a bare `<Stack />` with no `unstable_settings`. Home pushes straight into that stack: `mobile/app/(tabs)/index.tsx:324` (`/plan/limits/[id]`), `:332` (`/plan/bills/[id]`), `:346` (`/plan/loans/[id]`), `:271` (`/plan/limits/new`), `:347` (`/plan/loans`), and `:236` into the other bare nested stack, `/more/listener_health`.

On a first open the Plan stack has never mounted. The push mounts it with the detail screen as its only entry, so there is nothing underneath to go back to and the tab stays on that card. Visiting the Plan tab first puts `index` in the stack, which is why the owner cannot reproduce it that way.

expo-router's fix has two halves and both are needed. `unstable_settings.initialRouteName` loads the anchor beneath the target, but the documentation is explicit that it "only applies during deep linking". For an ordinary in-app `router.push` from another tab, which is the reported case, the caller passes `withAnchor: true`.

### D2. "None of these" remembers nothing

`mobile/components/loans/payment_match_sheet.tsx:150` wires the button to `onDismiss` and nothing else. The loan detail screen's `onDismiss` at `mobile/app/(tabs)/plan/loans/[id].tsx:295` sets two pieces of local state to false. No write happens, so `findPaymentCandidates` re-scores the same rows on the next visit and `mobile/app/(tabs)/plan/loans/[id].tsx:178` keeps rendering "3 possible payments". The owner is right that there is no wired function behind it.

### D3. The possible-payments list cannot scroll

`mobile/components/ui/bottom_sheet.tsx` renders `{children}` inside a plain `View`, bottom-aligned in a `flex-1 justify-end` container, with no scroll container and no height bound. A loan with several candidates grows the sheet upward until it clips off the top of the screen, and nothing scrolls it back.

The codebase already has the answer one directory over: `mobile/components/review/correct_sheet.tsx:385` wraps its own body in `<ScrollView className="max-h-96">`. `docs/13-on-device-verification.md:1384` names the general remedy as "a `maxHeight` from `useWindowDimensions()`", against the per-sheet `max-h-96`. Putting it in `BottomSheet` fixes all ten sheets at once and lets `correct_sheet` give up its private copy.

### D4. A detected payment can only be declined once the same payment was recorded

Two surfaces can record the same match and neither tells the other.

1. The notification pipeline commits transaction `T` and `raiseLoanMatchAfterCommit` queues a `loan-match` card naming `T`.
2. The owner opens the loan and confirms `T` from the match sheet. `confirmPaymentMatch` calls `recordPayment`, which claims `T` in `loan_payments` (`transaction_id` is `NOT NULL UNIQUE`, invariant I12).
3. Nothing closes the card. `mobile/lib/loans/loans_service.ts` imports nothing from the review queue, by design.
4. The owner taps "Record this payment" on the surviving card. `confirmLoanMatch` reaches `recordPayment`, which finds `T` already claimed at `mobile/lib/db/repos/loans_repo.ts:432` and throws `PaymentAlreadyMatchedError`.
5. `mobile/app/review/index.tsx:155`'s `triageFailureMessage` has no branch for it, so the card says "That didn't go through, and nothing was saved, your balances are unchanged. Try again." Every word of that is wrong here: it did go through, it was saved, and trying again can never succeed.

The only button left that does anything is "Not a loan payment", which records the opposite of what happened. `loan_match_queue.ts:194` predicts this exact error for the within-card double tap; the cross-surface case is the one nobody closed.

One thing this plan deliberately does NOT fix: the manual "Record payment" sheet creates a NEW `source: manual` transaction, so a notification for the same money later commits a second row and both can be recorded. That is a double-count, not a blocked accept, and it is a different defect with a different fix. It is written up as a follow-up at the end rather than folded in here.

---

### Task 1: Anchor the Plan and More stacks so a card cannot capture the tab

Fixes D1.

**Files:**
- Modify: `mobile/app/(tabs)/plan/_layout.tsx`
- Modify: `mobile/app/(tabs)/more/_layout.tsx`
- Modify: `mobile/app/(tabs)/index.tsx:236,271,319-324,332,346,347,353`
- Test: `mobile/app/__tests__/home_screen.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Write the failing test**

Add to `mobile/app/__tests__/home_screen.test.tsx`. The suite already mocks the router at line 7 as `useRouter: () => ({ push: (...args) => mockPush(...args) })`, so the second argument is observable. Place these next to the existing `sts-set-limit` and `tracking-fix` assertions and keep their `renderScreen` setup.

```tsx
// A CROSS-TAB PUSH CARRIES ITS ANCHOR. Home lives in one tab and every one of
// these targets lives in another tab's Stack. Without `withAnchor` the target
// mounts as that stack's ONLY entry on a cold start, and the tab is stuck on
// it: no back, and pressing the tab button returns to the same card. See
// plan/_layout.tsx for the other half, which covers deep links rather than
// in-app pushes.
test("opening a limit from Home anchors the Plan tab's stack", () => {
  renderScreen(<HomeScreen />);

  fireEvent.press(screen.getByTestId("sts-set-limit"));

  expect(mockPush).toHaveBeenCalledWith("/plan/limits/new", { withAnchor: true });
});

test("opening listener health from Home anchors the More tab's stack", () => {
  renderScreen(<HomeScreen />);

  fireEvent.press(screen.getByTestId("tracking-fix"));

  expect(mockPush).toHaveBeenCalledWith("/more/listener_health", { withAnchor: true });
});
```

The two existing assertions at lines 133 and 323 assert the single-argument form and will now fail. Update them to the two-argument form rather than deleting them: they are the same claim. The bill-alert assertion at line 433 needs the same second argument added to its `toHaveBeenCalledWith`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest app/__tests__/home_screen.test.tsx -t "anchors"`

Expected: FAIL, with `toHaveBeenCalledWith` reporting the received call as `"/plan/limits/new"` with no second argument.

- [ ] **Step 3: Add the anchor to both nested stacks**

In `mobile/app/(tabs)/plan/_layout.tsx`, above the default export and below the existing header comment:

```tsx
/**
 * THE ANCHOR THAT KEEPS THIS TAB FROM BEING CAPTURED BY ONE CARD.
 *
 * Without it, a link straight to `plan/loans/[id]` mounts this Stack with that
 * screen as its only entry. There is nothing beneath it, so Back does nothing
 * and pressing the Plan tab button lands on the same card again. The owner's
 * 2026-09-05 report is exactly that: tapping a loan on Home "locks the Plan tab
 * to that selected card", and it does not happen if the Plan tab was visited
 * first, because then `index` is already on the stack.
 *
 * IT COVERS DEEP LINKS ONLY, AND THAT IS NOT THE WHOLE BUG. expo-router's
 * documentation is explicit that `initialRouteName` "only applies during deep
 * linking". An ordinary `router.push` from the Home tab is not a deep link, so
 * the callers in app/(tabs)/index.tsx pass `withAnchor: true`. Both halves are
 * needed: this one for a notification tap or a `peraplano://` link, that one
 * for a tap inside the app.
 */
export const unstable_settings = {
  initialRouteName: "index",
};
```

In `mobile/app/(tabs)/more/_layout.tsx`, the same export with a shorter comment pointing at the Plan copy:

```tsx
/**
 * The same anchor, for the same reason, as app/(tabs)/plan/_layout.tsx: a link
 * straight to `more/listener_health` would otherwise mount this Stack with that
 * screen as its only entry and strand the More tab on it. Home pushes here from
 * its tracking banner. See that file for the full reasoning and for why the
 * push sites carry `withAnchor` as well.
 */
export const unstable_settings = {
  initialRouteName: "index",
};
```

- [ ] **Step 4: Add `withAnchor` to every cross-tab push in Home**

In `mobile/app/(tabs)/index.tsx`, add the options argument to each push whose target is inside another tab's Stack. That is every `/plan/...` and `/more/...` target, and only those. In the file as it stands they are:

| Line | Target | Anchor? |
|---|---|---|
| 236 | `/more/listener_health` | yes |
| 255 | `/transaction/new` | no, root route |
| 271 | `/plan/limits/new` | yes |
| 272 | `/review` | no, root route |
| 319-324 | `/plan/limits/[id]` (object href) | yes |
| 332 | `/plan/bills/[id]` (object href) | yes |
| 346 | `/plan/loans/[id]` (object href) | yes |
| 347 | `/plan/loans` | yes |
| 353 | `/plan/limits/[id]` (object href) | yes |
| 363 | `/transaction/new` | no, root route |

`/transaction/new` and `/review` are root-level routes outside the `(tabs)` group, so there is no nested stack for them to anchor into. Leave those three exactly as they are.

Above the first of them, one comment for the group:

```tsx
// `withAnchor` ON EVERY PUSH THAT LEAVES THIS TAB. Home is in one tab and each
// of these targets is a screen inside another tab's Stack. Pushed without an
// anchor on a cold start, the target becomes that stack's only entry: no Back,
// and the tab button returns to the same screen. `unstable_settings` in the
// two nested layouts covers the deep-link case; this covers the in-app tap,
// which is the one the owner hit.
```

The two shapes, string href and object href, both take the same second argument:

```tsx
router.push("/plan/limits/new", { withAnchor: true });

router.push(
  { pathname: "/plan/limits/[id]", params: { id: alert.target.limitId } },
  { withAnchor: true },
);
```

- [ ] **Step 5: Run the tests**

Run: `cd mobile && npx jest app/__tests__/home_screen.test.tsx app/__tests__/tabs_layout.test.tsx app/__tests__/plan_segments.test.tsx app/__tests__/more_tab.test.tsx app/__tests__/more_hub.test.tsx`

Expected: PASS. `tabs_layout` and `plan_segments` are the two suites that read the tab tree, so a stray extra tab button or a changed route registration surfaces there rather than on the device.

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/(tabs)/plan/_layout.tsx" "mobile/app/(tabs)/more/_layout.tsx" "mobile/app/(tabs)/index.tsx" mobile/app/__tests__/home_screen.test.tsx
git commit -m "fix(nav): stop a card opened from Home capturing the Plan and More tabs"
```

---

### Task 2: Give every bottom sheet a bounded, scrolling body

Fixes D3.

**Files:**
- Modify: `mobile/components/ui/bottom_sheet.tsx`
- Modify: `mobile/components/review/correct_sheet.tsx:31-34,58,385,548`
- Create: `mobile/components/ui/__tests__/bottom_sheet.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a `bottom-sheet-scroll` testID that Task 3's sheet test may assert against. `BottomSheetProps` is unchanged, so no caller needs editing.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/ui/__tests__/bottom_sheet.test.tsx`. Match the imports and provider setup of `mobile/components/ui/__tests__/keypad_host.test.tsx`, which mounts a sheet-adjacent component and already deals with `react-native-safe-area-context`.

```tsx
import { render, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import { BottomSheet } from "@/components/ui/bottom_sheet";

// THE DEFECT THIS PINS. A loan with several possible payments grew the sheet
// upward until its first rows clipped off the top of the screen, and nothing
// scrolled them back: the body was a plain View, bottom-aligned, with no height
// bound at all. The owner reported it as "possible payments can't be scrolled".
test("a sheet's body is a bounded scroll area", () => {
  render(
    <BottomSheet visible onDismiss={() => {}} title="Is this a payment?">
      <Text>a candidate</Text>
    </BottomSheet>,
  );

  const body = screen.getByTestId("bottom-sheet-scroll");

  // A ScrollView with no height bound scrolls nothing, so the bound is the
  // assertion, not the presence of the component.
  const { maxHeight } = StyleSheet.flatten(body.props.style) as { maxHeight?: number };
  expect(typeof maxHeight).toBe("number");
  expect(maxHeight).toBeGreaterThan(0);
});

test("a sheet still renders its children", () => {
  render(
    <BottomSheet visible onDismiss={() => {}}>
      <Text>a candidate</Text>
    </BottomSheet>,
  );

  screen.getByText("a candidate");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest components/ui/__tests__/bottom_sheet.test.tsx`

Expected: FAIL with `Unable to find an element with testID: bottom-sheet-scroll`.

- [ ] **Step 3: Move the body into a bounded ScrollView**

In `mobile/components/ui/bottom_sheet.tsx`, add `ScrollView` and `useWindowDimensions` to the existing `react-native` import, then add the ratio constant beside `SHEET_BOTTOM_PADDING`:

```tsx
/**
 * How much of the screen a sheet's BODY may occupy before it starts scrolling.
 *
 * A sheet is a decision, not a page, and one that covers the whole screen has
 * stopped being a sheet: the user loses the context they opened it from and the
 * scrim stops reading as "tap here to back out". Seven tenths leaves the scrim
 * legible above the tallest body while giving a loan with six possible payments
 * room to show four of them without moving.
 *
 * It bounds the BODY only. The title, the grab handle and the sheet's own
 * bottom padding sit outside the scroll area, so the last row still clears the
 * navigation bar and the keypad panel exactly as before.
 */
const SHEET_MAX_BODY_RATIO = 0.7;
```

Inside the component, read the window height beside the other hooks, above the `if (!visible) return null` early return so the hook order never moves:

```tsx
const { height: windowHeight } = useWindowDimensions();
```

Then replace the bare `{children}` with:

```tsx
{/* THE BODY SCROLLS, THE CHROME DOES NOT (owner's 2026-09-05 report:
    "possible payments can't be scrolled, a loan showing multiple possible
    payments can't show all records").

    A sheet is bottom-aligned inside `flex-1 justify-end`, so an unbounded
    body grows UPWARD and its first rows leave the top of the screen. There is
    no gesture that brings them back, and the taller the list the more of it
    is simply gone. docs/13-on-device-verification.md:1384 names this remedy
    for the same clipping on the correction sheet: a maxHeight taken from
    `useWindowDimensions()`.

    MEASURED AGAINST THE WINDOW, NOT A FIXED `max-h-96`. A 384dp cap is most
    of a small phone's screen and a third of a tablet's. correct_sheet.tsx
    carried exactly that private cap and now gives it up in favour of this
    one, so there is one scroll container per sheet rather than two nested
    ones fighting over the same drag.

    `keyboardShouldPersistTaps="handled"` so the first tap on a Confirm button
    presses it, rather than being spent dismissing an open keypad panel. */}
<ScrollView
  testID="bottom-sheet-scroll"
  style={{ maxHeight: windowHeight * SHEET_MAX_BODY_RATIO }}
  keyboardShouldPersistTaps="handled"
>
  {children}
</ScrollView>
```

It goes where `{children}` is today, immediately after the title block and still inside the `bottom-sheet` View, so the `paddingBottom` stays outside the scroll area.

- [ ] **Step 4: Remove the correction sheet's private scroll container**

In `mobile/components/review/correct_sheet.tsx`, delete the `<ScrollView className="max-h-96">` opening tag at line 385 and its closing tag at line 548, keeping the `<View className="gap-4">` they wrapped. Remove `ScrollView` from the `react-native` import at line 58. Replace the header comment at lines 31 to 34 that explains the `max-h-96` fold with:

```tsx
// THE `max-h-96` FOLD THIS SHEET USED TO OWN NOW LIVES IN `BottomSheet`, which
// bounds every sheet's body against the window rather than at a fixed 384dp.
// The blocked-Save defect that comment described is unchanged by the move: the
// missing-field notice still sits at the top of the form, above Direction, and
// Save still sits outside the scroll area where the panel cannot cover it.
```

Two nested scroll views of the same orientation would otherwise both claim the drag and the inner one would win, which is a bug rather than a style preference.

- [ ] **Step 5: Run the tests**

Run: `cd mobile && npx jest components/ui/__tests__/bottom_sheet.test.tsx components/ui/__tests__/keypad_host.test.tsx components/review/__tests__ app/__tests__/review_queue.test.tsx`

Expected: PASS. The review suites drive `correct_sheet` end to end, so a lost tag or a broken import surfaces there.

- [ ] **Step 6: Commit**

```bash
git add mobile/components/ui/bottom_sheet.tsx mobile/components/review/correct_sheet.tsx mobile/components/ui/__tests__/bottom_sheet.test.tsx
git commit -m "fix(ui): bound and scroll a bottom sheet's body against the window"
```

---

### Task 3: Make "None of these" remember the rejection

Fixes D2.

**Files:**
- Create: `mobile/lib/db/migrations/019_loan_match_rejections.sql`
- Modify: `mobile/lib/db/migrations.ts` (import block, and the `MIGRATIONS` array at line 171)
- Modify: `mobile/lib/db/repos/loans_repo.ts`
- Modify: `mobile/lib/loans/loans_service.ts:454-510`
- Create: `mobile/hooks/mutations/use_reject_payment_candidates.ts`
- Modify: `mobile/components/loans/payment_match_sheet.tsx`
- Modify: `mobile/app/(tabs)/plan/loans/[id].tsx`
- Test: the loans service suite that already drives `findPaymentCandidates`. Find it with `git grep -l findPaymentCandidates -- mobile/lib/loans/__tests__` and add to that file.
- Test: `mobile/components/loans/__tests__/payment_match_sheet.test.tsx` (create it)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `rejectCandidates(loanId: string, transactionIds: readonly string[], now?: number): Promise<void>` in `loans_repo.ts`
  - `listRejectedTransactionIds(loanId: string): Promise<string[]>` in `loans_repo.ts`
  - `useRejectPaymentCandidates()`, a TanStack mutation over `{ loanId: string; transactionIds: string[] }`
  - `PaymentMatchSheetProps` gains `onReject?: (transactionIds: string[]) => void`

- [ ] **Step 1: Write the failing service test**

```ts
// "NONE OF THESE" HAS TO SURVIVE THE SHEET CLOSING. Before this, the button
// called `onDismiss` and nothing else, so the same rows were re-scored on the
// next visit and the loan kept advertising "2 possible payments". The owner
// reported it as the button having "no actual wired function".
test("a rejected transaction stops being suggested for that loan", async () => {
  const { loan, paying } = await aLoanWithOnePlausiblePayment();

  const before = await findPaymentCandidates(loan.id, NOW);
  expect(before.map((candidate) => candidate.transactionId)).toContain(paying.id);

  await rejectCandidates(loan.id, [paying.id]);

  const after = await findPaymentCandidates(loan.id, NOW);
  expect(after.map((candidate) => candidate.transactionId)).not.toContain(paying.id);
});

// THE REJECTION IS A UI MEMORY, NOT A NEGATIVE RULE (loans rule 10). "Show
// every transaction" is a SEARCH, and a user who rejected a row and then
// realised it was the payment must still be able to find it and confirm it.
test("the browse-everything list still offers a rejected transaction", async () => {
  const { loan, paying } = await aLoanWithOnePlausiblePayment();
  await rejectCandidates(loan.id, [paying.id]);

  const all = await findPaymentCandidates(loan.id, NOW, 50, true);

  expect(all.map((candidate) => candidate.transactionId)).toContain(paying.id);
});

// Rule 10 again, from the other side: a rejection names ONE pair. It says
// nothing about the counterparty, and a second loan with the same person must
// still be offered the same row.
test("a rejection on one loan does not silence the row on another", async () => {
  const { loan, paying, otherLoanSameCounterparty } = await aLoanWithOnePlausiblePayment();
  await rejectCandidates(loan.id, [paying.id]);

  const other = await findPaymentCandidates(otherLoanSameCounterparty.id, NOW);

  expect(other.map((candidate) => candidate.transactionId)).toContain(paying.id);
});
```

Build `aLoanWithOnePlausiblePayment` from the fixtures the file you are adding to already uses, and reuse its `beforeEach` database setup verbatim. Do not introduce a second fixture layer.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest lib/loans/__tests__ -t "rejected"`

Expected: FAIL with `rejectCandidates is not a function`, or a module resolution error for the missing export.

- [ ] **Step 3: Write the migration**

Create `mobile/lib/db/migrations/019_loan_match_rejections.sql`:

```sql
-- 019_loan_match_rejections.sql -- the owner's 2026-09-05 device report:
-- "clicking 'None of These' is not working properly, could be because there's
-- no actual wired function for that button and just closes the shown element".
--
-- WHAT THE BUTTON MEANT BEFORE THIS TABLE. Nothing. It called `onDismiss`, the
-- sheet closed, and the next open re-scored the same rows and offered them
-- again under a button still reading "3 possible payments". The user answered a
-- question the app immediately forgot, which is worse than not asking it.
--
-- ONE PAIR PER ROW, AND THAT IS WHAT KEEPS RULE 10 INTACT. Loans rule 10:
-- rejecting a suggestion "never creates a negative UserRule automatically". A
-- row here is not a rule. It silences exactly one transaction against exactly
-- one loan and says nothing about the merchant, the counterparty, or the next
-- transaction from the same person. The rejection COUNTER that rule 10 goes on
-- to describe ("repeated rejections for the same merchant surface a one-time
-- prompt") still has nowhere to live, and this table is deliberately not it.
--
-- STILL REACHABLE, NEVER LOST. `findPaymentCandidates` consults this table for
-- the SUGGESTED list only. "Show every transaction" drops the score floor and
-- ignores it, so a user who rejects a row and then realises it was the payment
-- can still find and confirm it. A rejection that could not be undone would be
-- a worse defect than the one it fixes.
--
-- CASCADE ON BOTH SIDES, UNLIKE `loan_payments`. 001_core.sql's payments carry
-- no CASCADE because they are LEDGER rows and must never disappear quietly. A
-- rejection is a UI memory: a dangling one would filter a candidate out of a
-- loan that no longer exists, and nothing would ever show the user why.
CREATE TABLE IF NOT EXISTS loan_match_rejections (
  id TEXT PRIMARY KEY NOT NULL,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (loan_id, transaction_id)
);

-- The only read is "which transactions has this loan rejected", once per open
-- of the loan detail screen.
CREATE INDEX IF NOT EXISTS idx_loan_match_rejections_loan
  ON loan_match_rejections (loan_id);
```

Register it in `mobile/lib/db/migrations.ts`. The import, beside the others:

```ts
import loanMatchRejectionsSql from "./migrations/019_loan_match_rejections.sql";
```

The entry, at the end of `MIGRATIONS` after version 18:

```ts
  // A new table and its index. No rebuild, so no `disablesForeignKeys`.
  { version: 19, name: "loan_match_rejections", sql: loanMatchRejectionsSql },
```

- [ ] **Step 4: Add the two repository functions**

In `mobile/lib/db/repos/loans_repo.ts`, below `deletePayment`, in the file's existing section style:

```ts
// ---------------------------------------------------------------------------
// Rejected match suggestions
// ---------------------------------------------------------------------------

/**
 * The user said none of these rows pays this loan (019_loan_match_rejections).
 *
 * IDEMPOTENT, because the same sheet can be opened and rejected twice and a
 * second "None of these" is not an error the user should ever hear about.
 * `INSERT OR IGNORE` against the pair's UNIQUE constraint is the whole
 * mechanism.
 *
 * TAKES THE WHOLE LIST, not one id at a time. The button rejects everything the
 * sheet was showing, and one statement per row inside one transaction is what
 * keeps a half-applied rejection from surviving a crash mid-loop.
 */
export async function rejectCandidates(
  loanId: string,
  transactionIds: readonly string[],
  now: number = Date.now(),
): Promise<void> {
  if (transactionIds.length === 0) return;
  const db = await getDatabase();

  for (const transactionId of transactionIds) {
    await db.runAsync(
      `INSERT OR IGNORE INTO loan_match_rejections (id, loan_id, transaction_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [newId(), loanId, transactionId, now],
    );
  }
}

/** The transactions this loan has been told are not its payments. */
export async function listRejectedTransactionIds(loanId: string): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ transaction_id: string }>(
    "SELECT transaction_id FROM loan_match_rejections WHERE loan_id = ?",
    [loanId],
  );
  return rows.map((row) => row.transaction_id);
}
```

Wrap the loop in the unit-of-work helper if the neighbouring write functions use one. Match what `recordPayment` and `deletePayment` do rather than introducing a different pattern.

- [ ] **Step 5: Filter the suggestions**

In `mobile/lib/loans/loans_service.ts`, add `listRejectedTransactionIds` to the existing `loans_repo` import, then inside `findPaymentCandidates`, beside the `claimed` set:

```ts
  // WHAT THE USER ALREADY SAID NO TO (019_loan_match_rejections). Suggestions
  // only: `includeBelowFloor` is the "Show every transaction" SEARCH, and a
  // search that hides rows because of an earlier tap is a search the user
  // cannot use to correct that tap. Rejecting is meant to be undoable, so the
  // one list that exists to find a specific transaction never consults this.
  const rejected = includeBelowFloor
    ? new Set<string>()
    : new Set(await listRejectedTransactionIds(loanId));
```

and extend the first filter:

```ts
    .filter((transaction) => !claimed.has(transaction.id) && !rejected.has(transaction.id))
```

- [ ] **Step 6: Run the service tests to verify they pass**

Run: `cd mobile && npx jest lib/loans/__tests__`

Expected: PASS, including the three new tests and every existing loans test.

- [ ] **Step 7: Commit the data half**

```bash
git add mobile/lib/db/migrations/019_loan_match_rejections.sql mobile/lib/db/migrations.ts mobile/lib/db/repos/loans_repo.ts mobile/lib/loans/loans_service.ts mobile/lib/loans/__tests__
git commit -m "feat(loans): remember a rejected payment suggestion per loan"
```

- [ ] **Step 8: Write the failing sheet test**

Create `mobile/components/loans/__tests__/payment_match_sheet.test.tsx`, matching the setup in `record_payment_sheet.test.tsx` next door. `candidateFor` builds a `PaymentCandidate` with a transaction id, an amount, an `occurredAt`, a score and a one-entry `reasons` array; write it at the top of the file.

```tsx
test("'None of these' reports every row it was showing, then closes", () => {
  const onReject = jest.fn();
  const onDismiss = jest.fn();

  render(
    <PaymentMatchSheet
      visible
      candidates={[candidateFor("tx-1"), candidateFor("tx-2")]}
      counterparty="Kuya Ben"
      direction="i-owe"
      onDismiss={onDismiss}
      onConfirm={() => {}}
      onReject={onReject}
      onShowAll={() => {}}
    />,
  );

  fireEvent.press(screen.getByTestId("match-dismiss"));

  expect(onReject).toHaveBeenCalledWith(["tx-1", "tx-2"]);
  expect(onDismiss).toHaveBeenCalled();
});

// THE BROWSE LIST IS A SEARCH AND ITS BUTTON IS A PLAIN CLOSE. Rejecting fifty
// unfiltered rows because the user gave up scrolling would silence the
// suggested list on the strength of a gesture that meant nothing of the kind.
test("the browse list's Close rejects nothing", () => {
  const onReject = jest.fn();

  render(
    <PaymentMatchSheet
      visible
      showingAll
      candidates={[candidateFor("tx-1")]}
      counterparty="Kuya Ben"
      direction="i-owe"
      onDismiss={() => {}}
      onConfirm={() => {}}
      onReject={onReject}
    />,
  );

  fireEvent.press(screen.getByTestId("match-dismiss"));

  expect(onReject).not.toHaveBeenCalled();
});
```

- [ ] **Step 9: Run the sheet test to verify it fails**

Run: `cd mobile && npx jest components/loans/__tests__/payment_match_sheet.test.tsx`

Expected: FAIL, `onReject` received zero calls.

- [ ] **Step 10: Wire the button**

In `mobile/components/loans/payment_match_sheet.tsx`, add to `PaymentMatchSheetProps`:

```tsx
  /**
   * The user said none of the SUGGESTED rows pays this loan, and named them.
   *
   * Absent on the browse-everything list, where the same button is a plain
   * "Close": those fifty rows are a search result, not an offer, and rejecting
   * them would silence the suggestions on the strength of a user who simply
   * stopped scrolling.
   */
  onReject?: (transactionIds: string[]) => void;
```

Take `onReject` in the destructured props and replace the dismiss button with:

```tsx
        {/* Rejecting writes ONE narrow row per pair (019_loan_match_rejections)
            and nothing else. Loans rule 10 forbids inventing a negative
            UserRule from a single "no", and this is not one: it silences these
            exact transactions on this exact loan, leaves the counterparty and
            every future transaction from them alone, and stays reachable
            through "Show every transaction", which ignores the rejections. */}
        <Button
          title={showingAll ? "Close" : "None of these"}
          variant="ghost"
          testID="match-dismiss"
          onPress={() => {
            if (!showingAll && onReject !== undefined) {
              onReject(candidates.map((candidate) => candidate.transactionId));
            }
            onDismiss();
          }}
        />
```

- [ ] **Step 11: Add the mutation hook**

Create `mobile/hooks/mutations/use_reject_payment_candidates.ts`, copying the shape of `mobile/hooks/mutations/use_confirm_payment_match.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { rejectCandidates } from "@/lib/db/repos/loans_repo";

/**
 * "None of these" (019_loan_match_rejections).
 *
 * INVALIDATES THE LOANS FAMILY, not just the candidate list, because the loan
 * detail screen's own button reads the suggestion COUNT ("3 possible
 * payments"). Dropping the list without dropping the count would close the
 * sheet and leave the number that opened it unchanged, which is the defect this
 * hook exists to fix wearing a different face.
 */
export function useRejectPaymentCandidates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ loanId, transactionIds }: { loanId: string; transactionIds: string[] }) =>
      rejectCandidates(loanId, transactionIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.loans.all }),
  });
}
```

- [ ] **Step 12: Wire the loan detail screen**

In `mobile/app/(tabs)/plan/loans/[id].tsx`, add the hook beside the other mutations:

```tsx
  const reject = useRejectPaymentCandidates();
```

and the prop on `PaymentMatchSheet`:

```tsx
        onReject={(transactionIds) =>
          reject.mutate({ loanId: status.loan.id, transactionIds })
        }
```

The existing `onDismiss` keeps resetting `sheetOpen` and `browsingAll` and needs no change: the sheet calls `onReject` first and `onDismiss` second, so the write is issued before the state resets.

- [ ] **Step 13: Run the tests**

Run: `cd mobile && npx jest components/loans/__tests__ app/__tests__/loan_routes.test.tsx hooks`

Expected: PASS.

- [ ] **Step 14: Commit the UI half**

```bash
git add mobile/components/loans/payment_match_sheet.tsx "mobile/app/(tabs)/plan/loans/[id].tsx" mobile/hooks/mutations/use_reject_payment_candidates.ts mobile/components/loans/__tests__
git commit -m "fix(loans): wire 'None of these' to the rejection it claims to record"
```

---

### Task 4: Close the stale card instead of throwing at the user

Fixes D4.

**Files:**
- Modify: `mobile/lib/db/repos/loans_repo.ts`
- Modify: `mobile/lib/loans/loan_match_queue.ts:208-247`
- Modify: `mobile/hooks/mutations/use_confirm_payment_match.ts`
- Modify: `mobile/hooks/mutations/use_review_action.ts:91-107`
- Modify: `mobile/app/review/index.tsx:155-160`
- Test: `mobile/lib/loans/__tests__/loan_match_queue.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `getPaymentByTransaction(transactionId: string): Promise<LoanPayment | null>` in `loans_repo.ts`
  - `closeLoanMatchesFor(transactionId: string): Promise<void>` in `loan_match_queue.ts`
  - `recordPaymentAndCloseCards(loanId: string, transactionId: string): Promise<LoanPayment>` in `loan_match_queue.ts`
  - `ReviewAction` gains `{ kind: "dismiss-loan-match"; itemId: string }`

A layering rule the implementer must not break: `loan_match_queue.ts` already imports from both `loans_service.ts` and `review_queue_repo.ts`, and it is the only module that may. `loans_service.ts` must NOT gain an import from the review queue, or the two become an import cycle, which is how the Plan tab stopped rendering under Jest during m2 Task 8 (see that module's own header).

- [ ] **Step 1: Write the failing tests**

In `mobile/lib/loans/__tests__/loan_match_queue.test.ts`, next to the existing confirm and dismiss tests, reusing that file's fixtures:

```ts
// THE OWNER'S 2026-09-05 REPORT, IN ONE TEST. The notification raised a card;
// the owner then confirmed the same transaction from the loan screen's match
// sheet. The card survived, and pressing "Record this payment" on it threw
// PaymentAlreadyMatchedError, which the review screen rendered as "That didn't
// go through, and nothing was saved". Every word of that was false, and the
// only button left that did anything said the payment was not a payment.
test("recording a payment closes the open card for the same transaction", async () => {
  const { loan, transaction } = await aLoanAndAPlausibleTransaction();
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;
  expect(itemId).not.toBeNull();

  await recordPaymentAndCloseCards(loan.id, transaction.id);

  const open = await listOpen();
  expect(open.map((item) => item.id)).not.toContain(itemId);
});

// The card that slipped through anyway: raised, then the payment recorded by
// some other path. Confirming it must recognise the existing match and answer
// the card's question, not throw at the user for doing what the app asked.
test("confirming a card whose payment is already recorded resolves it", async () => {
  const { loan, transaction } = await aLoanAndAPlausibleTransaction();
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;
  await recordPayment({ loanId: loan.id, transactionId: transaction.id });

  const payment = await confirmLoanMatch(itemId, loan.id);

  expect(payment).not.toBeNull();
  expect(payment?.transactionId).toBe(transaction.id);
  const open = await listOpen();
  expect(open.map((item) => item.id)).not.toContain(itemId);
});

// I12 STILL HOLDS: one transaction pays at most one loan. A card offering a
// SECOND loan for a transaction the first loan already claimed must not record
// anything, and must still close, because its question has an answer.
test("a card is not a second claim on an already-paid transaction", async () => {
  const { loan, otherLoan, transaction } = await aLoanAndAPlausibleTransaction();
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;
  await recordPayment({ loanId: loan.id, transactionId: transaction.id });

  await confirmLoanMatch(itemId, otherLoan.id);

  const payments = await listPayments(otherLoan.id);
  expect(payments).toHaveLength(0);
});
```

The third test only holds if the raised card actually lists both loans as candidates, since `confirmLoanMatch` rejects a `loanId` that is not in the payload. Build `aLoanAndAPlausibleTransaction` so both score above the floor. If that is not achievable with the existing fixtures, drop `otherLoan` and assert on `loan.id` alone: the first two tests are the reported defect.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest lib/loans/__tests__/loan_match_queue.test.ts`

Expected: FAIL. The first with `recordPaymentAndCloseCards is not a function`, the second with a thrown `PaymentAlreadyMatchedError`.

- [ ] **Step 3: Add the repository read**

In `mobile/lib/db/repos/loans_repo.ts`, beside `listPayments`:

```ts
/**
 * The payment that already claims this transaction, or `null`.
 *
 * `loan_payments.transaction_id` is `NOT NULL UNIQUE` (001_core.sql, invariant
 * I12), so there is at most one and no ordering is needed. Exists so a caller
 * can ASK before writing, rather than learning the answer as a thrown
 * `PaymentAlreadyMatchedError` it then has to translate for the user.
 */
export async function getPaymentByTransaction(
  transactionId: string,
): Promise<LoanPayment | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    id: string;
    loan_id: string;
    transaction_id: string;
    created_at: number;
    updated_at: number;
  }>(
    `SELECT id, loan_id, transaction_id, created_at, updated_at
     FROM loan_payments WHERE transaction_id = ?`,
    [transactionId],
  );
  return row === null
    ? null
    : {
        id: row.id,
        loanId: row.loan_id,
        transactionId: row.transaction_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
}
```

If `listPayments` maps its rows differently, follow that function: it is the authority on the shape.

- [ ] **Step 4: Make `confirmLoanMatch` tolerate an already-recorded payment**

In `mobile/lib/loans/loan_match_queue.ts`, inside `confirmLoanMatch`'s `withUnitOfWork` callback, before the `recordPayment` call:

```ts
    // ALREADY RECORDED SOMEWHERE ELSE, AND THAT IS AN ANSWER, NOT A FAULT.
    //
    // Two surfaces can record this match and until now neither told the other:
    // this card, and the loan detail screen's match sheet. Confirm the sheet
    // first and the card survived; pressing it then reached `recordPayment`,
    // which found the transaction claimed and threw
    // `PaymentAlreadyMatchedError`, which app/review/index.tsx rendered as
    // "That didn't go through, and nothing was saved". It HAD gone through, it
    // WAS saved, and no amount of trying again could ever succeed. The only
    // working button left was "Not a loan payment", so the app was asking the
    // user to record the opposite of what happened. That is the owner's
    // 2026-09-05 report.
    //
    // RESOLVES, WRITES NOTHING. The card asked "is this a payment on one of
    // your loans?" and the ledger already says yes, so the question has an
    // answer and the item closes as `confirmed`. Writing a second
    // `loan_payments` row is not available even in principle: `transaction_id`
    // is UNIQUE, which is invariant I12 in schema form.
    //
    // TRUE EVEN WHEN THE CLAIM IS ANOTHER LOAN'S. I12 gives a transaction one
    // loan, so a card offering a second one has been overtaken by events. The
    // existing payment is the honest return value, and leaving the item open to
    // ask again would put an unanswerable question back in front of the user.
    const existing = await getPaymentByTransaction(payload.transactionId);
    if (existing !== null) {
      await resolve(itemId, "confirmed");
      return existing;
    }
```

Add `getPaymentByTransaction` to the file's existing `loans_repo` import.

- [ ] **Step 5: Add the two composition functions**

Below `dismissLoanMatch` in the same file:

```ts
/**
 * Closes every OPEN loan-match card for a transaction, because it has one now.
 *
 * THE HALF OF THE RACE THAT NEVER REACHES THE CARD. `confirmLoanMatch` above
 * handles a user who arrives at the card second. This handles the user who
 * never goes back to it: they record the payment on the loan screen, and the
 * card would otherwise sit in the queue asking a question that is already
 * answered until it expires, offering an accept that can only fail.
 *
 * `confirmed`, not `dismissed`. The card asked "is this a payment on one of
 * your loans", the answer turned out to be yes, and a queue that recorded it as
 * a dismissal would be filing the user's own decision as a rejection.
 */
export async function closeLoanMatchesFor(transactionId: string): Promise<void> {
  const open = await listOpen();
  for (const item of open) {
    if (readLoanMatchPayload(item)?.transactionId === transactionId) {
      await resolve(item.id, "confirmed");
    }
  }
}

/**
 * Record a payment from OUTSIDE the queue, and close whatever the queue was
 * still asking about it.
 *
 * ONE UNIT OF WORK, for the same reason `confirmLoanMatch` is one: a recorded
 * payment beside a surviving card is precisely the state this task exists to
 * remove, and a half-applied write would recreate it.
 *
 * IT LIVES HERE AND NOT IN `loans_service.ts`. That module must not import the
 * review queue. This one already imports both sides and is the only module
 * allowed to; reversing that would make the two a cycle, which is how the Plan
 * tab stopped rendering under Jest during m2 Task 8.
 */
export async function recordPaymentAndCloseCards(
  loanId: string,
  transactionId: string,
): Promise<LoanPayment> {
  return withUnitOfWork(async () => {
    const payment = await recordPayment({ loanId, transactionId });
    await closeLoanMatchesFor(transactionId);
    return payment;
  });
}
```

- [ ] **Step 6: Point the loan screen's mutation at it**

In `mobile/hooks/mutations/use_confirm_payment_match.ts`, replace the `confirmPaymentMatch` call with `recordPaymentAndCloseCards(loanId, transactionId)`, and add the review-queue key to whatever it already invalidates, with the reason:

```ts
// ALSO INVALIDATES THE REVIEW QUEUE, because this write can now CLOSE a card.
// Without it the queue badge and the queue screen keep showing an item the
// database has already resolved, and the user taps a card that is gone.
```

Leave `loans_service.confirmPaymentMatch` in place and add one line to its doc comment saying the UI now goes through `loan_match_queue.recordPaymentAndCloseCards`, so the next reader does not wire a new screen to the queue-blind version.

- [ ] **Step 7: Route the loan-match dismissal through its own function**

`mobile/hooks/mutations/use_review_action.ts`'s `dismiss` case calls `resolve(itemId, "dismissed")` directly for every kind, which is why `dismissLoanMatch` has no caller outside its tests today. Add `| { kind: "dismiss-loan-match"; itemId: string }` to `ReviewAction`, import `dismissLoanMatch` beside the existing `confirmLoanMatch` import, and add the case:

```ts
    case "dismiss-loan-match":
      // Not a bare `resolve`: loans rule 10's rejection COUNTER ("repeated
      // rejections for the same merchant surface a one-time prompt") needs a
      // named seam to be added at, and a switch case that reaches past the
      // loans module gives it nowhere to live. `dismissLoanMatch` is a
      // pass-through today and exists for exactly that reason.
      await dismissLoanMatch(action.itemId);
      return;
```

`keysFor` must return the same keys for the new kind as it does for `dismiss`; add it to that case's fall-through rather than letting it hit the broad `default`.

Then make `mobile/app/review/index.tsx` send `dismiss-loan-match` for a `loan-match` card's secondary button instead of the generic `dismiss`. Find that call site by reading the screen's secondary-action handler. Do not guess it.

- [ ] **Step 8: Fix the message the user actually reads**

In `mobile/app/review/index.tsx`, add a branch to `triageFailureMessage` above the generic return, importing `PaymentAlreadyMatchedError` from `@/lib/db/repos/loans_repo`:

```tsx
  // The generic sentence below says "nothing was saved, your balances are
  // unchanged, try again". For this error every clause is false: the payment IS
  // recorded, the balance DID move, and trying again can never succeed because
  // `loan_payments.transaction_id` is UNIQUE. Step 4 above should keep this
  // unreachable from the card; it stays as the honest fallback for any path
  // that still reaches `recordPayment` with a claimed transaction.
  if (error instanceof PaymentAlreadyMatchedError) {
    return "This payment is already recorded on one of your loans, so there was nothing to save.";
  }
```

- [ ] **Step 9: Run the tests**

Run: `cd mobile && npx jest lib/loans/__tests__ app/__tests__/review_queue.test.tsx app/__tests__/loan_routes.test.tsx hooks`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add mobile/lib/db/repos/loans_repo.ts mobile/lib/loans/loan_match_queue.ts mobile/hooks/mutations/use_confirm_payment_match.ts mobile/hooks/mutations/use_review_action.ts mobile/app/review/index.tsx mobile/lib/loans/__tests__
git commit -m "fix(loans): close a loan-match card once its payment is recorded elsewhere"
```

---

### Task 5: Verify the whole change

- [ ] **Step 1: Typecheck and lint**

Run: `cd mobile && npx tsc --noEmit`
Then: `cd mobile && npm run lint`

Expected: PASS with no new errors. If something looks pre-existing, check it out on `master` and confirm before writing it off.

- [ ] **Step 2: Run the full suite once**

Run: `cd mobile && npx jest`

Expected: PASS except the pre-existing flaky failures the 2026-09-01 handoff recorded. Name any failure you keep and say why you believe it is pre-existing, by running that one suite on `master`. Do not write PASS for a suite you did not watch finish.

- [ ] **Step 3: Build and install to the A54**

Three of the four defects are about touch and navigation, which Jest cannot see.

```bash
cd mobile
APP_VARIANT=preview npx expo run:android --variant preview
```

`APP_VARIANT` is not optional: unset, it builds the wrong package. If a prebuild is needed first, kill every Gradle daemon before deleting `android/`, and do not run it from a terminal whose working directory is inside `mobile/android`.

- [ ] **Step 4: Walk the four reports on the device**

Record each verbatim outcome. These go in the PR body.

1. Force-stop the app, then open it. From Home, tap a loan card, a bills card and a limits card in turn. Each opens its detail screen, Back returns to Home, and afterwards the Plan tab opens on the Plan index, not on the card.
2. Same cold start, tap the tracking banner's Fix. More opens on `listener_health`, Back works, and afterwards the More tab opens on the More index.
3. Plan, Utang, a loan with three or more possible payments. The sheet's list scrolls, every candidate is reachable, and the confirm button on the last one is not under the navigation bar.
4. In that sheet, tap "None of these". Reopen the loan: those rows are no longer offered and the button has dropped its count or reads "Match a payment". Open "Show every transaction": the rejected rows are still listed and still confirmable.
5. With a loan-match card waiting in the Review Queue, confirm the same transaction from the loan screen's match sheet. Return to the Review Queue: the card is gone. If one is still there, press "Record this payment": it closes without an error and without adding a second payment to the loan.

- [ ] **Step 5: Commit the device results**

```bash
git commit --allow-empty -m "test(mobile): record on-device verification of the 2026-09-05 fixes"
```

Paste the five recorded outcomes into that message. An empty commit whose message says nothing is worth nothing.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin worktree-fix-plan-tab-and-loan-match
```

Base `master`. Body: the four defects, their root causes, and the device results. No AI attribution line anywhere in it.

---

## Follow-ups deliberately not in this plan

1. **Manual payment plus notification is still a double count.** The manual "Record payment" sheet creates a new `source: manual` transaction. A notification for the same money commits a second row, and both can be recorded against the loan. `committedTwinOf` in `resolve_actions.ts` cannot catch it: it joins on `providerKey` and `channel`, and a manual row has neither, so a manual transaction is never a twin of a detected one. Fixing it means either matching manual rows against later notifications, or giving the manual sheet an "I already have the notification" path. Real defect, different fix, not what was reported.
2. **The rejection counter loans rule 10 describes.** `loan_match_rejections` stores the pair, not a per-merchant tally, and `dismissLoanMatch` still writes no count. The "stop suggesting this merchant for this loan?" prompt needs both, plus a product decision about the threshold.
