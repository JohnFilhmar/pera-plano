// mobile/lib/ai/tools/__tests__/period_range.test.ts
//
// THE OFF-BY-ONE HERE IS A WHOLE MISSING DAY OF SPENDING, and it is silent.
// `TxFilter.to` is EXCLUSIVE (transactions_repo.ts emits `occurred_at < ?`);
// `DateRange.to` is INCLUSIVE (aggregate.ts emits `date <= to`, and its header
// explains at length why). One module converts once so no handler has to hold
// both conventions in its head.
import { AI_PERIODS, resolvePeriod } from "../period_range";

/** 2026-03-15T10:00 local, a mid-month Sunday — nothing special, on purpose. */
const NOW = new Date(2026, 2, 15, 10, 0, 0).getTime();

describe("this_month", () => {
  const { dates, epochs } = resolvePeriod("this_month", NOW);

  test("starts on the first of the calendar month", () => {
    expect(dates.from).toBe("2026-03-01");
  });

  test("ends on TODAY, inclusive — not on the last day of the month", () => {
    // A period that ran to 2026-03-31 would report a month's spending as
    // though the remaining sixteen days had already happened, and the share
    // percentages would be computed against a total that does not exist yet.
    expect(dates.to).toBe("2026-03-15");
  });

  test("the epoch range is half-open and covers all of the 15th", () => {
    expect(epochs.from).toBe(new Date(2026, 2, 1, 0, 0, 0, 0).getTime());
    expect(epochs.to).toBe(new Date(2026, 2, 16, 0, 0, 0, 0).getTime());
  });
});

describe("last_month", () => {
  const { dates, epochs } = resolvePeriod("last_month", NOW);

  test("is the whole previous calendar month, both ends inclusive", () => {
    expect(dates.from).toBe("2026-02-01");
    expect(dates.to).toBe("2026-02-28");
  });

  test("the exclusive epoch bound is midnight on the 1st of THIS month", () => {
    expect(epochs.to).toBe(new Date(2026, 2, 1, 0, 0, 0, 0).getTime());
  });
});

describe("rolling windows count today as one of the days", () => {
  test("last_7_days spans seven calendar days ending today", () => {
    const { dates } = resolvePeriod("last_7_days", NOW);
    expect(dates.from).toBe("2026-03-09");
    expect(dates.to).toBe("2026-03-15");
  });

  test("last_30_days spans thirty calendar days ending today", () => {
    const { dates } = resolvePeriod("last_30_days", NOW);
    expect(dates.from).toBe("2026-02-14");
    expect(dates.to).toBe("2026-03-15");
  });
});

describe("the two shapes never disagree", () => {
  test.each(AI_PERIODS)("%s: the epoch bounds bracket the date bounds", (period) => {
    const { dates, epochs } = resolvePeriod(period, NOW);
    // from: the epoch bound is local midnight ON the inclusive first day.
    expect(epochs.from).toBe(new Date(`${dates.from}T00:00:00`).getTime());
    // to: the EXCLUSIVE epoch bound is local midnight on the day AFTER the
    // inclusive last day. Anything else drops or double-counts a day.
    const day_after = new Date(`${dates.to}T00:00:00`);
    day_after.setDate(day_after.getDate() + 1);
    expect(epochs.to).toBe(day_after.getTime());
  });

  test.each(AI_PERIODS)("%s: from is never after to", (period) => {
    const { dates, epochs } = resolvePeriod(period, NOW);
    expect(dates.from <= dates.to).toBe(true);
    expect(epochs.from).toBeLessThan(epochs.to);
  });
});

describe("month boundaries, where the off-by-one actually bites", () => {
  test("on the 1st, this_month is a single day", () => {
    const first = new Date(2026, 2, 1, 9, 0, 0).getTime();
    const { dates, epochs } = resolvePeriod("this_month", first);
    expect(dates.from).toBe("2026-03-01");
    expect(dates.to).toBe("2026-03-01");
    // Still a full day wide, not zero — a zero-width window returns no
    // transactions and reads to the user as "you have spent nothing".
    expect(epochs.to - epochs.from).toBe(86_400_000);
  });

  test("last_month from the 1st of March is February, not January", () => {
    const first = new Date(2026, 2, 1, 9, 0, 0).getTime();
    const { dates } = resolvePeriod("last_month", first);
    expect(dates.from).toBe("2026-02-01");
    expect(dates.to).toBe("2026-02-28");
  });

  test("last_month lands on a 31-day month correctly", () => {
    // 2026-01-15 -> December 2025, which has 31 days. A naive
    // 'subtract 30 days' would return 2025-12-16.
    const january = new Date(2026, 0, 15, 9, 0, 0).getTime();
    const { dates } = resolvePeriod("last_month", january);
    expect(dates.from).toBe("2025-12-01");
    expect(dates.to).toBe("2025-12-31");
  });

  test("last_month handles a leap February", () => {
    const march_2028 = new Date(2028, 2, 10, 9, 0, 0).getTime();
    const { dates } = resolvePeriod("last_month", march_2028);
    expect(dates.from).toBe("2028-02-01");
    expect(dates.to).toBe("2028-02-29");
  });

  test("last_30_days crosses a year boundary without losing a day", () => {
    const january = new Date(2026, 0, 5, 9, 0, 0).getTime();
    const { dates } = resolvePeriod("last_30_days", january);
    expect(dates.from).toBe("2025-12-07");
    expect(dates.to).toBe("2026-01-05");
  });
});

describe("AI_PERIODS is the single source of the enum", () => {
  test("holds exactly the four the grammar and the tool schemas allow", () => {
    // The GBNF grammar, the tool schemas and this array must agree. A period
    // the grammar permits but resolvePeriod cannot resolve is a crash on a
    // path the model can reach.
    expect([...AI_PERIODS]).toEqual([
      "this_month",
      "last_month",
      "last_7_days",
      "last_30_days",
    ]);
  });
});
