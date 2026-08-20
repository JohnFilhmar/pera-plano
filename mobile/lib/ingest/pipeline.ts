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
import { systemClock } from "@/lib/clock";
import { categorize } from "@/lib/ingest/categorizer";
import { checkDuplicate } from "@/lib/ingest/dedupe_gate";
import { decideRoute, GATE_REASONS } from "@/lib/ingest/confidence_gate";
import { detectTransfer } from "@/lib/ingest/transfer_detector";
import { emitAppEvent } from "@/lib/events/app_events";
import { getActiveRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { recordParseResult } from "@/lib/diagnostics/parse_stats_repo";
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

/**
 * Contract §5 — do not reshape. `"unreadable"` ADDED 2026-08-20 (see
 * docs/superpowers/plans/2026-08-02-00-interface-contract.md §5): a provider
 * was matched but nothing in the text could be read, and the confidence gate's
 * review floor now discards that case rather than filling the Review Queue
 * with a card carrying nothing to act on. Additive only — every existing
 * reason keeps its exact meaning.
 */
export type PipelineOutcome =
  | { kind: "committed"; transactionId: string }
  | { kind: "queued"; reviewItemId: string }
  | {
      kind: "ignored";
      reason: "not_financial" | "duplicate" | "unknown-provider" | "paused" | "unreadable";
    };

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
  now: number = systemClock.now(),
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

  return runStages(capture, routed.provider, bundle, now);
}

/** The seven stages, for a capture already stored and known to be from a real provider. */
async function runStages(
  capture: RawCapture,
  provider: ProviderRuleset,
  bundle: RulesetBundle,
  now: number,
): Promise<PipelineOutcome> {
  const { tunables } = bundle;

  const parsed = parseCapture(capture, [provider], tunables);

  // Diagnostics rule 4 (m3b Task 7): a local, content-free count of whether
  // THIS provider's text was readable — never the text itself, never the
  // parsed fields. `now` rather than a fresh clock read, so a batch of
  // buffered captures drained together records against the instant they were
  // drained, not whenever the loop happens to reach each one.
  //
  // GUARDED, DELIBERATELY. By this point `storeRawCapture` has already run,
  // so an unguarded throw here (SQLite busy, disk error, anything transient)
  // would propagate out of `runStages` BEFORE the capture is queued or
  // committed — and both outer callers (`runGuarded`, `processStored`)
  // swallow that exception silently, so `hasRawCapture` would then treat any
  // redelivery of the same notification as a duplicate forever after. A
  // diagnostics counter is a nice-to-have; the transaction it is about is
  // not — losing the counter is survivable, losing the row is not.
  try {
    await recordParseResult(provider.providerKey, parsed !== null, now);
  } catch (error) {
    console.warn("parse stats could not be recorded", error);
  }

  if (parsed === null) {
    // THE UNREADABLE PATH NOW ASKS THE GATE TOO. This branch used to enqueue
    // unconditionally, which is how the Review Queue filled with identical
    // cards carrying no amount, no merchant and no wallet — items the user
    // could neither act on nor get rid of. The verdicts are the truthful
    // neutral ones: nothing was read, so nothing could match a duplicate or a
    // transfer counterpart.
    const decision = decideRoute({
      confidence: 0,
      hasAmount: false,
      walletId: null,
      dedupe: { kind: "unique" },
      transfer: { kind: "none" },
      routed: "known",
      nonPhpCurrency: false,
      tunables,
    });
    if (decision.route === "discard") {
      // The raw capture is already stored and stays visible in the Privacy
      // Centre for its full 30-day TTL, so "ignored" here means "no card was
      // made", never "the evidence was destroyed".
      return { kind: "ignored", reason: "unreadable" };
    }
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
    // Every event reaching here came through `parseCapture`, which refuses to
    // return a `ParsedEvent` without an amount — so this is always `true` on
    // this path. Literal `true`, not `event.amount > 0`: `amount.ts` returns
    // `null`, never `0`, for anything it will not vouch for, and pins `0` as
    // a legitimate parsed amount (`parseAmountToCentavos("0.00") === 0`).
    // `> 0` would misreport a genuine ₱0.00 notification as unparsed.
    hasAmount: true,
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
      // UNREACHABLE ON THIS PATH, HANDLED ANYWAY: `hasAmount` above is always
      // `true` (the parser refuses to return a `ParsedEvent` without an
      // amount), and `decideRoute` only ever chooses "discard" when
      // `hasAmount` is `false` — so `decision.route` can never actually be
      // "discard" here. `GATE_REASONS.unreadable` is the safe fallback text
      // rather than a thrown assertion, the same doctrine `hardRouteReason`'s
      // own unreachable branches follow: a throw here would lose an
      // already-verdicted capture with no trace instead of showing one extra,
      // harmlessly-worded Review Queue card.
      reason: decision.route === "discard" ? GATE_REASONS.unreadable : decision.reason,
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
    // The provider's own statement of the balance, when its notification made
    // one. `insertTransaction` snaps the wallet to it (wallets spec rule 1);
    // `undefined` here means the notification carried none, and the ordinary
    // computed path applies. The parser has always extracted this and the
    // normalizer has always carried it — until m1c Task 3b this line did not
    // exist, so it was dropped on the floor and every wallet balance was the
    // signed sum of whatever parsed, drifting from the bank permanently.
    balanceAfter: event.balanceAfter ?? null,
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
    } catch (err) {
      // Still buffered natively; nothing is lost. Keep the subscription.
      //
      // SWALLOWING IS CORRECT HERE, SILENCE IS NOT. Recovering is right — this
      // runs from a mount effect while the user is reading their ledger, so
      // there is no user intent to hang a system auth prompt on, and
      // app/_layout.tsx requires the whole effect to be fire-and-forget.
      //
      // But a bare `catch {}` made two very different failures identical and
      // invisible: NotAuthenticatedError (the ~10s Keystore window closed
      // between unlock and here — reachable, since migrations and ruleset
      // seeding run in between) and CaptureBufferReadFailedError (a storage
      // fault). The first is self-healing; the next unlock re-prompts and
      // re-drains. The second is not, and it is the one path where captures
      // can eventually be lost, because the native buffer caps at 500.
      //
      // Logging costs nothing and is the difference between diagnosing that on
      // a device and guessing. Commit 5bad9d2 is the precedent: two identical
      // bare catches on the recovery-phrase screen turned a first-run blocker
      // into an undiagnosable "try again", and adding one line found the cause
      // on the next run. Note `transform-remove-console` strips this from
      // production bundles, so it serves development and dev-client builds.
      console.error("[ingest] drainPendingCaptures failed; captures left in the native buffer", err);
      buffered = [];
    }

    const ordered = [...buffered].sort((a, b) => a.postedAt - b.postedAt);

    // Rule 10: durable first, all of it, before any processing. One clock read
    // for the whole batch, so every capture drained together shares a TTL
    // anchor rather than drifting apart by however long the writes took.
    const storedAt = systemClock.now();
    const fresh: RawCapture[] = [];
    for (const capture of ordered) {
      if (await hasRawCapture(capture.id)) continue;
      await storeRawCapture(capture, storedAt);
      fresh.push(capture);
    }

    for (const capture of fresh) {
      await processStored(capture, storedAt);
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
async function processStored(capture: RawCapture, now: number): Promise<void> {
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

    await runStages(capture, routed.provider, bundle, now);
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
