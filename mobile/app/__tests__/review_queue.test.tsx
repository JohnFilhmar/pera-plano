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
import { render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { enqueue, resolve } from "@/lib/db/repos/review_queue_repo";
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

beforeEach(async () => {
  jest.clearAllMocks();
  await freshDb();
  await seedDefaultCategories();
  await createWallet({ name: "GCash", type: "e-wallet" });
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

  test("the actions render but stay inert until Task 10 wires them", async () => {
    const queued = await enqueueAt(NOW - HOUR, {
      kind: "low-confidence",
      payload: gatedPayload(),
    });

    await renderScreen();

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    expect(primary.props.accessibilityState.disabled).toBe(true);
    expect(await screen.findByTestId(`review-secondary-${queued.id}`)).toBeTruthy();
  });

  test("offers a way back out of the queue", async () => {
    await renderScreen();
    expect(screen.getByTestId("review-queue-back")).toBeTruthy();
  });
});
