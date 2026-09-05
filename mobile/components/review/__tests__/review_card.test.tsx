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

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
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

// KeypadProvider AND A ROOT HOST (numeric-input-system Task 14, same fix
// `correct_sheet.test.tsx` already carries) — Task 12's one-sided-transfer
// body renders a `NumericField` for the fee, whose `useKeypad()` throws with
// no provider above it in the tree.
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
  gcash = await createWallet({ name: "GCash" });
  bpi = await createWallet({ name: "BPI" });
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

  // Round 1 fix. `parseAmountToCentavos` (lib/ingest/amount.ts) returns `0`,
  // never `null`, for a genuine "₱0.00" notification — "0 is a legitimate
  // amount and must stay distinguishable from a refusal" (that file's own
  // words, pinned by amount.test.ts's `parseAmountToCentavos("0.00") === 0`).
  // So a low-confidence item can reach this card with `amount: 0`, and
  // `resolve_actions.ts`'s OWN `readAmount` requires `value > 0` before
  // `proposalFrom` will build a Transaction from it — `hasParsedAmount` has to
  // agree with THAT rule, not merely "is it a number", or a ₱0.00 card renders
  // an enabled primary whose tap throws and shows the user nothing: the exact
  // silent dead tap this task exists to close.
  test("false for a payload whose amount is exactly zero — the ledger will not accept it either", () => {
    const queued = item({
      kind: "low-confidence",
      payload: { amount: 0, direction: "out", confidence: 0.4 },
    });
    expect(hasParsedAmount(queued)).toBe(false);
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

  // Round 1 fix's card-level regression: a genuine ₱0.00 notification is a
  // real, non-null `amount`, so this is a distinct case from "amount is
  // null" above — the primary must refuse it too, for the same reason
  // `hasParsedAmount`'s own test does.
  test("a payload with amount: 0 is treated the same as no amount at all", async () => {
    const queued = item({
      id: "r-zero",
      kind: "low-confidence",
      payload: gatedPayload({ amount: 0 }),
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

// ---------------------------------------------------------------------------
// Branch review, 2026-08-21 — THE SAME DEAD TAP, REACHED THROUGH A DIFFERENT
// FIELD. Task 4b guarded `amount` alone, but `resolve_actions.ts`'s
// `proposalFrom` refuses THREE fields before it will build a Transaction —
// amount, direction and wallet — and an unmapped wallet is a ROUTINE hard
// route (`GATE_REASONS.unmappedWallet`, "PeraPlano could not tell which
// account this came from"), not an exotic one. So a `low-confidence` card
// carrying `walletId: null` rendered an ENABLED primary whose tap threw
// `IncompleteReviewItemError(item.id, "wallet")` into a mutation with no
// `onError`: the identical silent dead tap task 4 exists to close, just via
// the wallet instead of the amount.
// ---------------------------------------------------------------------------

describe("a low-confidence card missing any ledger-required field cannot be confirmed", () => {
  test("no wallet disables the primary and the blocked line names the wallet", async () => {
    const queued = item({
      id: "r-nowallet",
      kind: "low-confidence",
      payload: gatedPayload({ walletId: null }),
    });
    render(
      <ReviewCard item={queued} wallets={[gcash, bpi]} onPrimary={jest.fn()} onSecondary={jest.fn()} />,
      { wrapper: Wrapper },
    );

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    expect(primary.props.accessibilityState.disabled).toBe(true);
    expect(await screen.findByTestId(`review-blocked-${queued.id}`)).toHaveTextContent(
      /PeraPlano needs the wallet before this can be recorded./,
    );
  });

  test("no direction disables the primary too", async () => {
    const queued = item({
      id: "r-nodirection",
      kind: "low-confidence",
      payload: gatedPayload({ direction: null }),
    });
    render(
      <ReviewCard item={queued} wallets={[gcash, bpi]} onPrimary={jest.fn()} onSecondary={jest.fn()} />,
      { wrapper: Wrapper },
    );

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    expect(primary.props.accessibilityState.disabled).toBe(true);
  });

  // "Correct" is the way OFF a blocked card, so it stays live whichever field
  // is missing. Disabling it too would strand the user on a card whose only
  // remaining exit is rejecting a transaction that really happened.
  test("Correct stays enabled on a card blocked by its wallet", async () => {
    const queued = item({
      id: "r-nowallet-correct",
      kind: "low-confidence",
      payload: gatedPayload({ walletId: null }),
    });
    render(
      <ReviewCard item={queued} wallets={[gcash, bpi]} onPrimary={jest.fn()} onSecondary={jest.fn()} />,
      { wrapper: Wrapper },
    );

    const secondary = await screen.findByTestId(`review-secondary-${queued.id}`);
    expect(secondary.props.accessibilityState.disabled).toBe(false);
  });

  // The deliberate split between this file's DISPLAY reader (`readAmount`,
  // any finite number) and its ledger-facing predicate (`> 0`) was pinned on
  // the LEDGER side only. Without this test, a "simplification" that made the
  // display reader require `> 0` as well would silently turn a genuine ₱0.00
  // into the false statement "Amount not read" — exactly what `Side`'s own
  // comment forbids, and invisible to every other test on this branch.
  test("a ₱0.00 card still SHOWS ₱0.00, never 'Amount not read'", async () => {
    const queued = item({
      id: "r-zero-display",
      kind: "low-confidence",
      payload: gatedPayload({ amount: 0 }),
    });
    render(
      <ReviewCard item={queued} wallets={[gcash, bpi]} onPrimary={jest.fn()} onSecondary={jest.fn()} />,
      { wrapper: Wrapper },
    );

    const candidate = await screen.findByTestId(`review-candidate-${queued.id}`);
    expect(candidate).toHaveTextContent(new RegExp(`${MINUS}₱0\.00`));
    expect(candidate).not.toHaveTextContent("Amount not read");
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
// The one-tap record (2026-08-28)
//
// An unknown provider's payload is `{ amount: null, direction: null }` by
// construction — no ruleset matched, so no parser ran — and the card's primary
// used to open a blank form over a notification whose text was sitting right
// there on the same card. `candidates.ts` reads that text; these tests pin the
// two halves of what the card does with it.
//
// THE DANGEROUS HALF IS THE REFUSAL, not the autofill. A primary that commits
// the balance instead of the amount, or books a credit as a spend, is a wrong
// row in a ledger the user has no reason to doubt — so every case where the
// read is uncertain is asserted to fall back to the form.
// ---------------------------------------------------------------------------

describe("recording an unknown provider in one tap", () => {
  const ONE_TAP = { rawNotificationId: "cap-unknown" };

  test("a readable notification and one wallet make the primary a commit", async () => {
    await storeRawCapture(capture(), NOW);
    const queued = itemOfKind("unknown-provider", ONE_TAP);
    const onPrimary = jest.fn();
    const onRecordAutofill = jest.fn();

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash]}
        onPrimary={onPrimary}
        onSecondary={jest.fn()}
        onRecordAutofill={onRecordAutofill}
        onEditDetails={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    // NAMES ALL THREE FACTS IT WILL WRITE. This button is the whole
    // confirmation — there is no form after it — so a user who taps it without
    // reading the card still cannot be surprised by what lands.
    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    await waitFor(() =>
      expect(primary.props.accessibilityLabel).toBe("Record ₱1,250.00 out of GCash"),
    );

    fireEvent.press(primary);
    expect(onRecordAutofill).toHaveBeenCalledWith(queued, {
      amount: 125000,
      direction: "out",
      // "debited from your account" — the preposition introduced the user's own
      // account, not a counterparty, and a merchant of "your account" would key
      // a rule matching everything this app ever sends.
      merchant: null,
      walletId: gcash.id,
    });
    // The form path is not merely unused, it is not wired: two ways to settle
    // the same card would be two outcomes for one tap.
    expect(onPrimary).not.toHaveBeenCalled();
  });

  test("the way back to the form is rendered beside it", async () => {
    await storeRawCapture(capture(), NOW);
    const queued = itemOfKind("unknown-provider", ONE_TAP);
    const onEditDetails = jest.fn();

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onRecordAutofill={jest.fn()}
        onEditDetails={onEditDetails}
      />,
      { wrapper: Wrapper },
    );

    // WITHOUT THIS THE AUTOFILL IS A TRAP. A user who can see the app read the
    // wrong number would be left choosing between recording it anyway and
    // discarding a real transaction.
    const edit = await screen.findByTestId(`review-edit-${queued.id}`);
    fireEvent.press(edit);
    expect(onEditDetails).toHaveBeenCalledWith(queued);
  });

  test("two live amounts leave the primary opening the form", async () => {
    // A payment and a fee. Nothing in the prose ranks one over the other, and
    // picking either would be the silent wrong commit the queue exists to
    // prevent.
    await storeRawCapture(
      capture({ text: "PHP 1,250.00 was debited. Convenience fee PHP 15.00." }),
      NOW,
    );
    const queued = itemOfKind("unknown-provider", ONE_TAP);

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onRecordAutofill={jest.fn()}
        onEditDetails={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    await waitFor(() =>
      expect(screen.getByTestId(`review-snippet-${queued.id}`)).toHaveTextContent(/fee/),
    );
    expect(primary.props.accessibilityLabel).toBe(REVIEW_ACTIONS["unknown-provider"].primary);
    expect(screen.queryByTestId(`review-edit-${queued.id}`)).toBeNull();
  });

  test("a balance after the amount is not a second candidate", async () => {
    // The shape nearly every Philippine e-wallet notification takes. If the
    // balance counted as a candidate the one-tap path would never fire in the
    // field — and if it OUTRANKED the amount, the ledger would gain a ₱3,420.50
    // spend nobody made.
    await storeRawCapture(
      capture({ text: "PHP 1,250.00 was debited. Your new balance is PHP 3,420.50." }),
      NOW,
    );
    const queued = itemOfKind("unknown-provider", ONE_TAP);

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onRecordAutofill={jest.fn()}
        onEditDetails={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    await waitFor(() =>
      expect(primary.props.accessibilityLabel).toBe("Record ₱1,250.00 out of GCash"),
    );
  });

  test("two wallets are a decision, so the form opens", async () => {
    await storeRawCapture(capture(), NOW);
    const queued = itemOfKind("unknown-provider", ONE_TAP);

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onRecordAutofill={jest.fn()}
        onEditDetails={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    // Which wallet a transaction belongs to is exactly the question the sheet
    // exists to ask; guessing it here would mint a row on an account the user
    // never named.
    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    await waitFor(() =>
      expect(screen.getByTestId(`review-source-${queued.id}`)).toBeTruthy(),
    );
    expect(primary.props.accessibilityLabel).toBe(REVIEW_ACTIONS["unknown-provider"].primary);
  });

  test("a notification with no direction cue opens the form", async () => {
    // Defaulting the direction would book the occasional salary credit as a
    // ₱30,000 spend, on a card the user cleared in one tap precisely because
    // they trusted it.
    await storeRawCapture(capture({ text: "PHP 1,250.00 GCash" }), NOW);
    const queued = itemOfKind("unknown-provider", ONE_TAP);

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onRecordAutofill={jest.fn()}
        onEditDetails={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    await waitFor(() =>
      expect(screen.getByTestId(`review-snippet-${queued.id}`)).toHaveTextContent(/1,250/),
    );
    expect(primary.props.accessibilityLabel).toBe(REVIEW_ACTIONS["unknown-provider"].primary);
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

// ---------------------------------------------------------------------------
// The one-sided transfer card — money-transfers spec Task 12. Confirming this
// card MINTS a second ledger row on whichever wallet is selected here, so the
// four things pinned below are exactly the ways that could go wrong: a wallet
// offered that should not be (the captured leg's own, or an archived one), a
// wallet withheld that should be offered (cash — the ATM-withdrawal case this
// whole feature exists to catch), a prefill treated as a decision instead of a
// suggestion, and a primary that is live before there is anything to submit.
// ---------------------------------------------------------------------------

function oneSidedItem(payloadOverrides: Record<string, unknown> = {}): ReviewQueueItem {
  return itemOfKind("one-sided-transfer", {
    id: "r-onesided",
    payload: gatedPayload({
      reason: GATE_REASONS.oneSidedTransfer,
      walletId: gcash.id,
      counterpartWalletId: null,
      signal: "text",
      ...payloadOverrides,
    }),
  });
}

describe("the one-sided transfer card", () => {
  test("offers every other unarchived wallet, never the captured leg's own", async () => {
    // CASH IS OFFERED ON PURPOSE — see one_sided_transfer_body.tsx's header:
    // a cash leg posts no notification, so this card is the only way a human
    // can supply it.
    const cash: Wallet = { ...gcash, id: "w-cash", name: "Cash" };
    const archived: Wallet = { ...gcash, id: "w-archived", name: "Retired GCash", isArchived: true };
    const queued = oneSidedItem();

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi, cash, archived]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onChooseTransferWallet={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    expect(await screen.findByTestId(`one-sided-wallet-${bpi.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`one-sided-wallet-${cash.id}`)).not.toBeNull();
    expect(screen.queryByTestId(`one-sided-wallet-${gcash.id}`)).toBeNull();
    expect(screen.queryByTestId(`one-sided-wallet-${archived.id}`)).toBeNull();
  });

  test("a rule-sourced item preselects its wallet", async () => {
    const queued = oneSidedItem({ counterpartWalletId: bpi.id, signal: "rule" });

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onChooseTransferWallet={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    const preselected = await screen.findByTestId(`one-sided-wallet-${bpi.id}`);
    expect(preselected.props.accessibilityState?.selected).toBe(true);
  });

  test("confirming reports the chosen wallet and fee", async () => {
    const onChoose = jest.fn();
    const queued = oneSidedItem();

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onChooseTransferWallet={onChoose}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.press(await screen.findByTestId(`one-sided-wallet-${bpi.id}`));
    fireEvent.press(await screen.findByTestId(`review-primary-${queued.id}`));

    expect(onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "one-sided-transfer" }),
      bpi.id,
      0,
    );
  });

  // `signal` is the ONE thing separating a proposal the app has evidence for
  // from a guess off the notification's own words (spec §1.2). A card that
  // reads identically either way tells the user a rule-backed prefill is worth
  // no more than an unbacked one, on the screen where they decide whether to
  // accept it.
  test("a rule-sourced proposal says the app has seen the pairing, naming the wallet", async () => {
    const queued = oneSidedItem({ counterpartWalletId: bpi.id, signal: "rule" });

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onChooseTransferWallet={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    const prompt = await screen.findByTestId("one-sided-transfer-prompt");
    expect(prompt).toHaveTextContent(new RegExp(`usually.*${bpi.name}`, "i"));
  });

  test("a text-sourced proposal just asks the question", async () => {
    const queued = oneSidedItem({ counterpartWalletId: bpi.id, signal: "text" });

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onChooseTransferWallet={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    // A text signal is the notification's own wording and nothing more — it has
    // no history behind it, so claiming one would be the app inventing evidence
    // for its own guess.
    const prompt = await screen.findByTestId("one-sided-transfer-prompt");
    expect(prompt).toHaveTextContent(/where did this money go/i);
    expect(prompt).not.toHaveTextContent(/usually/i);
  });

  test("a rule signal with no prefilled wallet still just asks the question", async () => {
    const queued = oneSidedItem({ counterpartWalletId: null, signal: "rule" });

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onChooseTransferWallet={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    const prompt = await screen.findByTestId("one-sided-transfer-prompt");
    expect(prompt).not.toHaveTextContent(/usually/i);
  });

  test("the primary is withheld until a wallet is chosen", async () => {
    const queued = oneSidedItem();

    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        onChooseTransferWallet={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    expect(primary.props.accessibilityState.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wallet-kind-unclear — the only card that is about a wallet, not a transaction
// ---------------------------------------------------------------------------

describe("the wallet-kind card", () => {
  function walletKindItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
    return item({
      id: "r-wallet-kind",
      kind: "wallet-kind-unclear",
      payload: { walletId: bpi.id, walletName: "BPI", balance: 250_000 },
      ...overrides,
    });
  }

  test("asks about the wallet by name, in money the user can read", async () => {
    render(<ReviewCard item={walletKindItem()} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    const question = await screen.findByTestId("wallet-kind-question-r-wallet-kind");
    expect(String(question.props.children)).toContain("BPI");
    expect(String(question.props.children)).toMatch(/money you have, or money you owe/i);
  });

  test("quotes the wallet's CURRENT balance, not the one frozen into the payload", async () => {
    // The card can sit in the queue for weeks. Asking about a figure the user
    // cannot see anywhere is worse than asking without one.
    const stale = walletKindItem({
      payload: { walletId: bpi.id, walletName: "BPI", balance: 1 },
    });
    render(<ReviewCard item={stale} wallets={[gcash, { ...bpi, balance: 777_700 }]} />, {
      wrapper: Wrapper,
    });

    const question = await screen.findByTestId("wallet-kind-question-r-wallet-kind");
    expect(String(question.props.children)).toContain("₱7,777.00");
  });

  test("falls back to the payload's copy when the wallet is no longer listed", async () => {
    render(<ReviewCard item={walletKindItem()} wallets={[]} />, { wrapper: Wrapper });

    const question = await screen.findByTestId("wallet-kind-question-r-wallet-kind");
    expect(String(question.props.children)).toContain("BPI");
    expect(String(question.props.children)).toContain("₱2,500.00");
  });

  test("offers two answers, neither of them a rejection", async () => {
    const queued = walletKindItem();
    render(
      <ReviewCard item={queued} wallets={[gcash, bpi]} onPrimary={jest.fn()} onSecondary={jest.fn()} />,
      { wrapper: Wrapper },
    );

    expect(await screen.findByTestId(`review-primary-${queued.id}`)).toHaveTextContent(
      "Money I have",
    );
    expect(await screen.findByTestId(`review-secondary-${queued.id}`)).toHaveTextContent(
      "Money I owe",
    );
  });

  test("shows no proposal panel and no confidence meter", async () => {
    const queued = walletKindItem();
    render(<ReviewCard item={queued} wallets={[gcash, bpi]} />, { wrapper: Wrapper });

    await screen.findByTestId("wallet-kind-body-r-wallet-kind");
    // There is no notification behind this card: no amount to approve, and no
    // score to report. Rendering either would put a transaction on screen that
    // does not exist.
    expect(screen.queryByTestId(`review-candidate-${queued.id}`)).toBeNull();
    expect(screen.queryByTestId(`review-confidence-${queued.id}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// `busy` — a triage write already in flight for THIS card (GAP-079)
// ---------------------------------------------------------------------------
//
// Every `disabled` rule above answers "can this outcome be chosen at all?".
// This one answers "has it already been chosen?", and it is a different
// question with a different owner: `useReviewAction` is ONE mutation shared by
// the whole queue, so only the screen can join `isPending` to the item being
// written, and only the screen learns when the write settles. A card-local
// latch could do neither — the queue keeps a FAILED card on screen, so a latch
// with nothing to clear it would strand the user on the card they were trying
// to resolve.
//
// Nothing under the hook dedupes a second outcome for one item, and `confirm`
// and `dismiss` are not the same write, so the refusal has to happen at the
// buttons.

describe("a triage write already in flight for this card", () => {
  test("disables the pair, and gives them back when it settles", async () => {
    const queued = itemOfKind("low-confidence");
    const card = (busy: boolean) => (
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        onPrimary={jest.fn()}
        onSecondary={jest.fn()}
        busy={busy}
      />
    );
    const view = render(card(true), { wrapper: Wrapper });

    const primary = await screen.findByTestId(`review-primary-${queued.id}`);
    expect(primary.props.accessibilityState.disabled).toBe(true);
    // Refused WITH THE REASON on it, the same no-dead-taps rule the rest of
    // this card keeps — a spinner where the others show a sentence.
    expect(primary.props.accessibilityState.busy).toBe(true);
    expect(
      screen.getByTestId(`review-secondary-${queued.id}`).props.accessibilityState.disabled,
    ).toBe(true);

    view.rerender(card(false));

    // A failed triage leaves this card exactly where it was — the screen
    // renders the failure and offers a retry — so both buttons have to return.
    expect(
      screen.getByTestId(`review-primary-${queued.id}`).props.accessibilityState.disabled,
    ).toBe(false);
    expect(
      screen.getByTestId(`review-secondary-${queued.id}`).props.accessibilityState.disabled,
    ).toBe(false);
  });

  test("a second press on the primary does not reach the screen", async () => {
    const onPrimary = jest.fn();
    const queued = itemOfKind("low-confidence");
    render(
      <ReviewCard
        item={queued}
        wallets={[gcash, bpi]}
        onPrimary={onPrimary}
        onSecondary={jest.fn()}
        busy
      />,
      { wrapper: Wrapper },
    );

    fireEvent.press(await screen.findByTestId(`review-primary-${queued.id}`));

    expect(onPrimary).not.toHaveBeenCalled();
  });

  test("the per-loan buttons go with it", async () => {
    const queued = itemOfKind("loan-match", {
      id: "r-loan",
      payload: {
        candidates: [
          { loanId: "l-nena", counterparty: "Aling Nena" },
          { loanId: "l-ben", counterparty: "Kuya Ben" },
        ],
      },
    });
    render(
      <ReviewCard item={queued} wallets={[gcash, bpi]} onChooseLoan={jest.fn()} busy />,
      { wrapper: Wrapper },
    );

    // With two or more candidates the screen supplies NO primary (loans rule
    // 9), so these are the card's confirm buttons and the only place a second
    // tap can be refused.
    expect(
      (await screen.findByTestId(`review-loan-choice-${queued.id}-l-nena`)).props
        .accessibilityState.disabled,
    ).toBe(true);
    expect(
      screen.getByTestId(`review-loan-choice-${queued.id}-l-ben`).props.accessibilityState
        .disabled,
    ).toBe(true);
  });
});
