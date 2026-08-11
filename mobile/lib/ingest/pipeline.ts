// lib/ingest/pipeline.ts — Stage 0 and Stage 9: the orchestrator.
//
// docs/03-ingest-pipeline.md §2. Every other file in this directory is a pure
// function nobody calls; this is the one that calls them, in the fixed order
// route -> parse -> normalize -> dedupe -> transfer -> categorize -> gate ->
// commit-or-queue, and does all the I/O those stages deliberately refuse.
//
// It owns three things none of the pure stages can:
//
//   - THE TWO JOINS. `normalizeEvent` needs wallet matchers and `checkDuplicate`
//     needs each recent transaction's provider and channel, neither of which is
//     on `Transaction`. Both are assembled here (see `recentEventsFor`).
//   - DURABILITY. `drainPendingCaptures()` is destructive: the instant it
//     returns, the native buffer is empty and a JavaScript array is the only
//     copy of up to 500 captures. See `startIngest`.
//   - THE SCORE ARITHMETIC. The categorizer returns a penalty for this file to
//     subtract, which makes this the one place float dust can push a clean
//     auto-commit into the Review Queue. See `applyPenalty`.
import { categorize } from "@/lib/ingest/categorizer";
import { checkDuplicate } from "@/lib/ingest/dedupe_gate";
import { decideRoute } from "@/lib/ingest/confidence_gate";
import { detectTransfer } from "@/lib/ingest/transfer_detector";
import { emitAppEvent } from "@/lib/events/app_events";
import { getActiveRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { getRawCapture, hasRawCapture, storeRawCapture } from "@/lib/db/repos/raw_notifications_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { listMatchers } from "@/lib/db/repos/wallet_matchers_repo";
import { listUserRules } from "@/lib/db/repos/user_rules_repo";
import { listWallets } from "@/lib/db/repos/wallets_repo";
import { normalizeEvent } from "@/lib/ingest/normalizer";
import { parseCapture } from "@/lib/ingest/parser";
import { enqueue } from "@/lib/db/repos/review_queue_repo";
import { routeCapture } from "@/lib/ingest/source_router";
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { addCaptureListener, drainPendingCaptures } from "@/modules/notification_listener";

import type { NormalizedEvent } from "@/lib/ingest/normalizer";
import type { ProviderRuleset, RulesetBundle } from "@/lib/ingest/ruleset_types";
import type { RecentEvent } from "@/lib/ingest/dedupe_gate";
import type { RawCapture, ReviewKind, Transaction, UserRule } from "@/types/domain";

/** Contract §5 — do not reshape. */
export type PipelineOutcome =
  | { kind: "committed"; transactionId: string }
  | { kind: "queued"; reviewItemId: string }
  | { kind: "ignored"; reason: "not_financial" | "duplicate" | "unknown-provider" | "paused" };

/**
 * Ten-thousandths, matching `parser.ts` and `confidence_gate.ts`.
 *
 * The categorizer hands back a penalty for this file to subtract, and doing it
 * in floats is how `0.95 - 0.05` becomes `0.8999999999999999` and a clean
 * auto-commit lands in the Review Queue instead. The gate compares in the same
 * scale defensively, but the subtraction itself happens here, so this is where
 * the dust would be created.
 */
const SCORE_SCALE = 10_000;

function applyPenalty(confidence: number, penalty: number): number {
  const scaled = Math.round(confidence * SCORE_SCALE) - Math.round(penalty * SCORE_SCALE);
  return Math.min(SCORE_SCALE, Math.max(0, scaled)) / SCORE_SCALE;
}

/**
 * How far back to look for duplicates and transfer counterparts.
 *
 * The widest window either stage uses, so one query serves both: dedupe's
 * strong key reaches 48 h and the transfer detector's extended window 24 h.
 * Read from the ruleset rather than hardcoded, because both are remotely
 * tunable and a lookback shorter than the window it feeds would silently stop
 * the rule working at its edges.
 */
function lookbackMs(bundle: RulesetBundle): number {
  return Math.max(bundle.tunables.dedupeStrongWindowMs, bundle.tunables.transferExtendedWindowMs);
}

/**
 * The `RecentEvent` join the DedupeGate cannot do for itself (plan Task 6).
 *
 * `Transaction` carries neither the provider nor the channel, but §6 rule 1
 * needs the first and rule 2 needs the second. Both are recoverable only
 * through the raw notification the transaction came from:
 *
 *   transaction.rawNotificationId -> raw_notifications.package_name -> provider -> channel
 *
 * A row with no notification behind it — a hand-typed entry — gets
 * `providerKey: null` and `channel: null`, and the gate treats nulls as never
 * matching. That is deliberate and load-bearing: someone who typed a ₱100 entry
 * and then received a ₱100 notification may have recorded two genuinely
 * different things, and suppressing the second would lose money data with no
 * trace.
 */
async function recentEventsFor(
  rows: Transaction[],
  providerByPackage: Map<string, ProviderRuleset>,
): Promise<RecentEvent[]> {
  const events: RecentEvent[] = [];

  for (const row of rows) {
    let providerKey: string | null = null;
    let channel: "push" | "sms" | null = null;

    if (row.rawNotificationId !== null) {
      const raw = await getRawCapture(row.rawNotificationId);
      const provider = raw === null ? undefined : providerByPackage.get(raw.packageName);
      if (provider !== undefined) {
        providerKey = provider.providerKey;
        channel = provider.channel;
      }
    }

    events.push({
      transactionId: row.id,
      providerKey,
      channel,
      amount: row.amount,
      direction: row.direction,
      referenceNo: row.referenceNo,
      occurredAt: row.occurredAt,
    });
  }

  return events;
}

function packageIndex(bundle: RulesetBundle): Map<string, ProviderRuleset> {
  const index = new Map<string, ProviderRuleset>();
  for (const provider of bundle.providers) {
    for (const packageName of provider.packageNames) {
      // First provider wins, matching `routeCapture`'s bundle-order rule.
      if (!index.has(packageName)) index.set(packageName, provider);
    }
  }
  return index;
}

/**
 * True when the user has already told us this package is not money.
 *
 * The dismissal is stored as a `UserRule` whose matcher names the package and
 * whose action is `ignore`. This is the other half of plan rule 4: an unknown
 * money-like notification is *queued* so the user can teach us, but once they
 * have said "not money", re-queueing it every time would make the Review Queue
 * useless — which is exactly how users learn to ignore it.
 */
function isDismissedPackage(rules: UserRule[], packageName: string): boolean {
  return rules.some(
    (rule) =>
      rule.isEnabled &&
      rule.action.kind === "ignore" &&
      rule.matcher.providerKey !== undefined &&
      rule.matcher.providerKey.toLowerCase() === packageName.toLowerCase(),
  );
}

async function queue(
  kind: ReviewKind,
  rawNotificationId: string,
  payload: Record<string, unknown>,
): Promise<PipelineOutcome> {
  const item = await enqueue({ kind, rawNotificationId, payload });
  return { kind: "queued", reviewItemId: item.id };
}

/**
 * One capture, end to end.
 *
 * ORDER MATTERS AND IS NOT NEGOTIABLE (plan rule 1, spec §2). Three things
 * happen before any parsing:
 *
 *   1. The pause switch, so a paused app does no work and stores nothing.
 *   2. Routing, so a private chat message is dropped before it can be persisted
 *      (§1 principle 2 — non-financial text never touches the database).
 *   3. The replay check, because `drainPendingCaptures` is at-least-once by
 *      design and the same batch can come back after a crash.
 *
 * Only then is the raw capture stored, and it is stored BEFORE the stages run
 * (rule 2) so that "why was this recorded?" is answerable even when the parse
 * later fails — or throws.
 */
export async function processCapture(
  capture: RawCapture,
  now: number = Date.now(),
): Promise<PipelineOutcome> {
  if ((await getSetting("capture_enabled")) === false) {
    return { kind: "ignored", reason: "paused" };
  }

  const bundle = await getActiveRuleset();
  if (bundle === null) {
    // No ruleset at all: every package is unknown. Falling through would call
    // routeCapture with nothing to match, so say so plainly instead.
    return { kind: "ignored", reason: "not_financial" };
  }

  const routed = routeCapture(capture, bundle);
  if (routed.kind === "not_financial") {
    return { kind: "ignored", reason: "not_financial" };
  }

  const userRules = await listUserRules();
  if (routed.kind === "unknown" && isDismissedPackage(userRules, capture.packageName)) {
    return { kind: "ignored", reason: "unknown-provider" };
  }

  // Rule 11: at-least-once delivery means the identical capture can arrive
  // twice. The id settles it — this is NOT the DedupeGate's job, which compares
  // parsed events and exists to protect two genuine ₱100 purchases minutes
  // apart from being merged.
  if (await hasRawCapture(capture.id)) {
    return { kind: "ignored", reason: "duplicate" };
  }

  await storeRawCapture(capture, now);

  if (routed.kind === "unknown") {
    return queue("unknown-provider", capture.id, {
      amount: null,
      direction: null,
      packageName: capture.packageName,
    });
  }

  return runStages(capture, routed.provider, bundle);
}

/** The seven stages, for a capture already stored and known to be from a real provider. */
async function runStages(
  capture: RawCapture,
  provider: ProviderRuleset,
  bundle: RulesetBundle,
): Promise<PipelineOutcome> {
  const { tunables } = bundle;

  const parsed = parseCapture(capture, [provider], tunables);
  if (parsed === null) {
    // Matched a provider but nothing readable in the text. The user still gets
    // a card, with nothing presented as parsed.
    return queue("low-confidence", capture.id, { amount: null, direction: null, confidence: 0 });
  }

  const [wallets, matchers] = await Promise.all([listWallets(), listMatchers()]);
  const event = normalizeEvent(parsed, provider, wallets, matchers, tunables);

  const since = event.occurredAt - lookbackMs(bundle);
  const recentRows = await listTransactions({ from: since });

  const verdicts = await runVerdicts(event, recentRows, bundle);
  if (verdicts.dedupe.kind === "duplicate") {
    return { kind: "ignored", reason: "duplicate" };
  }

  const history = await listTransactions({});
  const category = categorize(event, await listUserRules(), history);
  const confidence = applyPenalty(event.confidence, category.penalty);

  const decision = decideRoute({
    confidence,
    walletId: event.walletId,
    dedupe: verdicts.dedupe,
    transfer: verdicts.transfer,
    routed: "known",
    // The parser refuses a foreign-currency amount outright, so no ParsedEvent
    // can carry one — nothing here can produce a `true`.
    nonPhpCurrency: false,
    tunables,
  });

  if (decision.route !== "auto_commit") {
    return queue(reviewKindFor(verdicts), capture.id, {
      amount: event.amount,
      direction: event.direction,
      merchant: event.merchant ?? null,
      walletId: event.walletId,
      categoryId: category.categoryId,
      confidence,
      reason: decision.reason,
      // The counterpart the card has to be able to show. A "possible duplicate"
      // or "possible transfer" the user cannot see the other half of is
      // unresolvable — they would be asked to judge a pairing without being
      // shown what it was paired with.
      ...(verdicts.dedupe.kind === "possible-duplicate"
        ? { duplicateOfTransactionId: verdicts.dedupe.ofTransactionId }
        : {}),
      ...(verdicts.transfer.kind === "ambiguous-transfer"
        ? {
            transferCounterpartTransactionId: verdicts.transfer.counterpartTransactionId,
            transferReason: verdicts.transfer.reason,
          }
        : {}),
    });
  }

  return commit(capture, event, category.categoryId, confidence, verdicts, recentRows);
}

type Verdicts = {
  dedupe: ReturnType<typeof checkDuplicate>;
  transfer: ReturnType<typeof detectTransfer>;
};

async function runVerdicts(
  event: NormalizedEvent,
  recentRows: Transaction[],
  bundle: RulesetBundle,
): Promise<Verdicts> {
  const recent = await recentEventsFor(recentRows, packageIndex(bundle));
  return {
    dedupe: checkDuplicate(event, recent, bundle.tunables),
    // NOT pre-filtered by direction. Rule 4's "no competing candidate for
    // either leg" needs the rows moving the SAME way as the event, and
    // filtering them out silently disables the guard whose whole job is
    // preventing a false link that hides real spend and real income at once.
    transfer: detectTransfer(event, recentRows, bundle.tunables),
  };
}

/** Which card the Review Queue shows. `ReviewKind` has no "needs-details" member. */
function reviewKindFor(verdicts: Verdicts): ReviewKind {
  if (verdicts.dedupe.kind === "possible-duplicate") return "possible-duplicate";
  if (verdicts.transfer.kind === "ambiguous-transfer") return "ambiguous-transfer";
  // Both `review_prefilled` and `review_needs_details` land here. `ReviewKind`
  // has no "needs-details" member, and adding one would duplicate information
  // the payload already carries: the card decides how much to prefill from the
  // confidence it was given, not from a second enum that could disagree with it.
  return "low-confidence";
}

async function commit(
  capture: RawCapture,
  event: NormalizedEvent,
  categoryId: string,
  confidence: number,
  verdicts: Verdicts,
  recentRows: Transaction[],
): Promise<PipelineOutcome> {
  const row = await insertTransaction({
    // `auto_commit` requires a resolved wallet, so this cannot be null here —
    // `walletId === null` is one of the gate's hard routes.
    walletId: event.walletId as string,
    categoryId: categoryId === "" ? UNCATEGORIZED_ID : categoryId,
    amount: event.amount,
    direction: event.direction,
    occurredAt: event.occurredAt,
    merchant: event.merchant ?? null,
    counterparty: event.counterparty ?? null,
    referenceNo: event.referenceNo ?? null,
    source: "notification",
    confidence,
    rawNotificationId: capture.id,
  });

  if (verdicts.transfer.kind === "auto_link") {
    await linkAutoDetected(row, verdicts.transfer.counterpartTransactionId, recentRows, confidence);
  }

  // Rule 7. After the row exists, carrying the id that was actually written —
  // M2's limit engine recomputes off this.
  emitAppEvent("ledger:committed", { transactionId: row.id });

  return { kind: "committed", transactionId: row.id };
}

/**
 * Pairs the freshly committed leg with its counterpart.
 *
 * `feeAmount` is `out − in`, which the repository stores verbatim because only
 * the caller holds both legs. It is informational only: nothing in the app adds
 * it to a spend total (contract §3, domain §3.3).
 */
async function linkAutoDetected(
  committed: Transaction,
  counterpartId: string,
  recentRows: Transaction[],
  confidence: number,
): Promise<void> {
  const counterpart = recentRows.find((row) => row.id === counterpartId);
  if (counterpart === undefined) return;

  const outLeg = committed.direction === "out" ? committed : counterpart;
  const inLeg = committed.direction === "out" ? counterpart : committed;

  await linkTransfer(outLeg.id, inLeg.id, outLeg.amount - inLeg.amount, {
    detectedBy: "auto",
    confidence,
  });
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Work in flight, so tests can wait for the drain without polling.
 *
 * `startIngest` deliberately does not await its own drain — a slow or failing
 * bridge must not delay the live subscription (see below) — which leaves the
 * batch running after the function returns.
 */
let inFlight: Promise<void> = Promise.resolve();

/** Test-only: resolves once the current drain and every capture it produced is done. */
export async function __awaitIngestIdle(): Promise<void> {
  await inFlight;
}

/**
 * Drains what accumulated while the app was dead, then listens for live ones.
 *
 * RULE 10, AND IT IS THE REASON THIS FUNCTION IS SHAPED THIS WAY. The drain is
 * destructive: the moment it returns, the native buffer is empty and this
 * array is the only copy of up to 500 captures. So the whole batch is written
 * to `raw_notifications` in one pass BEFORE any of it is processed. After that
 * a crash costs nothing — every capture can be reprocessed from the table on
 * the next launch. Processing them one at a time straight from the array would
 * lose everything not yet reached, silently.
 *
 * RULE 8: buffered captures are processed in `postedAt` order and before live
 * ones, so an older buffered capture can never be committed after a newer live
 * one.
 *
 * The live subscription is installed even when the drain fails. The bridge
 * rejects when the app is outside the Keystore auth window; those captures are
 * still in the native buffer and cost nothing, but dropping the subscription
 * would stop tracking until the next launch.
 */
export async function startIngest(): Promise<() => void> {
  if ((await getSetting("capture_enabled")) === false) {
    // Draining while paused would move captures into a table the pipeline then
    // refuses to process, and rule 11 would call them replays forever after.
    return () => undefined;
  }

  // A CHAIN, not a queue drained once at the end.
  //
  // The obvious shape — collect live captures in an array and process it after
  // the drain — is racy, and the race is easy to lose: a drain that rejects
  // settles on the very next microtask, so the batch work can finish before the
  // first live capture even arrives, and every capture after that point is
  // silently never processed. Appending each one to a promise chain instead
  // means a live capture is always processed, whenever it lands, and still
  // strictly after the buffered batch (rule 8).
  let chain: Promise<void>;

  const unsubscribe = addCaptureListener((capture) => {
    chain = chain.then(() => runGuarded(capture));
    inFlight = chain;
  });

  chain = (async () => {
    let buffered: RawCapture[] = [];
    try {
      buffered = await drainPendingCaptures();
    } catch {
      // Still buffered natively; nothing is lost. Keep the subscription.
      buffered = [];
    }

    const ordered = [...buffered].sort((a, b) => a.postedAt - b.postedAt);

    // Rule 10: durable first, all of it, before any processing. One clock read
    // for the whole batch, so every capture drained together shares a TTL
    // anchor rather than drifting apart by however long the writes took.
    const storedAt = Date.now();
    const fresh: RawCapture[] = [];
    for (const capture of ordered) {
      if (await hasRawCapture(capture.id)) continue;
      await storeRawCapture(capture, storedAt);
      fresh.push(capture);
    }

    for (const capture of fresh) {
      await processStored(capture);
    }
  })();

  inFlight = chain;

  return () => {
    unsubscribe();
  };
}

/**
 * Runs the stages for a capture already written to `raw_notifications`.
 *
 * Re-entering `processCapture` would see its own stored row and return
 * `ignored: "duplicate"` — the replay check doing its job against the durable
 * write rule 10 just made. So the batch path skips straight to the stages.
 */
async function processStored(capture: RawCapture): Promise<void> {
  try {
    const bundle = await getActiveRuleset();
    if (bundle === null) return;

    const routed = routeCapture(capture, bundle);
    if (routed.kind === "not_financial") return;
    if (routed.kind === "unknown") {
      await queue("unknown-provider", capture.id, {
        amount: null,
        direction: null,
        packageName: capture.packageName,
      });
      return;
    }

    await runStages(capture, routed.provider, bundle);
  } catch {
    // One malformed capture must not take the rest of the batch with it. The
    // raw row is already durable, so this one can be reprocessed later.
  }
}

async function runGuarded(capture: RawCapture): Promise<void> {
  try {
    await processCapture(capture);
  } catch {
    // Same isolation for live captures. The raw row is written before any
    // stage runs, so the capture survives its own crash.
  }
}
