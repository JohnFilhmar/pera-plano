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

import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { countOpen, enqueue, resolve } from "@/lib/db/repos/review_queue_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { listUserRules } from "@/lib/db/repos/user_rules_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { GATE_REASONS } from "@/lib/ingest/confidence_gate";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { NewReviewItem, ReviewQueueItem } from "@/types/domain";

import ReviewQueueScreen, {
  REVIEW_EMPTY_BODY,
  REVIEW_EMPTY_TITLE,
  sortOldestFirst,
} from "../review/index";

const mockBack = jest.fn();

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
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

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={makeTestClient()}>{children}</QueryClientProvider>;
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
  walletId = (await createWallet({ name: "GCash", type: "e-wallet" })).id;
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
    const queued = await enqueueAt(NOW - HOUR, {
      kind: "low-confidence",
      payload: gatedPayload(),
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
});
