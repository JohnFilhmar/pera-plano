// app/__tests__/review_queue.test.tsx — m1c plan Task 9's route,
// app/review/index.tsx, against a REAL database.
//
// TWO THINGS ONLY AN END-TO-END TEST CAN CATCH, and both are about the queue's
// job rather than its looks:
//
//   ORDER. Cards are oldest-first (rule 2) because a queue sorted the other way
//   quietly guarantees that the oldest item is the one nobody ever reaches: it
//   sinks a row further with every new capture until it expires unread at 30
//   days, discarded without ever being shown. The items below are enqueued OUT
//   of chronological order on purpose — a screen that merely preserved whatever
//   order it was handed would pass against a repository that happens to sort
//   correctly, and reverse the queue the first time anything else fed it.
//
//   WHAT IS OPEN. An expired item must not render. The queue is triage, not an
//   inbox: `listOpen` is what keeps it from becoming the guilt list rule 27
//   exists to prevent, and the screen has to honour that boundary rather than
//   render every row it can see.
//
// The empty state is asserted as a REWARD, with the spec's own wording. "All
// caught up." is the one empty state in this app that should feel good.
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: () => mockBack() }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { createLoan, listPayments, outstandingBalance } from "@/lib/db/repos/loans_repo";
import { raiseLoanMatchSuggestion } from "@/lib/loans/loan_match_queue";
import {
  countOpen,
  enqueue,
  resolve,
  REVIEW_PAGE_SIZE,
} from "@/lib/db/repos/review_queue_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { listUserRules } from "@/lib/db/repos/user_rules_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { GATE_REASONS } from "@/lib/ingest/confidence_gate";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { NewReviewItem, ReviewQueueItem, Transaction } from "@/types/domain";

import ReviewQueueScreen, {
  REVIEW_BACKLOG_BANNER,
  REVIEW_EMPTY_BODY,
  REVIEW_EMPTY_TITLE,
  sortOldestFirst,
} from "../review/index";

const mockBack = jest.fn();

const NOW = Date.now();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity },
      // Task 10 gave this screen mutations. The app's default mutation `gcTime`
      // is five minutes, and a settled mutation holds a timer for that long —
      // long enough to outlive the whole suite and force Jest to kill the
      // worker. Zero here, matching app/__tests__/transactions_screen.test.tsx.
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

// KeypadProvider AND A ROOT HOST (numeric-input-system Task 14). "Correct"
// opens a sheet whose amount is a NumericField now, and that field's
// `useKeypad()` throws with no provider above it. The host goes BEFORE the
// screen: tokens are handed out in effect-completion order, so a host mounted
// after would outrank the one CorrectSheet's BottomSheet mounts inside its own
// Modal, and the panel would be painted behind the sheet.
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={makeTestClient()}>
      <KeypadProvider>
        <KeypadHost />
        {children}
      </KeypadProvider>
    </QueryClientProvider>
  );
}

/**
 * `enqueue` stamps `createdAt` from the wall clock and `NewReviewItem` has no
 * field for it, so the only way to seed a queue whose insertion order differs
 * from its chronological order is to move the clock for the duration of the
 * write.
 */
async function enqueueAt(createdAt: number, input: NewReviewItem): Promise<ReviewQueueItem> {
  const clock = jest.spyOn(Date, "now").mockReturnValue(createdAt);
  try {
    return await enqueue(input);
  } finally {
    clock.mockRestore();
  }
}

function gatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amount: 125000,
    direction: "out",
    merchant: "7-ELEVEN",
    walletId: null,
    categoryId: "cat_food_dining",
    confidence: 0.72,
    reason: GATE_REASONS.lowConfidence,
    ...overrides,
  };
}

async function renderScreen(): Promise<void> {
  render(<ReviewQueueScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId("review-queue-screen")).toBeTruthy());
}

let walletId: string;

beforeEach(async () => {
  jest.clearAllMocks();
  await freshDb();
  await seedDefaultCategories();
  walletId = (await createWallet({ name: "GCash" })).id;
});

afterEach(async () => {
  await closeDatabase();
});

describe("sortOldestFirst", () => {
  function stub(id: string, createdAt: number): ReviewQueueItem {
    return {
      id,
      kind: "low-confidence",
      payload: {},
      rawNotificationId: null,
      createdAt,
      expiresAt: createdAt + 30 * DAY,
      resolvedAt: null,
    };
  }

  test("puts the oldest item first whatever order it is handed", () => {
    const newestFirst = [stub("c", NOW), stub("b", NOW - HOUR), stub("a", NOW - 2 * HOUR)];
    expect(sortOldestFirst(newestFirst).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  test("does not mutate its input", () => {
    const input = [stub("c", NOW), stub("a", NOW - 2 * HOUR)];
    sortOldestFirst(input);
    expect(input.map((entry) => entry.id)).toEqual(["c", "a"]);
  });
});

describe("the review queue screen", () => {
  test("renders cards oldest-first, whatever order they were enqueued in", async () => {
    // Enqueued middle, newest, oldest — deliberately not chronological.
    const second = await enqueueAt(NOW - 2 * HOUR, {
      kind: "low-confidence",
      payload: gatedPayload(),
    });
    const third = await enqueueAt(NOW - HOUR, {
      kind: "unknown-provider",
      payload: { amount: null, direction: null, packageName: "com.bank.notanapp" },
    });
    const first = await enqueueAt(NOW - 3 * HOUR, {
      kind: "possible-duplicate",
      payload: gatedPayload({
        reason: GATE_REASONS.possibleDuplicate,
        duplicateOfTransactionId: "t-missing",
      }),
    });

    await renderScreen();

    await waitFor(() => expect(screen.getAllByTestId(/^review-card-/)).toHaveLength(3));
    expect(screen.getAllByTestId(/^review-card-/).map((node) => node.props.testID)).toEqual([
      `review-card-${first.id}`,
      `review-card-${second.id}`,
      `review-card-${third.id}`,
    ]);
  });

  test("every rendered card carries its explanation", async () => {
    const low = await enqueueAt(NOW - 2 * HOUR, {
      kind: "low-confidence",
      payload: gatedPayload(),
    });
    const unknown = await enqueueAt(NOW - HOUR, {
      kind: "unknown-provider",
      payload: { amount: null, direction: null, packageName: "com.bank.notanapp" },
    });

    await renderScreen();

    await waitFor(() => expect(screen.getAllByTestId(/^review-card-/)).toHaveLength(2));
    expect(screen.getByTestId(`review-reason-${low.id}`)).toHaveTextContent(
      GATE_REASONS.lowConfidence,
    );
    // The card the pipeline queues with NO reason in its payload.
    expect(screen.getByTestId(`review-reason-${unknown.id}`)).toHaveTextContent(
      GATE_REASONS.unknownProvider,
    );
  });

  test("the empty state is the spec's reward, not a blank screen", async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId("review-queue-empty")).toBeTruthy());
    expect(screen.getByText(REVIEW_EMPTY_TITLE)).toBeTruthy();
    expect(screen.getByText(REVIEW_EMPTY_BODY)).toBeTruthy();
    expect(REVIEW_EMPTY_TITLE).toBe("All caught up.");
    expect(screen.queryByTestId(/^review-card-/)).toBeNull();
  });

  test("a resolved item leaves the queue", async () => {
    const done = await enqueueAt(NOW - 2 * HOUR, {
      kind: "low-confidence",
      payload: gatedPayload(),
    });
    await resolve(done.id, "confirmed");

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId("review-queue-empty")).toBeTruthy());
  });

  test("an expired item is never rendered — the queue is triage, not an inbox", async () => {
    await enqueueAt(NOW - 31 * DAY, {
      kind: "low-confidence",
      payload: gatedPayload(),
      expiresAt: NOW - DAY,
    });
    const live = await enqueueAt(NOW - HOUR, {
      kind: "low-confidence",
      payload: gatedPayload(),
    });

    await renderScreen();

    await waitFor(() => expect(screen.getAllByTestId(/^review-card-/)).toHaveLength(1));
    expect(screen.getByTestId(`review-card-${live.id}`)).toBeTruthy();
  });

  test("the actions are live now that Task 10 has wired them", async () => {
    // `gatedPayload({ walletId })`, not the bare `gatedPayload()` this used
    // to pass. The bare helper defaults to `walletId: null`, and since the
    // whole-branch review widened review_card.tsx's guard to every field
    // `proposalFrom` requires, a null wallet now legitimately DISABLES the
    // primary. Left as it was, this test would have asserted the opposite of
    // what it is about: that supplying the handlers is what lights the pair
    // up, not which fields the payload happens to carry.
    const queued = await enqueueAt(NOW - HOUR, {
      kind: "low-confidence",
      payload: gatedPayload({ walletId }),
    });

    await renderScreen();

    // Task 9 shipped these DISABLED on purpose — a money decision that silently
    // does nothing when tapped is worse than one that is visibly unavailable.
    // Supplying the handlers is what lights them up.
    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    expect(primary.props.accessibilityState.disabled).toBe(false);
    const secondary = await screen.findByTestId(`review-secondary-${queued.id}`);
    expect(secondary.props.accessibilityState.disabled).toBe(false);
  });

  test("offers a way back out of the queue", async () => {
    await renderScreen();
    expect(screen.getByTestId("review-queue-back")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Triage, end to end (m1c Task 10)
// ---------------------------------------------------------------------------
//
// The actions themselves are proven in lib/review/__tests__/resolve_actions.ts
// against SQLite. What only THIS file can prove is that the buttons are wired to
// them at all — a card whose primary calls nothing passes every unit test that
// action has, and ships a queue that clears nothing.
describe("triaging from the queue", () => {
  test("Looks right commits the row and the card leaves", async () => {
    const queued = await enqueueAt(NOW - HOUR, {
      kind: "low-confidence",
      payload: gatedPayload({ walletId }),
    });

    await renderScreen();
    fireEvent.press(await screen.findByTestId(`review-primary-${queued.id}`));

    await waitFor(async () => expect(await listTransactions({})).toHaveLength(1));
    expect((await listTransactions({}))[0]).toMatchObject({
      amount: 125000,
      source: "notification",
      confidence: 1,
    });
    await waitFor(() => expect(screen.queryByTestId(`review-card-${queued.id}`)).toBeNull());
  });

  test("Correct opens the sheet, and saving a fix teaches the pipeline", async () => {
    const queued = await enqueueAt(NOW - HOUR, {
      kind: "low-confidence",
      payload: gatedPayload({ walletId }),
    });

    await renderScreen();
    fireEvent.press(await screen.findByTestId(`review-secondary-${queued.id}`));

    // Rule 5: "Correct" is the ONLY action that opens a form.
    expect(await screen.findByTestId("correct-sheet")).toBeTruthy();

    fireEvent.press(screen.getByTestId("correct-category"));
    fireEvent.press(screen.getByTestId("category-option-cat_transport"));
    fireEvent.press(screen.getByTestId("category-picker-save"));
    fireEvent.press(screen.getByTestId("correct-save"));

    await waitFor(async () => expect(await listUserRules()).toHaveLength(1));
    const [rule] = await listUserRules();
    expect(rule.action).toEqual({ kind: "set-category", categoryId: "cat_transport" });
    expect((await listTransactions({}))[0].categoryId).toBe("cat_transport");
    await waitFor(() => expect(screen.queryByTestId(`review-card-${queued.id}`)).toBeNull());
  });

  test("Not money discards the capture without touching the ledger", async () => {
    const queued = await enqueueAt(NOW - HOUR, {
      kind: "unknown-provider",
      payload: { amount: null, direction: null, packageName: "com.games.loud" },
    });

    await renderScreen();
    fireEvent.press(await screen.findByTestId(`review-secondary-${queued.id}`));

    await waitFor(async () => expect(await countOpen()).toBe(0));
    // Spec: a single "Not money" DISCARDS. The mute ("always ignore this app")
    // is offered only after the second dismissal of the same source, so no rule
    // may be created here.
    expect(await listTransactions({})).toEqual([]);
    expect(await listUserRules()).toEqual([]);
  });

  test("Same transaction closes a duplicate without deleting the committed original", async () => {
    const original = await insertTransaction({
      walletId,
      categoryId: "cat_food_dining",
      amount: 125000,
      direction: "out",
      occurredAt: NOW - 2 * HOUR,
      source: "notification",
      confidence: 0.95,
    });
    const queued = await enqueueAt(NOW - HOUR, {
      kind: "possible-duplicate",
      payload: gatedPayload({ walletId, duplicateOfTransactionId: original.id }),
    });

    await renderScreen();
    fireEvent.press(await screen.findByTestId(`review-primary-${queued.id}`));

    await waitFor(async () => expect(await countOpen()).toBe(0));
    // Rule 10, and this is the one the DedupeGate's design depends on: the twin
    // was never committed, so "Same transaction" discards a HELD record. The
    // committed original must survive untouched, and the ledger must still hold
    // exactly one row.
    expect(await listTransactions({})).toHaveLength(1);
    expect((await listTransactions({}))[0].id).toBe(original.id);
  });

  test("Different commits the held twin as its own transaction", async () => {
    const original = await insertTransaction({
      walletId,
      categoryId: "cat_food_dining",
      amount: 125000,
      direction: "out",
      occurredAt: NOW - 2 * HOUR,
      source: "notification",
      confidence: 0.95,
    });
    const queued = await enqueueAt(NOW - HOUR, {
      kind: "possible-duplicate",
      payload: gatedPayload({ walletId, duplicateOfTransactionId: original.id }),
    });

    await renderScreen();
    fireEvent.press(await screen.findByTestId(`review-secondary-${queued.id}`));

    // Two genuine ₱1,250.00 purchases minutes apart are a real thing that
    // happens, and the DedupeGate holding the second one is a QUESTION, not a
    // verdict. "Different" has to be able to answer it.
    await waitFor(async () => expect(await listTransactions({})).toHaveLength(2));
  });

  // Task 4a's regression test: the ten `low-confidence` rows already sitting
  // in the owner's queue had no way out at all, because `low-confidence` was
  // the one kind with no `dismiss` wired anywhere on its card. A button that
  // merely renders is not the fix — the backlog has to actually drain.
  test("rejecting a low-confidence item resolves it out of the queue", async () => {
    const queued = await enqueueAt(NOW - HOUR, {
      kind: "low-confidence",
      payload: gatedPayload({ walletId }),
    });

    await renderScreen();
    fireEvent.press(await screen.findByTestId(`review-reject-${queued.id}`));

    await waitFor(async () => expect(await countOpen()).toBe(0));
    // "Not money" discards the capture — it must not write a Transaction, and
    // it must not create a rule (that mute is a SEPARATE feature, offered
    // only after a second dismissal of the same source).
    expect(await listTransactions({})).toEqual([]);
    expect(await listUserRules()).toEqual([]);
  });

  // `possible-duplicate`'s own PRIMARY ("Same transaction") already dismisses
  // the held twin, so a second, separate reject button would offer the user
  // two different buttons for the same outcome on the same card.
  test("a possible-duplicate card offers no separate reject", async () => {
    const queued = await enqueueAt(NOW - HOUR, {
      kind: "possible-duplicate",
      payload: gatedPayload({ walletId, duplicateOfTransactionId: "t-missing" }),
    });

    await renderScreen();

    await screen.findByTestId(`review-primary-${queued.id}`);
    expect(screen.queryByTestId(`review-reject-${queued.id}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The fifth kind — loan-match (docs/04-features/06-loans.md rules 8-10)
// ---------------------------------------------------------------------------
//
// THE ONE CARD ABOUT A ROW THAT IS ALREADY IN THE LEDGER. Every other kind asks
// "should this become a Transaction?"; this one asks "does this Transaction,
// which is already committed and already counted, also pay down a loan?" The
// two failure modes worth an end-to-end test are both about the app deciding
// something it may not decide:
//
//   ONE CANDIDATE is a confirmation, and the primary carries the loan's NAME so
//   the user is never agreeing to an unnamed balance change.
//
//   TWO CANDIDATES is a CHOICE, and rule 9 forbids the app from making it: "it
//   is always a suggestion listing the candidates — never an auto-match." The
//   screen withholds `onPrimary` entirely so the big green button cannot pick
//   the top-scoring loan on the user's behalf.
describe("loan-match cards", () => {
  /** A committed repayment, already in the ledger — the state this card is about. */
  async function committedRepayment(amount: number): Promise<Transaction> {
    return insertTransaction({
      walletId,
      categoryId: UNCATEGORIZED_ID,
      amount,
      direction: "in",
      occurredAt: NOW - HOUR,
      merchant: "BEN SANTOS",
      source: "manual",
      confidence: 1,
    });
  }

  async function utang() {
    return createLoan({
      direction: "owed-to-me",
      counterparty: "Ben Santos",
      principal: 200000,
    });
  }

  test("one candidate: the primary names the loan and records the payment", async () => {
    const loan = await utang();
    const transaction = await committedRepayment(200000);
    const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

    await renderScreen();
    const primary = await screen.findByTestId(`review-primary-${itemId}`);
    // NAMED, not "Record this payment". A user confirming a balance change is
    // owed the name of the balance it changes.
    expect(screen.getByText("Record on Ben Santos")).toBeTruthy();

    fireEvent.press(primary);

    await waitFor(async () => expect(await countOpen()).toBe(0));
    expect(await listPayments(loan.id)).toHaveLength(1);
    expect(await outstandingBalance(loan.id)).toBe(0);
  });

  test("TWO CANDIDATES: THE CARD LISTS BOTH AND THE PRIMARY CANNOT PICK ONE", async () => {
    const first = await utang();
    const second = await utang();
    const transaction = await committedRepayment(200000);
    const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

    await renderScreen();

    // Rule 9. The primary renders (the pair is definitional to the kind) and is
    // DISABLED, because the screen supplies no handler for a question with two
    // right-shaped answers.
    const primary = await screen.findByTestId(`review-primary-${itemId}`);
    expect(primary.props.accessibilityState?.disabled).toBe(true);

    // Both loans get their own button. Tapping one is the user choosing.
    expect(screen.getByTestId(`review-loan-choice-${itemId}-${first.id}`)).toBeTruthy();
    fireEvent.press(screen.getByTestId(`review-loan-choice-${itemId}-${second.id}`));

    await waitFor(async () => expect(await countOpen()).toBe(0));
    expect(await listPayments(second.id)).toHaveLength(1);
    // And the loan the user did NOT pick is untouched — the whole point of
    // refusing to guess.
    expect(await listPayments(first.id)).toHaveLength(0);
  });

  test("'Not a loan payment' closes the card and leaves the ledger alone", async () => {
    // Spec rule 10: rejecting never creates a negative UserRule automatically,
    // and the transaction stays exactly where it is.
    const loan = await utang();
    const transaction = await committedRepayment(200000);
    const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

    await renderScreen();
    fireEvent.press(await screen.findByTestId(`review-secondary-${itemId}`));

    await waitFor(async () => expect(await countOpen()).toBe(0));
    expect(await listPayments(loan.id)).toHaveLength(0);
    expect(await outstandingBalance(loan.id)).toBe(200000);
    expect(await listUserRules()).toEqual([]);
    // The row it was about is still in the ledger, untouched.
    expect((await listTransactions({})).map((row) => row.id)).toEqual([transaction.id]);
  });

  test("a loan-match card offers no separate reject — its secondary IS the rejection", async () => {
    await utang();
    const itemId = (await raiseLoanMatchSuggestion(await committedRepayment(200000))) as string;

    await renderScreen();

    await screen.findByTestId(`review-primary-${itemId}`);
    expect(screen.queryByTestId(`review-reject-${itemId}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FILTERING AND PAGING — what replaced "every open item in one ScrollView".
//
// Both properties here are about what the screen DOES NOT render. A queue that
// mounts a ReviewCard per open row costs its whole length on the first frame
// and, past the spec's 25-item "Normal" size, stops being triage: 200 mixed
// cards on one rope is the second inbox this screen's header warns about,
// wearing a scrollbar.
// ---------------------------------------------------------------------------
describe("the queue is paged", () => {
  /** `count` open low-confidence items, oldest first, one minute apart. */
  async function seedQueue(count: number): Promise<ReviewQueueItem[]> {
    const items: ReviewQueueItem[] = [];
    for (let n = count; n > 0; n -= 1) {
      items.push(
        await enqueueAt(NOW - n * MINUTE, { kind: "low-confidence", payload: gatedPayload() }),
      );
    }
    // Seeded counting DOWN from the oldest, so this is already queue order.
    return items;
  }

  // The queue is read a page at a time AND mounted a window at a time, so
  // "is that card in the tree?" answers the wrong question — a row can be
  // absent because it was never fetched (paging, what these tests are about)
  // or because it is below the viewport (virtualization, React Native's job).
  // The FOOTER LABEL separates them: it is computed from the whole queue's
  // count minus the rows actually fetched, so "Show 2 more" is a direct
  // statement that 25 of 27 were read — and its disappearance is the only
  // proof that the last page landed.
  test("fetches one page, not the whole queue, and says how many are left", async () => {
    const items = await seedQueue(REVIEW_PAGE_SIZE + 2);

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId(`review-card-${items[0].id}`)).toBeTruthy());
    expect(screen.getByTestId("review-queue-load-more")).toBeTruthy();
    // The count on the button is the only place in the app that says how much
    // work is actually left.
    expect(screen.getByText("Show 2 more")).toBeTruthy();
  });

  test("the next page appends to the queue rather than replacing it", async () => {
    const items = await seedQueue(REVIEW_PAGE_SIZE + 2);
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId("review-queue-load-more")).toBeTruthy());

    fireEvent.press(screen.getByTestId("review-queue-load-more"));

    // Nothing left to ask for — the second page arrived and covered the rest.
    await waitFor(() => expect(screen.queryByTestId("review-queue-load-more")).toBeNull());
    // Page one is still there — this is "show more", not "next page".
    expect(screen.getByTestId(`review-card-${items[0].id}`)).toBeTruthy();
    // And the queue never fell back to its loading state on the way.
    expect(screen.queryByTestId("review-queue-loading")).toBeNull();
  });

  test("a queue that fits one page offers no paging control at all", async () => {
    await seedQueue(3);
    await renderScreen();

    await waitFor(() => expect(screen.getAllByTestId(/^review-card-/)).toHaveLength(3));
    expect(screen.queryByTestId("review-queue-load-more")).toBeNull();
    expect(screen.queryByTestId("review-backlog-banner")).toBeNull();
  });

  test("past the spec's 25-item Normal size, the backlog banner appears", async () => {
    await seedQueue(REVIEW_PAGE_SIZE + 1);
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId("review-backlog-banner")).toBeTruthy());
    expect(screen.getByText(REVIEW_BACKLOG_BANNER)).toBeTruthy();
  });
});

describe("the queue is filterable by kind", () => {
  async function seedTwoKinds(): Promise<{ parse: ReviewQueueItem; unknown: ReviewQueueItem }> {
    const parse = await enqueueAt(NOW - 2 * HOUR, {
      kind: "low-confidence",
      payload: gatedPayload(),
    });
    const unknown = await enqueueAt(NOW - HOUR, {
      kind: "unknown-provider",
      payload: { amount: null, direction: null, packageName: "com.games.loud" },
    });
    return { parse, unknown };
  }

  test("a kind chip narrows the list, and pressing it again restores the queue", async () => {
    const { parse, unknown } = await seedTwoKinds();
    await renderScreen();
    await waitFor(() => expect(screen.getAllByTestId(/^review-card-/)).toHaveLength(2));

    fireEvent.press(screen.getByTestId("review-filter-chip-unknown-provider"));

    // A chip press is a NEW DATABASE READ, not a re-render of loaded rows (the
    // filter is part of the query — see use_review_queue_page.ts), so these
    // waits have to outlast a real round trip. `waitFor`'s 1 s default is
    // enough on an idle machine and not enough on one running the whole suite
    // in parallel, where this read has queued behind 200 other test databases.
    await waitFor(() => expect(screen.getAllByTestId(/^review-card-/)).toHaveLength(1), {
      timeout: 10_000,
    });
    expect(screen.getByTestId(`review-card-${unknown.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`review-card-${parse.id}`)).toBeNull();
    // The narrowing NEVER passes through the loading skeleton — see
    // `placeholderData` in use_review_queue_page.ts. A chip that blanks the
    // list to five grey bars reads as data being lost.
    expect(screen.queryByTestId("review-queue-loading")).toBeNull();

    // A SELECTED CHIP IS ITS OWN REMOVAL AFFORDANCE — there is no separate
    // clear control, so this press has to be the way back.
    fireEvent.press(screen.getByTestId("review-filter-chip-unknown-provider"));
    await waitFor(() => expect(screen.getByTestId(`review-card-${parse.id}`)).toBeTruthy(), {
      timeout: 10_000,
    });
  });

  test("the chips count what is waiting", async () => {
    await seedTwoKinds();
    await enqueueAt(NOW - 3 * HOUR, { kind: "low-confidence", payload: gatedPayload() });
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId("review-filter-bar")).toBeTruthy());
    expect(screen.getByText("All 3")).toBeTruthy();
    expect(screen.getByText("Needs a check 2")).toBeTruthy();
    expect(screen.getByText("Unknown app 1")).toBeTruthy();
  });

  test("one kind waiting means no filter bar — a lone chip cannot change anything", async () => {
    await enqueueAt(NOW - HOUR, { kind: "low-confidence", payload: gatedPayload() });
    await renderScreen();

    await waitFor(() => expect(screen.getAllByTestId(/^review-card-/)).toHaveLength(1));
    expect(screen.queryByTestId("review-filter-bar")).toBeNull();
  });

  test("EMPTYING A FILTER IS NOT 'All caught up.' — the reward is never shown over a hidden queue", async () => {
    const { parse, unknown } = await seedTwoKinds();
    await renderScreen();
    await waitFor(() => expect(screen.getAllByTestId(/^review-card-/)).toHaveLength(2));

    fireEvent.press(screen.getByTestId("review-filter-chip-unknown-provider"));
    // Same round trip, same headroom as above.
    await waitFor(() => expect(screen.getAllByTestId(/^review-card-/)).toHaveLength(1), {
      timeout: 10_000,
    });

    // "Not money" — the last unknown-provider item leaves the queue while the
    // low-confidence one is still waiting one chip away.
    fireEvent.press(await screen.findByTestId(`review-secondary-${unknown.id}`));

    await waitFor(() => expect(screen.getByTestId("review-queue-empty-filtered")).toBeTruthy(), {
      timeout: 10_000,
    });
    expect(screen.queryByTestId("review-queue-empty")).toBeNull();
    expect(screen.queryByText(REVIEW_EMPTY_TITLE)).toBeNull();
    // And the way out is on screen, because the chip that caused this is the
    // only one still selected.
    fireEvent.press(screen.getByText("Show all"));
    await waitFor(() => expect(screen.getByTestId(`review-card-${parse.id}`)).toBeTruthy(), {
      timeout: 10_000,
    });
  });
});
