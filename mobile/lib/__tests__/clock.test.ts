// lib/__tests__/clock.test.ts — m2 Task 1.
//
// The whole point of the module is that an engine never reads the wall clock
// itself, so the tests that matter are the two that pin the seam: a fixed clock
// never moves, and the system clock actually tracks real time.
import { fixedClock, systemClock } from "../clock";

test("fixedClock returns the injected instant, every time", () => {
  const at = new Date(2026, 5, 15, 12, 0).getTime(); // 2026-06-15 12:00 local

  const clock = fixedClock(at);

  // Called twice deliberately: a `fixedClock` that captured `Date.now()` on
  // first read instead of holding `at` would pass a single-call assertion.
  expect(clock.now()).toBe(at);
  expect(clock.now()).toBe(at);
});

test("fixedClock does not drift when real time passes", async () => {
  const at = new Date(2026, 0, 1, 0, 0).getTime();
  const clock = fixedClock(at);

  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(clock.now()).toBe(at);
});

test("systemClock tracks real time", () => {
  const before = Date.now();
  const value = systemClock.now();
  const after = Date.now();

  expect(value).toBeGreaterThanOrEqual(before);
  expect(value).toBeLessThanOrEqual(after);
});

test("systemClock advances", async () => {
  const first = systemClock.now();
  await new Promise((resolve) => setTimeout(resolve, 20));

  // A `systemClock` frozen at module load — the mistake `fixedClock` sitting
  // next to it invites — would return the same number here.
  expect(systemClock.now()).toBeGreaterThan(first);
});
