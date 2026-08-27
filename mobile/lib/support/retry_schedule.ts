// lib/support/retry_schedule.ts — when a queued problem report may be tried
// again. Pure arithmetic over one constant; no clock, no database, no
// network, so the schedule can be reasoned about (and tested) without any of
// them.
//
// THE SCHEDULE IS THE SPEC'S, LITERALLY. The brief asked for "factorial retry
// attempts up to factorial of 7 and back to 1", and then wrote out the minutes
// it wanted: 1, 2, 4, 6, 8, 16, 32. Those two sentences do not describe the
// same sequence — 7! is 5040, and the written list is neither n! (1, 2, 6, 24,
// 120, 720, 5040) nor a clean doubling (1, 2, 4, 8, 16, 32, 64); its 4, 6, 8
// middle belongs to neither. The written minutes win, because they are the
// half of the request that says what the user actually waits through, and
// because every alternative reading has a step measured in days. The literal
// list is therefore the single source of truth below — not a formula that
// reproduces it, which would only invite someone to "fix" the formula and
// silently change the waits.
//
// AND THEN IT WRAPS, rather than escalating or stopping. After the 32-minute
// step the next delay is one minute again — "back to 1 to prevent too long of
// a wait". Classic exponential backoff is built for a server that needs
// protecting from a stampede; this queue is one device sending at most a
// handful of reports to an endpoint that does nothing else, and the thing
// worth optimising is how quickly a report escapes once the phone finds
// signal on a jeepney. A cycle whose worst case is 32 minutes does that; an
// unbounded doubling would have a user who reported a crash yesterday still
// waiting today.
//
// NO JITTER, deliberately. Jitter exists to decorrelate many clients waking
// at once; there is no fleet here to decorrelate, and a deterministic
// schedule is one the tests can assert to the millisecond and a user can be
// told about honestly ("we'll try again in a couple of minutes").
import type { EpochMs } from "@/types/domain";

const MS_PER_MINUTE = 60_000;

/**
 * The wait after each consecutive failure, in minutes — the brief's list,
 * unchanged. Index 0 is the wait after the FIRST failure; index 6 is the wait
 * after the seventh. Failure eight starts the list over.
 */
export const SUPPORT_RETRY_DELAYS_MINUTES = [1, 2, 4, 6, 8, 16, 32] as const;

/** How many failures it takes to walk the whole list once. */
export const SUPPORT_RETRY_CYCLE_LENGTH = SUPPORT_RETRY_DELAYS_MINUTES.length;

/**
 * The wait, in milliseconds, after `attemptCount` consecutive failed sends.
 *
 * `attemptCount` is a count of FAILURES, not an index: 1 means "one attempt
 * has failed, when may the second run" and answers one minute. It is clamped
 * at 1 rather than trusted, because a caller reading a corrupt row (or a
 * future caller doing its own arithmetic) passing 0 would otherwise index
 * `-1 % 7 === -1` and get `undefined` milliseconds — a NaN `next_attempt_at`
 * that is never `<= now`, which is a report that silently never sends again.
 */
export function retryDelayMs(attemptCount: number): number {
  const failures = Math.max(1, Math.floor(attemptCount));
  const index = (failures - 1) % SUPPORT_RETRY_CYCLE_LENGTH;
  return SUPPORT_RETRY_DELAYS_MINUTES[index] * MS_PER_MINUTE;
}

/**
 * The instant the next send may be attempted, given the number of failures so
 * far and the instant the latest one happened.
 *
 * `now` is a required parameter — this is a `lib/` module, and `lib/clock.ts`
 * rules out reading the wall clock in here. The caller
 * (`lib/support/outbox_runner.ts`) already holds the instant it started the
 * flush with, and deriving the next attempt from a second, slightly later
 * reading would drift the whole schedule forward by however long the failed
 * request took to time out — thirty seconds, on this app's client.
 */
export function nextAttemptAt(attemptCount: number, now: EpochMs): EpochMs {
  return now + retryDelayMs(attemptCount);
}
