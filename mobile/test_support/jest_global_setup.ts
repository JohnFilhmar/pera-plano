// THE SUITE'S TIME ZONE, PINNED WHERE IT ACTUALLY TAKES EFFECT.
//
// `globalSetup` runs ONCE in Jest's parent process, before any worker is forked.
// Workers inherit `process.env` at fork time, so setting TZ here means every
// worker's Node reads it during its own startup, before anything constructs a
// Date.
//
// WHY NOT IN `setupFiles`, WHERE IT USED TO LIVE. `test_support/jest_setup.ts`
// set `process.env.TZ` too, and that assignment does NOTHING. By the time a
// setup file runs, the worker's Node has already resolved its zone, and the
// value is cached for the life of the process. The old comment there claimed
// "Node 16+ re-reads `process.env.TZ` on the next Date operation, so assigning
// it here is enough". That is false, and it was invisible for five waves for one
// reason: the machine this suite is developed on is already in Asia/Manila, so
// the pin was a no-op that agreed with the answer.
//
// It took a Linux CI runner to expose it. On UTC, `ledger_list.test.tsx`'s
// `localDateKey keys by the LOCAL calendar day, not by UTC` failed on the
// explicit `toISOString()` guard GAP-097 added for exactly this purpose --
// "Expected: 2026-08-12, Received: 2026-08-13" -- which is the guard doing its
// job rather than a new defect. Reproduce with `TZ=UTC npx jest ledger_list`.
//
// Asia/Manila (+08:00, no DST) is the product's own zone; see lib/dates.ts.
export default function globalSetup(): void {
  process.env.TZ = "Asia/Manila";
}
