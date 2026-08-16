// lib/alerts/__tests__/notification_policy.test.ts — docs/06-information-
// architecture.md §6.2 rules 6 and 7, tested where they are actually decided.
//
// THIS FILE EXISTS BECAUSE `alerts_service.ts` CANNOT BE REASONED ABOUT IN A
// TEST CHEAPLY. It imports `expo-notifications` and the native listener, both
// of which have to be mocked wholesale before the module can even be required.
// Every judgement the two rules make is therefore in `notification_policy.ts`,
// which imports neither, and this file is the exhaustive proof of those
// judgements. `alerts_service.test.ts` proves the transport carries them out.
//
// EVERY INSTANT IS BUILT WITH THE LOCAL `Date` CONSTRUCTOR, never a UTC string
// parse — `lib/clock.ts`'s `fixedClock` doc says why: this is local-calendar
// math, and a UTC-parsed fixture agrees with a UTC-based bug.
import {
  COALESCE_MAX_INDIVIDUAL,
  COALESCE_WINDOW_MS,
  EMPTY_BURST,
  MINUTES_PER_DAY,
  isWithinQuietHours,
  localMinuteOfDay,
  planBurst,
  planHeld,
  quietHoursDelivery,
  quietHoursEndAfter,
  type BurstState,
  type QuietHours,
} from "../notification_policy";

/** IA §6.2 rule 7's stated default: 21:00 to 08:00. */
const DEFAULT_WINDOW: QuietHours = { enabled: true, startMinute: 1260, endMinute: 480 };

/** A window that does NOT wrap midnight — a user may set 01:00-06:00. */
const NARROW_WINDOW: QuietHours = { enabled: true, startMinute: 60, endMinute: 360 };

/** Wednesday 2026-08-19, so "tomorrow" is never a month or year boundary. */
function at(hour: number, minute: number, day = 19): number {
  return new Date(2026, 7, day, hour, minute).getTime();
}

// ===========================================================================
// Quiet hours — the wrapping window (rule 7)
// ===========================================================================

describe("localMinuteOfDay reads LOCAL wall-clock minutes", () => {
  test.each([
    [0, 0, 0],
    [7, 59, 479],
    [8, 0, 480],
    [20, 59, 1259],
    [21, 0, 1260],
    [23, 59, 1439],
  ])("%i:%i is minute %i", (hour, minute, expected) => {
    expect(localMinuteOfDay(at(hour, minute))).toBe(expected);
  });

  test("the last minute of the day is one short of a full day", () => {
    expect(localMinuteOfDay(at(23, 59))).toBe(MINUTES_PER_DAY - 1);
  });
});

describe("isWithinQuietHours: the default 21:00-08:00 window WRAPS midnight", () => {
  // THE TEST THAT MATTERS MOST IN THIS FILE. `start <= m && m < end` is empty
  // for every minute when start (1260) > end (480) — it does not throw, it
  // reports "never quiet", and rule 7 becomes a no-op that looks implemented.
  // Every one of these six cases passes under that bug except the four marked
  // `true`, so the `true`s are the assertion and the `false`s are the fence.
  test.each([
    ["20:59 — one minute before it starts", at(20, 59), false],
    ["21:00 — the first quiet minute", at(21, 0), true],
    ["23:59 — the last minute before midnight", at(23, 59), true],
    ["00:00 — midnight itself, the far side of the wrap", at(0, 0), true],
    ["07:59 — the last quiet minute", at(7, 59), true],
    ["08:00 — the first minute after it ends", at(8, 0), false],
  ] as const)("%s", (_name, instant, expected) => {
    expect(isWithinQuietHours(instant, DEFAULT_WINDOW)).toBe(expected);
  });

  test("02:00 — rule 7's own named example — is inside", () => {
    expect(isWithinQuietHours(at(2, 0), DEFAULT_WINDOW)).toBe(true);
  });

  test("midday is nowhere near it", () => {
    expect(isWithinQuietHours(at(12, 0), DEFAULT_WINDOW)).toBe(false);
  });
});

describe("isWithinQuietHours: a NON-wrapping window is handled on its own branch", () => {
  test.each([
    ["00:59 — before it starts", at(0, 59), false],
    ["01:00 — the first quiet minute", at(1, 0), true],
    ["05:59 — the last quiet minute", at(5, 59), true],
    ["06:00 — the first minute after it ends", at(6, 0), false],
    ["23:00 — outside, and NOT swept in by a wrap that does not apply", at(23, 0), false],
  ] as const)("%s", (_name, instant, expected) => {
    expect(isWithinQuietHours(instant, NARROW_WINDOW)).toBe(expected);
  });
});

describe("isWithinQuietHours: the two ways it must report 'not quiet'", () => {
  test("disabled means never, whatever the bounds say", () => {
    const off: QuietHours = { ...DEFAULT_WINDOW, enabled: false };
    expect(isWithinQuietHours(at(2, 0), off)).toBe(false);
    expect(isWithinQuietHours(at(21, 0), off)).toBe(false);
  });

  test("a degenerate window (start === end) is EMPTY, not all day", () => {
    // Under the wrapping formula `m >= start || m < start` is true for every
    // minute of the day, so this user would hold every notification the app
    // ever produced, forever, with nothing to see but silence. Failing towards
    // "notifications keep flowing" is the only safe direction.
    const degenerate: QuietHours = { enabled: true, startMinute: 600, endMinute: 600 };
    for (const hour of [0, 6, 10, 12, 18, 23]) {
      expect(isWithinQuietHours(at(hour, 0), degenerate)).toBe(false);
    }
  });
});

describe("quietHoursEndAfter finds the NEXT end, in local calendar terms", () => {
  test("02:00 ends at 08:00 the SAME morning", () => {
    expect(quietHoursEndAfter(at(2, 0), DEFAULT_WINDOW)).toBe(at(8, 0));
  });

  test("21:00 ends at 08:00 the NEXT morning, not tonight", () => {
    expect(quietHoursEndAfter(at(21, 0), DEFAULT_WINDOW)).toBe(at(8, 0, 20));
  });

  test("23:59 crosses midnight to the next morning", () => {
    expect(quietHoursEndAfter(at(23, 59), DEFAULT_WINDOW)).toBe(at(8, 0, 20));
  });

  test("00:00 — already past the wrap — ends the same morning", () => {
    expect(quietHoursEndAfter(at(0, 0), DEFAULT_WINDOW)).toBe(at(8, 0));
  });

  test("07:59 ends one minute later", () => {
    expect(quietHoursEndAfter(at(7, 59), DEFAULT_WINDOW)).toBe(at(8, 0));
  });

  test("08:00 exactly rolls to tomorrow — the contract is STRICTLY after", () => {
    expect(quietHoursEndAfter(at(8, 0), DEFAULT_WINDOW)).toBe(at(8, 0, 20));
  });

  test("a non-wrapping window ends the same morning", () => {
    expect(quietHoursEndAfter(at(2, 0), NARROW_WINDOW)).toBe(at(6, 0));
  });

  test("crosses a month boundary without arithmetic on milliseconds", () => {
    // 2026-08-31 22:00 → 2026-09-01 08:00. A `+ 10 * 3600_000` shortcut gets
    // this one right and gets a DST transition wrong; local calendar fields
    // get both right.
    const lastNightOfAugust = new Date(2026, 7, 31, 22, 0).getTime();
    expect(quietHoursEndAfter(lastNightOfAugust, DEFAULT_WINDOW)).toBe(
      new Date(2026, 8, 1, 8, 0).getTime(),
    );
  });
});

describe("quietHoursDelivery — the one call the transport makes", () => {
  test("null outside the window: post it now", () => {
    expect(quietHoursDelivery(at(20, 59), DEFAULT_WINDOW)).toBeNull();
    expect(quietHoursDelivery(at(8, 0), DEFAULT_WINDOW)).toBeNull();
  });

  test("inside the window: the instant to hold it until", () => {
    expect(quietHoursDelivery(at(2, 0), DEFAULT_WINDOW)).toBe(at(8, 0));
  });

  test("computes FORWARD FROM THE INSTANT GIVEN, not from today", () => {
    // R4, and the reason `scheduleReminder` passes `fireAt` here rather than
    // `now`: a bill reminder set for 22:00 three days out belongs at 08:00 on
    // the FOURTH morning. Shifting from the current time instead passes every
    // test where fireAt happens to be tonight and moves every other reminder
    // to the wrong morning.
    const threeNightsOut = at(22, 0, 22);
    expect(quietHoursDelivery(threeNightsOut, DEFAULT_WINDOW)).toBe(at(8, 0, 23));
  });

  test("a reminder already outside the window is left exactly where it was", () => {
    // Bills schedule at 09:00 (bill_reminders.ts's REMINDER_HOUR) — the common
    // case, and it must not be nudged.
    expect(quietHoursDelivery(at(9, 0, 22), DEFAULT_WINDOW)).toBeNull();
  });
});

// ===========================================================================
// Global coalescing (rule 6)
// ===========================================================================

describe("planBurst: the first three alerts arrive as themselves", () => {
  test("threshold is 'more than 3', so three post individually", () => {
    expect(COALESCE_MAX_INDIVIDUAL).toBe(3);

    let state: BurstState = EMPTY_BURST;
    for (let n = 1; n <= 3; n += 1) {
      const plan = planBurst(state, at(12, 0) + n * 1000);
      expect(plan.mode).toBe("individual");
      expect(plan.count).toBe(n);
      expect(plan.dismiss).toEqual([]);
      state = { ...plan.carry, individualIds: [...plan.carry.individualIds, `os-${n}`] };
    }
    expect(state.individualIds).toEqual(["os-1", "os-2", "os-3"]);
  });
});

describe("planBurst: the fourth alert collapses the burst", () => {
  const now = at(12, 0);
  const threeStanding: BurstState = {
    postedAt: [now - 3000, now - 2000, now - 1000],
    individualIds: ["os-1", "os-2", "os-3"],
    summaryId: null,
  };

  test("posts a summary instead of the alert, and clears the three already in the shade", () => {
    const plan = planBurst(threeStanding, now);

    expect(plan.mode).toBe("summary");
    expect(plan.count).toBe(4);
    expect(plan.dismiss).toEqual(["os-1", "os-2", "os-3"]);
    expect(plan.carry.individualIds).toEqual([]);
  });

  test("the summary REPLACES ITSELF as the burst grows — never two summaries", () => {
    const collapsed: BurstState = {
      postedAt: [now - 3000, now - 2000, now - 1000, now - 500],
      individualIds: [],
      summaryId: "os-summary-4",
    };

    const plan = planBurst(collapsed, now);
    expect(plan.mode).toBe("summary");
    expect(plan.count).toBe(5);
    // "4 updates" must not sit in the shade beside "5 updates".
    expect(plan.dismiss).toEqual(["os-summary-4"]);
  });
});

describe("planBurst: the window slides, so a trickle never coalesces", () => {
  test("entries older than the window stop counting and the burst restarts", () => {
    const now = at(12, 0);
    const stale: BurstState = {
      postedAt: [now - COALESCE_WINDOW_MS - 1, now - COALESCE_WINDOW_MS - 2],
      individualIds: ["os-old-1", "os-old-2"],
      summaryId: null,
    };

    const plan = planBurst(stale, now);

    expect(plan.count).toBe(1);
    expect(plan.mode).toBe("individual");
    // NOT dismissed. By now those are simply the user's older notifications,
    // not part of a burst — clearing them would delete alerts they never saw
    // collapsed into anything.
    expect(plan.dismiss).toEqual([]);
    expect(plan.carry.individualIds).toEqual([]);
  });

  test("an entry exactly on the window edge has aged out", () => {
    const now = at(12, 0);
    const edge: BurstState = { postedAt: [now - COALESCE_WINDOW_MS], individualIds: ["os-1"], summaryId: null };
    expect(planBurst(edge, now).count).toBe(1);
  });

  test("one alert every ten minutes never collapses, however long it runs", () => {
    let state: BurstState = EMPTY_BURST;
    for (let n = 0; n < 10; n += 1) {
      const now = at(12, 0) + n * 10 * 60 * 1000;
      const plan = planBurst(state, now);
      expect(plan.mode).toBe("individual");
      expect(plan.count).toBe(1);
      state = { ...plan.carry, individualIds: [...plan.carry.individualIds, `os-${n}`] };
    }
  });

  test("four alerts inside the window DO collapse, even spread across it", () => {
    const start = at(12, 0);
    let state: BurstState = EMPTY_BURST;
    let last = planBurst(state, start);
    for (let n = 1; n <= 3; n += 1) {
      state = { ...last.carry, individualIds: [...last.carry.individualIds, `os-${n}`] };
      last = planBurst(state, start + n * 60_000);
    }
    expect(last.mode).toBe("summary");
    expect(last.count).toBe(4);
  });
});

// ===========================================================================
// The overnight hold (rules 6 and 7 together)
// ===========================================================================

describe("planHeld: a night's worth of held alerts collapses too", () => {
  const morning = at(8, 0);

  test("the first three are held individually", () => {
    expect(planHeld(null, [], morning)).toEqual({
      count: 1,
      mode: "individual",
      cancel: [],
      keep: [],
    });
    expect(planHeld({ endAt: morning, count: 2 }, ["a", "b"], morning)).toEqual({
      count: 3,
      mode: "individual",
      cancel: [],
      keep: ["a", "b"],
    });
  });

  test("the fourth cancels all three and schedules ONE summary in their place", () => {
    // R7's own statement: six alerts held overnight must NOT fire as six
    // separate notifications at 08:00.
    const plan = planHeld({ endAt: morning, count: 3 }, ["a", "b", "c"], morning);

    expect(plan.mode).toBe("summary");
    expect(plan.count).toBe(4);
    expect(plan.cancel).toEqual(["a", "b", "c"]);
    expect(plan.keep).toEqual([]);
  });

  test("the summary keeps replacing itself, so the count stays truthful", () => {
    const plan = planHeld({ endAt: morning, count: 5 }, ["summary-5"], morning);

    expect(plan.count).toBe(6);
    expect(plan.mode).toBe("summary");
    expect(plan.cancel).toEqual(["summary-5"]);
  });

  test("a record from a PREVIOUS night starts over, and its ids are dropped not cancelled", () => {
    // Cancelling them would either be a no-op (they already fired) or would
    // silently drop an alert rule 7 promised to deliver.
    const lastNight = { endAt: at(8, 0, 18), count: 5 };

    const plan = planHeld(lastNight, ["stale-1", "stale-2"], morning);

    expect(plan.count).toBe(1);
    expect(plan.mode).toBe("individual");
    expect(plan.cancel).toEqual([]);
    expect(plan.keep).toEqual([]);
  });
});
