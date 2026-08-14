// lib/review/resolve_actions.ts — what actually happens when a triage button is
// pressed (m1c plan Task 10; docs/04-features/08-review-queue.md).
//
// THE QUEUE'S WHOLE VALUE IS ON THIS PAGE. Task 9 built cards that ask the
// question; these are the writes that answer it, and every one of them moves
// money or teaches the pipeline. Four rules shape all of them:
//
//   ATOMIC, OR NOTHING (rule 2). Commit, rule and resolution happen in ONE SQL
//   transaction via `withUnitOfWork`. A committed Transaction beside an
//   unresolved queue item is not a cosmetic inconsistency: the card comes back,
//   the user confirms it again, and their ledger holds the same purchase twice.
//
//   EVERY CORRECTION TEACHES, UNLESS THE USER SAID NO (rule 1, spec rule 12).
//   This is the loop the whole feature exists for — a parser gap becomes training
//   data instead of a bug report. But `createRule: false` creates NOTHING. A user
//   who unchecked the box made a specific statement about every future row from
//   that merchant, and making the rule anyway silently recategorizes transactions
//   they never looked at.
//
//   THE `UserRule` MODEL IS MATCHER/ACTION. The m1c plan's `provider_wallet`,
//   `merchant_category` and `ignore_pattern` KINDS DO NOT EXIST anywhere in this
//   codebase; m1b Task 8 shipped `{ matcher, action }` (types/domain.ts), and the
//   plan's three "kinds" are three ACTION kinds. `merchantPattern` is matched as
//   a case-insensitive SUBSTRING by lib/ingest/categorizer.ts — never a regex, so
//   a merchant containing "(" cannot throw mid-pipeline months later.
//
//   DOUBLE-TAPS ARE INHERITED, NOT REIMPLEMENTED (rule 5).
//   `review_queue_repo.resolve` already returns early on an item that is missing
//   or already resolved, and `listOpen` already excludes both. Each action reads
//   the OPEN item first and returns `null` when there is none, so the second tap
//   is a no-op by construction rather than by a flag someone has to remember.
//
// NOT A REPOSITORY. This is the service layer the interface contract expects
// between hooks and repositories for work that spans aggregates; it holds no SQL
// of its own.
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { getActiveRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { getRawCapture } from "@/lib/db/repos/raw_notifications_repo";
import { listOpen, resolve } from "@/lib/db/repos/review_queue_repo";
import {
  deleteTransaction,
  getTransaction,
  insertTransaction,
} from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { createUserRule } from "@/lib/db/repos/user_rules_repo";
import { withUnitOfWork } from "@/lib/db/unit_of_work";
import type {
  Centavos,
  EpochMs,
  NewTransaction,
  RawCapture,
  ReviewItemPayload,
  ReviewQueueItem,
  TxDirection,
} from "@/types/domain";

/**
 * A field the user changed on the card before committing it.
 *
 * `createRule` defaults to TRUE (spec rule 12: "every correction creates a
 * UserRule"), and only an explicit `false` suppresses it — which is exactly what
 * `components/transactions/category_picker.tsx`'s checkbox reports, checked by
 * default. An omitted key is not a correction: `correctItem` compares each field
 * against what the parser proposed, so re-picking the value that was already
 * there teaches nothing and writes nothing.
 */
export type CorrectionPatch = {
  amount?: Centavos;
  direction?: TxDirection;
  walletId?: string;
  categoryId?: string;
  merchant?: string;
  createRule?: boolean;
};

/**
 * Thrown when a queue item cannot become a Transaction because a field the
 * ledger requires is still missing — most often the Wallet, which is one of the
 * gate's hard routes into the queue in the first place.
 *
 * IT REFUSES RATHER THAN GUESSING. Picking a wallet on the user's behalf here
 * would be the silent wrong auto-commit the entire Review Queue exists to
 * prevent (risk #4): a total that is wrong is worse than a total that is late.
 * The card's own "No wallet matched" chip is the user's cue to supply one
 * through `correctItem`.
 */
export class IncompleteReviewItemError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly missing: string,
  ) {
    super(`review item ${itemId} cannot be committed: ${missing} is missing`);
    this.name = "IncompleteReviewItemError";
  }
}

// ---------------------------------------------------------------------------
// Payload readers
// ---------------------------------------------------------------------------
//
// `ReviewItemPayload` is `Record<string, unknown>` — the repository stores it
// verbatim and deliberately never interprets it. So every field is read
// defensively, exactly as `review_card.tsx` reads them for display: an item
// enqueued by an older build must fail with a sentence naming what is missing,
// never by writing `NaN` into the ledger.

function readString(payload: ReviewItemPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readAmount(payload: ReviewItemPayload): Centavos | null {
  const value = payload.amount;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function readDirection(payload: ReviewItemPayload): TxDirection | null {
  return payload.direction === "in" || payload.direction === "out" ? payload.direction : null;
}

/** The open item, or `null` when it is unknown, expired or already resolved. */
async function openItem(itemId: string): Promise<ReviewQueueItem | null> {
  return (await listOpen()).find((item) => item.id === itemId) ?? null;
}

/** The capture behind an item, or `null` once it is past its 30-day TTL. */
async function captureFor(item: ReviewQueueItem): Promise<RawCapture | null> {
  return item.rawNotificationId === null ? null : await getRawCapture(item.rawNotificationId);
}

/**
 * When the money actually moved.
 *
 * `capture.postedAt`, the SAME source `parser.ts` uses on the auto-commit path
 * (spec §10, "never `capturedAt`"), because the queue payload does not carry
 * `occurredAt` at all — `pipeline.ts` writes the parsed fields and the gate's
 * reason, and the normalized event's timestamp is lost with it.
 *
 * Stamping the confirmation time instead would file a notification triaged two
 * days later under today: wrong day-group header, wrong daily total, wrong
 * report, on a row the user just told the app was correct. The item's own
 * `createdAt` is the fallback when the capture has been purged — it is when the
 * capture was stored, which is the closest surviving evidence.
 */
async function occurredAtFor(item: ReviewQueueItem): Promise<EpochMs> {
  return (await captureFor(item))?.postedAt ?? item.createdAt;
}

/**
 * The key a rule about this item's SOURCE should match on.
 *
 * The installed ruleset first, because `categorizer.ts` compares a matcher's
 * `providerKey` against the normalized event's — which comes from the matched
 * `ProviderRuleset`. The package name is the fallback, and it is the right one
 * twice over: an unknown-provider item has no ruleset entry by definition, and
 * `pipeline.ts`'s `isDismissedPackage` compares `providerKey` against the
 * package name itself. Either way the rule names a real source rather than an
 * invented string.
 */
async function providerKeyFor(item: ReviewQueueItem): Promise<string | null> {
  const packageName =
    readString(item.payload, "packageName") ?? (await captureFor(item))?.packageName ?? null;
  if (packageName === null) return null;

  const bundle = await getActiveRuleset();
  const provider = bundle?.providers.find((candidate) =>
    candidate.packageNames.includes(packageName),
  );
  return provider?.providerKey ?? packageName;
}

/**
 * The Transaction a queue item proposes, with the user's corrections applied.
 *
 * `source` is always `notification` and `confidence` is always 1: rule 3 pins
 * the first, and spec rule 8 pins the second — "a human decision outranks any
 * parser score". `rawNotificationId` rides along so "Why was this recorded?"
 * still answers afterwards.
 */
function proposalFrom(
  item: ReviewQueueItem,
  patch: CorrectionPatch,
  occurredAt: EpochMs,
): NewTransaction {
  const amount = patch.amount ?? readAmount(item.payload);
  if (amount === null) throw new IncompleteReviewItemError(item.id, "amount");

  const direction = patch.direction ?? readDirection(item.payload);
  if (direction === null) throw new IncompleteReviewItemError(item.id, "direction");

  const walletId = patch.walletId ?? readString(item.payload, "walletId");
  if (walletId === null) throw new IncompleteReviewItemError(item.id, "wallet");

  return {
    walletId,
    // Mirrors `pipeline.ts`'s own commit: a parse that resolved no category
    // lands in Uncategorized rather than violating the category foreign key.
    categoryId: patch.categoryId ?? readString(item.payload, "categoryId") ?? UNCATEGORIZED_ID,
    amount,
    direction,
    occurredAt,
    merchant: patch.merchant ?? readString(item.payload, "merchant"),
    source: "notification",
    confidence: 1,
    rawNotificationId: item.rawNotificationId,
  };
}

/**
 * Writes the rules a correction implies (spec rule 12's table), or none.
 *
 * A field only counts as CORRECTED when the patch actually changes it. Setting
 * the category to the one the parser already chose is a confirmation, and spec
 * rule 13 is explicit that a plain confirmation creates no rule — it would
 * restate what the pipeline got right and clutter the list the user has to be
 * able to read.
 */
async function teachFrom(
  item: ReviewQueueItem,
  patch: CorrectionPatch,
  committed: NewTransaction,
  now: EpochMs,
): Promise<void> {
  if (patch.createRule === false) return;

  const merchant = committed.merchant;
  if (
    patch.categoryId !== undefined &&
    patch.categoryId !== readString(item.payload, "categoryId") &&
    // NO RULE WITHOUT A MERCHANT. `categorizer.ts` makes a blank
    // `merchantPattern` FAIL CLOSED, so a rule built from a missing merchant
    // could never fire — it would sit in the user's settings looking as though
    // it might, which is worse than not offering it.
    typeof merchant === "string" &&
    merchant.trim() !== ""
  ) {
    await createUserRule(
      {
        matcher: { merchantPattern: merchant },
        action: { kind: "set-category", categoryId: patch.categoryId },
        createdFrom: item.id,
      },
      now,
    );
  }

  if (patch.walletId !== undefined && patch.walletId !== readString(item.payload, "walletId")) {
    const providerKey = await providerKeyFor(item);
    if (providerKey !== null) {
      await createUserRule(
        {
          matcher: { providerKey },
          action: { kind: "set-wallet", walletId: patch.walletId },
          createdFrom: item.id,
        },
        now,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The actions
// ---------------------------------------------------------------------------

/**
 * "Correct" — commit the item with the user's fixes and teach the pipeline.
 *
 * Returns the committed Transaction's id, or `null` when the item was already
 * resolved (rule 5). `null` rather than a thrown error because a double-tap is
 * not a mistake the user should be told about; and rather than the original
 * transaction id because the queue table records no outcome — `resolved_at` is
 * its only column, by design (review_queue_repo's header).
 *
 * `now` stamps any rule this creates. Injectable per Global Constraints, and it
 * matters here specifically: `created_at` is part of `listUserRules`' evaluation
 * order, so a test that could not pin it could not pin conflict resolution.
 */
export async function correctItem(
  itemId: string,
  patch: CorrectionPatch,
  now: EpochMs = Date.now(),
): Promise<string | null> {
  return withUnitOfWork(async () => {
    const item = await openItem(itemId);
    if (item === null) return null;

    const proposal = proposalFrom(item, patch, await occurredAtFor(item));
    const committed = await insertTransaction(proposal);
    await teachFrom(item, patch, proposal, now);
    await resolve(itemId, "confirmed");
    return committed.id;
  });
}

/**
 * "Looks right" — commit exactly what was proposed.
 *
 * An empty correction, which is what makes spec rule 13 STRUCTURAL rather than a
 * rule someone has to remember: nothing changed, so `teachFrom` finds no
 * corrected field and writes no rule. The confirmation still raises the row's
 * `confidence` to 1 — that is the human decision, not a correction.
 */
export async function confirmItem(
  itemId: string,
  now: EpochMs = Date.now(),
): Promise<string | null> {
  return correctItem(itemId, {}, now);
}

/**
 * "Always ignore notifications like this" — mute a source and close the item.
 *
 * The matcher carries the PACKAGE NAME verbatim, unresolved, because
 * `pipeline.ts`'s `isDismissedPackage` is the only consumer of an `ignore` rule
 * and it compares `matcher.providerKey` against `capture.packageName`. Resolving
 * it to a ruleset key here would produce a rule that reads correctly and never
 * fires.
 *
 * Commits nothing (rule 10: dismissing is never destructive to the ledger, and
 * never creative either). Note this is the MUTE, which spec §"unknown provider"
 * step 5 offers after two "Not money" dismissals of the same source — a single
 * "Not money" only discards the capture, which is `resolve(id, "dismissed")`.
 */
export async function ignoreProvider(
  itemId: string,
  packageName: string,
  now: EpochMs = Date.now(),
): Promise<void> {
  await withUnitOfWork(async () => {
    const item = await openItem(itemId);
    if (item === null) return;

    await createUserRule(
      {
        matcher: { providerKey: packageName },
        action: { kind: "ignore" },
        createdFrom: item.id,
      },
      now,
    );
    await resolve(itemId, "dismissed");
  });
}

/**
 * Pairs two ALREADY-COMMITTED legs and closes the item.
 *
 * The fee is `outLeg.amount − inLeg.amount`, computed here because only a caller
 * holding both legs can (transfer_links_repo's contract), and stored verbatim
 * including a negative value — domain §3.3 reads that as a credited cash-in
 * bonus.
 *
 * Idempotent through the LEDGER rather than the queue item: an already-stamped
 * leg returns its existing link id. That matters because this is also the
 * ledger-side "Link as transfer" (spec §"Flow: merge / split / link / unlink"),
 * which runs with no queue item at all — `resolve` on an id it does not know is
 * already a silent no-op, so the same function serves both callers.
 *
 * Both legs must exist. Linking a leg that is not in the ledger would stamp
 * nothing while writing a link row, and stamped-less link rows are invisible to
 * every total in the app.
 */
export async function linkAsTransfer(
  itemId: string,
  outTransactionId: string,
  inTransactionId: string,
): Promise<string> {
  return withUnitOfWork(async () => {
    const [outLeg, inLeg] = await Promise.all([
      getTransaction(outTransactionId),
      getTransaction(inTransactionId),
    ]);
    if (outLeg === null || inLeg === null) {
      throw new Error(
        `cannot link a transfer: ${outLeg === null ? outTransactionId : inTransactionId} is not in the ledger`,
      );
    }

    if (outLeg.transferLinkId !== null) {
      await resolve(itemId, "confirmed");
      return outLeg.transferLinkId;
    }

    const link = await linkTransfer(outLeg.id, inLeg.id, outLeg.amount - inLeg.amount, {
      detectedBy: "manual",
      confidence: 1,
    });
    await resolve(itemId, "confirmed");
    return link.id;
  });
}

/**
 * "It's a transfer" — commit the queued leg AND pair it with its counterpart.
 *
 * THIS EXISTS BECAUSE THE PLAN'S `linkAsTransfer` CANNOT ANSWER THIS CARD. The
 * spec says an ambiguous transfer queues with "both legs already committed", but
 * `pipeline.ts` does not commit the candidate at all — every non-auto-commit
 * route queues instead of committing, so the leg the card is about has no
 * transaction id yet. Confirming and then linking as two calls would leave a
 * window in which the leg is committed and unpaired: an internal movement
 * sitting in the user's spend total, which is the single most trust-destroying
 * row this app can show (rule 3 of the ledger).
 *
 * The counterpart id is the one `pipeline.ts` put in the payload and the one the
 * card showed the user beside the candidate — never a fresh guess, so what is
 * linked is what they judged.
 *
 * NO CLOCK ARGUMENT, unlike its neighbours: this action writes no UserRule, so
 * it has nothing to stamp. Spec rule 12's table does list a pairing rule for
 * "It's a transfer", and it is deliberately not written here — `UserRuleMatcher`
 * (types/domain.ts) has no field that can express a wallet PAIR, and nothing in
 * `lib/ingest/` reads the `mark-transfer` action, so the rule would be a row in
 * the user's settings that can never fire. See this file's header on why an
 * unfireable rule is worse than no rule.
 */
export async function confirmAsTransfer(itemId: string): Promise<string | null> {
  return withUnitOfWork(async () => {
    const item = await openItem(itemId);
    if (item === null) return null;

    const counterpartId = readString(item.payload, "transferCounterpartTransactionId");
    if (counterpartId === null) {
      throw new IncompleteReviewItemError(item.id, "transfer counterpart");
    }
    const counterpart = await getTransaction(counterpartId);
    if (counterpart === null) {
      throw new Error(`cannot link a transfer: ${counterpartId} is not in the ledger`);
    }

    const proposal = proposalFrom(item, {}, await occurredAtFor(item));
    const committed = await insertTransaction(proposal);

    // Which leg is which comes from the two rows, not from an assumption: the
    // candidate may be either half of the pair.
    const [outLeg, inLeg] =
      committed.direction === "out" ? [committed, counterpart] : [counterpart, committed];
    await linkTransfer(outLeg.id, inLeg.id, outLeg.amount - inLeg.amount, {
      detectedBy: "manual",
      confidence: 1,
    });
    await resolve(itemId, "confirmed");
    return committed.id;
  });
}

/**
 * "Same transaction" / the ledger's "Merge as duplicates" — keep one row, drop
 * the other, and give the wallet its money back.
 *
 * THE BALANCE IS THE WHOLE POINT. Both duplicates moved the wallet balance when
 * they were written, so the wallet is currently short by twice one purchase.
 * `deleteTransaction` reverses the dropped row's effect in the same SQL
 * transaction as the delete — deleting without reversing would leave the balance
 * describing a transaction that no longer exists, which is the exact bug the
 * user pressed this button to fix.
 *
 * The kept row is never touched, so rule 4's requirement that it keep its
 * `rawNotificationRef` holds by construction rather than by a copy step.
 *
 * IDEMPOTENT THROUGH THE LEDGER, like `linkAsTransfer` and for the same reason:
 * a dropped row that is already gone means the merge already happened, and this
 * is also the ledger-side merge that runs with no queue item.
 *
 * A held (uncommitted) duplicate twin has no row here at all — the DedupeGate
 * queues it without committing — so "Same transaction" on such a card discards
 * the twin by resolving the item alone, and spec rule 10's "committed
 * transactions are never deleted by any queue action" is untouched.
 */
export async function mergeDuplicate(
  itemId: string,
  keepTransactionId: string,
  dropTransactionId: string,
): Promise<void> {
  if (keepTransactionId === dropTransactionId) {
    throw new Error("cannot merge a transaction into itself — the survivor would be deleted");
  }

  await withUnitOfWork(async () => {
    if ((await getTransaction(dropTransactionId)) !== null) {
      await deleteTransaction(dropTransactionId);
    }
    await resolve(itemId, "confirmed");
  });
}
