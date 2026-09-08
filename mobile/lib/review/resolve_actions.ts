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
import { checkDuplicate } from "@/lib/ingest/dedupe_gate";
import { getActiveRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { getRawCapture, isRawCaptureUnreferenced } from "@/lib/db/repos/raw_notifications_repo";
import {
  enqueue,
  getReviewItem,
  listOpen,
  reopen,
  resolve,
} from "@/lib/db/repos/review_queue_repo";
import { setWalletOwed } from "@/lib/db/repos/wallet_traits_repo";
import {
  deleteTransaction,
  getTransaction,
  hasTransactionForRawCapture,
  insertTransaction,
  listTransactions,
} from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { createUserRule } from "@/lib/db/repos/user_rules_repo";
import { withUnitOfWork } from "@/lib/db/unit_of_work";
import { attachCounterpartLeg } from "@/lib/transfers/transfer_service";
import type { NormalizedEvent } from "@/lib/ingest/normalizer";
import type { RecentEvent } from "@/lib/ingest/dedupe_gate";
import type { RulesetBundle } from "@/lib/ingest/ruleset_types";
import type {
  Centavos,
  EpochMs,
  NewTransaction,
  RawCapture,
  ReviewItemPayload,
  ReviewQueueItem,
  Transaction,
  TxDirection,
  UserRuleMatcher,
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
 * THE NORMALIZED EVENT'S OWN STAMP FIRST (GAP-012). The payload carries
 * `occurredAt` since that fix; before it, the card kept the parsed fields and
 * the gate's reason and dropped the timestamp the stages had already worked out,
 * so the two paths could file the same notification under two different
 * instants. `capture.postedAt` remains the fallback and is the SAME source
 * `parser.ts` uses on the auto-commit path (spec §10, "never `capturedAt`").
 *
 * Stamping the confirmation time instead would file a notification triaged two
 * days later under today: wrong day-group header, wrong daily total, wrong
 * report, on a row the user just told the app was correct. The item's own
 * `createdAt` is the last fallback when the capture has been purged — it is when
 * the capture was stored, which is the closest surviving evidence.
 */
async function occurredAtFor(item: ReviewQueueItem): Promise<EpochMs> {
  const stated = item.payload.occurredAt;
  if (typeof stated === "number" && Number.isFinite(stated)) return stated;

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
 *
 * AND `referenceNo` RIDES ALONG TOO (GAP-012), which is not cosmetic. It is §6
 * rule 1's strong key, the ONLY thing that can match this movement to a late
 * telling of it hours later, and a row confirmed without one can never be
 * matched to anything again: the same purchase's SMS relay arriving outside the
 * 180-second twin window reads as a second, genuine transaction and is committed
 * beside it. The user gets no card and no warning, only a doubled total.
 *
 * `balanceAfter` IS DELIBERATELY LEFT OUT, though the payload now carries it.
 * `insertTransaction` SETS the wallet's balance to a non-null `balanceAfter`
 * (wallets rule 1), and its own docblock records that spec rule 9's
 * "snap only if newer than the current snapshot" guard is NOT implemented. A
 * card triaged three days after its notification would therefore re-anchor the
 * wallet to a three-day-old figure and silently discard every movement since.
 * Auto-commit snaps because it runs seconds after the notification; a triage
 * action has no such guarantee, and turning the snap on here is a wallets
 * decision, not a dedupe one.
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
    referenceNo: readString(item.payload, "referenceNo"),
    source: "notification",
    confidence: 1,
    rawNotificationId: item.rawNotificationId,
  };
}

/**
 * The already-committed row this card describes, or `null` — the confirm path's
 * own DedupeGate call (GAP-012).
 *
 * WHY A CARD NEEDS ONE AT ALL. `checkDuplicate` runs in the pipeline, over
 * captures. A queue item skips it entirely: whatever the gate decided when the
 * card was raised, the ledger has moved since — the twin may have auto-committed
 * on the other channel a second later, or the user may have confirmed the twin's
 * own card first. Committing regardless is how one payment becomes two rows with
 * nothing on screen to explain it, and it is the last door the queue-side
 * `findOpenTwin` guard does not close.
 *
 * ONLY A DEFINITE `duplicate` SUPPRESSES. `possible-duplicate` is §6 rule 4's
 * undecidable pair, and a user pressing "Looks right" on that card is answering
 * precisely that question — "yes, this is a second real purchase". Refusing them
 * there would delete a transaction they just vouched for. `supersedes` is left
 * alone too: overwriting a minted leg is the pipeline's own write, not something
 * to reach into from a triage action.
 *
 * THE RULES ARE NOT RESTATED HERE — `checkDuplicate` is imported and called, so
 * the confirm path and the ingest path cannot drift on what a duplicate is. Only
 * the JOIN is rebuilt (`recentEventsFor` below), because the pipeline's copy is
 * private to a module that imports the native notification bridge and cannot be
 * pulled into the service layer.
 */
async function committedTwinOf(
  item: ReviewQueueItem,
  proposal: NewTransaction,
): Promise<string | null> {
  const bundle = await getActiveRuleset();
  if (bundle === null) return null;

  const source = await sourceFor(item, bundle);
  if (source === null) return null;

  const event: NormalizedEvent = {
    providerKey: source.providerKey,
    channel: source.channel,
    walletId: proposal.walletId,
    amount: proposal.amount,
    direction: proposal.direction,
    occurredAt: proposal.occurredAt,
    referenceNo: proposal.referenceNo ?? undefined,
    confidence: proposal.confidence,
  };

  const { dedupeStrongWindowMs, dedupeTwinWindowMs } = bundle.tunables;
  const since = event.occurredAt - Math.max(dedupeStrongWindowMs, dedupeTwinWindowMs);
  const recent = await recentEventsFor(await listTransactions({ from: since }), bundle);

  const verdict = checkDuplicate(event, recent, bundle.tunables);
  return verdict.kind === "duplicate" ? verdict.ofTransactionId : null;
}

/**
 * The provider and channel behind a card.
 *
 * The payload first, because since GAP-012 the pipeline writes both onto every
 * queued item and they are what the stages actually decided. The capture's
 * package resolved through the installed ruleset is the fallback, which is what
 * every card raised before that fix has — and it is also why this cannot simply
 * reuse `providerKeyFor` above: that one falls back to the PACKAGE NAME when no
 * provider claims it, which is the right answer for a `UserRule` matcher and the
 * wrong one here, where an invented key would compare equal to nothing and a
 * `null` channel would disable rule 2 outright.
 */
async function sourceFor(
  item: ReviewQueueItem,
  bundle: RulesetBundle,
): Promise<{ providerKey: string; channel: "push" | "sms" } | null> {
  const { providerKey, channel } = item.payload;
  if (typeof providerKey === "string" && channel !== undefined) {
    return { providerKey, channel };
  }

  const packageName = (await captureFor(item))?.packageName ?? null;
  if (packageName === null) return null;

  const provider = bundle.providers.find((candidate) =>
    candidate.packageNames.includes(packageName),
  );
  return provider === undefined
    ? null
    : { providerKey: provider.providerKey, channel: provider.channel };
}

/**
 * The `RecentEvent` join the DedupeGate cannot do for itself, for the confirm
 * path.
 *
 * A SECOND COPY OF `pipeline.ts`'s `recentEventsFor`, and the duplication is
 * deliberate rather than an oversight: that module calls `requireNativeModule`
 * at import time through `@/modules/notification_listener`, so importing it here
 * would make every screen and hook that reaches this service layer depend on the
 * native notification bridge. The two must agree, and what keeps them agreeing
 * is that neither decides anything — both only assemble the two facts
 * (`providerKey`, `channel`) that `Transaction` does not carry, and hand them to
 * the one `checkDuplicate` both call. See that file's copy for why a row with no
 * notification behind it gets nulls and why nulls never match.
 */
async function recentEventsFor(
  rows: Transaction[],
  bundle: RulesetBundle,
): Promise<RecentEvent[]> {
  const events: RecentEvent[] = [];

  for (const row of rows) {
    let providerKey: string | null = null;
    let channel: "push" | "sms" | null = null;

    if (row.rawNotificationId !== null) {
      const raw = await getRawCapture(row.rawNotificationId);
      const provider =
        raw === null
          ? undefined
          : bundle.providers.find((candidate) =>
              candidate.packageNames.includes(raw.packageName),
            );
      if (provider !== undefined) {
        providerKey = provider.providerKey;
        channel = provider.channel;
      }
    }

    events.push({
      transactionId: row.id,
      providerKey,
      channel,
      walletId: row.walletId,
      amount: row.amount,
      direction: row.direction,
      referenceNo: row.referenceNo,
      occurredAt: row.occurredAt,
      mintedTransferLeg:
        row.source === "manual" && row.transferLinkId !== null && row.rawNotificationId === null,
    });
  }

  return events;
}

/**
 * Writes the rules a correction implies (spec rule 12's table), or none.
 *
 * A field only counts as CORRECTED when the patch actually changes it. Setting
 * the category to the one the parser already chose is a confirmation, and spec
 * rule 13 is explicit that a plain confirmation creates no rule — it would
 * restate what the pipeline got right and clutter the list the user has to be
 * able to read.
 *
 * `transfer` is the ONE branch not gated by a "did the patch change this"
 * check, because it answers a different question than the other two. The
 * category/wallet branches ask "did the user correct what the parser proposed"
 * — a `mark-transfer` teaching has no parser proposal to compare against, only
 * the user's own "yes, pair this" (`confirmOneSidedTransfer`, below), so its
 * caller always passes `patch: {}` and lets this branch fire unconditionally.
 * The matcher reuses exactly the two facts the other branches already read off
 * the item — `providerKeyFor` (the wallet-correction branch's provider lookup)
 * and the item's own `merchant` field (the category branch's merchant, read
 * the same defensive way as everything else in this file) — so a second
 * matcher-building path never has to exist.
 */
async function teachFrom(
  item: ReviewQueueItem,
  patch: CorrectionPatch,
  committed: NewTransaction,
  now: EpochMs,
  transfer?: { counterpartWalletId: string },
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

  if (transfer !== undefined) {
    const providerKey = await providerKeyFor(item);
    const merchantHint = readString(item.payload, "merchant");
    // NO RULE THAT IDENTIFIES NOTHING. `rule_matcher.ts`'s `matcherApplies`
    // treats an entirely empty matcher as a catch-all that matches every event
    // — harmless for a bad `set-category` guess on one field, but a catch-all
    // `mark-transfer` rule is a different kind of wrong: `ruleWalletFor` would
    // hand back this wallet for every future one-sided event from ANY
    // provider, so one confirmation the user glanced at becomes a standing
    // global rule that mints ledger rows on an unrelated wallet. Mirrors the
    // wallet-correction branch above, which skips for the identical reason
    // when `providerKey` alone is unknown.
    if (providerKey !== null || merchantHint !== null) {
      const matcher: UserRuleMatcher = {
        ...(providerKey !== null ? { providerKey } : {}),
        ...(merchantHint !== null ? { merchantPattern: merchantHint } : {}),
      };
      await createUserRule(
        {
          matcher,
          action: { kind: "mark-transfer", counterpartWalletId: transfer.counterpartWalletId },
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
 *
 * A CARD WHOSE MOVEMENT IS ALREADY IN THE LEDGER COMMITS NOTHING (GAP-012) and
 * returns the id of the row that already holds it, so the caller still gets "the
 * transaction this card became". The item is resolved either way: the question
 * it asked has an answer now, and leaving it open would put it straight back in
 * front of the user. Nothing is deleted on this branch, so the merge's
 * capture-marker rule is not in play — the card itself keeps referencing its
 * capture, and the ingest sweep sees a settled row.
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

    // `null` on the ordinary path, so this reads as "the row this card became".
    // A correction still TEACHES on either branch: the user's statement about
    // what notifications like this mean is true whether or not this particular
    // telling needed a row of its own.
    const alreadyCommitted = await committedTwinOf(item, proposal);
    const committed = alreadyCommitted ?? (await insertTransaction(proposal)).id;

    await teachFrom(item, patch, proposal, now);
    await resolve(itemId, "confirmed");
    return committed;
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

    // EITHER LEG, not just the out one, and the in-leg half is the whole point.
    // This card can sit in the queue for days while the ledger moves underneath
    // it: the counterpart it names gets linked to something else from the
    // transaction detail screen, and confirming afterwards used to re-stamp
    // that leg onto a brand-new link and leave the old one `active` with its
    // surviving partner orphaned — a settled transfer re-entering the user's
    // spend total for no reason they can see (domain §3.3 invariant 3).
    //
    // RESOLVED, NOT THROWN. `linkTransfer` now refuses the write outright, so
    // reaching it would leave the user tapping a button that fails forever on a
    // card whose question the ledger has already answered. The pairing they
    // asked for exists or has been superseded; either way there is nothing left
    // here to decide.
    const existing = outLeg.transferLinkId ?? inLeg.transferLinkId;
    if (existing !== null) {
      await resolve(itemId, "confirmed");
      return existing;
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
 * it has nothing to stamp. Spec rule 12's table lists a pairing rule for "It's
 * a transfer", and it is STILL not written HERE — not because the mechanism
 * can't express it any more (it can now: `mark-transfer`'s action carries
 * `counterpartWalletId`, and `transfer_detector.ts`'s `ruleWalletFor` reads it
 * — see `confirmOneSidedTransfer` below, which is the action that actually
 * writes it) — but because this card is never the situation the rule is FOR.
 * Every counterpart `confirmAsTransfer` links is an ALREADY-COMMITTED
 * transaction: both legs posted their own notification, which is exactly why
 * the pair reached `ambiguous-transfer` (a fee delta, a wide window, a rival
 * candidate) instead of `one-sided-transfer` in the first place. A
 * `mark-transfer` rule exists to prefill the NEXT notification for a side that
 * never posts one; there is no such gap here, and writing one would fire on
 * ordinary two-notification transfers this card was never asked about.
 *
 * `null` MEANS NOTHING WAS COMMITTED: a second tap on an item that is already
 * resolved, or a counterpart the ledger has paired with someone else since the
 * card was raised. Both are answered questions; see the guard inside.
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

    // THE COUNTERPART WAS TAKEN WHILE THIS CARD WAITED, so there is no pairing
    // left to make. Committing the candidate anyway and calling `linkTransfer`
    // used to re-stamp the counterpart onto a new link and strand whatever it
    // was already paired with, which puts a transfer the user had already
    // settled back into their spend total (domain §3.3 invariant 3).
    //
    // NOTHING IS COMMITTED, which is the deliberate half of this. The candidate
    // leg has no ledger row yet — the gate queued it rather than committing it
    // — so writing it now would be committing an internal movement as a plain
    // expense on the one card where the user has just said it is not one, and
    // the card would still be unanswerable. Resolving with no row is the same
    // outcome "Not a transaction" already produces, and it is reversible by
    // hand; a wrong total is not.
    //
    // The capture keeps its reference through this resolved card, so the ingest
    // recovery sweep does not read it as unfinished work and re-run the stages
    // over it (`listUnprocessedRawCaptures` counts resolved items too).
    if (counterpart.transferLinkId !== null) {
      await resolve(itemId, "confirmed");
      return null;
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
 * AND IT LEAVES A MARKER ON THE DROPPED CAPTURE, which is not bookkeeping —
 * without it this action undoes itself on the next launch. `startIngest`'s
 * recovery sweep (`listUnprocessedRawCaptures`) re-runs every stored capture
 * that points at neither a Transaction nor a queue card, and a capture that
 * AUTO-COMMITTED never raised a card, so deleting its row here leaves it
 * pointing at nothing and the sweep commits it again — the very duplicate the
 * user merged away, back under an id they have never seen. `markCaptureMerged`
 * is what stops that; see its own note for why the marker is a resolved card
 * rather than a column.
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
    const dropped = await getTransaction(dropTransactionId);
    if (dropped !== null) {
      await deleteTransaction(dropTransactionId);
      await markCaptureMerged(dropped, keepTransactionId);
    }
    await resolve(itemId, "confirmed");
  });
}

/**
 * Records that the dropped row's capture was answered, so the ingest pipeline
 * stops treating it as work it never finished.
 *
 * A RESOLVED CARD, BECAUSE IT IS THE ONLY DURABLE MARKER THAT NEEDS NO
 * MIGRATION — and because it is the truthful one. `review_queue_items` is
 * already the record of "this capture raised a question and the question is
 * closed"; the only unusual thing here is that the user answered it from the
 * ledger rather than from the card. It is resolved in the same unit of work
 * that creates it, so it is never open, never counted by `countOpen`, never
 * listed by `listOpen`, and never shown to anyone — and `purgeExpired` deletes
 * only UNRESOLVED rows, so it outlives the capture it protects.
 *
 * ONLY WHEN NOTHING ELSE POINTS AT THE CAPTURE. A card raised for this capture
 * already says everything this marker would say, and a second row claiming the
 * user was asked twice would be a lie about their triage history.
 * `isRawCaptureUnreferenced` is the sweep's own predicate, asked here about the
 * one id, so the marker is written exactly when its absence would cost a row.
 *
 * A MANUAL OR IMPORTED ROW HAS NO CAPTURE and needs no marker: nothing stored
 * it, so no sweep can find it.
 */
async function markCaptureMerged(dropped: Transaction, keepTransactionId: string): Promise<void> {
  const captureId = dropped.rawNotificationId;
  if (captureId === null) return;
  if (!(await isRawCaptureUnreferenced(captureId))) return;

  const marker = await enqueue({
    kind: "possible-duplicate",
    rawNotificationId: captureId,
    payload: {
      amount: dropped.amount,
      direction: dropped.direction,
      merchant: dropped.merchant,
      walletId: dropped.walletId,
      duplicateOfTransactionId: keepTransactionId,
    },
  });
  await resolve(marker.id, "confirmed");
}

/**
 * "Yes, this was a transfer — the other half was here." Closes a
 * `one-sided-transfer` card: the account that never posts a notification (a
 * bank-funded cash-in, an ATM withdrawal into cash) gets its leg minted
 * opposite the one that DID get captured.
 *
 * ONE WRITE. Every route into `one-sided-transfer` queues rather than commits
 * (same reason `confirmAsTransfer` above gives for `ambiguous-transfer`: this
 * verdict is never `auto_commit`), so the captured leg still has no row of its
 * own when this runs. `attachCounterpartLeg` (lib/transfers/transfer_service.ts)
 * commits that leg, mints the counterpart on `counterpartWalletId`, adds the
 * optional fee row on whichever leg is the SOURCE, and links the pair — all
 * inside this same unit of work, alongside the taught rule and the resolved
 * item. A partial success here is not a cosmetic gap: it either leaves an
 * internal movement counted as real money (a committed, unlinked leg), or puts
 * a card the user already answered back in front of them (a resolved item with
 * no rows behind it).
 *
 * TAKES A CLOCK, unlike `confirmAsTransfer`: this action writes a UserRule and
 * therefore has something to stamp, where `confirmAsTransfer` writes none (see
 * its own comment above for why that card can't teach the same way).
 *
 * THE RULE IS WRITTEN ON CONFIRM ONLY. "Not a transfer" teaches nothing — that
 * is a statement about the one notification in front of the user, not a
 * prediction about the next one — but it does NOT discard the money either. It
 * routes to `confirmItem` (`app/review/index.tsx`'s `secondaryActionFor`
 * returns `{ kind: "confirm" }`), which commits the captured leg UNPAIRED, per
 * spec §5.5 and exactly as `ambiguous-transfer`'s own secondary does: the
 * movement was parsed and the money really left the account, so declining "was
 * this half of a transfer?" makes it an ordinary transaction, not a
 * non-event.
 *
 * WHICH IS WHY A FALSE-POSITIVE PROPOSAL IS CHEAP, and worth stating here
 * rather than leaving to be inferred: the wrong answer to this card costs the
 * user a tap, not a row. Were the leg discarded instead, every over-eager
 * one-sided proposal would be a chance to lose real spend, and the detector
 * would have to be tuned far more conservatively than it is.
 */
export async function confirmOneSidedTransfer(
  itemId: string,
  counterpartWalletId: string,
  feeAmount: Centavos,
  now: EpochMs,
): Promise<string | null> {
  return withUnitOfWork(async () => {
    const item = await openItem(itemId);
    if (item === null) return null;

    const proposal = proposalFrom(item, {}, await occurredAtFor(item));
    const result = await attachCounterpartLeg(
      { captured: { proposal }, counterpartWalletId, feeAmount },
      now,
    );

    // The CAPTURED leg's id, not the minted one — `attachCounterpartLeg`
    // orients `outLegId`/`inLegId` off the two rows' own directions, and the
    // proposal's direction says which one is the row this card was about.
    const committedId = proposal.direction === "out" ? result.outLegId : result.inLegId;

    await teachFrom(item, {}, proposal, now, { counterpartWalletId });
    await resolve(itemId, "confirmed");
    return committedId;
  });
}

/**
 * The user answers the one question inference could not settle: is this
 * balance money you have, or money you owe?
 *
 * EITHER ANSWER PINS, and that is the whole point. "Money I have" is not a
 * dismissal — it is the user confirming the assumption the app has been running
 * on, and a wallet whose owner has confirmed it must not be flipped later by a
 * run of odd notifications. This is the only card where the secondary action is
 * as final as the primary.
 *
 * NO LEDGER WRITE AND NO `teachFrom`. Every other resolve action here commits,
 * links or merges a transaction, and teaches a UserRule from what the user
 * chose. This one changes a property of a WALLET: there is no row to write, no
 * capture to learn a pattern from, and nothing about the next notification that
 * this answer should silently decide.
 */
export async function answerWalletKind(itemId: string, owed: boolean): Promise<void> {
  const item = await openItem(itemId);
  if (item === null) return;

  const walletId = item.payload.walletId;
  if (typeof walletId !== "string" || walletId === "") {
    throw new IncompleteReviewItemError(itemId, "walletId");
  }

  await setWalletOwed(walletId, owed, { pinned: true });
  await resolve(itemId, "confirmed");
}

/**
 * How long the undo affordance stays on screen — spec rule 9's ten seconds,
 * exactly: "a just-triaged item shows an undo affordance for 10 seconds".
 *
 * It is the toast's `durationMs` in app/review/index.tsx and nothing else. The
 * window the DATA layer enforces is `UNDO_MAX_AGE_MS` below, and the two are
 * deliberately different numbers.
 */
export const UNDO_WINDOW_MS = 10_000;

/**
 * The oldest resolution `undoResolution` will reverse.
 *
 * NOT ten seconds, and the gap is the whole point. The affordance above is a
 * `setTimeout` inside a mounted component: Android freezes JS timers on a
 * backgrounded app, so a user who leaves at second three and returns at minute
 * five can come back to an Undo button that should have vanished. Rule 9's ten
 * seconds is a promise about what is OFFERED; this is the backstop on what is
 * ACCEPTED, and a card reopened five minutes after its triage is a card whose
 * queue has moved on without it.
 *
 * It is loose enough that no honest tap on a live affordance can fall outside
 * it — the mutation that stamped `resolved_at` had already returned before the
 * toast was published, so the ten seconds the user sees always begins after the
 * clock this bound measures, and a slow write must never turn a legitimate undo
 * into a silent no-op. Tightening it to exactly `UNDO_WINDOW_MS` would do
 * precisely that.
 *
 * It is also what keeps `markCaptureMerged`'s markers buried. Those rows are
 * enqueued and resolved inside one unit of work and their ids are never handed
 * to a caller, so they are unreachable from the UI in the first place; a bound
 * on age means that even a caller that somehow got hold of one could only
 * disturb it in the minute after a merge, rather than forever.
 */
export const UNDO_MAX_AGE_MS = 60_000;

/**
 * Spec rule 9's undo: put a just-triaged card back in front of the user.
 *
 * Returns whether the item was actually reopened. `false` is a refusal, not a
 * failure — see the four guards below — and the caller renders nothing new for
 * it: the card simply does not come back, which is what the user already sees.
 *
 * WHAT IT REVERSES, AND WHY THAT IS THE WHOLE LIST. It reverses a triage that
 * wrote nothing but `resolved_at`: "Not money" on an unknown provider, the
 * reject on a low-confidence card, "Same transaction" on a duplicate whose twin
 * was never committed, and "Not a loan payment". For those the resolution IS the
 * entire write, so clearing it is a complete reversal with nothing left over.
 *
 * IT DOES NOT REVERSE A TRIAGE THAT COMMITTED, and that is a reading of the
 * spec rather than a shortcut. Rule 10 of the same document is unqualified:
 * "committed transactions are never deleted by any queue action" — and an undo
 * rendered by the queue screen, dispatched through the queue's own mutation, is
 * a queue action. Rule 9's own second clause says what happens to a confirmation
 * instead: "committed results remain editable in the ledger indefinitely
 * afterward". So the document never contemplates the queue deleting a row it
 * committed; it contemplates the row being edited afterwards.
 *
 * AND THE CODE AGREES, in a way that matters more than the reading. `correctItem`
 * has a branch (GAP-012) where the movement was ALREADY in the ledger from the
 * other channel: it commits nothing, resolves the card, and returns the id of a
 * row it did not create. An undo built from "delete the transaction the confirm
 * returned" would delete that pre-existing row — a real transaction, from a real
 * notification, that this triage never wrote. `confirmOneSidedTransfer` mints a
 * counterpart leg, an optional fee row and a link; `mergeDuplicate` deletes a
 * row and writes a capture marker; `confirmLoanMatch` writes a `loan_payments`
 * row under a UNIQUE constraint. Each needs its own reversal with its own
 * proof, not one shared delete.
 *
 * THE FOUR GUARDS, in order, and each one closes a way this could go wrong:
 *
 *   NO ITEM, OR NOTHING TO UNDO. An unknown id, or one already open — the
 *   second tap on an offer that has been taken. Silent, exactly as `resolve`
 *   is on the same double tap.
 *
 *   TOO OLD. `UNDO_MAX_AGE_MS` above.
 *
 *   ALREADY EXPIRED. Reopening a card past its `expires_at` would hand
 *   `purgeExpired` a row the user just asked to see again, and `listOpen` would
 *   not show it in the meantime — an undo that appears to do nothing. The
 *   hygiene clock is not restarted (see `reopen`), so the honest answer is that
 *   this card's thirty days ran out while the offer was on screen.
 *
 *   THE TRIAGE COMMITTED. Asked of the ledger rather than of the action kind,
 *   so it holds however this function is called later: if any Transaction was
 *   built from this card's capture, reopening it puts a card back for a movement
 *   the ledger already holds, and confirming it again is how one purchase
 *   becomes two rows. A `loan-match` card carries no `rawNotificationId` at all
 *   (`loan_match_queue.ts` explains why) and passes this guard, which is right:
 *   its transaction was committed long before the card existed and "Not a loan
 *   payment" did not touch it.
 *
 * ONE UNIT OF WORK, though it issues a single UPDATE. The guards read state the
 * decision depends on, and a triage landing between the ledger check and the
 * reopen would let a card come back for a row that was committed in between.
 *
 * NOT DURABLE, DELIBERATELY. The offer lives in the toast queue in memory
 * (lib/query_client.ts), so it is gone after a kill or a reload — the ten
 * seconds is an affordance, not a promise the app makes across launches. The
 * only durable trace is the untouched `resolved_at`, which is the correct
 * resting state for a triage the user did not take back.
 */
export async function undoResolution(itemId: string, now: EpochMs = Date.now()): Promise<boolean> {
  return withUnitOfWork(async () => {
    const item = await getReviewItem(itemId);
    if (item === null || item.resolvedAt === null) return false;
    if (now - item.resolvedAt > UNDO_MAX_AGE_MS) return false;
    // `listOpen`'s own predicate, negated: `expires_at > ?` is false for a past
    // stamp AND for a NULL, so neither would come back to the list anyway.
    // Reopening either is an undo the user watches do nothing.
    if (item.expiresAt === null || item.expiresAt <= now) return false;
    if (
      item.rawNotificationId !== null &&
      (await hasTransactionForRawCapture(item.rawNotificationId))
    ) {
      return false;
    }

    return reopen(itemId);
  });
}
