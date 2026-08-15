// lib/bills/__tests__/bill_reminders.test.ts — m2c Task 4 rule 3.
//
// The only part of the bills feature that touches the notification stack, and
// therefore the only bills test file that mocks it. `bills_service.ts` mocks
// nothing, which is the point of the split.
jest.mock("@/lib/alerts/alerts_service", () => ({
  scheduleReminder: jest.fn(),
  cancelScheduled: jest.fn().mockResolvedValue(undefined),
  postAlert: jest.fn().mockResolvedValue(undefined),
}));

import { cancelScheduled, postAlert, scheduleReminder } from "@/lib/alerts/alerts_service";
import { closeDatabase } from "@/lib/db/database";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { createBill, getCycle, recordOverdueNotice } from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { freshDb } from "@/test_support/db";
import type { Bill, BillCycle } from "@/types/domain";

import {
  cancelCycleReminders,
  MAX_OVERDUE_NOTICES,
  postOverdueNotices,
  scheduleBillReminders,
} from "../bill_reminders";
import type { BillStatus } from "../bills_service";

const mockSchedule = scheduleReminder as jest.MockedFunction<typeof scheduleReminder>;
const mockCancel = cancelScheduled as jest.MockedFunction<typeof cancelScheduled>;
const mockPost = postAlert as jest.MockedFunction<typeof postAlert>;

/** Feb 10 2026, 08:00 — comfortably before a Feb 20 due date, so both fire. */
const NOW = new Date(2026, 1, 10, 8, 0).getTime();

let bill: Bill;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  jest.clearAllMocks();
  mockSchedule.mockImplementation(async () => `notif_${mockSchedule.mock.calls.length}`);
  bill = await createBill({
    name: "Meralco",
    amount: 235000,
    amountMode: "estimated",
    dueRule: { kind: "day-of-month", day: 20 },
    categoryId: "cat_bills_utilities",
  });
});

afterEach(async () => {
  await closeDatabase();
});

function statusOf(over: Partial<BillStatus> = {}): BillStatus {
  return {
    bill,
    dueDate: "2026-02-20",
    estimate: { amount: 235000, basis: "history", sampleSize: 3, spread: 0 },
    state: "upcoming",
    daysUntil: 10,
    cycle: null,
    payment: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Scheduling — spec rules 10-12
// ---------------------------------------------------------------------------
test("REMINDERS ARE SCHEDULED AT EACH CONFIGURED OFFSET, AT 9AM LOCAL", async () => {
  await scheduleBillReminders([statusOf()], NOW);

  expect(mockSchedule).toHaveBeenCalledTimes(2); // the spec's default [-3, 0]
  const fireTimes = mockSchedule.mock.calls.map(([args]) => args.fireAt);
  expect(fireTimes).toEqual([
    new Date(2026, 1, 17, 9, 0).getTime(),
    new Date(2026, 1, 20, 9, 0).getTime(),
  ]);
});

test("the reminder carries BOTH copy variants and the CURRENT estimate", async () => {
  // The encryption plan's Task 9b: every notification supplies a locked and an
  // unlocked variant, selected at post time. A bill NAME is a name the user
  // chose, so it survives the lock screen; the figure does not.
  await scheduleBillReminders([statusOf()], NOW);

  const [args] = mockSchedule.mock.calls[0];
  expect(args.copy.locked.body).toContain("Meralco");
  expect(args.copy.locked.body).not.toMatch(/₱|\d{3}/);
  expect(args.copy.unlocked.body).toContain("₱2,350");
});

test("A RESOLVED CYCLE IS NEVER REMINDED ABOUT", async () => {
  // Paid, skipped, and paid-outside-my-wallets all mean the same thing to a
  // reminder: there is nothing left to do.
  await scheduleBillReminders(
    [
      statusOf({ state: "paid" }),
      statusOf({ dueDate: "2026-03-20", state: "skipped" }),
      statusOf({ dueDate: "2026-04-20", state: "resolved_external" }),
    ],
    NOW,
  );

  expect(mockSchedule).not.toHaveBeenCalled();
});

test("an offset already in the past is skipped, not queued", async () => {
  // A reminder for a moment that has gone fires immediately on some Android
  // builds and never on others; either way it is not a reminder.
  const late = new Date(2026, 1, 19, 8, 0).getTime(); // past the -3 offset

  await scheduleBillReminders([statusOf({ daysUntil: 1 })], late);

  expect(mockSchedule).toHaveBeenCalledTimes(1);
});

test("EVERY RESCHEDULE CANCELS THE PREVIOUS RUN FIRST", async () => {
  // Rule 11's failure mode: scheduling without cancelling leaves the old
  // notifications queued, so a user who already paid is reminded anyway.
  await scheduleBillReminders([statusOf()], NOW);
  const firstRun = await getSetting("bill_reminder_ids");
  const queued = Object.values(firstRun).flat();
  expect(queued.length).toBe(2);

  mockCancel.mockClear();
  await scheduleBillReminders([statusOf()], NOW);

  expect(mockCancel.mock.calls.map(([id]) => id)).toEqual(queued);
});

test("RUNNING TWICE DOES NOT STACK DUPLICATE NOTIFICATIONS", async () => {
  // m2c Task 6 rule 3: the launch path calls this on every start, so two runs
  // in one session must leave exactly one set queued. The failure it guards
  // against is silent and compounding — a user who opens the app four times
  // before a due date would otherwise get four reminders for one bill.
  await scheduleBillReminders([statusOf()], NOW);
  const first = Object.values(await getSetting("bill_reminder_ids")).flat();

  await scheduleBillReminders([statusOf()], NOW);
  const second = Object.values(await getSetting("bill_reminder_ids")).flat();

  // Every id from the first run was cancelled, and the store holds only the
  // second run's — the same COUNT, not the same ids, because rescheduling
  // re-queues rather than reusing an OS handle.
  expect(second).toHaveLength(first.length);
  expect(second.some((id) => first.includes(id))).toBe(false);
  for (const id of first) expect(mockCancel).toHaveBeenCalledWith(id);
});

test("IDS ARE KEYED PER CYCLE, SO ONE CYCLE CAN BE SILENCED ALONE", async () => {
  // Rule 25 has two cycles of one bill open at once; a per-bill key could not
  // cancel one without silencing the other's reminders too.
  await scheduleBillReminders(
    [statusOf(), statusOf({ dueDate: "2026-03-20", daysUntil: 38 })],
    NOW,
  );
  const stored = await getSetting("bill_reminder_ids");
  expect(Object.keys(stored).sort()).toEqual([
    `${bill.id}|2026-02-20`,
    `${bill.id}|2026-03-20`,
  ]);

  mockCancel.mockClear();
  await cancelCycleReminders(bill.id, "2026-02-20");

  expect(mockCancel).toHaveBeenCalledTimes(2);
  expect(Object.keys(await getSetting("bill_reminder_ids"))).toEqual([`${bill.id}|2026-03-20`]);
});

test("a denied permission stores no id to cancel later", async () => {
  // Rule 12: nothing is lost silently — the in-app card still renders — but
  // there is no OS notification and therefore nothing to cancel.
  mockSchedule.mockResolvedValue(null);

  await scheduleBillReminders([statusOf()], NOW);

  expect(await getSetting("bill_reminder_ids")).toEqual({});
});

// ---------------------------------------------------------------------------
// Overdue escalation — spec rule 22
// ---------------------------------------------------------------------------
function overdue(daysOverdue: number, cycle: BillCycle | null = null): BillStatus {
  return statusOf({ state: "overdue", daysUntil: -daysOverdue, cycle });
}

test("THE FIRST OVERDUE NOTICE FIRES ON DAY +1", async () => {
  await postOverdueNotices([overdue(1)]);

  expect(mockPost).toHaveBeenCalledTimes(1);
  expect((await getCycle(bill.id, "2026-02-20"))?.overdueNoticesSent).toBe(1);
});

test("nothing fires on the due date itself", async () => {
  await postOverdueNotices([statusOf({ state: "due_today", daysUntil: 0 })]);

  expect(mockPost).not.toHaveBeenCalled();
});

test("THEN ONE EVERY THREE DAYS, AND NOT ON THE DAYS BETWEEN", async () => {
  await postOverdueNotices([overdue(2)]);
  expect(mockPost).not.toHaveBeenCalled();

  await postOverdueNotices([overdue(3)]);
  expect(mockPost).not.toHaveBeenCalled();

  await postOverdueNotices([overdue(4)]);
  expect(mockPost).toHaveBeenCalledTimes(1);
});

test("ESCALATION STOPS AT THREE PER CYCLE — NAGGING FOREVER ERODES TRUST", async () => {
  // Rule 22's cap, and its stated reason. After three, in-app surfaces only.
  for (let i = 0; i < MAX_OVERDUE_NOTICES; i += 1) {
    await recordOverdueNotice(bill.id, "2026-02-20");
  }
  const cycle = await getCycle(bill.id, "2026-02-20");

  await postOverdueNotices([overdue(10, cycle)]);

  expect(mockPost).not.toHaveBeenCalled();
});

test("A PHONE THAT WAS OFF FOR A WEEK DOES NOT FIRE THE BACKLOG AT ONCE", async () => {
  // Day 7 is the third scheduled notice. A cycle that has sent NONE has missed
  // days 1 and 4 — and receiving all three at once is exactly the pile-on rule
  // 22 exists to prevent. It sends one and carries on from there.
  await postOverdueNotices([overdue(7)]);

  expect(mockPost).toHaveBeenCalledTimes(1);
  expect((await getCycle(bill.id, "2026-02-20"))?.overdueNoticesSent).toBe(1);
});

test("THE OVERDUE NOTICE KEEPS THE FIGURE OFF THE LOCK SCREEN", async () => {
  await postOverdueNotices([overdue(1)]);

  const [args] = mockPost.mock.calls[0];
  expect(args.copy.locked.body).toContain("Meralco");
  expect(args.copy.locked.body).not.toMatch(/₱|\d{3}/);
  expect(args.copy.unlocked.body).toContain("₱2,350");
});

test("an overdue notice records against the CYCLE, not the bill", async () => {
  // Rule 22 caps per cycle, and rule 25 has two open at once — a bill-level
  // count would silence February's third notice because March had spoken.
  await postOverdueNotices([overdue(1), overdue(1, null)]);

  expect((await getCycle(bill.id, "2026-02-20"))?.overdueNoticesSent).toBe(2);
});
