// lib/loans/__tests__/loan_reminders.test.ts — m2b Task 7 rule 6.
//
// The only part of the loans feature that touches the notification stack, and
// therefore the only test file here that mocks it. `loans_service.ts` mocks
// nothing, which is the point of the split.
jest.mock("@/lib/alerts/alerts_service", () => ({
  scheduleReminder: jest.fn(),
  cancelScheduled: jest.fn().mockResolvedValue(undefined),
}));

import { cancelScheduled, scheduleReminder } from "@/lib/alerts/alerts_service";
import { closeDatabase } from "@/lib/db/database";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { freshDb } from "@/test_support/db";
import type { Loan } from "@/types/domain";

import { cancelLoanReminders, scheduleLoanReminders } from "../loan_reminders";
import type { LoanStatus } from "../loans_service";

const mockSchedule = scheduleReminder as jest.MockedFunction<typeof scheduleReminder>;
const mockCancel = cancelScheduled as jest.MockedFunction<typeof cancelScheduled>;

/** Sep 1 2026 — comfortably before a Sep 15 due date, so all three fire. */
const NOW = new Date(2026, 8, 1, 8, 0).getTime();

type LoanStatusOverride = Partial<Omit<LoanStatus, "loan">> & { loan?: Partial<Loan> };

function statusOf(over: LoanStatusOverride = {}): LoanStatus {
  const loan: Loan = {
    id: "l1",
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 600000,
    interestRate: null,
    schedule: null,
    linkedWalletId: null,
    nextDueDate: "2026-09-15",
    nextDueAmount: 100000,
    // Rule 15's default three — most fixtures want the out-of-box behaviour;
    // the off/custom tests override this explicitly.
    reminderOffsets: [-3, 0, 3],
    createdAt: 0,
    updatedAt: 0,
    ...over.loan,
  };
  return {
    outstanding: 600000,
    nextDue: { dueDate: "2026-09-15", amount: 100000 },
    overdue: false,
    paidCount: 0,
    ...over,
    // LAST, DELIBERATELY. `over.loan` is a PATCH merged into the defaults
    // above, not a full replacement — spreading `...over` first and `loan`
    // after keeps that merged value from being clobbered by the raw partial
    // object a test passed in `over.loan`.
    loan,
  };
}

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  let counter = 0;
  mockSchedule.mockImplementation(async () => `os-${++counter}`);
  mockCancel.mockResolvedValue(undefined);
});

afterEach(async () => {
  await closeDatabase();
});

test("REMINDERS FIRE AT THE SPEC'S THREE OFFSETS", async () => {
  // Rule 15: "3 days before nextDueDate, on the due date, and 3 days after if
  // still unpaid."
  await scheduleLoanReminders([statusOf()], NOW);

  expect(mockSchedule).toHaveBeenCalledTimes(3);
  const fireTimes = mockSchedule.mock.calls.map((call) => call[0].fireAt).sort((a, b) => a - b);
  expect(fireTimes).toEqual([
    new Date(2026, 8, 12, 9, 0).getTime(),
    new Date(2026, 8, 15, 9, 0).getTime(),
    new Date(2026, 8, 18, 9, 0).getTime(),
  ]);
});

test("reminders go on the REMINDERS channel and carry the loan id", async () => {
  await scheduleLoanReminders([statusOf()], NOW);

  const call = mockSchedule.mock.calls[0][0];
  expect(call.channel).toBe("reminders");
  // `kind` is the tap-routing discriminant lib/alerts/alert_routes.ts
  // switches on (m3c Task 8 audit).
  expect(call.data).toEqual({ kind: "loanReminder", loanId: "l1" });
});

test("THE LOCKED COPY WITHHOLDS THE COUNTERPARTY", async () => {
  // docs/12 §7a: a counterparty names another PERSON and is never allowed on a
  // lock screen, unlike a bill name the user chose themselves.
  await scheduleLoanReminders([statusOf()], NOW);

  const { copy } = mockSchedule.mock.calls[0][0];
  expect(copy.locked.body).not.toContain("Aling Nena");
  expect(copy.locked.body).not.toContain("₱");
  expect(copy.unlocked.body).toContain("Aling Nena");
});

test("A RESCHEDULE CANCELS THE PREVIOUS RUN FIRST", async () => {
  // Rule 6: "A reminder for an already-paid installment is worse than no
  // reminder." Scheduling without cancelling leaves the old notifications
  // queued, so a user who paid early still gets reminded.
  await scheduleLoanReminders([statusOf()], NOW);
  const firstRun = await getSetting("loan_reminder_ids");
  expect(firstRun.l1).toHaveLength(3);
  jest.clearAllMocks();
  mockSchedule.mockImplementation(async () => "os-new");

  await scheduleLoanReminders([statusOf()], NOW);

  expect(mockCancel.mock.calls.map((call) => call[0]).sort()).toEqual(firstRun.l1.sort());
});

test("A SETTLED LOAN SCHEDULES NOTHING, and its old reminders are cancelled", async () => {
  await scheduleLoanReminders([statusOf()], NOW);
  jest.clearAllMocks();

  await scheduleLoanReminders([statusOf({ outstanding: 0 })], NOW);

  expect(mockSchedule).not.toHaveBeenCalled();
  expect(mockCancel).toHaveBeenCalledTimes(3);
  expect(await getSetting("loan_reminder_ids")).toEqual({});
});

test("a loan with NO due date schedules nothing", async () => {
  // Rule 15's 5-6 case: "reminders only if the user sets a nextDueDate" —
  // "many 5-6 borrowers do not want a due-date reminder for a collector who
  // simply shows up".
  await scheduleLoanReminders([statusOf({ nextDue: null })], NOW);

  expect(mockSchedule).not.toHaveBeenCalled();
});

test("A LOAN WITH REMINDERS OFF SCHEDULES NOTHING", async () => {
  // Rule 15, the other half: "reminders can be turned off entirely" — an empty
  // `reminderOffsets` (migration 008), even though the loan has a due date.
  await scheduleLoanReminders(
    [statusOf({ loan: { reminderOffsets: [] } })],
    NOW,
  );

  expect(mockSchedule).not.toHaveBeenCalled();
});

test("A LOAN WITH CUSTOM OFFSETS SCHEDULES EXACTLY THOSE", async () => {
  // Rule 15: "Offsets are adjustable per loan."
  await scheduleLoanReminders(
    [statusOf({ loan: { reminderOffsets: [-1] } })],
    NOW,
  );

  expect(mockSchedule).toHaveBeenCalledTimes(1);
  expect(mockSchedule.mock.calls[0][0].fireAt).toBe(new Date(2026, 8, 14, 9, 0).getTime());
});

test("AN OFFSET ALREADY IN THE PAST IS SKIPPED", async () => {
  // A reminder scheduled for a moment that has gone fires immediately on some
  // Android builds and never on others; either way it is not a reminder.
  // On Sep 16 the −3 and 0 offsets have both passed.
  await scheduleLoanReminders([statusOf()], new Date(2026, 8, 16, 8, 0).getTime());

  expect(mockSchedule).toHaveBeenCalledTimes(1);
  expect(mockSchedule.mock.calls[0][0].fireAt).toBe(new Date(2026, 8, 18, 9, 0).getTime());
});

test("A DENIED PERMISSION IS NOT REMEMBERED AS A SCHEDULED REMINDER", async () => {
  // `scheduleReminder` returns null when POST_NOTIFICATIONS is denied (loans
  // rule 15: "due states still appear in-app"). Storing a null would leave
  // `cancelScheduled` to be called with it later.
  mockSchedule.mockResolvedValue(null);

  await scheduleLoanReminders([statusOf()], NOW);

  expect(await getSetting("loan_reminder_ids")).toEqual({});
});

test("several loans each keep their own reminder ids", async () => {
  const second = statusOf({ loan: { id: "l2", counterparty: "GLoan" } });

  await scheduleLoanReminders([statusOf(), second], NOW);

  const stored = await getSetting("loan_reminder_ids");
  expect(Object.keys(stored).sort()).toEqual(["l1", "l2"]);
  expect(stored.l1).toHaveLength(3);
  expect(stored.l2).toHaveLength(3);
});

test("cancelLoanReminders drops one loan's reminders and leaves the rest", async () => {
  const second = statusOf({ loan: { id: "l2", counterparty: "GLoan" } });
  await scheduleLoanReminders([statusOf(), second], NOW);
  jest.clearAllMocks();

  await cancelLoanReminders("l1");

  expect(mockCancel).toHaveBeenCalledTimes(3);
  expect(Object.keys(await getSetting("loan_reminder_ids"))).toEqual(["l2"]);
});

test("cancelling a loan with no reminders is harmless", async () => {
  await expect(cancelLoanReminders("no-such-loan")).resolves.toBeUndefined();
  expect(mockCancel).not.toHaveBeenCalled();
});
