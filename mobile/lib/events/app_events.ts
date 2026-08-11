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
// The map starts with the one event that has a producer. The control plane (m2
// Task 1) widens it — `ledger:changed` for edits and deletes, `income:payday`
// for the goals sheet — against these exact signatures, which that plan pins.
// Adding a key is the whole change; nothing here is per-event.
//
// SCOPE, DELIBERATELY SMALL. No wildcards, no once(), no event history, no
// cross-process delivery. A subscriber that needs the payload again reads the
// database, which is the only thing that is actually true after the fact.

/**
 * Every event and the payload it carries. Payloads are IDENTIFIERS, not
 * records: a handler that wants the committed Transaction reads it, so it can
 * never act on a stale copy that was serialized into an event before some other
 * subscriber changed it.
 */
export type AppEventMap = {
  /** A new row reached the ledger. Fired by `lib/ingest/pipeline.ts` after the write. */
  "ledger:committed": { transactionId: string };
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
