// lib/alerts/__tests__/alert_audit.test.ts — m3c Task 8: the notification
// audit named in this task's brief.
//
// This file is NOT a re-run of what other suites already prove in depth:
//   - "both a locked and an unlocked copy variant, no amount locked" is
//     ALERT_COPY_CATALOGUE's own job, scanned exhaustively in
//     lib/alerts/__tests__/alert_copy.test.ts. Extending that catalogue (for
//     payday summary and tracking-interrupted, both already present) was
//     enough to cover the two notification kinds this audit found had no
//     posting path at all — see below.
//   - "a threshold never re-fires within its period" and "raising a limit
//     preserves `fired`" are proven against the real database in
//     lib/limits/__tests__/limit_service.test.ts (search "fired").
//   - the bill overdue escalation's 1/+3/+3-day cadence and its 3-per-cycle
//     cap are lib/bills/__tests__/bill_reminders.test.ts's job.
// What belongs HERE is the cross-cutting audit the brief asks for: that
// every notification type named in docs/06-information-architecture.md §6.1
// is actually PRODUCIBLE (a real function posts or schedules it, on the
// right channel, with data a tap can route from) and that the anti-spam
// invariants in §6.2 hold end to end — plus, where they do not, saying so
// rather than papering over the gap.
jest.mock("@/lib/alerts/alerts_service", () => ({
  scheduleReminder: jest.fn(),
  cancelScheduled: jest.fn().mockResolvedValue(undefined),
  postAlert: jest.fn().mockResolvedValue("os-id"),
}));

import type { LimitAlert } from "@/types/control";
import type { Bill, Loan } from "@/types/domain";

import { cancelScheduled, postAlert, scheduleReminder } from "../alerts_service";
import { resolveAlertRoute } from "../alert_routes";
import { CHANNEL_LIMITS, CHANNEL_REMINDERS } from "../channels";
import { canNotifyTrackingInterrupted, notifyTrackingInterrupted } from "../tracking_notifier";

import { closeDatabase } from "@/lib/db/database";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { createBill } from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { notifyPaydaySummary } from "@/lib/income/payday_notifier";
import { crossedThreshold } from "@/lib/limits/limit_engine";
import { notifyLimitAlerts } from "@/lib/limits/limit_notifier";
import type { BillStatus } from "@/lib/bills/bills_service";
import { cancelCycleReminders, scheduleBillReminders } from "@/lib/bills/bill_reminders";
import { cancelLoanReminders, scheduleLoanReminders } from "@/lib/loans/loan_reminders";
import type { LoanStatus } from "@/lib/loans/loans_service";
import { freshDb } from "@/test_support/db";

const mockSchedule = scheduleReminder as jest.MockedFunction<typeof scheduleReminder>;
const mockCancel = cancelScheduled as jest.MockedFunction<typeof cancelScheduled>;
const mockPost = postAlert as jest.MockedFunction<typeof postAlert>;

/** Well inside every fixture's due window below. */
const NOW = new Date(2026, 8, 1, 8, 0).getTime();

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  mockPost.mockResolvedValue("os-id");
  let counter = 0;
  mockSchedule.mockImplementation(async () => `os-${++counter}`);
  await seedDefaultCategories();
});

afterEach(async () => {
  await closeDatabase();
});

function billStatusOf(bill: Bill, over: Partial<BillStatus> = {}): BillStatus {
  return {
    bill,
    dueDate: "2026-09-15",
    estimate: { amount: 235000, basis: "history", sampleSize: 3, spread: 0 },
    state: "upcoming",
    daysUntil: 14,
    cycle: null,
    payment: null,
    ...over,
  };
}

function loanStatusOf(over: Partial<Omit<LoanStatus, "loan">> & { loan?: Partial<Loan> } = {}): LoanStatus {
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
    loan,
  };
}

// ===========================================================================
// Producibility — every notification named in the brief actually posts
// ===========================================================================
describe("every audited notification type is producible", () => {
  test("limit alerts: all THREE intensities (50/80/100) are reachable thresholds", () => {
    // The real production function (limit_engine.ts), not a re-derivation —
    // an audit that reimplements the rule to check the rule proves nothing.
    const limit = 1_000_000;
    expect(crossedThreshold({ prevSpend: 490000, newSpend: 500000, effectiveLimit: limit, alreadyFired: [] })).toBe(50);
    expect(crossedThreshold({ prevSpend: 790000, newSpend: 800000, effectiveLimit: limit, alreadyFired: [50] })).toBe(80);
    expect(crossedThreshold({ prevSpend: 990000, newSpend: 1000000, effectiveLimit: limit, alreadyFired: [50, 80] })).toBe(100);
  });

  test("limit alerts: notifyLimitAlerts posts on the interrupting channel with routable data", async () => {
    const alert: LimitAlert = {
      limitId: "l-1",
      limitName: "Food & Dining",
      scope: "monthly",
      threshold: 80,
      spend: 800000,
      effectiveLimit: 1000000,
      daysLeft: 9,
    };

    await notifyLimitAlerts([alert]);

    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL_LIMITS, data: { kind: "limitAlerts", limitIds: ["l-1"] } }),
    );
  });

  test("bill reminders: scheduleBillReminders queues a reminder with routable data", async () => {
    const bill = await createBill({
      name: "Meralco",
      amount: 235000,
      amountMode: "estimated",
      dueRule: { kind: "day-of-month", day: 15 },
      categoryId: "cat_bills_utilities",
    });

    await scheduleBillReminders([billStatusOf(bill)], NOW);

    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: CHANNEL_REMINDERS,
        data: { kind: "billReminder", billId: bill.id, dueDate: "2026-09-15" },
      }),
    );
  });

  test("loan reminders: scheduleLoanReminders queues a reminder with routable data", async () => {
    await scheduleLoanReminders([loanStatusOf()], NOW);

    expect(mockSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: CHANNEL_REMINDERS,
        data: { kind: "loanReminder", loanId: "l1" },
      }),
    );
  });

  test("payday summary: producible, and OFF by default — IA §6.1's own opt-in column", async () => {
    const silent = await notifyPaydaySummary({ amount: 1_800_000 });
    expect(silent).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();

    await setSetting("payday_summary_enabled", true);
    const id = await notifyPaydaySummary({ amount: 1_800_000 });

    expect(id).toBe("os-id");
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL_REMINDERS, data: { kind: "paydaySummary" } }),
    );
  });

  test("tracking-interrupted: producible on the interrupting channel with routable data", async () => {
    const id = await notifyTrackingInterrupted(3, NOW);

    expect(id).toBe("os-id");
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL_LIMITS, data: { kind: "trackingInterrupted" } }),
    );
  });
});

// ===========================================================================
// Routing — IA §6.1's deep-link table, resolved from what each notifier
// above actually attaches as `data`
// ===========================================================================
describe("every notification routes to its documented destination when tapped", () => {
  test("a single limit alert opens that limit's breach view", () => {
    expect(resolveAlertRoute({ kind: "limitAlerts", limitIds: ["l-1"] })).toEqual({
      pathname: "/plan/limits/[id]",
      params: { id: "l-1" },
    });
  });

  test("a coalesced multi-limit alert opens the Limits list — no single breach view represents both", () => {
    expect(resolveAlertRoute({ kind: "limitAlerts", limitIds: ["l-1", "l-2"] })).toBe("/plan/limits");
  });

  test("a bill reminder opens that bill's detail, cycle-scoped", () => {
    expect(resolveAlertRoute({ kind: "billReminder", billId: "b-1", dueDate: "2026-09-15" })).toEqual({
      pathname: "/plan/bills/[id]",
      params: { id: "b-1", dueDate: "2026-09-15" },
    });
  });

  test("a loan reminder opens that loan's detail", () => {
    expect(resolveAlertRoute({ kind: "loanReminder", loanId: "l-1" })).toEqual({
      pathname: "/plan/loans/[id]",
      params: { id: "l-1" },
    });
  });

  test("payday summary opens Home", () => {
    expect(resolveAlertRoute({ kind: "paydaySummary" })).toBe("/");
  });

  test("tracking-interrupted opens the listener-health recovery screen", () => {
    expect(resolveAlertRoute({ kind: "trackingInterrupted" })).toBe("/more/listener_health");
  });

  test("an unrecognised or malformed payload falls back to Home rather than crashing the tap", () => {
    expect(resolveAlertRoute(undefined)).toBe("/");
    expect(resolveAlertRoute(null)).toBe("/");
    expect(resolveAlertRoute({})).toBe("/");
    expect(resolveAlertRoute({ kind: "somethingFromAnOlderBuild" })).toBe("/");
    expect(resolveAlertRoute({ kind: "billReminder", billId: 12345 })).toBe("/");
  });
});

// ===========================================================================
// Anti-spam — docs §6.2
// ===========================================================================
describe("anti-spam: each limit threshold fires at most once per limit per period", () => {
  // The deep, DB-backed proof of this (period rollover resets `fired`, a
  // raised limit preserves it, a mute still records it) lives in
  // lib/limits/__tests__/limit_service.test.ts. This is the audit-level
  // confirmation against the same production function that guard runs on.
  test("re-crossing the same threshold within a period is silent", () => {
    const limit = 1_000_000;
    const first = crossedThreshold({ prevSpend: 490000, newSpend: 500000, effectiveLimit: limit, alreadyFired: [] });
    expect(first).toBe(50);

    // A correction dips spend back under 50%, then a new commit re-crosses it.
    const second = crossedThreshold({
      prevSpend: 480000,
      newSpend: 520000,
      effectiveLimit: limit,
      alreadyFired: [50],
    });
    expect(second).toBeNull();
  });

  test("a single commit that jumps several thresholds fires only the highest — never a double alert", () => {
    const fired = crossedThreshold({
      prevSpend: 400000,
      newSpend: 1_050_000,
      effectiveLimit: 1_000_000,
      alreadyFired: [],
    });
    expect(fired).toBe(100);
  });
});

describe("anti-spam: a paid bill or loan installment cancels its remaining reminders", () => {
  test("bills rule 11: cancelCycleReminders drops that cycle's queued ids immediately", async () => {
    const bill = await createBill({
      name: "Meralco",
      amount: 235000,
      amountMode: "estimated",
      dueRule: { kind: "day-of-month", day: 15 },
      categoryId: "cat_bills_utilities",
    });
    await scheduleBillReminders([billStatusOf(bill)], NOW);
    expect(mockSchedule).toHaveBeenCalled();
    const scheduledIds = await Promise.all(mockSchedule.mock.results.map((r) => r.value));
    expect(scheduledIds.length).toBeGreaterThan(0);

    await cancelCycleReminders(bill.id, "2026-09-15");

    for (const id of scheduledIds) expect(mockCancel).toHaveBeenCalledWith(id);
    expect(await getSetting("bill_reminder_ids")).toEqual({});
  });

  test("loans (m3c Task 8 audit fix): cancelLoanReminders drops the whole loan's queued ids", async () => {
    // Reminders are keyed PER LOAN, not per cycle (loan_reminders.ts's own
    // header) — a payment advances `nextDueDate` in place, so every id
    // already queued against the OLD due date is stale, not just one cycle's
    // worth. Before this task's fix, nothing called this after a payment;
    // `hooks/mutations/use_record_payment.ts` and
    // `use_confirm_payment_match.ts` now do, immediately, mirroring the
    // bills hook above.
    await scheduleLoanReminders([loanStatusOf()], NOW);
    const scheduledIds = await Promise.all(mockSchedule.mock.results.map((r) => r.value));
    expect(scheduledIds.length).toBeGreaterThan(0);

    await cancelLoanReminders("l1");

    for (const id of scheduledIds) expect(mockCancel).toHaveBeenCalledWith(id);
    expect(await getSetting("loan_reminder_ids")).toEqual({});
  });
});

describe("anti-spam: listener-health warnings cap at one per day (docs §6.2 rule 4)", () => {
  test("canNotifyTrackingInterrupted — pure boundary check", () => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(canNotifyTrackingInterrupted(null, NOW)).toBe(true);
    expect(canNotifyTrackingInterrupted(NOW - oneDayMs + 1, NOW)).toBe(false);
    expect(canNotifyTrackingInterrupted(NOW - oneDayMs, NOW)).toBe(true);
  });

  test("a second interruption the same day does not post again", async () => {
    const first = await notifyTrackingInterrupted(2, NOW);
    expect(first).toBe("os-id");

    const secondTheSameDay = await notifyTrackingInterrupted(5, NOW + 60_000);
    expect(secondTheSameDay).toBeNull();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  // NOT A FALSE PASS: the tests above enforce rule 4's DAY cap only, not its
  // full text ("at most one per DISTINCT interruption, and no more than one
  // per day even across repeated interruptions"). Telling "a fresh
  // interruption" from "the same one continuing" needs a health TRANSITION
  // the live trigger observes; a pure elapsed-time comparison cannot see that
  // on its own — see tracking_notifier.ts's `canNotifyTrackingInterrupted`
  // header for the same note in the implementation itself.
});

// ===========================================================================
// The global daily notification cap
// ===========================================================================
describe("anti-spam: a global daily cap on ALL app notifications", () => {
  // AUDIT FINDING, REPORTED RATHER THAN INVENTED (per this task's own
  // instructions: a cap is a product decision, not an audit task's to make).
  // Searched: lib/alerts/*, lib/limits/limit_notifier.ts,
  // lib/bills/bill_reminders.ts, lib/loans/loan_reminders.ts,
  // lib/income/payday_notifier.ts, lib/alerts/tracking_notifier.ts. The only
  // caps that exist are SCOPED ones: bills rule 22 (max 3 overdue notices per
  // CYCLE, `MAX_OVERDUE_NOTICES`), limits rule 20/21 (max ONE alert per
  // THRESHOLD per period), and this file's own `tracking_notifier.ts` (max
  // one listener-health notice per DAY). Docs §6.2 rule 6 describes
  // "coalescing" — more than 3 notifications within a few minutes collapse
  // into one summary — which is a BURST-window merge rule, not a per-day
  // ceiling on the total COUNT the app may send, and nothing in the codebase
  // implements even that burst-merge across channels (each channel's
  // coalescing, e.g. `coalesceAlerts` in limit_engine.ts, only combines
  // several LIMIT alerts into one notification — it does not look at bills,
  // loans, or any other channel's queue).
  test.todo(
    "GAP: no cross-channel daily notification cap exists anywhere in this codebase — reported per task instructions, not invented here",
  );
});
