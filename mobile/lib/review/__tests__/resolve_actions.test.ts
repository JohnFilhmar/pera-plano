// lib/review/__tests__/resolve_actions.test.ts — m1c plan Task 10, against a
// REAL database.
//
// THESE ARE THE WRITES THE WHOLE REVIEW QUEUE EXISTS TO PERFORM, and every one
// of them touches money. Three properties are asserted over and over because
// each has a distinct, silent failure mode:
//
//   THE ITEM AND ITS CONSEQUENCE MOVE TOGETHER. A committed Transaction with an
//   unresolved queue item means the card comes back, the user confirms it again,
//   and their ledger now holds the same purchase twice. Every action here is
//   asserted on BOTH halves, never just the interesting one.
//
//   `createRule: false` CREATES NOTHING. A user who unchecked the box has made a
//   specific statement about every future row from that merchant. Making the
//   rule anyway silently recategorizes transactions they never looked at, and
//   they find out weeks later from a report.
//
//   A FAILURE LEAVES NOTHING BEHIND. The forced-throw test is the only one that
//   can catch a partial write, and it asserts all three surfaces — the ledger,
//   the rules and the queue item — because "atomic" that only covers two of them
//   is the shape of a bug nobody notices until reconciliation.
//
// `resolve` is partially mocked at the module boundary so exactly one test can
// make the LAST step of an action fail. Everything else in the module stays
// real: these tests exist to prove the actions against SQLite, not against a
// stub of it.
jest.mock("@/lib/db/repos/review_queue_repo", () => {
  const actual = jest.requireActual("@/lib/db/repos/review_queue_repo");
  return {
    ...actual,
    resolve: jest.fn((...args: unknown[]) =>
      (actual.resolve as (...a: unknown[]) => Promise<void>)(...args),
    ),
  };
});

import { closeDatabase, getDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { isRawCaptureUnreferenced, storeRawCapture } from "@/lib/db/repos/raw_notifications_repo";
import {
  countOpen,
  enqueue,
  getReviewItem,
  listOpen,
  resolve,
} from "@/lib/db/repos/review_queue_repo";
import {
  getTransaction,
  insertTransaction,
  listTransactions,
  sumSpend,
} from "@/lib/db/repos/transactions_repo";
import { getTransferLink, linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { listUserRules } from "@/lib/db/repos/user_rules_repo";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { freshDb } from "@/test_support/db";
import type { RulesetBundleInput } from "@/lib/ingest/ruleset_types";
import type { RawCapture, ReviewKind, ReviewQueueItem } from "@/types/domain";

import {
  confirmAsTransfer,
  confirmItem,
  confirmOneSidedTransfer,
  correctItem,
  ignoreProvider,
  mergeDuplicate,
  linkAsTransfer,
} from "../resolve_actions";

const FOOD = "cat_food_dining";
const TRANSPORT = "cat_transport";
const GCASH_PACKAGE = "com.globe.gcash.android";

const POSTED_AT = Date.UTC(2026, 7, 10, 3, 20, 0);
const NOW = Date.UTC(2026, 7, 12, 9, 0, 0);

let gcashId: string;
let bpiId: string;

async function storeCapture(id: string, patch: Partial<RawCapture> = {}): Promise<RawCapture> {
  const capture: RawCapture = {
    id,
    packageName: GCASH_PACKAGE,
    title: "GCash",
    text: "You sent PHP 1,250.00 to 7-ELEVEN",
    subText: null,
    bigText: null,
    postedAt: POSTED_AT,
    capturedAt: POSTED_AT + 500,
    ...patch,
  };
  await storeRawCapture(capture, POSTED_AT);
  return capture;
}

/** A queued low-confidence parse, exactly as `pipeline.ts` writes one. */
async function queueParse(
  overrides: Record<string, unknown> = {},
  kind: ReviewKind = "low-confidence",
  captureId = "raw-1",
): Promise<ReviewQueueItem> {
  await storeCapture(captureId);
  return enqueue({
    kind,
    rawNotificationId: captureId,
    payload: {
      amount: 125000,
      direction: "out",
      merchant: "7-ELEVEN",
      walletId: gcashId,
      categoryId: FOOD,
      confidence: 0.72,
      reason: "PeraPlano could not read this one confidently.",
      ...overrides,
    },
  });
}

/** Every `transfer_links` row, dissolved ones included — a refused pairing must leave none. */
async function countTransferLinkRows(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM transfer_links",
  );
  return row?.count ?? 0;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await freshDb();
  await seedDefaultCategories();
  gcashId = (await createWallet({ name: "GCash", openingBalance: 100000 })).id;
  bpiId = (await createWallet({ name: "BPI", openingBalance: 500000 })).id;
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// confirmItem — "Looks right"
// ---------------------------------------------------------------------------

describe("confirmItem commits the proposal and closes the item", () => {
  test("does both halves, not one", async () => {
    const item = await queueParse();

    const transactionId = await confirmItem(item.id, NOW);

    // BOTH assertions, and neither is redundant. A commit without a resolve
    // leaves the card on screen for the user to confirm a second time; a resolve
    // without a commit silently drops money out of the ledger.
    expect(await getTransaction(transactionId as string)).not.toBeNull();
    expect(await listOpen()).toHaveLength(0);
  });

  test("commits exactly the prefilled values, as a notification", async () => {
    const item = await queueParse();

    const committed = await getTransaction((await confirmItem(item.id, NOW)) as string);

    expect(committed).toMatchObject({
      walletId: gcashId,
      categoryId: FOOD,
      amount: 125000,
      direction: "out",
      merchant: "7-ELEVEN",
      // Rule 3: confirmation must not quietly alter what the user approved.
      source: "notification",
      // Spec rule 8: a human decision outranks the parser's 0.72.
      confidence: 1,
      // Rule 8 again — "why did the app record this?" still answers afterwards.
      rawNotificationId: "raw-1",
    });
  });

  test("dates the row from the notification, not from the tap", async () => {
    const item = await queueParse();

    const committed = await getTransaction((await confirmItem(item.id, NOW)) as string);

    // `occurredAt` is `capture.postedAt` (spec §10) — the same source
    // `parser.ts` uses on the auto-commit path. Stamping the confirmation time
    // instead would file a notification the user triaged two days later under
    // today, moving money between days in every report and day-group header.
    expect(committed?.occurredAt).toBe(POSTED_AT);
  });

  test("moves the wallet balance", async () => {
    const item = await queueParse();

    await confirmItem(item.id, NOW);

    expect((await getWallet(gcashId))?.balance).toBe(100000 - 125000);
  });

  test("creates no rule — a plain confirmation teaches nothing", async () => {
    const item = await queueParse();

    await confirmItem(item.id, NOW);

    // Spec rule 13: only a CORRECTION creates a rule. A rule built from an
    // unchanged confirmation would restate what the parser already got right.
    expect(await listUserRules()).toHaveLength(0);
  });

  test("a second tap commits nothing more", async () => {
    const item = await queueParse();

    const first = await confirmItem(item.id, NOW);
    const second = await confirmItem(item.id, NOW);

    // Rule 5's double-tap safety, inherited from `review_queue_repo.resolve`'s
    // early return rather than reimplemented here.
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await listTransactions({})).toHaveLength(1);
    expect((await getWallet(gcashId))?.balance).toBe(100000 - 125000);
  });

  test("refuses an item with no wallet rather than guessing one", async () => {
    const item = await queueParse({ walletId: null });

    // The gate hard-routes an unresolvable wallet here precisely so a human can
    // supply it. Picking one would be the silent wrong auto-commit the whole
    // queue exists to prevent.
    await expect(confirmItem(item.id, NOW)).rejects.toThrow(/wallet/i);
    expect(await countOpen()).toBe(1);
    expect(await listTransactions({})).toHaveLength(0);
  });

  test("falls back to Uncategorized when the parse produced no category", async () => {
    const item = await queueParse({ categoryId: "" });

    const committed = await getTransaction((await confirmItem(item.id, NOW)) as string);

    expect(committed?.categoryId).toBe(UNCATEGORIZED_ID);
  });

  test("carries the notification's reference number onto the row", async () => {
    const item = await queueParse({ referenceNo: "GC778899" });

    const committed = await getTransaction((await confirmItem(item.id, NOW)) as string);

    // §6 rule 1's strong key, and the only thing that can match this row to a
    // late telling of the same movement. Dropped here (GAP-012), the same
    // purchase's SMS relay outside the 180-second twin window reads as a second,
    // genuine transaction and is committed beside it.
    expect(committed?.referenceNo).toBe("GC778899");
  });

  test("dates the row from the event's own stamp when the payload carries one", async () => {
    const item = await queueParse({ occurredAt: POSTED_AT - 90_000 });

    const committed = await getTransaction((await confirmItem(item.id, NOW)) as string);

    // The stages already worked this out; `capture.postedAt` is the fallback for
    // cards raised before the payload carried it, not the better answer.
    expect(committed?.occurredAt).toBe(POSTED_AT - 90_000);
  });

  test("does not snap the wallet to a balance the notification reported earlier", async () => {
    const item = await queueParse({ balanceAfter: 999_999 });

    await confirmItem(item.id, NOW);

    // The payload carries `balanceAfter` for the audit trail, but the proposal
    // deliberately does not: `insertTransaction` SETS the wallet's balance to a
    // non-null one, and spec rule 9's "only if newer than the current snapshot"
    // guard is not implemented — so a card triaged days later would re-anchor
    // the wallet to a stale figure and discard every movement since.
    expect((await getWallet(gcashId))?.balance).toBe(100000 - 125000);
  });
});

// ---------------------------------------------------------------------------
// The DedupeGate on the CONFIRM path (GAP-012).
//
// `checkDuplicate` runs in the pipeline, over captures. A queue item skipped it
// entirely: whatever the gate decided when the card was raised, the ledger has
// moved since — the twin may have committed on the other channel, or the user
// may have answered the twin's own card first — and confirming regardless is how
// one payment becomes two rows with nothing on screen to explain it.
// ---------------------------------------------------------------------------

describe("confirming a card whose movement is already in the ledger", () => {
  const SMS_PACKAGE = "com.google.android.apps.messaging";
  const REFERENCE = "GC778899";

  /**
   * One provider reachable on two channels — the shape §6 rule 2 is written for,
   * and the minimum this suite needs: without an installed ruleset there is no
   * provider key and no channel for either side, and the confirm path correctly
   * declines to judge at all.
   */
  const TWO_CHANNEL_BUNDLE: RulesetBundleInput = {
    version: 2,
    providers: [
      {
        providerKey: "gcash",
        packageNames: [GCASH_PACKAGE],
        version: 2,
        channel: "push",
        templates: [
          {
            id: "gcash_push_sent",
            match: String.raw`\bsent (?<amount>(?:₱|PHP)\s?[\d,]+(?:\.\d{2})?)`,
            direction: "out",
            confidence: 1,
          },
        ],
      },
      {
        providerKey: "gcash",
        packageNames: [SMS_PACKAGE],
        version: 2,
        channel: "sms",
        senderIds: ["GCASH"],
        templates: [
          {
            id: "gcash_sms_sent",
            match: String.raw`\bsent (?<amount>(?:₱|PHP)\s?[\d,]+(?:\.\d{2})?)`,
            direction: "out",
            confidence: 1,
          },
        ],
      },
    ],
  };

  /** The relay that already reached the ledger, on the other channel. */
  async function commitSmsTwin(referenceNo: string | null): Promise<string> {
    await storeCapture("raw-sms", { packageName: SMS_PACKAGE, title: "GCASH" });
    const row = await insertTransaction({
      walletId: gcashId,
      categoryId: FOOD,
      amount: 125000,
      direction: "out",
      occurredAt: POSTED_AT + 30_000,
      referenceNo,
      source: "notification",
      confidence: 0.95,
      rawNotificationId: "raw-sms",
    });
    return row.id;
  }

  beforeEach(async () => {
    await upsertRuleset(TWO_CHANNEL_BUNDLE);
  });

  test("commits nothing, closes the card, and names the row that already holds it", async () => {
    const committed = await commitSmsTwin(REFERENCE);
    const item = await queueParse({
      providerKey: "gcash",
      channel: "push",
      referenceNo: REFERENCE,
      occurredAt: POSTED_AT,
    });

    const returned = await confirmItem(item.id, NOW);

    // One row, and it is the one that was already there — not a second row and
    // not a card left open for the user to try again.
    expect(await listTransactions({})).toHaveLength(1);
    expect(returned).toBe(committed);
    expect((await getReviewItem(item.id))?.resolvedAt).not.toBeNull();
    // The card keeps referencing its capture, so the ingest sweep sees a settled
    // row: nothing was deleted here, so the merge's marker rule is not in play.
    expect(await isRawCaptureUnreferenced("raw-1")).toBe(false);
  });

  test("references that disagree are two transactions, and both are recorded", async () => {
    await commitSmsTwin("GC000111");
    const item = await queueParse({
      providerKey: "gcash",
      channel: "push",
      referenceNo: REFERENCE,
      occurredAt: POSTED_AT,
    });

    await confirmItem(item.id, NOW);

    // The provider's own statement that these are not the same thing. Folding
    // them would delete a real transaction the user just vouched for.
    expect(await listTransactions({})).toHaveLength(2);
  });

  test("a same-channel pair the user called real is still committed", async () => {
    // §6 rule 4's undecidable pair, with no reference either way: pressing
    // "Looks right" IS the answer to "are these two purchases or one?", and
    // refusing it here would overrule the human decision the card asked for.
    await commitSmsTwin(null);
    const item = await queueParse({
      providerKey: "gcash",
      channel: "sms",
      occurredAt: POSTED_AT,
    });

    await confirmItem(item.id, NOW);

    expect(await listTransactions({})).toHaveLength(2);
  });

  test("a card raised before the payload carried a provider falls back to the capture", async () => {
    const committed = await commitSmsTwin(REFERENCE);
    // No `providerKey` and no `channel` — every card enqueued before GAP-012
    // looks like this. The capture's package resolved through the installed
    // ruleset is what stands in for them.
    const item = await queueParse({ referenceNo: REFERENCE, occurredAt: POSTED_AT });

    expect(await confirmItem(item.id, NOW)).toBe(committed);
    expect(await listTransactions({})).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// correctItem — the two-tap correction, and the rule it teaches
// ---------------------------------------------------------------------------

describe("correctItem commits the fix and teaches the pipeline", () => {
  test("a changed category creates a set-category rule on the merchant", async () => {
    const item = await queueParse();

    const transactionId = await correctItem(item.id, { categoryId: TRANSPORT }, NOW);

    expect((await getTransaction(transactionId as string))?.categoryId).toBe(TRANSPORT);

    const rules = await listUserRules();
    expect(rules).toHaveLength(1);
    // The SHIPPED model: matcher + action. There is no `merchant_category` kind
    // anywhere in this codebase, and `merchantPattern` is a case-insensitive
    // substring — never a regex — so a merchant containing "(" cannot throw
    // mid-pipeline later.
    expect(rules[0].matcher).toEqual({ merchantPattern: "7-ELEVEN" });
    expect(rules[0].action).toEqual({ kind: "set-category", categoryId: TRANSPORT });
    // Invariant I15: every rule is traceable to the correction that made it.
    expect(rules[0].createdFrom).toBe(item.id);
  });

  test("a changed wallet creates a set-wallet rule on the provider", async () => {
    const item = await queueParse();

    const transactionId = await correctItem(item.id, { walletId: bpiId }, NOW);

    expect((await getTransaction(transactionId as string))?.walletId).toBe(bpiId);

    const rules = await listUserRules("set-wallet");
    expect(rules).toHaveLength(1);
    // The capture's package resolves through the installed ruleset to the
    // provider key the Categorizer compares against; with no ruleset installed
    // it falls back to the package itself, which is what `isDismissedPackage`
    // compares against. Either way the rule names a real source.
    expect(rules[0].matcher).toEqual({ providerKey: GCASH_PACKAGE });
    expect(rules[0].action).toEqual({ kind: "set-wallet", walletId: bpiId });
  });

  test("the corrected row moves the balance of the wallet it was moved TO", async () => {
    const item = await queueParse();

    await correctItem(item.id, { walletId: bpiId }, NOW);

    expect((await getWallet(gcashId))?.balance).toBe(100000);
    expect((await getWallet(bpiId))?.balance).toBe(500000 - 125000);
  });

  test("createRule: false creates nothing at all", async () => {
    const item = await queueParse();

    const transactionId = await correctItem(
      item.id,
      { categoryId: TRANSPORT, walletId: bpiId, createRule: false },
      NOW,
    );

    // The correction still lands on THIS row...
    expect(await getTransaction(transactionId as string)).toMatchObject({
      categoryId: TRANSPORT,
      walletId: bpiId,
    });
    // ...and on nothing else, ever. The user said no.
    expect(await listUserRules()).toEqual([]);
    expect(await listOpen()).toHaveLength(0);
  });

  test("both corrections at once create both rules", async () => {
    const item = await queueParse();

    await correctItem(item.id, { categoryId: TRANSPORT, walletId: bpiId }, NOW);

    const rules = await listUserRules();
    expect(rules.map((rule) => rule.action.kind).sort()).toEqual(["set-category", "set-wallet"]);
  });

  test("offers no category rule when the notification named no merchant", async () => {
    const item = await queueParse({ merchant: null });

    await correctItem(item.id, { categoryId: TRANSPORT }, NOW);

    // `categorizer.ts` makes a blank `merchantPattern` FAIL CLOSED, so a rule
    // built from a missing merchant could never fire — it would sit in the
    // user's settings looking as though it might.
    expect(await listUserRules("set-category")).toEqual([]);
    // The row itself is still corrected and the item still closes.
    expect(await listTransactions({})).toHaveLength(1);
    expect(await listOpen()).toHaveLength(0);
  });

  test("a field re-set to the value it already had is not a correction", async () => {
    const item = await queueParse();

    await correctItem(item.id, { categoryId: FOOD, walletId: gcashId }, NOW);

    // "Always categorize 7-ELEVEN as Food & Dining" when that is what the parser
    // already chose teaches the pipeline nothing and clutters the rules list.
    expect(await listUserRules()).toEqual([]);
  });

  test("fills in what an unknown-provider capture could not parse", async () => {
    const item = await enqueue({
      kind: "unknown-provider",
      rawNotificationId: (await storeCapture("raw-unknown", { packageName: "ph.com.newbank" })).id,
      payload: { amount: null, direction: null, packageName: "ph.com.newbank" },
    });

    const transactionId = await correctItem(
      item.id,
      { amount: 45000, direction: "out", walletId: bpiId, categoryId: TRANSPORT },
      NOW,
    );

    // Spec §"unknown provider" step 3: the Transaction commits with its
    // `rawNotificationRef`, and a source→Wallet rule makes the NEXT capture from
    // this app arrive pre-filled.
    expect(await getTransaction(transactionId as string)).toMatchObject({
      amount: 45000,
      direction: "out",
      walletId: bpiId,
      source: "notification",
      rawNotificationId: "raw-unknown",
    });
    expect((await listUserRules("set-wallet"))[0].matcher).toEqual({
      providerKey: "ph.com.newbank",
    });
  });

  test("a second tap corrects nothing more", async () => {
    const item = await queueParse();

    await correctItem(item.id, { categoryId: TRANSPORT }, NOW);
    const second = await correctItem(item.id, { categoryId: FOOD }, NOW);

    expect(second).toBeNull();
    expect(await listTransactions({})).toHaveLength(1);
    expect(await listUserRules()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ignoreProvider — the mute
// ---------------------------------------------------------------------------

describe("ignoreProvider mutes a source and closes the item", () => {
  test("creates an ignore rule keyed on the package the pipeline checks", async () => {
    const item = await enqueue({
      kind: "unknown-provider",
      rawNotificationId: (await storeCapture("raw-spam", { packageName: "com.games.loud" })).id,
      payload: { amount: null, direction: null, packageName: "com.games.loud" },
    });

    await ignoreProvider(item.id, "com.games.loud", NOW);

    const rules = await listUserRules("ignore");
    expect(rules).toHaveLength(1);
    // `pipeline.ts`'s `isDismissedPackage` compares `matcher.providerKey`
    // against the capture's PACKAGE NAME, so the rule has to carry the package
    // verbatim or the mute silently never fires.
    expect(rules[0].matcher).toEqual({ providerKey: "com.games.loud" });
    expect(rules[0].action).toEqual({ kind: "ignore" });
    expect(await listOpen()).toHaveLength(0);
  });

  test("commits nothing to the ledger", async () => {
    const item = await queueParse({}, "unknown-provider");

    await ignoreProvider(item.id, GCASH_PACKAGE, NOW);

    // Rule 10: dismissing is never destructive, and never creative either.
    expect(await listTransactions({})).toEqual([]);
  });

  test("a second tap creates no second rule", async () => {
    const item = await queueParse({}, "unknown-provider");

    await ignoreProvider(item.id, GCASH_PACKAGE, NOW);
    await ignoreProvider(item.id, GCASH_PACKAGE, NOW);

    expect(await listUserRules()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// linkAsTransfer — "It's a transfer"
// ---------------------------------------------------------------------------

describe("linkAsTransfer pairs two committed legs", () => {
  async function seedLegs(): Promise<{ outId: string; inId: string }> {
    const outLeg = await insertTransaction({
      walletId: gcashId,
      categoryId: UNCATEGORIZED_ID,
      amount: 100000,
      direction: "out",
      occurredAt: POSTED_AT,
      source: "notification",
      confidence: 0.9,
    });
    const inLeg = await insertTransaction({
      walletId: bpiId,
      categoryId: UNCATEGORIZED_ID,
      amount: 99000,
      direction: "in",
      occurredAt: POSTED_AT + 60000,
      source: "notification",
      confidence: 0.9,
    });
    return { outId: outLeg.id, inId: inLeg.id };
  }

  test("creates the link, stamps both legs and closes the item", async () => {
    const item = await queueParse({}, "ambiguous-transfer");
    const { outId, inId } = await seedLegs();

    const linkId = await linkAsTransfer(item.id, outId, inId);

    const link = await getTransferLink(linkId);
    expect(link).toMatchObject({ outTransactionId: outId, inTransactionId: inId, status: "active" });
    // outLeg.amount − inLeg.amount, computed here because only the caller holds
    // both legs (transfer_links_repo's contract).
    expect(link?.feeAmount).toBe(1000);
    expect(await listOpen()).toHaveLength(0);
  });

  test("takes the out-leg out of spend and stamps the in-leg", async () => {
    const item = await queueParse({}, "ambiguous-transfer");
    const { outId, inId } = await seedLegs();
    const window = { from: POSTED_AT - 1000, to: POSTED_AT + 10 * 60 * 1000 };

    expect(await sumSpend(window)).toBe(100000);

    await linkAsTransfer(item.id, outId, inId);

    // Invariant I2: an internal movement is not spending. `sumSpend` filters
    // `direction = 'out'`, so the in-leg could never appear in it — that half is
    // asserted through the stamp the exclusion is actually built on.
    expect(await sumSpend(window)).toBe(0);
    expect((await getTransaction(inId))?.transferLinkId).toBe(await pairedLinkId(outId));
  });

  async function pairedLinkId(transactionId: string): Promise<string | null> {
    return (await getTransaction(transactionId))?.transferLinkId ?? null;
  }

  test("leaves both balances alone — the money really did move", async () => {
    const item = await queueParse({}, "ambiguous-transfer");
    const { outId, inId } = await seedLegs();

    await linkAsTransfer(item.id, outId, inId);

    expect((await getWallet(gcashId))?.balance).toBe(100000 - 100000);
    expect((await getWallet(bpiId))?.balance).toBe(500000 + 99000);
  });

  test("a second tap returns the same link rather than making another", async () => {
    const item = await queueParse({}, "ambiguous-transfer");
    const { outId, inId } = await seedLegs();

    const first = await linkAsTransfer(item.id, outId, inId);
    const second = await linkAsTransfer(item.id, outId, inId);

    expect(second).toBe(first);
    expect((await getTransaction(outId))?.transferLinkId).toBe(first);
  });

  test("refuses a leg that is not in the ledger", async () => {
    const item = await queueParse({}, "ambiguous-transfer");
    const { outId } = await seedLegs();

    await expect(linkAsTransfer(item.id, outId, "ghost")).rejects.toThrow();
    expect(await countOpen()).toBe(1);
  });

  // A card can wait days for an answer, and the ledger moves underneath it. If
  // a leg it names is paired with somebody else in the meantime, confirming
  // used to re-stamp that leg onto a new link and leave the old row `active`
  // with its surviving partner orphaned — a transfer the user already settled
  // walking back into their spend total (GAP-031, domain §3.3 invariant 3).
  test("an IN leg paired elsewhere while the card waited is not stolen back", async () => {
    const item = await queueParse({}, "ambiguous-transfer");
    const { outId, inId } = await seedLegs();
    const rival = await insertTransaction({
      walletId: gcashId,
      categoryId: UNCATEGORIZED_ID,
      amount: 99000,
      direction: "out",
      occurredAt: POSTED_AT + 120000,
      source: "manual",
      confidence: 1,
    });
    const settled = await linkTransfer(rival.id, inId, 0);

    const returned = await linkAsTransfer(item.id, outId, inId);

    // Answered by the ledger, so the card closes rather than failing forever on
    // a pairing that can no longer be made.
    expect(returned).toBe(settled.id);
    expect(await countOpen()).toBe(0);

    // The settled pair is untouched, and there is exactly one of it.
    expect(await countTransferLinkRows()).toBe(1);
    expect((await getTransaction(inId))?.transferLinkId).toBe(settled.id);
    expect((await getTransaction(rival.id))?.transferLinkId).toBe(settled.id);
    // The out leg was never stamped, so it keeps counting — the honest answer
    // when the app could not pair it, and one the user can still fix by hand.
    expect((await getTransaction(outId))?.transferLinkId).toBeNull();
  });
});

describe("confirmAsTransfer commits the queued leg and pairs it in one step", () => {
  test("commits the candidate and links it to its counterpart", async () => {
    const counterpart = await insertTransaction({
      walletId: bpiId,
      categoryId: UNCATEGORIZED_ID,
      amount: 125000,
      direction: "in",
      occurredAt: POSTED_AT + 30000,
      source: "notification",
      confidence: 0.9,
    });
    const item = await queueParse(
      { transferCounterpartTransactionId: counterpart.id },
      "ambiguous-transfer",
    );

    const transactionId = await confirmAsTransfer(item.id);

    // The candidate half of an ambiguous transfer is NOT committed when the gate
    // queues it (pipeline.ts queues instead of committing), so "It's a transfer"
    // has to commit and pair together — a commit that failed to pair would leave
    // a plain expense sitting in the user's spend total.
    const committed = await getTransaction(transactionId as string);
    expect(committed?.transferLinkId).not.toBeNull();
    expect((await getTransaction(counterpart.id))?.transferLinkId).toBe(committed?.transferLinkId);
    expect(await listOpen()).toHaveLength(0);
    expect(
      await sumSpend({ from: POSTED_AT - 1000, to: POSTED_AT + 10 * 60 * 1000 }),
    ).toBe(0);
  });

  test("a counterpart already paired elsewhere closes the card and commits nothing", async () => {
    const counterpart = await insertTransaction({
      walletId: bpiId,
      categoryId: UNCATEGORIZED_ID,
      amount: 125000,
      direction: "in",
      occurredAt: POSTED_AT + 30000,
      source: "notification",
      confidence: 0.9,
    });
    // The counterpart's real other half, linked from the transaction detail
    // screen while this card was still open.
    const rival = await insertTransaction({
      walletId: gcashId,
      categoryId: UNCATEGORIZED_ID,
      amount: 125000,
      direction: "out",
      occurredAt: POSTED_AT + 20000,
      source: "manual",
      confidence: 1,
    });
    const settled = await linkTransfer(rival.id, counterpart.id, 0);
    const item = await queueParse(
      { transferCounterpartTransactionId: counterpart.id },
      "ambiguous-transfer",
    );

    const committedId = await confirmAsTransfer(item.id);

    // GAP-031's acceptance criterion, read literally: one active link row, both
    // of its legs still pointing at it.
    expect(await countTransferLinkRows()).toBe(1);
    expect((await getTransferLink(settled.id))?.status).toBe("active");
    expect((await getTransaction(counterpart.id))?.transferLinkId).toBe(settled.id);
    expect((await getTransaction(rival.id))?.transferLinkId).toBe(settled.id);

    // NOTHING COMMITTED for the candidate. It has no ledger row of its own yet
    // — the gate queued it rather than committing it — so writing one here
    // would put an internal movement into the spend total on the very card
    // where the user said it is not one, and the pairing still could not be
    // made. `null` is how the caller learns that.
    expect(committedId).toBeNull();
    expect(await listTransactions({})).toHaveLength(2);
    expect(await countOpen()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// confirmOneSidedTransfer — "It's a transfer" for a leg that never got a
// counterpart notification
// ---------------------------------------------------------------------------

describe("confirmOneSidedTransfer mints the counterpart and remembers the pair", () => {
  // Every item here carries a stored capture so `occurredAtFor` reads
  // `POSTED_AT` (fixed, before `NOW`) rather than falling back to the item's
  // own `createdAt` — a REAL `Date.now()` read at enqueue time, which
  // `attachCounterpartLeg`'s future-dated guard would reject against the
  // fixed `NOW` this suite pins everything else to.
  test("confirming mints the counterpart, links the pair and teaches a rule", async () => {
    const capture = await storeCapture("raw-transfer-1");
    const item = await enqueue({
      kind: "one-sided-transfer",
      rawNotificationId: capture.id,
      payload: {
        amount: 100_000,
        direction: "in",
        walletId: gcashId,
        counterpartWalletId: null,
        signal: "text",
        providerKey: "gcash",
        merchant: "BPI",
        confidence: 0.9,
      },
    });

    const committedId = await confirmOneSidedTransfer(item.id, bpiId, 0, NOW);

    const rows = await listTransactions({});
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.transferLinkId !== null)).toBe(true);
    expect(rows.find((row) => row.id === committedId)?.walletId).toBe(gcashId);

    const [rule] = await listUserRules();
    expect(rule?.action).toEqual({ kind: "mark-transfer", counterpartWalletId: bpiId });

    expect((await getReviewItem(item.id))?.resolvedAt).not.toBeNull();
  });

  test("a fee lands on the source wallet as its own expense", async () => {
    const capture = await storeCapture("raw-transfer-2");
    const item = await enqueue({
      kind: "one-sided-transfer",
      rawNotificationId: capture.id,
      payload: {
        amount: 98_500,
        direction: "in",
        walletId: gcashId,
        counterpartWalletId: bpiId,
        signal: "rule",
        providerKey: "gcash",
        confidence: 0.9,
      },
    });

    await confirmOneSidedTransfer(item.id, bpiId, 1_500, NOW);

    const rows = await listTransactions({});
    const fee = rows.find((row) => row.categoryId === "cat_fees_charges");
    expect(fee?.walletId).toBe(bpiId);
    expect(fee?.amount).toBe(1_500);
    expect(fee?.transferLinkId).toBeNull();
  });

  test("an already-resolved item is a no-op", async () => {
    const capture = await storeCapture("raw-transfer-3");
    const item = await enqueue({
      kind: "one-sided-transfer",
      rawNotificationId: capture.id,
      payload: { amount: 100_000, direction: "in", walletId: gcashId, confidence: 0.9 },
    });
    await confirmOneSidedTransfer(item.id, bpiId, 0, NOW);

    expect(await confirmOneSidedTransfer(item.id, bpiId, 0, NOW)).toBeNull();
    expect(await listTransactions({})).toHaveLength(2);
  });

  test("writes no rule when the item names neither a provider nor a merchant", async () => {
    // No `rawNotificationId` and no `packageName`/`merchant` in the payload —
    // `providerKeyFor` and the merchant read both come back `null`, so the
    // matcher `teachFrom` would build has nothing in it. `Date.now()` stands in
    // for `NOW` here only because this item has no stored capture to pin
    // `occurredAtFor` to `POSTED_AT` (same reason the other three tests in this
    // block add one) — `enqueue` already ran, so it is safely in the past.
    const item = await enqueue({
      kind: "one-sided-transfer",
      payload: { amount: 100_000, direction: "in", walletId: gcashId, confidence: 0.9 },
    });

    const committedId = await confirmOneSidedTransfer(item.id, bpiId, 0, Date.now());

    expect(committedId).not.toBeNull();
    const rows = await listTransactions({});
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.transferLinkId !== null)).toBe(true);
    expect((await getReviewItem(item.id))?.resolvedAt).not.toBeNull();
    // A matcher that identifies nothing matches EVERY future one-sided event on
    // every provider — a catch-all `mark-transfer` rule, not a taught one.
    expect(await listUserRules()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeDuplicate — "Same transaction"
// ---------------------------------------------------------------------------

describe("mergeDuplicate leaves one row and undoes the double count", () => {
  async function seedTwins(): Promise<{ keep: string; drop: string }> {
    await storeCapture("raw-keep");
    const keep = await insertTransaction({
      walletId: gcashId,
      categoryId: FOOD,
      amount: 30000,
      direction: "out",
      occurredAt: POSTED_AT,
      merchant: "7-ELEVEN",
      source: "notification",
      confidence: 0.9,
      rawNotificationId: "raw-keep",
    });
    const drop = await insertTransaction({
      walletId: gcashId,
      categoryId: FOOD,
      amount: 30000,
      direction: "out",
      occurredAt: POSTED_AT + 4000,
      source: "notification",
      confidence: 0.8,
    });
    return { keep: keep.id, drop: drop.id };
  }

  test("exactly one transaction survives, with its raw reference intact", async () => {
    const item = await queueParse({}, "possible-duplicate");
    const { keep, drop } = await seedTwins();

    await mergeDuplicate(item.id, keep, drop);

    const rows = await listTransactions({});
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(keep);
    // Rule 4: "Why was this recorded?" must still answer after a merge.
    expect(rows[0].rawNotificationId).toBe("raw-keep");
    expect(await listOpen()).toHaveLength(0);
  });

  test("returns the wallet balance to a single transaction's worth", async () => {
    const item = await queueParse({}, "possible-duplicate");
    await seedTwins().then(async ({ keep, drop }) => {
      // Both twins moved the balance when they were written, so the wallet is
      // currently short by twice one purchase — which is the exact thing the
      // user pressed "Same transaction" to fix.
      expect((await getWallet(gcashId))?.balance).toBe(100000 - 30000 - 30000);

      await mergeDuplicate(item.id, keep, drop);

      expect((await getWallet(gcashId))?.balance).toBe(100000 - 30000);
    });
  });

  test("refuses to delete the survivor", async () => {
    const item = await queueParse({}, "possible-duplicate");
    const { keep } = await seedTwins();

    await expect(mergeDuplicate(item.id, keep, keep)).rejects.toThrow();
    expect(await listTransactions({})).toHaveLength(2);
  });

  test("a second tap deletes nothing more", async () => {
    const item = await queueParse({}, "possible-duplicate");
    const { keep, drop } = await seedTwins();

    await mergeDuplicate(item.id, keep, drop);
    await mergeDuplicate(item.id, keep, drop);

    expect(await listTransactions({})).toHaveLength(1);
    expect((await getWallet(gcashId))?.balance).toBe(100000 - 30000);
  });
});

// ---------------------------------------------------------------------------
// The merge has to SURVIVE A RELAUNCH. `startIngest`'s recovery sweep re-runs
// every stored capture that points at neither a Transaction nor a queue card
// (`listUnprocessedRawCaptures`), so a merge that deletes the last row
// referencing a capture hands that capture back to the pipeline, which commits
// the duplicate again under an id the user has never seen. These pin the
// reference the merge leaves behind.
// ---------------------------------------------------------------------------

describe("a merged-away capture is never handed back to the ingest sweep", () => {
  async function countCardsFor(captureId: string): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM review_queue_items WHERE raw_notification_id = ?",
      [captureId],
    );
    return row?.count ?? 0;
  }

  async function seedCapturedTwins(): Promise<{ keep: string; drop: string }> {
    await storeCapture("raw-keep");
    await storeCapture("raw-drop");
    const keep = await insertTransaction({
      walletId: gcashId,
      categoryId: FOOD,
      amount: 30000,
      direction: "out",
      occurredAt: POSTED_AT,
      merchant: "7-ELEVEN",
      source: "notification",
      confidence: 0.9,
      rawNotificationId: "raw-keep",
    });
    const drop = await insertTransaction({
      walletId: gcashId,
      categoryId: FOOD,
      amount: 30000,
      direction: "out",
      occurredAt: POSTED_AT + 4000,
      source: "notification",
      confidence: 0.8,
      rawNotificationId: "raw-drop",
    });
    return { keep: keep.id, drop: drop.id };
  }

  test("the ledger-side merge leaves the dropped capture referenced", async () => {
    const { keep, drop } = await seedCapturedTwins();

    // NO QUEUE ITEM, which is the case the docblock describes and the dangerous
    // one: both rows auto-committed, so neither ever raised a card, and nothing
    // but this action's own marker can tell the sweep the question is settled.
    await mergeDuplicate("no-card-was-ever-raised", keep, drop);

    expect(await listTransactions({})).toHaveLength(1);
    expect(await isRawCaptureUnreferenced("raw-drop")).toBe(false);
    // And the marker is invisible: it is resolved in the same unit of work that
    // creates it, so the user is never asked a question they already answered.
    expect(await countOpen()).toBe(0);
    expect(await listOpen()).toHaveLength(0);
  });

  test("a capture that already carries a card gets no second one", async () => {
    const { keep, drop } = await seedCapturedTwins();
    const item = await enqueue({
      kind: "possible-duplicate",
      rawNotificationId: "raw-drop",
      payload: { duplicateOfTransactionId: keep },
    });

    await mergeDuplicate(item.id, keep, drop);

    // One row, not two. A second marker would claim the user was asked about
    // this capture twice.
    expect(await countCardsFor("raw-drop")).toBe(1);
    expect((await getReviewItem(item.id))?.resolvedAt).not.toBeNull();
    expect(await isRawCaptureUnreferenced("raw-drop")).toBe(false);
  });

  test("a hand-typed row carries no capture, so the merge writes no marker", async () => {
    await storeCapture("raw-keep");
    const keep = await insertTransaction({
      walletId: gcashId,
      categoryId: FOOD,
      amount: 30000,
      direction: "out",
      occurredAt: POSTED_AT,
      merchant: "7-ELEVEN",
      source: "notification",
      confidence: 0.9,
      rawNotificationId: "raw-keep",
    });
    const drop = await insertTransaction({
      walletId: gcashId,
      categoryId: FOOD,
      amount: 30000,
      direction: "out",
      occurredAt: POSTED_AT + 4000,
      source: "manual",
      confidence: 1,
    });

    await mergeDuplicate("no-card-was-ever-raised", keep.id, drop.id);

    // Nothing stored it, so no sweep can find it and there is nothing to mark.
    expect(await countCardsFor("raw-keep")).toBe(0);
    expect(await listTransactions({})).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — atomic, or nothing
// ---------------------------------------------------------------------------

describe("a failure part-way through an action leaves no partial write", () => {
  test("the ledger, the rules and the queue item are all unchanged", async () => {
    const item = await queueParse();
    (resolve as jest.Mock).mockRejectedValueOnce(new Error("db went away"));

    await expect(correctItem(item.id, { categoryId: TRANSPORT }, NOW)).rejects.toThrow(
      "db went away",
    );

    // All THREE surfaces. `resolve` is the LAST step of the action, so a commit
    // and a rule have already been written by the time it throws — if they were
    // not inside the same SQL transaction, both would survive here and the user
    // would meet the same card again with the transaction already in their
    // ledger.
    expect(await listTransactions({})).toEqual([]);
    expect(await listUserRules()).toEqual([]);
    expect(await countOpen()).toBe(1);
    expect((await getWallet(gcashId))?.balance).toBe(100000);
  });

  test("the item stays triageable — a retry still works", async () => {
    const item = await queueParse();
    (resolve as jest.Mock).mockRejectedValueOnce(new Error("db went away"));

    await expect(confirmItem(item.id, NOW)).rejects.toThrow("db went away");
    const transactionId = await confirmItem(item.id, NOW);

    expect(transactionId).not.toBeNull();
    expect(await listTransactions({})).toHaveLength(1);
    expect(await listOpen()).toHaveLength(0);
  });
});
