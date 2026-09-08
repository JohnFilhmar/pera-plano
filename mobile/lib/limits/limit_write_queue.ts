// lib/limits/limit_write_queue.ts — one FIFO chain per limit, so the three
// writers of a limit's alert state can never interleave.
//
// WHAT IT IS FOR. `recomputeLimits`, `muteLimitForPeriod` and
// `refreshLimitBase` all read the whole alert-state object, await at least one
// more query, then write the whole object back. Nothing ordered those sections,
// so a mute tapped while a ledger pass sat inside `sumSpend` was persisted and
// then overwritten by that pass's older, unmuted copy — limits rule 25 promises
// the mute lasts until the period boundary, and the user got the alert they had
// just silenced. Rule 11's immediate base re-snapshot was lost the same way, and
// two overlapping passes could each post the same threshold, against rule 19.
//
// A JS QUEUE, NOT A TRANSACTION. Wrapping those sections in SQLite would hold a
// write lock open across a full spend scan on every ledger commit, and the
// repo layer has no nested-transaction escape once one is open. The app is
// single-threaded and there is exactly one process in front of the database, so
// ordering the read-modify-write sections in JS is sufficient — the only other
// writer that could exist would be another JS caller, and every one of them
// comes through here.
//
// PER LIMIT, NOT GLOBAL. One pass walks every active limit; a global lock would
// make a mute on limit A wait out a spend scan on limit B for nothing. Two
// writers only conflict when they are writing the same row.
//
// THE MAP SHRINKS. An entry is deleted as soon as its own chain drains with
// nothing queued behind it, so the map holds one entry per limit with work IN
// FLIGHT, not one per limit ever written. `pendingLimitWriteLocks` exists so
// that is a tested claim rather than a comment.

const chains = new Map<string, Promise<void>>();

/**
 * Runs `task` after every section already queued for `limitId`, and before
 * every section queued after it. Returns whatever `task` returns.
 *
 * The caller must put its READ inside the task as well as its write. A queue
 * around the write alone orders nothing: the stale copy was already in hand.
 *
 * A REJECTION NEVER POISONS THE CHAIN. `setLimitAlertState` throws when the
 * limit row has gone; that rejection reaches this caller and no one else,
 * because what the map holds is a settled-only view of this section.
 */
export function withLimitWriteLock<T>(limitId: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(limitId) ?? Promise.resolve();
  const run = previous.then(() => task());
  const settled = run.then(
    () => undefined,
    () => undefined,
  );

  chains.set(limitId, settled);
  void settled.then(() => {
    // Identity, not presence: a section queued behind this one has already
    // replaced the entry, and deleting it would let a third section start
    // alongside the second.
    if (chains.get(limitId) === settled) chains.delete(limitId);
  });

  return run;
}

/**
 * How many limits currently have a queued or running write section. Zero once
 * everything has drained — which is the point, and what its test asserts.
 */
export function pendingLimitWriteLocks(): number {
  return chains.size;
}
