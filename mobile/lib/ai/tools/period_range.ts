// mobile/lib/ai/tools/period_range.ts
//
// ONE MODULE CONVERTS ONCE, so no tool handler has to hold two conventions in
// its head. Three of the four AI periods have no `LimitScope` at all, and the
// two consumers disagree about their upper bound:
//
//   `DateRange.to`  is INCLUSIVE  — aggregate.ts emits `date <= to`
//   `TxFilter.to`   is EXCLUSIVE  — transactions_repo.ts emits `occurred_at < ?`
//
// A handler that got this wrong would drop or double-count a whole day of
// spending, silently, and the number would still look plausible.
import { addDaysIso, parseDateIso, toDateIso } from "@/lib/dates";
import { periodForScope } from "@/lib/period";
import type { DateRange } from "@/lib/reports/aggregate";
import type { EpochMs, IsoDate } from "@/types/domain";

export type AiPeriod = "this_month" | "last_month" | "last_7_days" | "last_30_days";

/**
 * The single source of the enum. The GBNF grammar and the tool schemas are
 * generated from this array, so a period the model can emit is always a period
 * `resolvePeriod` can resolve.
 */
export const AI_PERIODS = [
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
] as const satisfies readonly AiPeriod[];

export type ResolvedPeriod = {
  /** Inclusive calendar dates, for `categoryBreakdown` and friends. */
  dates: DateRange;
  /** Half-open epoch range, for `listTransactions`. `to` is EXCLUSIVE. */
  epochs: { from: EpochMs; to: EpochMs };
};

/** Local midnight on an inclusive calendar date. */
function startOfDayMs(iso: IsoDate): EpochMs {
  return parseDateIso(iso).getTime();
}

function datesFor(period: AiPeriod, today: IsoDate): DateRange {
  switch (period) {
    case "this_month":
      // Ends TODAY, not on the last day of the month. A window running to the
      // 31st reports a month's spending as though the remaining days had
      // already happened, and every share percentage is computed against a
      // total that does not exist yet.
      return { from: periodForScope("monthly", today).start, to: today };

    case "last_month": {
      // Step back one day from the 1st of this month rather than subtracting
      // 30, which lands mid-month for any 31-day month and breaks on February.
      const lastDayOfPrev = addDaysIso(periodForScope("monthly", today).start, -1);
      return { from: periodForScope("monthly", lastDayOfPrev).start, to: lastDayOfPrev };
    }

    // Rolling windows count today as one of their days: 7 days ending today is
    // today plus the six before it, matching `daysBetweenInclusive`.
    case "last_7_days":
      return { from: addDaysIso(today, -6), to: today };

    case "last_30_days":
      return { from: addDaysIso(today, -29), to: today };
  }
}

export function resolvePeriod(period: AiPeriod, now: EpochMs): ResolvedPeriod {
  const dates = datesFor(period, toDateIso(new Date(now)));

  return {
    dates,
    epochs: {
      from: startOfDayMs(dates.from),
      // The exclusive bound is local midnight on the day AFTER the inclusive
      // last day. Using `dates.to` directly would end the window at 00:00 and
      // silently drop everything spent on its final day.
      to: startOfDayMs(addDaysIso(dates.to, 1)),
    },
  };
}
