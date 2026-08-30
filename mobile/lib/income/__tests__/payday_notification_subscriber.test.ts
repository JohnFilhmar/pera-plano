// lib/income/__tests__/payday_notification_subscriber.test.ts — the wiring
// defect this subscriber closes.
//
// `notifyPaydaySummary` had no production caller: the in-app half (the payday
// sheet, via `usePaydayAllocations`) worked, so a user who happened to open the
// app saw their payday, and a user who did not got nothing at all.
//
// THE DEDUPE IS INHERITED, NOT REINVENTED. `maybeEmitPayday`
// (lib/income/income_service.ts) already fires `income:payday` at most once per
// transaction id, persisted across app kills. Subscribing to that event is what
// makes the push obey the same invariant; a second counter here would be a
// competing source of truth that could disagree with the sheet about whether a
// payday had already been announced.
//
// The notifier's own opt-in check, copy and channel are proven in
// lib/alerts/__tests__/alert_audit.test.ts. This file only asks whether it is
// called.
jest.mock("@/lib/income/payday_notifier", () => ({
  notifyPaydaySummary: jest.fn().mockResolvedValue("os-id"),
}));

import { emitAppEvent } from "@/lib/events/app_events";
import { notifyPaydaySummary } from "@/lib/income/payday_notifier";

import { startPaydayNotificationSubscriber } from "../payday_notification_subscriber";

const mockNotify = notifyPaydaySummary as jest.MockedFunction<typeof notifyPaydaySummary>;

const PAYDAY = {
  transactionId: "tx-payday",
  walletId: "w1",
  amount: 1_800_000,
  occurredAt: new Date(2026, 6, 15, 9, 0).getTime(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockNotify.mockResolvedValue("os-id");
});

test("A DETECTED PAYDAY POSTS THE SUMMARY PUSH", async () => {
  const stop = startPaydayNotificationSubscriber();

  await emitAppEvent("income:payday", PAYDAY);
  stop();

  expect(mockNotify).toHaveBeenCalledWith({ amount: PAYDAY.amount });
});

test("THE PUSH INHERITS THE EVENT'S ONE-PER-PAYDAY DEDUPE", async () => {
  // `maybeEmitPayday` emits at most once per transaction id. Riding that event
  // means the push cannot fire twice for one payday — and cannot fire once for
  // a payday the sheet never heard about either.
  const stop = startPaydayNotificationSubscriber();

  await emitAppEvent("income:payday", PAYDAY);
  await emitAppEvent("income:payday", { ...PAYDAY, transactionId: "tx-next", amount: 1_900_000 });
  stop();

  expect(mockNotify).toHaveBeenCalledTimes(2);
  expect(mockNotify).toHaveBeenNthCalledWith(1, { amount: 1_800_000 });
  expect(mockNotify).toHaveBeenNthCalledWith(2, { amount: 1_900_000 });
});

test("tearing down stops the push", async () => {
  const stop = startPaydayNotificationSubscriber();
  stop();

  await emitAppEvent("income:payday", PAYDAY);

  expect(mockNotify).not.toHaveBeenCalled();
});

test("A FAILING PUSH NEVER ESCAPES INTO THE COMMIT PATH", async () => {
  // The event is emitted from inside `maybeEmitPayday`, which the ledger
  // subscriber runs after a commit. A rejected notification must not look like
  // a failed capture.
  mockNotify.mockRejectedValue(new Error("permission denied"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const stop = startPaydayNotificationSubscriber();

  await expect(emitAppEvent("income:payday", PAYDAY)).resolves.toBeUndefined();
  stop();

  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
