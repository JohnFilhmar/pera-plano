// lib/bills/rule_summary.ts — a bill's rules in the user's words (GAP-085).
//
// docs/04-features/07-bills.md's Bill-detail row is: "Due rule in plain words
// ('Every 20th; moves to Friday if it lands on a weekend'), amount and its
// type, reminder schedule, payment history (matched transactions), auto-match
// rule summary". Three of those five were never rendered anywhere in the app —
// the two amount rows were — so a user could set a due rule, a reminder
// schedule and a matching rule and then never see any of them again.
//
// PURE, AND DELIBERATELY REACHES NO REPOSITORY. `bills_service.ts` owns the
// matching itself and imports the repositories to do it; a component that
// imported it for one number would pull `getDatabase` into the UI layer, which
// is the rule `constants/bills.ts` exists to keep. So the figures come from
// `constants/bills.ts` and `toleranceFor` lives here, with `bills_service.ts`
// importing it back — ONE implementation, so the sentence on the screen and the
// comparison in the matcher can never disagree about what counts as a match.
//
// SAYS WHAT THE CODE DOES, NOT WHAT THE SPEC ASKS FOR. Rule 15 also caps the
// date window at "half the bill's period"; `matchWindowFor` below is that cap,
// and `findBillPaymentCandidates` matches through the same function, so this
// summary reports the window the matcher really enforces. A screen that recited
// the spec at a user whose app behaves differently would be worse than the
// blank rows it replaces — and now that the matcher clamps, a summary still
// printing a flat 7/15 would be that same lie in the other direction (GAP-112).
import {
  ESTIMATED_TOLERANCE_PCT,
  FIXED_TOLERANCE_CENTAVOS,
  FIXED_TOLERANCE_PCT,
  LADDER_THRESHOLD,
  OVERDUE_WINDOW_DAYS,
  WINDOW_CLOSES_DAYS_AFTER,
  WINDOW_OPENS_DAYS_BEFORE,
} from "@/constants/bills";
import type { Bill, Centavos, DueRule, IsoDate } from "@/types/domain";

import type { AmountEstimate } from "./amount_estimator";
import { periodDays } from "./due_rules";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** `20` -> `20th`. An unanswered number stays visibly unanswered. */
function ordinal(day: number): string {
  if (!Number.isFinite(day)) return "—";
  const teens = Math.abs(day) % 100;
  if (teens >= 11 && teens <= 13) return `${day}th`;
  switch (Math.abs(day) % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? "that day";
}

/**
 * The weekend shift as a clause, in the spec's own shape.
 *
 * `every-n-weeks` never gets one: `adjustOf` in lib/bills/due_rules.ts returns
 * `"none"` for week-based rules, so a clause here would promise a shift that
 * cannot happen.
 *
 * THE CLAUSE DESCRIBES THE RULE, NOT THIS CYCLE. A weekend date at the very
 * end of a month falls back to the opposite direction rather than leaving the
 * month (see due_rules.ts), so the exact fact for the occurrence on screen is
 * the unadjusted-date line the detail renders beside this, not this sentence.
 */
function weekendClause(rule: DueRule): string {
  if (rule.kind === "every-n-weeks") return "";
  const adjust = rule.weekdayAdjust ?? "none";
  if (adjust === "none") return "";
  return adjust === "earlier"
    ? "; moves to the Friday before if it lands on a weekend"
    : "; moves to the Monday after if it lands on a weekend";
}

function baseDueRuleLabel(rule: DueRule): string {
  switch (rule.kind) {
    case "day-of-month":
      return `Every ${ordinal(rule.day)}`;
    case "last-day-of-month":
      // The spec's *katapusan* — the final calendar day, not the 30th.
      return "The last day of every month";
    case "semi-monthly":
      return "Every 15th and the last day of the month";
    case "every-n-weeks":
      return rule.n === 1
        ? `Every ${weekdayName(rule.weekday)}`
        : `Every ${rule.n} weeks on ${weekdayName(rule.weekday)}`;
    case "every-n-months":
      return rule.n === 1
        ? `Every ${ordinal(rule.day)}`
        : `Every ${rule.n} months on the ${ordinal(rule.day)}`;
  }
}

/** Spec's example: `Every 20th; moves to Friday if it lands on a weekend`. */
export function dueRuleLabel(rule: DueRule): string {
  return `${baseDueRuleLabel(rule)}${weekendClause(rule)}`;
}

/** One offset as the form itself words it (rule 10). Negative is before. */
function offsetPhrase(offset: number): string {
  if (offset >= 0) return "on the due date";
  const days = Math.abs(offset);
  return days === 1 ? "1 day before" : `${days} days before`;
}

/**
 * Rule 10's schedule, read back. `[-3, 0]` — the default the create flow
 * applies without asking — becomes "3 days before and on the due date".
 *
 * NO DELIVERY TIME. 9:00 AM lives in `bill_reminders.ts`, which reaches
 * expo-notifications and so cannot be imported from a screen; repeating the
 * number here would be a second copy free to drift from the scheduler.
 */
export function reminderScheduleLabel(offsets: number[]): string {
  if (offsets.length === 0) return "No reminders for this bill.";

  const phrases = [...offsets].sort((a, b) => a - b).map(offsetPhrase);
  const last = phrases[phrases.length - 1];
  const joined =
    phrases.length === 1
      ? last
      : phrases.length === 2
        ? `${phrases[0]} and ${last}`
        : `${phrases.slice(0, -1).join(", ")}, and ${last}`;

  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/**
 * Rule 14's two tolerance bands, which differ by amount mode.
 *
 * MOVED HERE FROM `bills_service.ts` (GAP-085), unchanged. It is the number the
 * detail screen has to print, and the matcher imports it back so the two cannot
 * drift apart.
 */
export function toleranceFor(bill: Bill, estimate: AmountEstimate): Centavos {
  if (bill.amountMode === "fixed") {
    // "±₱30.00 or ±3% of the amount, whichever is greater" — the allowance that
    // absorbs an e-wallet's ₱7.00 bills-payment convenience fee.
    return Math.max(FIXED_TOLERANCE_CENTAVOS, (estimate.amount * FIXED_TOLERANCE_PCT) / 100);
  }
  return (estimate.amount * ESTIMATED_TOLERANCE_PCT) / 100;
}

/** How far either side of a due date the matcher will look, in whole days. */
export type MatchWindow = {
  opensDaysBefore: number;
  closesDaysAfter: number;
};

/**
 * Rule 15's date window for ONE cycle, with its half-period clamp applied.
 *
 * Rule 15: "opens 7 days before the (adjusted) due date and closes 15 days
 * after it, but never wider than half the bill's period (so weekly bills use a
 * proportionally tighter window)."
 *
 * PER EDGE, NOT PER TOTAL WIDTH. Read as a cap on the whole span, "never wider
 * than half" would make the rule contradict its own first clause: 7 + 15 is 22
 * days, already wider than half a monthly period, so no bill could ever get the
 * 7 and 15 the same sentence promises. Read per edge it is consistent, and it
 * is the reading the parenthetical points at — half the period on each side is
 * exactly the width at which one cycle's window stops reaching the next cycle's
 * due date, which is the whole failure a weekly bill had.
 *
 * HALF IS FLOORED. A weekly period halves to 3.5, and rule 15's words are
 * "never WIDER than half" — 4 is wider. Rounding up would also undo the clamp's
 * one job: two adjacent weekly windows of 4 days each side overlap on two days,
 * so both cycles would offer the same payment again.
 *
 * RULE 26 REPLACES THE CLAMPED CLOSE, IT DOES NOT STACK WITH IT. Rule 26:
 * "auto-match against an overdue cycle stays active for 30 days past the due
 * date (SUPERSEDING RULE 15'S CLOSE)". Rule 15's close is the whole close —
 * "15 days after it" and the cap on it alike — so an overdue cycle takes 30
 * days flat. Keeping the clamp on top would repeal rule 26 for every bill whose
 * period is under 60 days, monthly included (half of 30 is 15, so the close
 * would stay 15 and never reach 30), and a late Meralco payment is the exact
 * case rule 26 was written for. The OPEN edge has no such supersession and is
 * clamped in both states.
 */
export function matchWindowFor(rule: DueRule, dueDate: IsoDate, overdue: boolean): MatchWindow {
  const half = Math.floor(periodDays(rule, dueDate) / 2);

  return {
    opensDaysBefore: Math.min(WINDOW_OPENS_DAYS_BEFORE, half),
    closesDaysAfter: overdue ? OVERDUE_WINDOW_DAYS : Math.min(WINDOW_CLOSES_DAYS_AFTER, half),
  };
}

/**
 * Rule 13's definition of an `autoMatchRule`, as facts rather than as prose:
 * "merchant keyword set + amount tolerance + date window", plus where the
 * confirmation ladder has got to.
 *
 * Facts, not sentences, because every peso on this screen goes through
 * `formatCentavos` (components/ui/amount_text.tsx is the app's only money
 * formatter) and `lib/` must not reach into `components/` to get it.
 */
export type AutoMatchFacts =
  | { enabled: false }
  | {
      enabled: true;
      /** Exactly what `scoreCandidate` looks for in a merchant string. */
      merchantPattern: string;
      /** Rule 14, unrounded — the figure the matcher itself compares against. */
      toleranceCentavos: Centavos;
      /** Rule 15 AFTER its half-period clamp, so 7 and 15 are ceilings here. */
      opensDaysBefore: number;
      closesDaysAfter: number;
      /** Rule 26 keeps an overdue cycle's window open this long instead. */
      overdueClosesDaysAfter: number;
      /** Rule 13's "No" branch: merchants this bill will never be offered. */
      excludedKeywords: string[];
      /** True once rule 13's ladder is earned and matching goes silent. */
      silent: boolean;
      /** Confirmations still needed before that happens. */
      confirmationsLeft: number;
    };

export function autoMatchFacts(
  bill: Bill,
  estimate: AmountEstimate,
  /** The cycle on screen: rule 15's clamp is a fact about a due date, not a bill. */
  dueDate: IsoDate,
): AutoMatchFacts {
  const rule = bill.autoMatchRule;
  // No rule means the user never opted into matching for this bill — the same
  // test `shouldAutoMatch` makes before anything else.
  if (rule === null) return { enabled: false };

  const streak = rule.confirmedStreak ?? 0;
  // The not-yet-overdue window, because both of its edges are what the sentence
  // on screen names; rule 26's 30 days is stated separately beside them.
  const matchWindow = matchWindowFor(bill.dueRule, dueDate, false);

  return {
    enabled: true,
    merchantPattern: rule.merchantPattern,
    toleranceCentavos: toleranceFor(bill, estimate),
    opensDaysBefore: matchWindow.opensDaysBefore,
    closesDaysAfter: matchWindow.closesDaysAfter,
    overdueClosesDaysAfter: OVERDUE_WINDOW_DAYS,
    excludedKeywords: rule.excludedKeywords ?? [],
    silent: streak >= LADDER_THRESHOLD,
    confirmationsLeft: Math.max(0, LADDER_THRESHOLD - streak),
  };
}
