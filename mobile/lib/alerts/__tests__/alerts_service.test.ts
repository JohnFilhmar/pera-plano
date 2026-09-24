// lib/alerts/__tests__/alerts_service.test.ts — the transport half of the
// alerts layer (m2 Task 2). `alert_copy.ts` decides WHAT a notification says;
// this decides whether, when and on which channel it is delivered.
//
// Every dependency is mocked with a factory handing back its own jest.fn()s,
// the pattern key_manager.test.ts established as safe against the Jest/Babel
// namespace-import trap. react-native is NOT mocked here at all — the service
// deliberately has no `Platform` branch (see its header).
//
// THE CLOCK IS MOCKED, THE DATABASE IS REAL. Since the service began enforcing
// docs/06 §6.2 rules 6 and 7 it reads two things it did not before: the
// instant (to know whether quiet hours are running) and the user's quiet-hours
// settings. A wall-clock service would make this whole file pass or fail
// depending on what time of day CI ran — every quiet-hours assertion below
// would flip at 21:00 — so `systemClock` is pinned per test. The settings go
// through the real `app_settings_repo` against a real in-memory database
// because the DURABILITY of the held record is half of what rule 7 promises;
// a mocked repo would prove the calls were made, not that the record survives.
jest.mock("expo-notifications", () => ({
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("os-id-1"),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

jest.mock("@/modules/notification_listener", () => ({
  isKeyguardLocked: jest.fn().mockResolvedValue(false),
}));

jest.mock("@/lib/clock", () => ({
  ...jest.requireActual("@/lib/clock"),
  systemClock: { now: () => mockNow },
}));

import * as Notifications from "expo-notifications";

import { closeDatabase } from "@/lib/db/database";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { isKeyguardLocked } from "@/modules/notification_listener";
import { freshDb } from "@/test_support/db";

import type { AlertCopy } from "../alert_copy";
import {
  __resetAlertBurstForTests,
  cancelScheduled,
  ensureNotificationChannels,
  postAlert,
  requestAlertPermission,
  scheduleReminder,
} from "../alerts_service";
import { CHANNEL_GOALS, CHANNEL_LIMITS, CHANNEL_REMINDERS } from "../channels";

const mockNotifications = Notifications as jest.Mocked<typeof Notifications>;
const mockIsKeyguardLocked = isKeyguardLocked as jest.MockedFunction<typeof isKeyguardLocked>;

/** Wednesday 2026-08-19 at the given local wall-clock time. */
function at(hour: number, minute = 0, day = 19): number {
  return new Date(2026, 7, day, hour, minute).getTime();
}

/** Midday — comfortably outside the default 21:00-08:00 quiet window. */
let mockNow = at(12, 0);

// Deliberately amount-laden on the unlocked side and amount-free on the locked
// side, so any assertion below can tell which variant was actually posted by
// looking for "₱8,400" alone.
const COPY: AlertCopy = {
  locked: { title: "Spending limit alert", body: "You've reached 80% of your monthly limit." },
  unlocked: { title: "Spending limit alert", body: "You've spent ₱8,400 of your ₱10,000 monthly limit." },
};

/** docs §6.2 rule 7's own named example: the breach that must not be dropped. */
const BREACH_COPY: AlertCopy = {
  locked: { title: "Spending limit alert", body: "You've reached 100% of your monthly limit." },
  unlocked: { title: "Spending limit alert", body: "You've spent ₱10,000 of your ₱10,000 monthly limit." },
};

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  __resetAlertBurstForTests();
  mockNow = at(12, 0);
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true } as never);
  mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: true } as never);
  mockNotifications.scheduleNotificationAsync.mockResolvedValue("os-id-1");
  mockIsKeyguardLocked.mockResolvedValue(false);
});

afterEach(async () => {
  await closeDatabase();
});

/** The single argument `scheduleNotificationAsync` was called with, call `n`. */
function scheduleCall(n = 0) {
  return mockNotifications.scheduleNotificationAsync.mock.calls[n][0];
}

/** Hands back "os-1", "os-2", ... so a burst's ids can be told apart. */
function countedIds(): void {
  let counter = 0;
  mockNotifications.scheduleNotificationAsync.mockImplementation(async () => `os-${++counter}`);
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------
test("creates every android channel", async () => {
  await ensureNotificationChannels();

  const ids = mockNotifications.setNotificationChannelAsync.mock.calls.map((c) => c[0]);
  expect(ids).toEqual(expect.arrayContaining([CHANNEL_LIMITS, CHANNEL_REMINDERS, CHANNEL_GOALS]));
  expect(ids).toHaveLength(3);
});

test("goal updates get their own channel at default importance (docs/06 §6.1)", async () => {
  await ensureNotificationChannels();

  const byId = new Map(
    mockNotifications.setNotificationChannelAsync.mock.calls.map((c) => [c[0], c[1]]),
  );
  expect(byId.get(CHANNEL_GOALS)?.importance).toBe(mockNotifications.AndroidImportance.DEFAULT);
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

// ===========================================================================
// docs/06 §6.2 rule 7 — quiet hours
// ===========================================================================
describe("quiet hours: an alert raised inside the window is HELD, not posted", () => {
  test("it is handed to the OS scheduler for the morning, with a DATE trigger", async () => {
    mockNow = at(2, 0);

    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

    // NOT a one-second interval trigger — that would post it at 2am, which is
    // the behaviour rule 7 exists to prevent.
    expect(scheduleCall().trigger).toEqual({
      type: mockNotifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(at(8, 0)),
      channelId: CHANNEL_LIMITS,
    });
  });

  test("RULE 7'S OWN EXAMPLE: a 100% limit breach at 2am is DELIVERED AT 8am, not dropped", async () => {
    // The single regression this whole feature is judged on. Three ways to
    // fail it, all of which look like working code: post it at 2am anyway
    // (rule 7 says hold), drop it (rule 7 says "not dropped"), or park it in a
    // JS timer until morning — which loses it the moment Android kills the
    // process overnight, and Android will.
    mockNow = at(2, 0);

    const id = await postAlert({ channel: CHANNEL_LIMITS, copy: BREACH_COPY });

    // NOT DROPPED: an id came back and exactly one notification is queued.
    expect(id).toBe("os-id-1");
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // DELIVERED IN THE MORNING: the OS holds it, so it survives the app being
    // killed at 3am. Nothing here sets a timer.
    expect(scheduleCall().trigger).toMatchObject({ date: new Date(at(8, 0)) });
    expect(scheduleCall().content.title).toBe(BREACH_COPY.locked.title);

    // AND IT IS STILL RECOVERABLE AFTER A PROCESS DEATH: the id lives in the
    // database, not in module state.
    expect(await getSetting("quiet_hours_held_ids")).toEqual(["os-id-1"]);
    expect(await getSetting("quiet_hours_held_period")).toEqual({ endAt: at(8, 0), count: 1 });
  });

  test("a held alert carries the LOCKED variant — the OS renders it hours later", async () => {
    mockIsKeyguardLocked.mockResolvedValue(false); // unlocked right now, at 2am
    mockNow = at(2, 0);

    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

    // Same reasoning as `scheduleReminder`: this process will be dead when the
    // notification is drawn, so the phone's state now says nothing about then.
    expect(scheduleCall().content.body).toBe(COPY.locked.body);
    expect(scheduleCall().content.body).not.toContain("₱");
  });

  test.each([
    ["21:00, the first quiet minute", at(21, 0), at(8, 0, 20)],
    ["23:59, before the wrap", at(23, 59), at(8, 0, 20)],
    ["00:00, after the wrap", at(0, 0), at(8, 0)],
    ["07:59, the last quiet minute", at(7, 59), at(8, 0)],
  ] as const)("%s is held until %p", async (_name, now, deliverAt) => {
    mockNow = now;

    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

    expect(scheduleCall().trigger).toMatchObject({ date: new Date(deliverAt) });
  });
});

describe("quiet hours: an alert raised OUTSIDE the window posts immediately", () => {
  test.each([
    ["20:59, one minute early", at(20, 59)],
    ["08:00, the minute it ends", at(8, 0)],
    ["midday", at(12, 0)],
  ] as const)("%s", async (_name, now) => {
    mockNow = now;

    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

    expect(scheduleCall().trigger).toMatchObject({
      type: mockNotifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    });
  });

  test("turning quiet hours off posts at 2am like any other hour", async () => {
    await setSetting("quiet_hours_enabled", false);
    mockNow = at(2, 0);

    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

    expect(scheduleCall().trigger).toMatchObject({
      type: mockNotifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    });
  });

  test("a user-chosen non-wrapping window (01:00-06:00) is honoured on both sides", async () => {
    await setSetting("quiet_hours_start_minute", 60);
    await setSetting("quiet_hours_end_minute", 360);

    mockNow = at(23, 0);
    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });
    expect(scheduleCall(0).trigger).toMatchObject({
      type: mockNotifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    });

    mockNow = at(2, 0);
    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });
    expect(scheduleCall(1).trigger).toMatchObject({ date: new Date(at(6, 0)) });
  });
});

describe("quiet hours: the listener-health exemption is per call site", () => {
  test("bypassQuietHours posts at 2am instead of holding", async () => {
    // §6.2 rule 7's one carve-out: "everything EXCEPT listener-health
    // warnings". `lib/alerts/tracking_notifier.ts` is the only caller that
    // sets it.
    mockNow = at(2, 0);

    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY, bypassQuietHours: true });

    expect(scheduleCall().trigger).toMatchObject({
      type: mockNotifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    });
  });

  test("the exemption is NOT the channel — a limit alert on the same channel is still held", async () => {
    // The trap R5 names. Listener-health deliberately shares CHANNEL_LIMITS
    // with limit alerts, so a channel-keyed exemption would exempt every limit
    // alert too, including the 100% breach rule 7 names as the thing that must
    // wait for morning. That would defeat the rule while looking implemented.
    mockNow = at(2, 0);

    await postAlert({ channel: CHANNEL_LIMITS, copy: BREACH_COPY });

    expect(scheduleCall().trigger).toMatchObject({ date: new Date(at(8, 0)) });
  });

  test("an exempt alert at 2am does not wipe the record of what is still held", async () => {
    countedIds();
    mockNow = at(2, 0);
    await postAlert({ channel: CHANNEL_LIMITS, copy: BREACH_COPY });
    expect(await getSetting("quiet_hours_held_ids")).toEqual(["os-1"]);

    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY, bypassQuietHours: true });

    // Still held — the quiet period has not ended, only this one alert was
    // allowed through it.
    expect(await getSetting("quiet_hours_held_ids")).toEqual(["os-1"]);
  });
});

describe("quiet hours: the held record is durable and self-clearing", () => {
  test("a held alert's id and count survive in the database, not in module state", async () => {
    countedIds();
    mockNow = at(23, 0);

    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });
    await postAlert({ channel: CHANNEL_REMINDERS, copy: COPY });

    expect(await getSetting("quiet_hours_held_ids")).toEqual(["os-1", "os-2"]);
    expect(await getSetting("quiet_hours_held_period")).toEqual({
      endAt: at(8, 0, 20),
      count: 2,
    });
  });

  test("the record is cleared once the window has ended", async () => {
    mockNow = at(2, 0);
    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });
    expect(await getSetting("quiet_hours_held_period")).not.toBeNull();

    mockNow = at(9, 0);
    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

    expect(await getSetting("quiet_hours_held_ids")).toEqual([]);
    expect(await getSetting("quiet_hours_held_period")).toBeNull();
  });

  test("a record left over from a previous night does not inflate tonight's count", async () => {
    // The device posted nothing all day, so nothing cleared the record. Rather
    // than count Monday's alerts into Tuesday's summary, `endAt` identifies the
    // period the ids belong to and a mismatch starts over.
    countedIds();
    await setSetting("quiet_hours_held_ids", ["stale-1", "stale-2", "stale-3"]);
    await setSetting("quiet_hours_held_period", { endAt: at(8, 0, 18), count: 3 });
    mockNow = at(23, 0);

    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

    expect(await getSetting("quiet_hours_held_period")).toEqual({
      endAt: at(8, 0, 20),
      count: 1,
    });
    // Last night's ids are dropped from the record, NOT cancelled: they were
    // scheduled for a morning that has already come.
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});

describe("quiet hours: scheduleReminder shifts its own fireAt (R4)", () => {
  test("a reminder set for 22:00 three nights out moves to 08:00 the FOURTH morning", async () => {
    // Computed forward from `fireAt`, never from now. Shifting from the
    // current time instead passes any test where fireAt happens to be tonight
    // and moves every other reminder to the wrong morning.
    mockNow = at(12, 0);

    await scheduleReminder({ channel: CHANNEL_REMINDERS, copy: COPY, fireAt: at(22, 0, 22) });

    expect(scheduleCall().trigger).toMatchObject({ date: new Date(at(8, 0, 23)) });
  });

  test("a 9am reminder — the ordinary case — is left exactly where it was", async () => {
    await scheduleReminder({ channel: CHANNEL_REMINDERS, copy: COPY, fireAt: at(9, 0, 22) });

    expect(scheduleCall().trigger).toMatchObject({ date: new Date(at(9, 0, 22)) });
  });

  test("the shift does not depend on the current time at all", async () => {
    const fireAt = at(23, 30, 22);

    mockNow = at(2, 0);
    await scheduleReminder({ channel: CHANNEL_REMINDERS, copy: COPY, fireAt });
    mockNow = at(15, 0);
    await scheduleReminder({ channel: CHANNEL_REMINDERS, copy: COPY, fireAt });

    const expected = new Date(at(8, 0, 23));
    expect(scheduleCall(0).trigger).toMatchObject({ date: expected });
    expect(scheduleCall(1).trigger).toMatchObject({ date: expected });
  });
});

// ===========================================================================
// docs/06 §6.2 rule 6 — global coalescing
// ===========================================================================
describe("coalescing: a live burst collapses on the fourth alert", () => {
  test("three post individually; the fourth clears them and posts one summary", async () => {
    countedIds();

    for (let n = 0; n < 3; n += 1) {
      mockNow = at(12, 0) + n * 1000;
      await postAlert({ channel: CHANNEL_LIMITS, copy: COPY, data: { limitId: `l${n}` } });
    }
    expect(mockNotifications.dismissNotificationAsync).not.toHaveBeenCalled();

    mockNow = at(12, 0) + 3000;
    await postAlert({ channel: CHANNEL_REMINDERS, copy: COPY });

    // CROSS-CHANNEL: three limit alerts and a reminder, collapsed together.
    // Nothing before this task looked across channels at all.
    for (const id of ["os-1", "os-2", "os-3"]) {
      expect(mockNotifications.dismissNotificationAsync).toHaveBeenCalledWith(id);
      // Cancelled as well as dismissed — a one-second interval trigger means
      // an alert posted moments ago may still be PENDING rather than drawn,
      // and dismissing alone would let it appear beside the summary.
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(id);
    }
    expect(scheduleCall(3).content.title).toBe("4 updates while you were away");
    expect(scheduleCall(3).content.data).toEqual({ kind: "coalescedUpdates" });
  });

  test("posts first and collapses after — it never buffers", async () => {
    // The literal reading of rule 6 is a buffer: hold everything a few seconds
    // then decide. That adds latency to every alert in the app and loses one
    // outright if the process dies mid-buffer, which is exactly what rule 7's
    // "not dropped" forbids. The proof it does not buffer is that the FIRST
    // alert reaches the OS during its own call.
    await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(scheduleCall().content.body).toBe(COPY.unlocked.body);
  });

  test("the summary replaces ITSELF on the fifth — never two summaries in the shade", async () => {
    countedIds();

    for (let n = 0; n < 5; n += 1) {
      mockNow = at(12, 0) + n * 1000;
      await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });
    }

    // Call 4 (0-indexed) posted "4 updates" as os-4; call 5 must clear it.
    expect(mockNotifications.dismissNotificationAsync).toHaveBeenCalledWith("os-4");
    expect(scheduleCall(4).content.title).toBe("5 updates while you were away");
  });

  test("the summary goes out on the INTERRUPTING channel", async () => {
    // A burst can contain the 100% breach rule 7 names by hand. Posting the
    // summary on the quiet channel would downgrade that breach from
    // interrupting to unobtrusive as a side effect of coalescing.
    countedIds();
    for (let n = 0; n < 4; n += 1) {
      mockNow = at(12, 0) + n * 1000;
      await postAlert({ channel: CHANNEL_REMINDERS, copy: COPY });
    }

    expect(scheduleCall(3).trigger).toMatchObject({ channelId: CHANNEL_LIMITS });
  });

  test("the summary withholds the count on a locked screen", async () => {
    countedIds();
    mockIsKeyguardLocked.mockResolvedValue(true);
    for (let n = 0; n < 4; n += 1) {
      mockNow = at(12, 0) + n * 1000;
      await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });
    }

    expect(scheduleCall(3).content.title).toBe("Updates while you were away");
    expect(scheduleCall(3).content.title).not.toContain("4");
  });

  test("a trickle spread beyond the window never coalesces", async () => {
    countedIds();

    for (let n = 0; n < 6; n += 1) {
      mockNow = at(12, 0) + n * 10 * 60 * 1000;
      await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });
    }

    expect(mockNotifications.dismissNotificationAsync).not.toHaveBeenCalled();
    for (let n = 0; n < 6; n += 1) {
      expect(scheduleCall(n).content.body).toBe(COPY.unlocked.body);
    }
  });
});

describe("coalescing: the overnight hold collapses too (the 'while you were away' case)", () => {
  test("six alerts held from 2am arrive as ONE notification at 8am, not six", async () => {
    // R7's own statement, and the case rule 6's example phrase is actually
    // describing. In-memory burst state cannot do this job — the app will be
    // killed at some point overnight — so the bookkeeping is in the database.
    countedIds();
    mockNow = at(2, 0);

    for (let n = 0; n < 6; n += 1) {
      await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });
    }

    // The three individually-held ones were cancelled when the fourth arrived,
    // and each later summary was cancelled by the one that replaced it.
    for (const id of ["os-1", "os-2", "os-3", "os-4", "os-5"]) {
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(id);
    }
    expect(await getSetting("quiet_hours_held_ids")).toEqual(["os-6"]);
    expect(await getSetting("quiet_hours_held_period")).toEqual({ endAt: at(8, 0), count: 6 });

    const last = scheduleCall(5);
    expect(last.content.title).toBe("Updates while you were away");
    expect(last.trigger).toMatchObject({ date: new Date(at(8, 0)) });
  });

  test("the held summary is still delivered in the morning — collapsing is not dropping", async () => {
    countedIds();
    mockNow = at(2, 0);
    for (let n = 0; n < 4; n += 1) {
      await postAlert({ channel: CHANNEL_LIMITS, copy: BREACH_COPY });
    }

    const held = await getSetting("quiet_hours_held_ids");
    expect(held).toHaveLength(1);
    expect(scheduleCall(3).trigger).toMatchObject({
      type: mockNotifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(at(8, 0)),
    });
    expect(scheduleCall(3).content.data).toEqual({ kind: "coalescedUpdates" });
  });

  test("three held alerts are NOT collapsed — the threshold is 'more than 3'", async () => {
    countedIds();
    mockNow = at(2, 0);
    for (let n = 0; n < 3; n += 1) {
      await postAlert({ channel: CHANNEL_LIMITS, copy: COPY });
    }

    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(await getSetting("quiet_hours_held_ids")).toEqual(["os-1", "os-2", "os-3"]);
  });
});
