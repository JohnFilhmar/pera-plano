// lib/recurring/__tests__/recurring_ledger_subscriber.test.ts — M3 Part 2
// Task 6, plan rule 4 ("refreshPatterns runs on the ledger:committed event,
// debounced").
//
// The service is mocked HERE and nowhere else in this feature — same
// discipline as lib/income/__tests__/income_ledger_subscriber.test.ts. This
// file is about the debounce and the swallow, not about detection itself.
jest.mock("@/lib/recurring/recurring_service", () => ({
  refreshPatterns: jest.fn().mockResolvedValue([]),
}));

import { __setTierForTests } from "@/lib/entitlements";
import { emitAppEvent } from "@/lib/events/app_events";
import { refreshPatterns } from "@/lib/recurring/recurring_service";

import { runRecurringPass, startRecurringLedgerSubscriber } from "../recurring_ledger_subscriber";

const mockRefresh = refreshPatterns as jest.MockedFunction<typeof refreshPatterns>;

/** Long enough to be deterministic, short enough not to slow the suite. */
const DEBOUNCE_MS = 20;
const settle = () => new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 4));

beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockResolvedValue([]);
});

afterEach(() => {
  __setTierForTests(null);
});

test("A BURST OF COMMITS TRIGGERS EXACTLY ONE DETECTION PASS", async () => {
  // Rule 4: debounced so a burst of drained captures triggers one pass.
  // Draining the native buffer after the phone has been offline commits a run
  // of transactions in a tight loop, and each pass reads up to 800 days of
  // ledger.
  const stop = startRecurringLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  for (let index = 0; index < 25; index++) {
    await emitAppEvent("ledger:committed", { transactionId: `tx-${index}` });
  }
  await settle();
  stop();

  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test("two bursts far enough apart are two passes", async () => {
  // Trailing-edge, not once-ever. A commit an hour later is new evidence.
  const stop = startRecurringLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  await emitAppEvent("ledger:committed", { transactionId: "tx-2" });
  await settle();
  stop();

  expect(mockRefresh).toHaveBeenCalledTimes(2);
});

test("tearing down cancels a pass that has not fired yet", async () => {
  // The subscription outlives a screen; a timer that fired into an unmounted
  // tree would run detection against a database the shell may have closed.
  const stop = startRecurringLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  stop();
  await settle();

  expect(mockRefresh).not.toHaveBeenCalled();
});

test("after teardown a further commit does nothing", async () => {
  const stop = startRecurringLedgerSubscriber({ debounceMs: DEBOUNCE_MS });
  stop();

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();

  expect(mockRefresh).not.toHaveBeenCalled();
});

test("A THROWING PASS IS SWALLOWED, NOT PROPAGATED", async () => {
  mockRefresh.mockRejectedValue(new Error("detection exploded"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(runRecurringPass(Date.now())).resolves.toBeUndefined();

  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("a throwing pass does not kill the subscription", async () => {
  mockRefresh.mockRejectedValueOnce(new Error("boom"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const stop = startRecurringLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  await emitAppEvent("ledger:committed", { transactionId: "tx-2" });
  await settle();
  stop();

  expect(mockRefresh).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});

// ---------------------------------------------------------------------------
// THE TIER DOES NOT DECIDE WHETHER THE PASS RUNS (GAP-122)
// ---------------------------------------------------------------------------
//
// INVERTED FROM THE GAP-118 VERSION OF THIS BLOCK, which asserted the exact
// opposite — "ON FREE THE PASS DOES NOT RUN AT ALL", "on free a ledger commit
// schedules nothing", "UPGRADING TO PLUS RUNS THE NEXT PASS WITH NO RESTART".
// That skip was taken on the premise that no free surface could ever display
// the result; Reports rule 19 (docs/04-features/10-reports.md `:70`, `:98`,
// `:157`) says the free locked preview owes the user "the count of detected
// patterns only", and the owner chose to honour it. A device that never runs
// detection has nothing to count, so the pass now runs in both tiers, the
// 800-day window is read floor-exempt in both (recurring_service.ts), and the
// only tier check left is on the screen that renders the count
// (app/(tabs)/more/subscriptions.tsx).

test("ON FREE THE PASS RUNS, BECAUSE RULE 19 OWES FREE A COUNT", async () => {
  __setTierForTests("free");

  await expect(runRecurringPass(Date.now())).resolves.toBeUndefined();

  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test("on free a ledger commit schedules a pass, same as on plus", async () => {
  // The event entry point matters as much as bootstrap's direct call: a drained
  // capture burst is where a free user's first patterns actually come from.
  __setTierForTests("free");
  const stop = startRecurringLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  stop();

  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

test("NEITHER TIER IS TREATED DIFFERENTLY, AND AN UPGRADE MID-SESSION CHANGES NOTHING HERE", async () => {
  // No guard is left to be evaluated per pass or per subscription, so the tier
  // flipping under a live subscriber is a non-event for this file: both commits
  // below run a pass. What an upgrade changes is what the Subscriptions screen
  // is allowed to render, which is that screen's own test.
  __setTierForTests("free");
  const stop = startRecurringLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  expect(mockRefresh).toHaveBeenCalledTimes(1);

  __setTierForTests("plus");
  await emitAppEvent("ledger:committed", { transactionId: "tx-2" });
  await settle();
  stop();

  expect(mockRefresh).toHaveBeenCalledTimes(2);
});
