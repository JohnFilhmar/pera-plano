// components/review/__tests__/review_card.test.tsx — m1c plan Task 9, rules 3–5.
//
// THE REVIEW QUEUE IS WHERE THE PIPELINE ADMITS WHAT IT COULD NOT DECIDE. Every
// card here is the app saying "I saw money move and I am not sure enough to
// record it silently", and the two ways that goes wrong are both asserted below
// rather than left to review.
//
//   A CARD WITH NO EXPLANATION trains the user to tap through without reading,
//   which converts the queue from a safety net into a rubber stamp. So every
//   kind — including the two the pipeline queues with NO `reason` in the payload
//   — is pinned to a non-empty sentence, and that sentence is pinned to
//   `GATE_REASONS` by identity, not by string equality with a copy written here.
//   Two copies of a sentence the user reads at their most anxious moment will
//   drift, and the one they see will be the stale one.
//
//   A CHOICE THE USER CANNOT MAKE. "Same transaction or different?" and "is this
//   a transfer?" are both questions about a PAIR. A card showing one side asks
//   the user to judge a pairing they cannot see, so both sides are asserted for
//   both kinds — the counterpart resolved through `useTransaction`, against a
//   real database.
//
// The confidence meter has its own inverted case: `unknown-provider` carries no
// score at all (see pipeline.ts), and a meter there would render 0% on something
// that was never parsed — the app claiming to be certain it is wrong.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";

import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { storeRawCapture } from "@/lib/db/repos/raw_notifications_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { GATE_REASONS } from "@/lib/ingest/confidence_gate";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { RawCapture, ReviewKind, ReviewQueueItem, Wallet } from "@/types/domain";

import { ConfidenceMeter, confidencePercent } from "../confidence_meter";
import {
  hasParsedAmount,
  REASON_FALLBACKS,
  REVIEW_ACTIONS,
  REVIEW_REJECT_LABEL,
  ReviewCard,
  reviewReason,
} from "../review_card";

const MINUS = "−";
const NOW = new Date(2026, 7, 13, 9, 0).getTime();
const FOOD = "cat_food_dining";
const UNKNOWN_PACKAGE = "com.bank.notanapp";

const ALL_KINDS: ReviewKind[] = [
  "low-confidence",
  "unknown-provider",
  "ambiguous-transfer",
  "possible-duplicate",
];

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

function item(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: "r1",
    kind: "low-confidence",
    payload: {},
    rawNotificationId: null,
    createdAt: NOW,
    expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    resolvedAt: null,
    ...overrides,
  };
}

/**
 * The payload `pipeline.ts` writes for a GATED event — verbatim field set, so a
 * change to the orchestrator's shape breaks these tests rather than silently
 * emptying the card.
 */
function gatedPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amount: 125000,
    direction: "out",
    merchant: "7-ELEVEN",
    walletId: "w-gcash",
    categoryId: FOOD,
    confidence: 0.72,
    reason: GATE_REASONS.lowConfidence,
    ...overrides,
  };
}

/** The FOUR kinds as the pipeline actually enqueues them. */
function itemOfKind(kind: ReviewKind, overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  switch (kind) {
    case "unknown-provider":
      // pipeline.ts, BOTH queue sites: no `reason`, no `confidence`, no amount.
      return item({
        id: "r-unknown",
        kind,
        payload: { amount: null, direction: null, packageName: UNKNOWN_PACKAGE },
        ...overrides,
      });
    case "possible-duplicate":
      return item({
        id: "r-dupe",
        kind,
        payload: gatedPayload({
          reason: GATE_REASONS.possibleDuplicate,
          duplicateOfTransactionId: "t-committed",
        }),
        ...overrides,
      });
    case "ambiguous-transfer":
      return item({
        id: "r-transfer",
        kind,
        payload: gatedPayload({
          reason: GATE_REASONS.ambiguousTransfer,
          transferCounterpartTransactionId: "t-committed",
          transferReason: "fee_delta",
        }),
        ...overrides,
      });
    default:
      return item({ id: "r-low", kind, payload: gatedPayload(), ...overrides });
  }
}

function capture(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    id: "cap-unknown",
    packageName: UNKNOWN_PACKAGE,
    title: "Notanapp",
    text: "PHP 1,250.00 was debited from your account.",
    subText: null,
    bigText: null,
    postedAt: NOW,
    capturedAt: NOW,
    ...overrides,
  };
}

let gcash: Wallet;
let bpi: Wallet;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  gcash = await createWallet({ name: "GCash", type: "e-wallet" });
  bpi = await createWallet({ name: "BPI", type: "bank" });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Rule 3 — no card is ever unexplained, and the sentence is the gate's own
// ---------------------------------------------------------------------------

describe("the reason sentence", () => {
  test.each(ALL_KINDS)("%s renders a non-empty reason sentence", async (kind) => {
    const queued = itemOfKind(kind);
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    const reason = await screen.findByTestId(`review-reason-${queued.id}`);
    expect(reason).toBeTruthy();
    expect(String(reason.props.children).trim().length).toBeGreaterThan(0);
  });

  test.each(ALL_KINDS)("%s's reason is one of the gate's own strings", async (kind) => {
    const queued = itemOfKind(kind);
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    const reason = await screen.findByTestId(`review-reason-${queued.id}`);
    // IDENTITY WITH `GATE_REASONS`, not equality with a literal written here.
    // A card that invented its own copy would pass a string comparison against
    // a fixture and still drift from the sentence the gate stamped.
    expect(Object.values(GATE_REASONS)).toContain(String(reason.props.children));
  });

  test("unknown-provider has NO reason in its payload and still explains itself", () => {
    const queued = itemOfKind("unknown-provider");
    expect(queued.payload.reason).toBeUndefined();
    expect(reviewReason(queued)).toBe(GATE_REASONS.unknownProvider);
  });

  test("a low-confidence item whose parse failed carries no reason either", () => {
    // pipeline.ts's third reason-less queue site: `parsed === null`.
    const queued = item({ kind: "low-confidence", payload: { amount: null, direction: null, confidence: 0 } });
    expect(queued.payload.reason).toBeUndefined();
    expect(reviewReason(queued)).toBe(GATE_REASONS.unreadable);
  });

  test("the payload's own reason wins over the fallback", () => {
    const queued = item({
      kind: "low-confidence",
      payload: gatedPayload({ reason: GATE_REASONS.unmappedWallet }),
    });
    expect(reviewReason(queued)).toBe(GATE_REASONS.unmappedWallet);
  });

  test("a blank reason falls back rather than rendering an empty card", () => {
    const queued = item({ kind: "possible-duplicate", payload: gatedPayload({ reason: "   " }) });
    expect(reviewReason(queued)).toBe(GATE_REASONS.possibleDuplicate);
  });

  test("every fallback is a GATE_REASONS member, never a local string", () => {
    const gateStrings = Object.values(GATE_REASONS) as string[];
    for (const kind of ALL_KINDS) {
      expect(gateStrings).toContain(REASON_FALLBACKS[kind]);
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — four kinds, four distinct action pairs
// ---------------------------------------------------------------------------

describe("the action pair", () => {
  test.each(ALL_KINDS)("%s renders its own pair", async (kind) => {
    const queued = itemOfKind(kind);
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} onPrimary={jest.fn()} onSecondary={jest.fn()} />, {
      wrapper: Wrapper,
    });

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    const secondary = await screen.findByTestId(`review-secondary-${queued.id}`);
    expect(primary.props.accessibilityLabel).toBe(REVIEW_ACTIONS[kind].primary);
    expect(secondary.props.accessibilityLabel).toBe(REVIEW_ACTIONS[kind].secondary);
  });

  test("no two kinds share a label", () => {
    const labels = ALL_KINDS.flatMap((kind) => [
      REVIEW_ACTIONS[kind].primary,
      REVIEW_ACTIONS[kind].secondary,
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("the primary action fires with the item", async () => {
    const onPrimary = jest.fn();
    const queued = itemOfKind("low-confidence");
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} onPrimary={onPrimary} />, {
      wrapper: Wrapper,
    });

    fireEvent.press(await screen.findByTestId(`review-primary-${queued.id}`));
    expect(onPrimary).toHaveBeenCalledWith(queued);
  });

  test("the secondary action fires with the item", async () => {
    const onSecondary = jest.fn();
    const queued = itemOfKind("possible-duplicate");
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} onSecondary={onSecondary} />, {
      wrapper: Wrapper,
    });

    fireEvent.press(await screen.findByTestId(`review-secondary-${queued.id}`));
    expect(onSecondary).toHaveBeenCalledWith(queued);
  });

  test("an unwired action renders but is inert — Task 10 owns the wiring", async () => {
    const queued = itemOfKind("low-confidence");
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    // Visible (rule 4 is about what the card SHOWS) but not tappable: a button
    // that silently does nothing is the affordance Tasks 4 and 6 refused to
    // ship, and a dead tap on a money decision is worse than a dimmed one.
    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    expect(primary.props.accessibilityState.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No amount, no one-tap accept — task 4b: a card whose payload never carried
// an amount must not be one tap from a committed ledger row (data integrity,
// not cosmetic: `proposalFrom` already refuses such a row, but the button
// tapping it silently did nothing instead of visibly refusing).
// ---------------------------------------------------------------------------

describe("hasParsedAmount", () => {
  test("false for a payload whose amount is null", () => {
    const queued = item({ kind: "low-confidence", payload: { amount: null, direction: null, confidence: 0 } });
    expect(hasParsedAmount(queued)).toBe(false);
  });

  test("true once the payload carries a real amount", () => {
    const queued = itemOfKind("low-confidence");
    expect(hasParsedAmount(queued)).toBe(true);
  });
});

describe("a low-confidence card with no amount cannot be confirmed", () => {
  test("the primary is disabled and the blocked line explains why", async () => {
    const queued = item({
      id: "r-noamount",
      kind: "low-confidence",
      payload: gatedPayload({ amount: null }),
    });
    render(
      <ReviewCard item={queued} wallets={[gcash, bpi]} onPrimary={jest.fn()} onSecondary={jest.fn()} />,
      { wrapper: Wrapper },
    );

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    expect(primary.props.accessibilityState.disabled).toBe(true);
    expect(await screen.findByTestId(`review-blocked-${queued.id}`)).toBeTruthy();
  });
});

describe("a low-confidence card WITH an amount is still confirmable", () => {
  test("the primary stays enabled and no blocked line renders", async () => {
    const queued = itemOfKind("low-confidence");
    render(
      <ReviewCard item={queued} wallets={[gcash, bpi]} onPrimary={jest.fn()} onSecondary={jest.fn()} />,
      { wrapper: Wrapper },
    );

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    expect(primary.props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId(`review-blocked-${queued.id}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The reject affordance — task 4a: a card kind that can be pure noise must
// have a way out, but only when the screen supplies one (rule 4's pair is
// definitional to every kind; the reject is an extra outcome only some kinds
// have, so its absence renders nothing rather than a permanently disabled
// third button that would read as broken on a kind that has no such outcome).
// ---------------------------------------------------------------------------

describe("the reject button renders only when a handler is supplied", () => {
  test("absent without onReject", async () => {
    const queued = itemOfKind("low-confidence");
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} onPrimary={jest.fn()} onSecondary={jest.fn()} />, {
      wrapper: Wrapper,
    });

    await screen.findByTestId(`review-primary-${queued.id}`);
    expect(screen.queryByTestId(`review-reject-${queued.id}`)).toBeNull();
  });

  test("present and pressable with onReject", async () => {
    const onReject = jest.fn();
    const queued = itemOfKind("low-confidence");
    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onReject={onReject}
      />,
      { wrapper: Wrapper },
    );

    const reject = await screen.findByTestId(`review-reject-${queued.id}`);
    expect(reject.props.accessibilityLabel).toBe(REVIEW_REJECT_LABEL);
    fireEvent.press(reject);
    expect(onReject).toHaveBeenCalledWith(queued);
  });
});

// ---------------------------------------------------------------------------
// The confidence meter
// ---------------------------------------------------------------------------

describe("confidencePercent", () => {
  test.each([
    [0, 0],
    [0.42, 42],
    [0.725, 73],
    [1, 100],
  ])("%f becomes %i%%", (confidence, expected) => {
    expect(confidencePercent(confidence)).toBe(expected);
  });

  test("clamps out-of-range scores rather than rendering a bar past its track", () => {
    expect(confidencePercent(1.4)).toBe(100);
    expect(confidencePercent(-0.2)).toBe(0);
  });

  test("a non-numeric score reads as zero, never NaN%", () => {
    expect(confidencePercent(Number.NaN)).toBe(0);
  });
});

describe("the confidence meter", () => {
  function fillWidth(testID: string): unknown {
    return StyleSheet.flatten(screen.getByTestId(`${testID}-fill`).props.style)?.width;
  }

  test("reflects the score rather than decorating the card", () => {
    render(<ConfidenceMeter confidence={0.42} testID="meter" />);
    expect(screen.getByTestId("meter")).toHaveTextContent(/42%/);
    expect(fillWidth("meter")).toBe("42%");
    expect(screen.getByTestId("meter").props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 42,
    });
  });

  test("a different score renders a different meter", () => {
    render(<ConfidenceMeter confidence={0.88} testID="meter" />);
    expect(screen.getByTestId("meter")).toHaveTextContent(/88%/);
    expect(fillWidth("meter")).toBe("88%");
  });

  test("a low-confidence card renders the meter at its payload's score", async () => {
    const queued = itemOfKind("low-confidence");
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    const meter = await screen.findByTestId(`review-confidence-${queued.id}`);
    expect(meter).toHaveTextContent(/72%/);
  });

  test("a failed parse still gets a meter — 0% is a real, earned score", async () => {
    const queued = item({
      id: "r-unparsed",
      kind: "low-confidence",
      payload: { amount: null, direction: null, confidence: 0 },
    });
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    expect(await screen.findByTestId(`review-confidence-${queued.id}`)).toHaveTextContent(/0%/);
  });

  test("unknown-provider renders NO meter — nothing was ever parsed to score", async () => {
    const queued = itemOfKind("unknown-provider");
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    await screen.findByTestId(`review-reason-${queued.id}`);
    // A 0% bar here would be the app reporting certainty about a notification
    // it never read a single field from.
    expect(screen.queryByTestId(`review-confidence-${queued.id}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Both sides of a pair
// ---------------------------------------------------------------------------

describe("cards about a PAIR show both sides", () => {
  async function committedTwin(): Promise<string> {
    const row = await insertTransaction({
      walletId: bpi.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 125000,
      direction: "out",
      occurredAt: NOW - 60_000,
      merchant: "SEVEN ELEVEN",
      source: "notification",
      confidence: 0.95,
    });
    return row.id;
  }

  test("a possible duplicate shows the held twin AND the record already in the ledger", async () => {
    const committedId = await committedTwin();
    const queued = itemOfKind("possible-duplicate", {
      payload: gatedPayload({
        reason: GATE_REASONS.possibleDuplicate,
        duplicateOfTransactionId: committedId,
      }),
    });

    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    const candidate = await screen.findByTestId(`review-candidate-${queued.id}`);
    expect(candidate).toHaveTextContent(/7-ELEVEN/);
    expect(candidate).toHaveTextContent(/₱1,250\.00/);

    // RE-QUERIED INSIDE `waitFor`, never captured once: the counterpart side
    // renders a placeholder while `useTransaction` is in flight and swaps it for
    // a different node when the row arrives, so a node held from before the
    // resolution is unmounted by the time it is asserted on.
    await waitFor(() =>
      expect(screen.getByTestId(`review-counterpart-${queued.id}`)).toHaveTextContent(
        /SEVEN ELEVEN/,
      ),
    );
    const counterpart = screen.getByTestId(`review-counterpart-${queued.id}`);
    expect(counterpart).toHaveTextContent(/₱1,250\.00/);
    // The wallet is the field that most often settles "same or different".
    expect(within(counterpart).getByText("BPI")).toBeTruthy();
  });

  test("an ambiguous transfer shows both legs and the fee difference", async () => {
    const inLeg = await insertTransaction({
      walletId: bpi.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 499000,
      direction: "in",
      occurredAt: NOW - 30_000,
      merchant: "TRANSFER IN",
      source: "notification",
      confidence: 0.95,
    });
    const queued = itemOfKind("ambiguous-transfer", {
      payload: gatedPayload({
        amount: 500000,
        merchant: "TRANSFER OUT",
        reason: GATE_REASONS.ambiguousTransfer,
        transferCounterpartTransactionId: inLeg.id,
        transferReason: "fee_delta",
      }),
    });

    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    const candidate = await screen.findByTestId(`review-candidate-${queued.id}`);
    expect(candidate).toHaveTextContent(new RegExp(`${MINUS}₱5,000\\.00`));

    await waitFor(() =>
      expect(screen.getByTestId(`review-counterpart-${queued.id}`)).toHaveTextContent(
        /\+₱4,990\.00/,
      ),
    );

    // The number that makes the pairing judgeable: ₱10 short is a fee, ₱500
    // short is a different transaction.
    expect(await screen.findByTestId(`review-fee-${queued.id}`)).toHaveTextContent(/₱10\.00/);
  });

  test("a counterpart that no longer exists says so instead of showing a blank side", async () => {
    const queued = itemOfKind("possible-duplicate", {
      payload: gatedPayload({
        reason: GATE_REASONS.possibleDuplicate,
        duplicateOfTransactionId: "t-deleted",
      }),
    });

    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    await waitFor(() =>
      expect(screen.getByTestId(`review-counterpart-${queued.id}`)).toHaveTextContent(/no longer/i),
    );
  });

  test("a low-confidence card has no counterpart side at all", async () => {
    const queued = itemOfKind("low-confidence");
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    await screen.findByTestId(`review-reason-${queued.id}`);
    expect(screen.queryByTestId(`review-counterpart-${queued.id}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The unknown-provider card
// ---------------------------------------------------------------------------

describe("the unknown-provider card", () => {
  test("names the source app and shows what was captured", async () => {
    await storeRawCapture(capture(), NOW);
    const queued = itemOfKind("unknown-provider", { rawNotificationId: "cap-unknown" });

    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    expect(await screen.findByTestId(`review-source-${queued.id}`)).toHaveTextContent(
      new RegExp(UNKNOWN_PACKAGE),
    );
    // Without the captured text, "is this a money notification?" is a question
    // about a notification the user cannot see.
    await waitFor(() =>
      expect(screen.getByTestId(`review-snippet-${queued.id}`)).toHaveTextContent(
        /PHP 1,250\.00 was debited/,
      ),
    );
  });

  test("a purged capture leaves the card explained rather than empty", async () => {
    const queued = itemOfKind("unknown-provider", { rawNotificationId: "cap-gone" });
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    expect(await screen.findByTestId(`review-reason-${queued.id}`)).toBeTruthy();
    expect(screen.getByTestId(`review-source-${queued.id}`)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The prefilled fields
// ---------------------------------------------------------------------------

describe("the proposed transaction", () => {
  test("renders the parsed amount, merchant, wallet and category", async () => {
    const queued = itemOfKind("low-confidence", {
      payload: gatedPayload({ walletId: gcash.id }),
    });
    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        categories={[
          {
            id: FOOD,
            name: "Food & Dining",
            parentId: null,
            icon: "utensils",
            isSystem: true,
            isHidden: false,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ]}
      />,
      { wrapper: Wrapper },
    );

    const candidate = await screen.findByTestId(`review-candidate-${queued.id}`);
    expect(candidate).toHaveTextContent(new RegExp(`${MINUS}₱1,250\\.00`));
    expect(candidate).toHaveTextContent(/7-ELEVEN/);
    expect(candidate).toHaveTextContent(/GCash/);
    expect(candidate).toHaveTextContent(/Food & Dining/);
  });

  test("an unreadable parse says the amount was not read rather than showing ₱0.00", async () => {
    const queued = item({
      id: "r-unparsed",
      kind: "low-confidence",
      payload: { amount: null, direction: null, confidence: 0 },
    });
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    const candidate = await screen.findByTestId(`review-candidate-${queued.id}`);
    // "₱0.00" on a card about money that definitely moved is a lie the user has
    // no way to detect.
    expect(candidate).not.toHaveTextContent(/₱0\.00/);
    expect(candidate).toHaveTextContent(/not read/i);
  });
});
