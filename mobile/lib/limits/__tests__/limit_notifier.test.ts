// lib/limits/__tests__/limit_notifier.test.ts — m2 Task 7/8.
//
// Split out of limit_service.test.ts alongside the module itself: posting is
// the only part of the limits feature that touches expo-notifications and the
// native listener, so it is the only part whose test has to mock them.
//
// Only `postAlert` is mocked. `CHANNEL_LIMITS` is deliberately NOT stubbed and
// comes from the real lib/alerts/channels.ts — a mock that hands back a symbol
// the real module does not export keeps jest green while `tsc` fails, which is
// exactly what happened on the first pass of the service.
jest.mock("@/lib/alerts/alerts_service", () => ({
  postAlert: jest.fn().mockResolvedValue("os-1"),
}));

import { limitAlertsCopy } from "@/lib/alerts/alert_copy";
import { postAlert } from "@/lib/alerts/alerts_service";
import type { LimitAlert } from "@/types/control";

import { notifyLimitAlerts } from "../limit_notifier";

const mockPostAlert = postAlert as jest.MockedFunction<typeof postAlert>;

const WARNED: LimitAlert = {
  limitId: "a",
  limitName: "Overall",
  scope: "monthly",
  threshold: 80,
  spend: 850000,
  effectiveLimit: 1000000,
  daysLeft: 9,
};

const BREACHED: LimitAlert = {
  limitId: "b",
  limitName: "GCash",
  scope: "daily",
  threshold: 100,
  spend: 1100000,
  effectiveLimit: 1000000,
  daysLeft: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPostAlert.mockResolvedValue("os-1");
});

test("posts exactly ONE coalesced notification for several alerts", async () => {
  await notifyLimitAlerts([WARNED, BREACHED]);

  expect(mockPostAlert).toHaveBeenCalledTimes(1);
  const call = mockPostAlert.mock.calls[0][0];
  expect(call.channel).toBe("limits");
  // Most severe first, and the ids travel with it so a tap can open the right one.
  expect(call.data).toEqual({ limitIds: ["b", "a"] });
});

test("the posted copy carries BOTH variants, and the locked one leaks nothing", async () => {
  // Task 2 takes an AlertCopy, not a title and a body — the m2 plan's
  // `postAlert({ channel, title, body })` predates its own encryption amendment.
  await notifyLimitAlerts([WARNED, BREACHED]);

  const { copy } = mockPostAlert.mock.calls[0][0];
  expect(copy.locked.body).not.toContain("₱");
  expect(copy.locked.body).not.toContain("GCash");
  expect(copy.unlocked.body.indexOf("GCash")).toBeLessThan(copy.unlocked.body.indexOf("Overall"));
});

test("coalesces before rendering, so an unsorted caller still gets severity order", async () => {
  await notifyLimitAlerts([WARNED, BREACHED]);

  const { copy } = mockPostAlert.mock.calls[0][0];
  expect(copy).toEqual(limitAlertsCopy([BREACHED, WARNED]));
});

test("a single alert posts the canonical single-limit copy", async () => {
  await notifyLimitAlerts([WARNED]);

  const { copy } = mockPostAlert.mock.calls[0][0];
  expect(copy).toEqual(limitAlertsCopy([WARNED]));
  expect(copy.locked.body).toBe("You've reached 80% of your monthly limit.");
});

test("posts nothing at all when there are no alerts", async () => {
  await notifyLimitAlerts([]);

  // A recompute that fired nothing is the normal case, on most ledger commits.
  expect(mockPostAlert).not.toHaveBeenCalled();
});
