// lib/clock.ts — the seam that keeps `Date.now()` out of every engine in the
// control plane (m2 Task 1).
//
// WHY A SEAM AT ALL. Limits, bills, loans and income detection are all period
// math: "how much did this month spend", "is this bill due in three days",
// "has the rollover window closed". A module that reads the wall clock itself
// can only be tested by either mocking global time or waiting for the calendar,
// and both produce tests that pass on the day they were written. Taking the
// instant as a parameter makes February 29th, month-end, and year-end ordinary
// inputs.
//
// THE RULE: no engine or service under lib/ calls `Date.now()`. It takes either
// a `now: number` or a `Clock`. Only the composition edges — a screen, a
// service entry point, the scheduler — reach for `systemClock`.
//
// Deliberately NOT a class, NOT injectable via context, and NOT a source of
// formatted strings. `lib/datetime.ts` owns display; `lib/dates.ts` owns
// calendar arithmetic; this file owns one question: what time is it.

/**
 * An instant source. Epoch milliseconds, per the interface contract §1 — the
 * same unit every `occurred_at`, `created_at` and `due_at` column holds, so a
 * clock reading and a database row are directly comparable with no conversion.
 */
export type Clock = { now(): number };

/**
 * Real time. The only clock production code ever constructs.
 *
 * A frozen object with a live `Date.now()` call inside, NOT a captured value —
 * the mistake `fixedClock` sitting right next to it invites is writing
 * `{ now: Date.now() }` and shipping a clock stuck at app launch.
 */
export const systemClock: Clock = { now: () => Date.now() };

/**
 * A clock stopped at `at`. Tests build the instant with a LOCAL constructor
 * (`new Date(2026, 5, 15, 12, 0)`), never a UTC string parse — period math here
 * is local-calendar math, so a UTC-parsed fixture agrees with a UTC-based bug.
 */
export function fixedClock(at: number): Clock {
  return { now: () => at };
}
