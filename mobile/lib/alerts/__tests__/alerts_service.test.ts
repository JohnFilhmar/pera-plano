// lib/alerts/__tests__/alerts_service.test.ts — the transport half of the
// alerts layer (m2 Task 2). `alert_copy.ts` decides WHAT a notification says;
// this decides whether, when and on which channel it is delivered.
//
// Every dependency is mocked with a factory handing back its own jest.fn()s,
// the pattern key_manager.test.ts established as safe against the Jest/Babel
// namespace-import trap. react-native is NOT mocked here at all — the service
// deliberately has no `Platform` branch (see its header).
jest.mock("expo-notifications", () => ({
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("os-id-1"),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

jest.mock("@/modules/notification_listener", () => ({
  isKeyguardLocked: jest.fn().mockResolvedValue(false),
}));

import * as Notifications from "expo-notifications";

import { isKeyguardLocked } from "@/modules/notification_listener";
import type { AlertCopy } from "../alert_copy";
import {
  cancelScheduled,
  ensureNotificationChannels,
  postAlert,
  requestAlertPermission,
  scheduleReminder,
} from "../alerts_service";
import { CHANNEL_LIMITS, CHANNEL_REMINDERS } from "../channels";

const mockNotifications = Notifications as jest.Mocked<typeof Notifications>;
const mockIsKeyguardLocked = isKeyguardLocked as jest.MockedFunction<typeof isKeyguardLocked>;

// Deliberately amount-laden on the unlocked side and amount-free on the locked
// side, so any assertion below can tell which variant was actually posted by
// looking for "₱8,400" alone.
const COPY: AlertCopy = {
  locked: { title: "Spending limit alert", body: "You've reached 80% of your monthly limit." },
  unlocked: { title: "Spending limit alert", body: "You've spent ₱8,400 of your ₱10,000 monthly limit." },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true } as never);
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: true } as never);
  mockNotifications.scheduleNotificationAsync.mockResolvedValue("os-id-1");
  mockIsKeyguardLocked.mockResolvedValue(false);
});

/** The single argument `scheduleNotificationAsync` was called with, call `n`. */
function scheduleCall(n = 0) {
  return mockNotifications.scheduleNotificationAsync.mock.calls[n][0];
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
test("creates both android channels", async () => {
  await ensureNotificationChannels();

  const ids = mockNotifications.setNotificationChannelAsync.mock.calls.map((c) => c[0]);
  expect(ids).toEqual(expect.arrayContaining([CHANNEL_LIMITS, CHANNEL_REMINDERS]));
  expect(ids).toHaveLength(2);
});

test("the two channels carry DIFFERENT importances", async () => {
  await ensureNotificationChannels();

  const byId = new Map(
    mockNotifications.setNotificationChannelAsync.mock.calls.map((c) => [c[0], c[1]]),
  );

  // A limit alert is worth interrupting for (heads-up banner); a due-date
  // reminder is not. An implementation that gave both channels the same
  // importance would pass a "both channels exist" test and be wrong.
  expect(byId.get(CHANNEL_LIMITS)?.importance).toBe(mockNotifications.AndroidImportance.HIGH);
  expect(byId.get(CHANNEL_REMINDERS)?.importance).toBe(mockNotifications.AndroidImportance.DEFAULT);
});

// ---------------------------------------------------------------------------
// postAlert — the post-time keyguard check that docs/12 §7a exists for
// ---------------------------------------------------------------------------
test("posts the UNLOCKED variant when the phone is unlocked at post time", async () => {
  mockIsKeyguardLocked.mockResolvedValue(false);

  const id = await postAlert({ channel: CHANNEL_LIMITS, copy: COPY, data: { limitId: "l1" } });

  expect(id).toBe("os-id-1");
  expect(scheduleCall().content.body).toBe(COPY.unlocked.body);
  expect(scheduleCall().content.data).toEqual({ limitId: "l1" });
});

test("posts the LOCKED variant when the phone is locked at post time", async () => {
  mockIsKeyguardLocked.mockResolvedValue(true);

  await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

  // The whole point of docs/12 §7a: no amount reaches a lock screen.
  expect(scheduleCall().content.body).toBe(COPY.locked.body);
  expect(scheduleCall().content.body).not.toContain("₱");
});

test("checks the keyguard on EVERY post, not once", async () => {
  // An implementation that read the keyguard at module load, or cached the
  // first answer, passes both tests above and fails this one. The phone's
  // state between two alerts is precisely what is allowed to change.
  mockIsKeyguardLocked.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

  await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });
  await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

  expect(mockIsKeyguardLocked).toHaveBeenCalledTimes(2);
  expect(scheduleCall(0).content.body).toBe(COPY.unlocked.body);
  expect(scheduleCall(1).content.body).toBe(COPY.locked.body);
});

test("an immediate alert names its channel, so it keeps the channel's importance", async () => {
  await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

  // `trigger: null` — the obvious way to say "now" — has NOWHERE to put a
  // channelId, so the notification silently lands on the app's default
  // channel at default importance and the HIGH channel created above does
  // nothing. See the service header.
  expect(scheduleCall().trigger).toMatchObject({ channelId: CHANNEL_LIMITS });
});

test("returns null instead of posting when permission is denied", async () => {
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false } as never);

  const id = await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

  // Specs limits r24 / loans r15 / bills r12: the in-app surface still shows
  // the event; only the system notification is lost. Nothing throws.
  expect(id).toBeNull();
  expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("a denied permission is not turned into a prompt", async () => {
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false } as never);

  await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

  // Asking for permission from inside a background recompute would put a
  // system dialog in front of a user who is not looking at the app.
  expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// scheduleReminder — the case the post-time rule CANNOT cover
// ---------------------------------------------------------------------------
test("a scheduled reminder always carries the LOCKED variant", async () => {
  mockIsKeyguardLocked.mockResolvedValue(false); // unlocked RIGHT NOW

  const fireAt = new Date(2026, 7, 17, 9, 0).getTime();
  const id = await scheduleReminder({ channel: CHANNEL_REMINDERS, copy: COPY, fireAt });

  expect(id).toBe("os-id-1");
  // Unlocked at schedule time and STILL the locked copy: the phone's state
  // now says nothing about its state days from now, when the OS — not this
  // app — renders the notification.
  expect(scheduleCall().content.body).toBe(COPY.locked.body);
  expect(scheduleCall().content.body).not.toContain("₱");
});

test("a scheduled reminder never consults the keyguard at all", async () => {
  await scheduleReminder({
    channel: CHANNEL_REMINDERS,
    copy: COPY,
    fireAt: new Date(2026, 7, 17, 9, 0).getTime(),
  });

  // Checking it here would be checking the wrong moment (docs/12 §7a), and a
  // service that called it would eventually be "improved" into using the
  // answer. Not calling it is the assertion.
  expect(mockIsKeyguardLocked).not.toHaveBeenCalled();
});

test("a scheduled reminder uses a DATE trigger on the reminders channel", async () => {
  const fireAt = new Date(2026, 7, 17, 9, 0).getTime();

  await scheduleReminder({ channel: CHANNEL_REMINDERS, copy: COPY, fireAt, data: { billId: "b1" } });

  expect(scheduleCall().trigger).toEqual({
    type: mockNotifications.SchedulableTriggerInputTypes.DATE,
    date: new Date(fireAt),
    channelId: CHANNEL_REMINDERS,
  });
  expect(scheduleCall().content.data).toEqual({ billId: "b1" });
});

test("a scheduled reminder returns null when permission is denied", async () => {
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false } as never);

  const id = await scheduleReminder({
    channel: CHANNEL_REMINDERS,
    copy: COPY,
    fireAt: new Date(2026, 7, 17, 9, 0).getTime(),
  });

  expect(id).toBeNull();
  expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});

test("cancelScheduled forwards the OS identifier", async () => {
  await cancelScheduled("os-id-1");

  expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("os-id-1");
});

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------
test("requestAlertPermission returns the OS answer", async () => {
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: false } as never);
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false } as never);

  await expect(requestAlertPermission()).resolves.toBe(false);
});

test("requestAlertPermission does not re-prompt when already granted", async () => {
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true } as never);

  await expect(requestAlertPermission()).resolves.toBe(true);
  // Android 13+ only shows the dialog once ever; spending it on a user who
  // already said yes means a later genuine request silently does nothing.
  expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
});
