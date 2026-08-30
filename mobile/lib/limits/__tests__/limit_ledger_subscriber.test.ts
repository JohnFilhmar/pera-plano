// lib/limits/__tests__/limit_ledger_subscriber.test.ts — the wiring defect this
// subscriber exists to close.
//
// `recomputeLimits` had NO production caller. Every unit under it was tested in
// isolation and green, and the feature was still dead: `setLimitAlertState` is
// only ever written by a recompute, so `getLimitAlertState` answered `null`
// forever, `carriesForward` in `resolveState` was permanently false, and a user
// who enabled rollover silently never received carried headroom. Unit tests
// caught none of it because nothing asserted the units were ever CALLED.
//
// This file is therefore about the call, not the arithmetic: how many passes a
// burst produces, what the pass hands the notifier, and whether a failing pass
// can take the app down with it. The engine's own maths lives next door in
// limit_service.test.ts against a real database, and the period-crossing
// consequence is pinned end to end in limit_rollover_wiring.test.ts.
jest.mock("@/lib/limits/limit_service", () => ({
  recomputeLimits: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/limits/limit_notifier", () => ({
  notifyLimitAlerts: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/income/income_service", () => ({
  getMonthlyEquivalentIncome: jest.fn().mockResolvedValue(null),
}));

import { emitAppEvent } from "@/lib/events/app_events";
import { getMonthlyEquivalentIncome } from "@/lib/income/income_service";
import { notifyLimitAlerts } from "@/lib/limits/limit_notifier";
import { recomputeLimits } from "@/lib/limits/limit_service";
import type { LimitAlert } from "@/types/control";

import { runLimitPass, startLimitLedgerSubscriber } from "../limit_ledger_subscriber";

const mockRecompute = recomputeLimits as jest.MockedFunction<typeof recomputeLimits>;
const mockNotify = notifyLimitAlerts as jest.MockedFunction<typeof notifyLimitAlerts>;
const mockIncome = getMonthlyEquivalentIncome as jest.MockedFunction<
  typeof getMonthlyEquivalentIncome
>;

/** Long enough to be deterministic, short enough not to slow the suite. */
const DEBOUNCE_MS = 20;
const settle = () => new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 4));

const ALERT: LimitAlert = {
  limitId: "limit-1",
  limitName: "Food",
  scope: "monthly",
  threshold: 80,
  spend: 80000,
  effectiveLimit: 100000,
  daysLeft: 9,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRecompute.mockResolvedValue([]);
  mockNotify.mockResolvedValue(undefined);
  mockIncome.mockResolvedValue(null);
});

test("A BURST OF COMMITS TRIGGERS EXACTLY ONE RECOMPUTE", async () => {
  // The same reason the income subscriber is debounced: draining the native
  // capture buffer after the phone has been offline commits a burst of
  // transactions in a tight loop, and every pass re-sums the period for every
  // active limit.
  const stop = startLimitLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  for (let index = 0; index < 25; index++) {
    await emitAppEvent("ledger:committed", { transactionId: `tx-${index}` });
  }
  await settle();
  stop();

  expect(mockRecompute).toHaveBeenCalledTimes(1);
});

test("two bursts far enough apart are two recomputes", async () => {
  // Trailing-edge, not once-ever. A commit an hour later is new spend.
  const stop = startLimitLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  await emitAppEvent("ledger:committed", { transactionId: "tx-2" });
  await settle();
  stop();

  expect(mockRecompute).toHaveBeenCalledTimes(2);
});

test("A COMMIT'S ALERTS REACH THE NOTIFIER", async () => {
  // The whole point of the wiring: a recompute that returns alerts must post
  // them. Returning them to nobody is what the app did before.
  mockRecompute.mockResolvedValue([ALERT]);
  const stop = startLimitLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  stop();

  expect(mockNotify).toHaveBeenCalledWith([ALERT]);
});

test("the pass supplies the monthly-equivalent income a percent-of-income limit needs", async () => {
  // `baseFor` returns null without it (limits rule 12), so a percent limit
  // would be permanently paused if the pass passed `null` blindly.
  mockIncome.mockResolvedValue(3_700_000);
  const stop = startLimitLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  stop();

  expect(mockRecompute).toHaveBeenCalledWith({ now: expect.any(Number), monthlyIncome: 3_700_000 });
});

test("the income read and the recompute see the SAME instant", async () => {
  // Two separate clock reads can straddle a period boundary — midnight, or the
  // 1st of a month — and resolve the window against one period while resolving
  // income against the next.
  const now = new Date(2026, 6, 10, 12, 0).getTime();

  await runLimitPass(now);

  expect(mockIncome).toHaveBeenCalledWith(now);
  expect(mockRecompute).toHaveBeenCalledWith({ now, monthlyIncome: null });
});

test("tearing down cancels a pass that has not fired yet", async () => {
  const stop = startLimitLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  stop();
  await settle();

  expect(mockRecompute).not.toHaveBeenCalled();
});

test("after teardown a further commit does nothing", async () => {
  const stop = startLimitLedgerSubscriber({ debounceMs: DEBOUNCE_MS });
  stop();

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();

  expect(mockRecompute).not.toHaveBeenCalled();
});

test("NOTHING IS POSTED WHEN NOTHING FIRED", async () => {
  // The normal case on most commits. `notifyLimitAlerts` is silent on an empty
  // list of its own accord, but calling it at all on every single commit would
  // load the notification stack for nothing.
  const stop = startLimitLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  stop();

  expect(mockNotify).not.toHaveBeenCalled();
});

test("A THROWING RECOMPUTE IS SWALLOWED, NOT PROPAGATED", async () => {
  // Limits are derived convenience; the ledger is the product. An app that will
  // not open cannot be fixed by the user at all.
  mockRecompute.mockRejectedValue(new Error("recompute exploded"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(runLimitPass(Date.now())).resolves.toBeUndefined();

  // Swallowed, but not silently — a failure nobody can see is its own bug.
  expect(warn).toHaveBeenCalled();
  expect(mockNotify).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("a throwing notifier is swallowed too", async () => {
  // Denied notification permission, a dead channel, an OS that refuses the
  // post — none of them may escape into the commit path.
  mockRecompute.mockResolvedValue([ALERT]);
  mockNotify.mockRejectedValue(new Error("permission denied"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(runLimitPass(Date.now())).resolves.toBeUndefined();

  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("a throwing pass does not kill the subscription", async () => {
  mockRecompute.mockRejectedValueOnce(new Error("boom"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const stop = startLimitLedgerSubscriber({ debounceMs: DEBOUNCE_MS });

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  await settle();
  await emitAppEvent("ledger:committed", { transactionId: "tx-2" });
  await settle();
  stop();

  expect(mockRecompute).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});
