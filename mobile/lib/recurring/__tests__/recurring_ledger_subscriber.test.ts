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
// The tier decides whether the pass runs at all (GAP-118)
// ---------------------------------------------------------------------------
//
// Owner's decision, 2026-09-10: on Free, recurring detection does not run. The
// 800-day window it asks for was being clamped to the 90-day browsing floor,
// which cannot hold three instances of an annual charge, and the result is
// gated out of the only surface that shows it. The pass is skipped rather than
// exempted — the opposite call to `sumSpend` (GAP-105), the categorizer
// (GAP-111) and income cadence detection (GAP-118's other half), for the reason
// `runRecurringPass`'s own doc gives: this is the one computation whose output
// is tier-gated.

test("ON FREE THE PASS DOES NOT RUN AT ALL", async () => {
  __setTierForTests("free");

  await expect(runRecurringPass(Date.now())).resolves.toBeUndefined();

  expect(mockRefresh).not.toHaveBeenCalled();
});

test("on free a ledger commit schedules nothing", async () => {
  // The skip has to hold at the event entry point too, not only when bootstrap
  // calls the pass directly — a drained capture burst is where the wasted work
  // actually was.
  __setTierForTests("free");
  const stop = startRecurringLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  stop();

  expect(mockRefresh).not.toHaveBeenCalled();
});

test("UPGRADING TO PLUS RUNS THE NEXT PASS WITH NO RESTART", async () => {
  // The check is per PASS, not per subscription. A subscriber that had decided
  // at `startRecurringLedgerSubscriber` time would stay dead until the app was
  // relaunched, and Reports rule 19 promises patterns "on upgrade".
  __setTierForTests("free");
  const stop = startRecurringLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  expect(mockRefresh).not.toHaveBeenCalled();

  __setTierForTests("plus");
  await emitAppEvent("ledger:committed", { transactionId: "tx-2" });
  await settle();
  stop();

  expect(mockRefresh).toHaveBeenCalledTimes(1);
});
