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
