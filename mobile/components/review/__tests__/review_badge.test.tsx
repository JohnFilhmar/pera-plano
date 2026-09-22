// components/review/__tests__/review_badge.test.tsx — m1c plan Task 9 rule 1.
//
// THE ZERO CASE IS THE ONE THAT MATTERS, and it is the opposite of what a badge
// component usually does. docs/04-features/08-review-queue.md makes an empty
// queue a REWARD ("absence of work is the reward"); a "0" bubble on the tab is
// an unread marker, and a user who taps it to find nothing there learns that the
// badge lies. After a few of those they stop tapping it when it says "3".
//
// THE CAP IS THE SPEC'S 99+, NOT THE PLAN'S 9+ — see review_badge.tsx's header
// for the whole argument. Both boundaries are pinned here (99 renders bare, 100
// caps) because a cap is an off-by-one waiting to happen and the failure is
// invisible: nothing throws, the badge just quietly understates the queue.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { closeDatabase } from "@/lib/db/database";
import { enqueue } from "@/lib/db/repos/review_queue_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";

import {
  REVIEW_BADGE_CAP,
  ReviewBadge,
  ReviewCountBadge,
  reviewBadgeLabel,
} from "../review_badge";

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

describe("reviewBadgeLabel", () => {
  test("a zero count has no label at all — never a '0' bubble", () => {
    expect(reviewBadgeLabel(0)).toBeNull();
  });

  test("a count still loading has no label", () => {
    expect(reviewBadgeLabel(undefined)).toBeNull();
  });

  test("a negative count has no label", () => {
    // Nothing can produce one, but a `-1` rendered as "-1" would be a badge
    // announcing a queue the user cannot open.
    expect(reviewBadgeLabel(-3)).toBeNull();
  });

  test.each([
    [1, "1"],
    [3, "3"],
    [10, "10"],
    [REVIEW_BADGE_CAP, "99"],
  ])("a count of %i renders as %s", (count, expected) => {
    expect(reviewBadgeLabel(count)).toBe(expected);
  });

  test.each([
    [REVIEW_BADGE_CAP + 1, "99+"],
    [250, "99+"],
  ])("a count of %i caps at %s", (count, expected) => {
    expect(reviewBadgeLabel(count)).toBe(expected);
  });
});

describe("ReviewBadge", () => {
  test("renders the count", () => {
    render(<ReviewBadge count={4} />);
    expect(screen.getByTestId("review-badge")).toHaveTextContent("4");
  });

  test("renders NOTHING for a zero count", () => {
    render(<ReviewBadge count={0} />);
    expect(screen.queryByTestId("review-badge")).toBeNull();
  });

  test("renders nothing while the count is still loading", () => {
    render(<ReviewBadge count={undefined} />);
    expect(screen.queryByTestId("review-badge")).toBeNull();
  });

  test("caps over the cap rather than overflowing the tab icon", () => {
    render(<ReviewBadge count={140} />);
    expect(screen.getByTestId("review-badge")).toHaveTextContent("99+");
  });

  test("fills red, not the brand green — this queue needs attention, it is not a success state", () => {
    render(<ReviewBadge count={4} />);
    const classes = String(screen.getByTestId("review-badge").props.className);
    expect(classes).toContain("bg-danger");
    expect(classes).not.toContain("bg-brand");
  });

  test("announces the waiting work to a screen reader", () => {
    render(<ReviewBadge count={2} />);
    expect(screen.getByTestId("review-badge").props.accessibilityLabel).toBe(
      "2 items waiting for review",
    );
  });

  test("says 'item' in the singular for one", () => {
    render(<ReviewBadge count={1} />);
    expect(screen.getByTestId("review-badge").props.accessibilityLabel).toBe(
      "1 item waiting for review",
    );
  });
});

describe("ReviewCountBadge", () => {
  beforeEach(async () => {
    await freshDb();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  test("shows the live open count from the queue", async () => {
    await enqueue({ kind: "low-confidence", payload: {} });
    await enqueue({ kind: "unknown-provider", payload: {} });
    await enqueue({ kind: "possible-duplicate", payload: {} });

    render(<ReviewCountBadge />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByTestId("review-badge")).toHaveTextContent("3"));
  });

  test("an empty queue puts no badge on the tab", async () => {
    render(<ReviewCountBadge />, { wrapper: Wrapper });

    // Wait for the read to actually resolve before asserting absence, or this
    // passes on the pending frame and would keep passing with a broken count.
    await waitFor(() => expect(screen.queryByTestId("review-badge")).not.toBeOnTheScreen());
    expect(screen.queryByTestId("review-badge")).toBeNull();
  });
});
