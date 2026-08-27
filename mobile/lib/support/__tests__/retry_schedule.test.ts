// lib/support/__tests__/retry_schedule.test.ts — the brief's exact minutes,
// pinned.
//
// THE POINT OF THE FIRST TEST is that it will fail if anyone "corrects" the
// list into a real factorial or a clean doubling. The retry_schedule.ts header
// records why the written minutes win over the word "factorial"; this is the
// half of that argument that survives a refactor.
import {
  SUPPORT_RETRY_CYCLE_LENGTH,
  SUPPORT_RETRY_DELAYS_MINUTES,
  nextAttemptAt,
  retryDelayMs,
} from "../retry_schedule";

const MINUTE = 60_000;

test("the schedule is exactly 1, 2, 4, 6, 8, 16, 32 minutes", () => {
  expect(SUPPORT_RETRY_DELAYS_MINUTES).toEqual([1, 2, 4, 6, 8, 16, 32]);
  expect(SUPPORT_RETRY_CYCLE_LENGTH).toBe(7);
});

test("each consecutive failure walks one step down the list", () => {
  const waits = [1, 2, 3, 4, 5, 6, 7].map((failures) => retryDelayMs(failures) / MINUTE);

  expect(waits).toEqual([1, 2, 4, 6, 8, 16, 32]);
});

test("the eighth failure wraps back to one minute rather than growing", () => {
  expect(retryDelayMs(8)).toBe(1 * MINUTE);
  expect(retryDelayMs(9)).toBe(2 * MINUTE);
  expect(retryDelayMs(14)).toBe(32 * MINUTE);
  expect(retryDelayMs(15)).toBe(1 * MINUTE);
});

test("the wait never exceeds 32 minutes, however long the queue has been failing", () => {
  for (let failures = 1; failures <= 200; failures += 1) {
    expect(retryDelayMs(failures)).toBeLessThanOrEqual(32 * MINUTE);
    expect(retryDelayMs(failures)).toBeGreaterThanOrEqual(1 * MINUTE);
  }
});

// The guard in `retryDelayMs`: a 0 (or negative, or fractional) attempt count
// must not index off the front of the list and produce an undefined delay —
// `now + undefined` is NaN, and a NaN `next_attempt_at` is never `<= now`,
// which is a report that silently never sends again.
test("a nonsense attempt count still produces a real, one-minute delay", () => {
  expect(retryDelayMs(0)).toBe(1 * MINUTE);
  expect(retryDelayMs(-5)).toBe(1 * MINUTE);
  expect(retryDelayMs(1.7)).toBe(1 * MINUTE);
  expect(Number.isNaN(retryDelayMs(0))).toBe(false);
});

test("nextAttemptAt offsets the instant it is given, and nothing else", () => {
  const now = new Date(2026, 7, 28, 9, 30).getTime();

  expect(nextAttemptAt(1, now)).toBe(now + 1 * MINUTE);
  expect(nextAttemptAt(7, now)).toBe(now + 32 * MINUTE);
  expect(nextAttemptAt(8, now)).toBe(now + 1 * MINUTE);
});
