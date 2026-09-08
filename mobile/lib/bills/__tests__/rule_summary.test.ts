// lib/bills/__tests__/rule_summary.test.ts — GAP-085.
//
// The bill detail's three missing spec rows, as text. Pure: no database, no
// clock, no renderer — the card next door proves they reach the screen.
import { LADDER_THRESHOLD } from "@/constants/bills";
import type { AmountEstimate } from "@/lib/bills/amount_estimator";
import {
  autoMatchFacts,
  dueRuleLabel,
  reminderScheduleLabel,
  toleranceFor,
} from "@/lib/bills/rule_summary";
import type { Bill, BillAutoMatchRule, DueRule } from "@/types/domain";

const FIXED: AmountEstimate = { amount: 235000, basis: "fixed", sampleSize: 0, spread: 0 };
const HISTORY: AmountEstimate = { amount: 235000, basis: "history", sampleSize: 3, spread: 40000 };

function bill(over: Partial<Bill> = {}): Bill {
  return {
    id: "bill_1",
    name: "Meralco",
    amount: 235000,
    amountMode: "estimated",
    dueRule: { kind: "day-of-month", day: 20 },
    reminderOffsets: [-3, 0],
    autoMatchRule: { merchantPattern: "MERALCO", dateWindowDays: 7 },
    categoryId: "cat_bills_utilities",
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Due rule in plain words — the spec's own example
// ---------------------------------------------------------------------------
test("THE DUE RULE READS BACK IN THE SPEC'S OWN WORDS", () => {
  // docs/04-features/07-bills.md, Bill detail: "Due rule in plain words
  // ('Every 20th; moves to Friday if it lands on a weekend')".
  const rule: DueRule = { kind: "day-of-month", day: 20, weekdayAdjust: "earlier" };

  expect(dueRuleLabel(rule)).toBe(
    "Every 20th; moves to the Friday before if it lands on a weekend",
  );
});

test("no weekend clause when the rule does not shift", () => {
  expect(dueRuleLabel({ kind: "day-of-month", day: 20 })).toBe("Every 20th");
  expect(dueRuleLabel({ kind: "day-of-month", day: 20, weekdayAdjust: "none" })).toBe(
    "Every 20th",
  );
});

test("`later` says Monday, not Friday", () => {
  expect(dueRuleLabel({ kind: "day-of-month", day: 1, weekdayAdjust: "later" })).toBe(
    "Every 1st; moves to the Monday after if it lands on a weekend",
  );
});

test("ordinals are not all `th`", () => {
  // 1st/2nd/3rd/21st/31st, and the 11-13 exception that catches naive suffixing.
  const day = (n: number) => dueRuleLabel({ kind: "day-of-month", day: n });
  expect(day(1)).toBe("Every 1st");
  expect(day(2)).toBe("Every 2nd");
  expect(day(3)).toBe("Every 3rd");
  expect(day(11)).toBe("Every 11th");
  expect(day(12)).toBe("Every 12th");
  expect(day(13)).toBe("Every 13th");
  expect(day(21)).toBe("Every 21st");
  expect(day(31)).toBe("Every 31st");
});

test("every kind of rule has words", () => {
  expect(dueRuleLabel({ kind: "last-day-of-month" })).toBe("The last day of every month");
  // The spec's *katapusan* rhythm — the 15th and the LAST day, not the 30th.
  expect(dueRuleLabel({ kind: "semi-monthly" })).toBe(
    "Every 15th and the last day of the month",
  );
  expect(
    dueRuleLabel({ kind: "every-n-weeks", n: 2, weekday: 5, anchorDate: "2026-02-20" }),
  ).toBe("Every 2 weeks on Friday");
  expect(
    dueRuleLabel({ kind: "every-n-weeks", n: 1, weekday: 5, anchorDate: "2026-02-20" }),
  ).toBe("Every Friday");
  expect(dueRuleLabel({ kind: "every-n-months", n: 3, day: 10, anchorMonth: 1 })).toBe(
    "Every 3 months on the 10th",
  );
});

test("A WEEK-BASED RULE NEVER PROMISES A WEEKEND SHIFT", () => {
  // `adjustOf` in due_rules.ts returns "none" for every-n-weeks — the spec
  // scopes the adjustment to month-based rules — so a clause here would
  // describe a move that cannot happen. A user who set a Sunday bill chose
  // Sunday.
  const rule: DueRule = {
    kind: "every-n-weeks",
    n: 2,
    weekday: 0,
    anchorDate: "2026-02-22",
    weekdayAdjust: "earlier",
  };

  expect(dueRuleLabel(rule)).toBe("Every 2 weeks on Sunday");
});

// ---------------------------------------------------------------------------
// Reminder schedule — rule 10
// ---------------------------------------------------------------------------
test("THE DEFAULT SCHEDULE READS BACK AS THE SPEC WRITES IT", () => {
  // Rule 10's default: "[3 days before, on due date]".
  expect(reminderScheduleLabel([-3, 0])).toBe("3 days before and on the due date.");
});

test("the schedule is ordered earliest first whatever order it is stored in", () => {
  expect(reminderScheduleLabel([0, -7, -3])).toBe(
    "7 days before, 3 days before, and on the due date.",
  );
});

test("singular and lone offsets", () => {
  expect(reminderScheduleLabel([-1])).toBe("1 day before.");
  expect(reminderScheduleLabel([0])).toBe("On the due date.");
});

test("NO REMINDERS IS SAID OUT LOUD, NOT LEFT BLANK", () => {
  // The form allows an empty set. A blank row is indistinguishable from
  // reminders that are configured but silently failing to fire.
  expect(reminderScheduleLabel([])).toBe("No reminders for this bill.");
});

// ---------------------------------------------------------------------------
// Auto-match summary — rules 13-14
// ---------------------------------------------------------------------------
test("no rule means matching is off, not a blank summary", () => {
  expect(autoMatchFacts(bill({ autoMatchRule: null }), HISTORY)).toEqual({ enabled: false });
});

test("THE SUMMARY CARRIES RULE 13'S THREE PARTS", () => {
  // Rule 13: "The autoMatchRule is: merchant keyword set + amount tolerance +
  // date window."
  const facts = autoMatchFacts(bill(), HISTORY);
  expect(facts.enabled).toBe(true);
  if (!facts.enabled) return;

  expect(facts.merchantPattern).toBe("MERALCO");
  // Rule 14 for an ESTIMATED bill: ±30% of the current estimate.
  expect(facts.toleranceCentavos).toBe(70500);
  // Rule 15's window, and rule 26's wider one once overdue.
  expect(facts.opensDaysBefore).toBe(7);
  expect(facts.closesDaysAfter).toBe(15);
  expect(facts.overdueClosesDaysAfter).toBe(30);
});

test("A FIXED BILL GETS RULE 14'S OTHER BAND, NOT THE ESTIMATED ONE", () => {
  // "±₱30.00 or ±3% of the amount, whichever is greater". At ₱2,350.00 the 3%
  // is ₱70.50 and wins over the ₱30.00 floor — and the estimated band would be
  // 30%, ₱705.00, ten times as wide. The two are deliberately far apart here:
  // a fixture where both bands agreed would pass whichever one the code picked.
  const facts = autoMatchFacts(bill({ amountMode: "fixed" }), FIXED);
  if (!facts.enabled) throw new Error("expected matching to be on");

  expect(facts.toleranceCentavos).toBe(7050);
  expect(autoMatchFacts(bill(), HISTORY)).toMatchObject({ toleranceCentavos: 70500 });
});

test("the ₱30.00 floor is what a small fixed bill gets", () => {
  // Rule 14's floor exists to absorb an e-wallet's ₱7.00 convenience fee; on a
  // ₱500.00 bill 3% is ₱15.00, which would not.
  const small: AmountEstimate = { amount: 50000, basis: "fixed", sampleSize: 0, spread: 0 };
  expect(toleranceFor(bill({ amountMode: "fixed" }), small)).toBe(3000);
});

test("the percentage wins over the floor on a large fixed bill", () => {
  const large: AmountEstimate = { amount: 5000000, basis: "fixed", sampleSize: 0, spread: 0 };
  expect(toleranceFor(bill({ amountMode: "fixed" }), large)).toBe(150000);
});

test("THE LADDER'S POSITION IS PART OF THE SUMMARY", () => {
  // Rule 13: matches 1 and 2 ask, from 3 onward matching is silent. The user
  // has no other way to know which of those two apps they are holding.
  const asking = autoMatchFacts(
    bill({ autoMatchRule: { merchantPattern: "MERALCO", dateWindowDays: 7, confirmedStreak: 1 } }),
    HISTORY,
  );
  if (!asking.enabled) throw new Error("expected matching to be on");
  expect(asking.silent).toBe(false);
  expect(asking.confirmationsLeft).toBe(LADDER_THRESHOLD - 1);

  const earned = autoMatchFacts(
    bill({
      autoMatchRule: {
        merchantPattern: "MERALCO",
        dateWindowDays: 7,
        confirmedStreak: LADDER_THRESHOLD,
      },
    }),
    HISTORY,
  );
  if (!earned.enabled) throw new Error("expected matching to be on");
  expect(earned.silent).toBe(true);
  expect(earned.confirmationsLeft).toBe(0);
});

test("rejected keywords are reported, because nothing else surfaces them", () => {
  const rule: BillAutoMatchRule = {
    merchantPattern: "MERALCO",
    dateWindowDays: 7,
    excludedKeywords: ["MERALCO KIOSK"],
  };
  const facts = autoMatchFacts(bill({ autoMatchRule: rule }), HISTORY);
  if (!facts.enabled) throw new Error("expected matching to be on");

  expect(facts.excludedKeywords).toEqual(["MERALCO KIOSK"]);
});
