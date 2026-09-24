// lib/events/app_events.ts — the in-process bus features use to hear that
// something happened, without importing each other.
//
// It exists because of plan Task 10 rule 7: "after a successful commit the
// orchestrator emits a `ledger:committed` event so the M2 limit engine can
// recompute. Define the event name here; M2 subscribes." The ingest pipeline
// must not know that Limits, Safe-to-Spend, income detection, recurring-pattern
// detection or the Today screen exist — it commits a row and says so. Everything
// that has to recompute subscribes.
//
// The map started with the one event that had a producer; m2 Task 1 widened it
// with `ledger:changed` and `income:payday`, against the exact signatures that
// plan pins. Adding a key was the whole change — nothing here is per-event, and
// the widening needed no change to `onAppEvent` or `emitAppEvent` at all.
//
// A KEY IS ADDED FOR ITS *SUBSCRIBERS*, NOT ITS PRODUCER. Both new events are
// declared here before the code that fires them exists, because the map is the
// seam: the control plane can be built and tested against `ledger:changed`
// while transactions_repo still only emits `ledger:committed`. What that costs
// is a window where a subscriber is wired to an event nothing sends yet — so a
// feature that looks inert is worth checking against its producer first.
//
// SCOPE, DELIBERATELY SMALL. No wildcards, no once(), no event history, no
// cross-process delivery. A subscriber that needs the payload again reads the
// database, which is the only thing that is actually true after the fact.
import type { Centavos, EpochMs } from "@/types/domain";

/**
 * Every event and the payload it carries. Payloads are IDENTIFIERS, not
 * records: a handler that wants the committed Transaction reads it, so it can
 * never act on a stale copy that was serialized into an event before some other
 * subscriber changed it.
 */
export type AppEventMap = {
  /** A new row reached the ledger. Fired by `lib/ingest/pipeline.ts` after the write. */
  "ledger:committed": { transactionId: string };

  /**
   * An EXISTING row moved: edited, deleted, recategorised, or linked as a
   * transfer leg.
   *
   * Separate from `ledger:committed` rather than folded into it, because the
   * two mean opposite things to a total. A commit can only add to a period's
   * spend, so a subscriber may add incrementally; a change can add, subtract,
   * move spend between two periods, or remove it from every total at once (a
   * transfer link excludes both legs). A handler that treated the two alike
   * would double-count an edit and never notice a delete.
   */
  "ledger:changed": { transactionId: string };

  /**
   * Income landed that the detector recognised as a payday, per
   * `docs/04-features/04-income.md`. Consumed by the goals sheet.
   *
   * THE ONE PAYLOAD HERE THAT IS NOT PURELY IDENTIFIERS, and deliberately so.
   * A payday handler allocates against the amount that just arrived; re-reading
   * it from the row would make an allocation depend on the transaction still
   * being unchanged whenever the handler happened to run, which is exactly the
   * staleness the identifier rule above exists to prevent — inverted, because
   * here the historical figure IS the correct one. `occurredAt` likewise: an
   * allocation belongs to the payday's own instant, not to processing time.
   *
   * A PAYDAY, NOT A TRANSACTION. `transactionIds` is a list because one payday
   * can arrive as several credits — an employer paying half in the morning and
   * half in the afternoon is ordinary here — and `amount` is what they come to
   * TOGETHER, which is the base goals rule 13 names for a percent contribution:
   * "the sum of income Transactions detected on that payday date". A single
   * `transactionId` could only ever name one half of that sum, and a handler
   * reconciling the transfer (rule 14) needs all the rows it covers.
   */
  "income:payday": {
    /** Every credit the payday covers, oldest first. Never empty. */
    transactionIds: string[];
    /** The wallet holding the largest share of the day's pay. */
    walletId: string;
    /** The day's credits combined. */
    amount: Centavos;
    /** When the pay finished arriving — the last credit's instant. */
    occurredAt: EpochMs;
  };

  /**
   * A Goal was created, or edited in a way that can move its progress: a
   * relink onto another Wallet, or a changed target.
   *
   * WHY AN EVENT RATHER THAN A DIRECT CALL. The milestone pass is the only thing
   * that listens, and it lives behind `lib/alerts/alerts_service.ts`, which
   * imports expo-notifications and the native notification listener. A mutation
   * that called the pass directly would drag that whole stack into every screen
   * and every test that creates a goal; `app/(onboarding)` and `app/goal/*` have
   * no business loading the notification transport. The bus is the seam that
   * keeps them apart, exactly as it does for the ledger.
   *
   * WHAT THE SUBSCRIBER DOES WITH IT: a milestone pass, because a goal created
   * on, or moved onto, a Wallet that already sits past a milestone announces the
   * level it starts at (goals rule 12, owner's ruling 2026-09-24), and neither of
   * the pass's other wake-ups, a launch and a ledger commit, covers that.
   */
  "goals:changed": { goalId: string };

  /**
   * A problem report in the offline outbox changed state — sent, rescheduled
   * after a failure, or refused (`lib/support/outbox_runner.ts`).
   *
   * THE ONLY EVENT HERE WITH NO IDENTIFIER IN ITS PAYLOAD, and the deviation
   * is the point. The others name a row so a handler can re-read exactly what
   * moved; this one fires from a background flush that may have moved three
   * reports in one pass, and its single subscriber
   * (`hooks/queries/use_support_reports.ts`) re-reads the whole unsent list
   * regardless. A payload of ids it would immediately discard would be a
   * contract to keep accurate for no reader.
   *
   * It exists because this is the app's only queue that progresses with NO
   * user action behind it: a report can send itself while its own list is on
   * screen, and without an event the list would keep saying "waiting to send"
   * until the screen was left and re-entered.
   */
  "support:outbox_changed": Record<string, never>;

  /**
   * The app re-locked: the DEK is gone, the database handle is closed, and the
   * cache encryption key is cleared.
   *
   * PAYLOAD-FREE, DELIBERATELY. There is nothing a subscriber could be told
   * about a lock that is not "it happened", and a payload here would be a
   * plaintext detail surviving the exact moment everything plaintext is
   * supposed to stop existing.
   *
   * Added for `lib/ai/session.ts`, which is a module-scoped store rather than a
   * React context (assistant state must never reach react-query, which is
   * persisted to disk) and therefore cannot learn about a lock by unmounting.
   * Relying on unmount would also leave the AI spec §4.5 race untestable:
   * tokens arrive from a native thread, the lock arrives from the UI, and an
   * event is the only thing a test can fire at a chosen point in a token
   * stream.
   *
   * EMITTED AFTER `closeDatabase()` RESOLVES, so a subscriber that reads the
   * database on this event finds it already closed rather than racing the
   * close.
   */
  "lock:engaged": Record<string, never>;
};

type AppEventName = keyof AppEventMap;

type Handler<K extends AppEventName> = (payload: AppEventMap[K]) => void | Promise<void>;

/**
 * `Handler<never>` in the value position because a `Map` cannot express "the
 * handler set for key K holds `Handler<K>`". The two public functions restore
 * the relationship at their own boundaries, and they are the only things that
 * touch this map.
 */
const registry = new Map<AppEventName, Set<Handler<never>>>();

/**
 * Subscribes to one event and returns the unsubscribe.
 *
 * Calling the returned function is how a subscriber goes away; there is no
 * `off(event, handler)` because handler identity is a fragile thing to key on
 * (an inline arrow can never be unsubscribed) and a React effect wants a
 * teardown function anyway.
 *
 * Unsubscribing twice is a no-op — `Set.delete` on an absent member — so an
 * effect that runs its cleanup on both unmount and dependency change is safe.
 */
export function onAppEvent<K extends AppEventName>(event: K, handler: Handler<K>): () => void {
  let handlers = registry.get(event);
  if (handlers === undefined) {
    handlers = new Set();
    registry.set(event, handlers);
  }

  const stored = handler as Handler<never>;
  handlers.add(stored);

  return () => {
    handlers.delete(stored);
  };
}

/**
 * Delivers one event to every current subscriber and resolves once they have
 * all finished.
 *
 * SEQUENTIALLY, AND AWAITED. Both matter. Awaited, because the callers that
 * matter recompute derived state — a Limit's spend total, Safe-to-Spend — and
 * an emit that resolved before those finished would let the next commit start
 * reading half-updated numbers. Sequentially, because two recomputes over the
 * same rows racing each other is exactly how a total ends up reflecting one
 * write twice and another not at all.
 *
 * A THROWING HANDLER IS LOGGED, NEVER PROPAGATED. By the time this runs the
 * ledger row is already written and durable; letting a subscriber's failure
 * escape would turn a completed commit into a thrown capture at the pipeline's
 * call site and, in the drained-batch path, would look exactly like the capture
 * failing to process. One broken subscriber also must not silence the rest.
 *
 * The handler set is SNAPSHOT before iterating. A subscriber that unsubscribes
 * (or subscribes) from inside its own handler would otherwise mutate the Set
 * mid-iteration, which silently skips whichever handler the iterator was about
 * to reach.
 */
export async function emitAppEvent<K extends AppEventName>(
  event: K,
  payload: AppEventMap[K],
): Promise<void> {
  const handlers = registry.get(event);
  if (handlers === undefined || handlers.size === 0) return;

  for (const handler of [...handlers]) {
    try {
      await (handler as Handler<K>)(payload);
    } catch (error) {
      console.warn(`app_events: a "${event}" handler threw and was skipped`, error);
    }
  }
}
