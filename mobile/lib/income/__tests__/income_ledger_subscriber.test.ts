// lib/income/__tests__/income_ledger_subscriber.test.ts — m2-part2 Task 14,
// rules 2 and 3.
//
// The service is mocked HERE and nowhere else in this feature. What this file
// is about is the debounce and the swallow — how many times a pass runs, and
// whether a failing one escapes — and counting real passes against a real
// database would measure SQLite's speed rather than the subscriber's logic.
jest.mock("@/lib/income/income_service", () => ({
  refreshIncomeDetection: jest.fn().mockResolvedValue(undefined),
  maybeEmitPayday: jest.fn().mockResolvedValue(undefined),
}));

import { emitAppEvent } from "@/lib/events/app_events";
import { maybeEmitPayday, refreshIncomeDetection } from "@/lib/income/income_service";

import { runIncomePass, startIncomeLedgerSubscriber } from "../income_ledger_subscriber";

const mockRefresh = refreshIncomeDetection as jest.MockedFunction<typeof refreshIncomeDetection>;
const mockPayday = maybeEmitPayday as jest.MockedFunction<typeof maybeEmitPayday>;

/** Long enough to be deterministic, short enough not to slow the suite. */
const DEBOUNCE_MS = 20;
const settle = () => new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 4));

beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockResolvedValue(undefined as never);
  mockPayday.mockResolvedValue(false);
});

test("A BURST OF COMMITS TRIGGERS EXACTLY ONE DETECTION PASS", async () => {
  // Rule 2: "debounced so a burst of drained captures triggers one pass".
  // Draining the native buffer after the phone has been offline commits a run
  // of transactions in a tight loop, and each pass reads 130 days of ledger
  // plus every loan payment.
  const stop = startIncomeLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  for (let index = 0; index < 25; index++) {
    await emitAppEvent("ledger:committed", { transactionId: `tx-${index}` });
  }
  await settle();
  stop();

  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockPayday).toHaveBeenCalledTimes(1);
});

test("two bursts far enough apart are two passes", async () => {
  // Trailing-edge, not once-ever. A commit an hour later is new evidence.
  const stop = startIncomeLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

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
  const stop = startIncomeLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  stop();
  await settle();

  expect(mockRefresh).not.toHaveBeenCalled();
});

test("after teardown a further commit does nothing", async () => {
  const stop = startIncomeLedgerSubscriber({ debounceMs: DEBOUNCE_MS });
  stop();

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();

  expect(mockRefresh).not.toHaveBeenCalled();
});

test("DETECTION RUNS BEFORE THE PAYDAY CHECK", async () => {
  // `maybeEmitPayday` reads the profile `refreshIncomeDetection` may have just
  // written. Reversed, the credit that just landed would be tested against the
  // income figures from before it existed — so the first payday of a
  // newly-confirmed stream would never announce itself.
  const order: string[] = [];
  mockRefresh.mockImplementation(async () => {
    order.push("refresh");
    return undefined as never;
  });
  mockPayday.mockImplementation(async () => {
    order.push("payday");
    return false;
  });

  await runIncomePass(Date.now());

  expect(order).toEqual(["refresh", "payday"]);
});

test("A THROWING PASS IS SWALLOWED, NOT PROPAGATED", async () => {
  // Rule 3: "Income work must never block or break startup". Income is derived
  // convenience; the ledger is the product, and an app that will not open
  // cannot be fixed by the user at all.
  mockRefresh.mockRejectedValue(new Error("detection exploded"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(runIncomePass(Date.now())).resolves.toBeUndefined();

  // Swallowed, but not silently — a failure nobody can see is its own bug.
  expect(warn).toHaveBeenCalled();
  // And the payday check is skipped rather than run on a failed refresh.
  expect(mockPayday).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("a throwing pass does not kill the subscription", async () => {
  mockRefresh.mockRejectedValueOnce(new Error("boom"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const stop = startIncomeLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  await emitAppEvent("ledger:committed", { transactionId: "tx-2" });
  await settle();
  stop();

  expect(mockRefresh).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});
