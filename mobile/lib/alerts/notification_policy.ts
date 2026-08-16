// lib/alerts/notification_policy.ts — the two notification-governance rules
// docs/06-information-architecture.md §6.2 states and nothing in the app had
// implemented: rule 6 (global cross-channel coalescing) and rule 7 (quiet
// hours).
//
//   6. Global coalescing: if more than 3 notifications would post within a few
//      minutes (e.g., catch-up after reconnecting), they collapse into one
//      summary notification ("3 updates while you were away").
//   7. Quiet hours (default 21:00-08:00, user-adjustable): everything except
//      listener-health warnings is held and delivered after quiet hours end;
//      100% limit breaches are delivered at the start of the next morning, not
//      dropped.
//
// PURE, AND THAT IS THE WHOLE REASON THIS FILE EXISTS SEPARATELY FROM
// `alerts_service.ts`. Anything that imports `expo-notifications` — or
// `@/modules/notification_listener` — cannot be required under Jest in this
// project at all; that constraint is why `limit_notifier.ts`,
// `bill_reminders.ts` and `loan_reminders.ts` are already split away from
// their own services. So every DECISION lives here, over plain numbers, and
// `alerts_service.ts` stays a transport that asks this file what to do and
// then does it. A rule that cannot be required in a test is a rule that is
// only ever verified by hand.
//
// NOTHING HERE READS THE CLOCK. Every function takes the instant it reasons
// about (lib/clock.ts's rule: engines take `now: number`; only composition
// edges reach for `systemClock`). A default parameter of `Date.now()` is
// exactly the shape d52e7b8 removed from `lib/ingest/pipeline.ts` — a test
// that forgets to pass an instant silently gets wall-clock and passes anyway,
// which is how a date bug survives a green suite.
import type { EpochMs } from "@/types/domain";

// ===========================================================================
// Quiet hours (rule 7)
// ===========================================================================

/** Minutes in a day. The unit both quiet-hours bounds are expressed in. */
export const MINUTES_PER_DAY = 24 * 60;

/**
 * The user's quiet-hours window, in MINUTES FROM LOCAL MIDNIGHT.
 *
 * Minutes rather than `"HH:MM"` strings or epoch instants because the window
 * is a WALL-CLOCK concept: "21:00" has to keep meaning 9pm on whatever day it
 * is, after a DST transition, and after the user flies to another timezone
 * with the app installed. An instant would freeze one particular 9pm; a
 * formatted string would need parsing at every comparison.
 *
 * Stored as `quiet_hours_enabled` / `quiet_hours_start_minute` /
 * `quiet_hours_end_minute` in `lib/db/repos/app_settings_repo.ts`, which is
 * also where the 21:00-08:00 defaults §6.2 rule 7 names are written down.
 */
export type QuietHours = {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
};

/**
 * The local wall-clock minute of day an instant falls on — 0 for midnight,
 * 1259 for 20:59, 1260 for 21:00.
 *
 * `getHours()`/`getMinutes()`, never `getUTC*`: 21:00 in Manila is 13:00 UTC,
 * so a UTC-derived minute-of-day would put the whole window eight hours off
 * and quiet hours would start in the middle of the afternoon.
 */
export function localMinuteOfDay(at: EpochMs): number {
  const d = new Date(at);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Whether an instant falls inside quiet hours.
 *
 * THE WINDOW WRAPS MIDNIGHT, AND THAT IS THE BUG THIS FUNCTION EXISTS TO
 * PREVENT. The default window is 21:00-08:00 — `startMinute` (1260) is
 * GREATER than `endMinute` (480), so the obvious
 *
 *     startMinute <= m && m < endMinute
 *
 * is empty for every minute of the day. It does not crash, it does not warn:
 * it silently reports "never quiet" and turns rule 7 into a no-op that looks
 * implemented. A wrapping window is the union of two half-open intervals —
 * `[start, midnight)` and `[midnight, end)` — hence the `||`.
 *
 * The NON-wrapping case is real too and handled on its own branch: a user who
 * sets 01:00-06:00 has `start < end` and means the ordinary interval.
 *
 * A DEGENERATE WINDOW (`start === end`) IS TREATED AS EMPTY, never as all
 * day. Under the wrapping formula `m >= start || m < start` is true for every
 * minute, so a user who set both ends to the same time would hold every
 * notification the app ever produced, forever, with no way to notice except
 * silence. Failing towards "notifications keep flowing" is the only safe
 * direction here.
 */
export function isWithinQuietHours(at: EpochMs, quiet: QuietHours): boolean {
  if (!quiet.enabled) return false;
  if (quiet.startMinute === quiet.endMinute) return false;

  const minute = localMinuteOfDay(at);
  return quiet.startMinute < quiet.endMinute
    ? minute >= quiet.startMinute && minute < quiet.endMinute
    : minute >= quiet.startMinute || minute < quiet.endMinute;
}

/**
 * The next instant at which quiet hours end, STRICTLY AFTER `at`.
 *
 * Built from local calendar fields (`new Date(y, m, d + offset, h, min)`), not
 * from `at + someNumberOfMilliseconds`. The two agree in a zone with no
 * daylight saving, which the Philippines is — but "08:00 tomorrow" is a
 * statement about the calendar, not a duration, and the field-based
 * construction is the one that stays correct if that ever stops being true.
 * `lib/dates.ts`'s `addDaysIso` makes the same call for the same reason.
 *
 * Rolls to tomorrow when the end minute has already passed today, INCLUDING
 * when it is exactly now: at 08:00 sharp the current quiet period has already
 * ended, so the next end is tomorrow's.
 */
export function quietHoursEndAfter(at: EpochMs, quiet: QuietHours): EpochMs {
  const d = new Date(at);
  const dayOffset = quiet.endMinute > localMinuteOfDay(at) ? 0 : 1;
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + dayOffset,
    Math.floor(quiet.endMinute / 60),
    quiet.endMinute % 60,
    0,
    0,
  ).getTime();
}

/**
 * The one call `alerts_service.ts` makes for rule 7: when should an alert
 * raised at `at` actually be delivered?
 *
 * `null` means "right now, nothing to hold". A number is the instant to hold
 * it until — always the END of the quiet period `at` falls in, computed
 * FORWARD FROM `at` rather than from the current time. That distinction is
 * the whole of R4: a bill reminder due at 22:00 three days from now belongs at
 * 08:00 on the FOURTH morning, not at tomorrow's 08:00 and not now.
 */
export function quietHoursDelivery(at: EpochMs, quiet: QuietHours): EpochMs | null {
  return isWithinQuietHours(at, quiet) ? quietHoursEndAfter(at, quiet) : null;
}

// ===========================================================================
// Global coalescing (rule 6)
// ===========================================================================

/**
 * Rule 6's "more than 3". Three alerts still arrive as themselves; the FOURTH
 * is what collapses the burst into a summary.
 */
export const COALESCE_MAX_INDIVIDUAL = 3;

/** Rule 6's "within a few minutes", pinned to a number. */
export const COALESCE_WINDOW_MS = 5 * 60 * 1000;

/**
 * What the app currently has standing in the notification shade for the burst
 * in progress.
 *
 * `postedAt` is one entry per alert the burst has covered, oldest first — its
 * length is the burst's count. `individualIds` are the alerts posted as
 * themselves and not yet replaced; `summaryId` is the single summary that
 * replaced them, once the burst passed the threshold.
 *
 * IN-MEMORY STATE IS CORRECT FOR *THIS* RULE, unlike the overnight case. A
 * five-minute burst is within one JS session by definition — if the process
 * dies mid-burst there is no burst left to coalesce, only notifications
 * already delivered, which is the right outcome. The quiet-hours hold is the
 * opposite (it spans a process kill by design) and is recorded in
 * `app_settings` instead.
 */
export type BurstState = {
  postedAt: EpochMs[];
  individualIds: string[];
  summaryId: string | null;
};

/** A burst that has not started (or has lapsed). */
export const EMPTY_BURST: BurstState = { postedAt: [], individualIds: [], summaryId: null };

export type BurstPlan = {
  /** How many alerts the burst covers, counting the one about to post. */
  count: number;
  /** Post the alert as itself, or post one summary standing for `count`. */
  mode: "individual" | "summary";
  /** Notifications to clear from the shade before posting. */
  dismiss: string[];
  /**
   * The burst state to carry forward — complete except for the id the post
   * has not returned yet, which the caller folds in.
   */
  carry: BurstState;
};

/**
 * Decides what a post landing at `now` should do about rule 6.
 *
 * POST FIRST, THEN COLLAPSE — never buffer. The literal reading of "more than
 * 3 notifications would post within a few minutes ... collapse into one" is a
 * buffer: hold everything for a few seconds, then decide. That is a worse
 * app. It adds latency to EVERY alert the app sends, including the single
 * limit alert that is 99% of them, and a process death mid-buffer loses the
 * alert outright — which rule 7's own "not dropped" says is the failure that
 * matters. Posting immediately and dismissing the individual ones when a
 * fourth arrives reaches the same end state (one notification in the shade,
 * summarising the burst) with no delay and nothing at risk.
 *
 * THE WINDOW SLIDES. Entries older than `COALESCE_WINDOW_MS` stop counting,
 * so a slow trickle of one alert every ten minutes never coalesces however
 * long it runs. When every entry has aged out the burst is over and the state
 * resets — the notifications it left in the shade are deliberately NOT
 * dismissed at that point, because by then they are just the user's older
 * notifications rather than part of a burst.
 */
export function planBurst(state: BurstState, now: EpochMs): BurstPlan {
  const live = state.postedAt.filter((at) => at > now - COALESCE_WINDOW_MS);
  const base: BurstState = live.length > 0 ? { ...state, postedAt: live } : EMPTY_BURST;
  const count = base.postedAt.length + 1;
  const postedAt = [...base.postedAt, now];

  if (count <= COALESCE_MAX_INDIVIDUAL) {
    return {
      count,
      mode: "individual",
      dismiss: [],
      carry: { ...base, postedAt },
    };
  }

  return {
    count,
    mode: "summary",
    // Both the individually-posted ones AND any summary already standing: the
    // summary replaces itself as the burst grows, so "4 updates" must not sit
    // in the shade beside "5 updates".
    dismiss: [...base.individualIds, ...(base.summaryId === null ? [] : [base.summaryId])],
    carry: { postedAt, individualIds: [], summaryId: null },
  };
}

// ===========================================================================
// The overnight hold (rules 6 and 7 together)
// ===========================================================================

/**
 * The durable half of the same collapse, for alerts held across quiet hours.
 *
 * THE OVERNIGHT CASE IS THE PRIMARY ONE, not an edge case. Rule 6's own
 * example phrase is "3 updates while you were AWAY" — the catch-up scenario,
 * not a live burst — and six alerts held from 02:00 must not arrive as six
 * separate notifications at 08:00. The burst bookkeeping above cannot do this
 * job: the app will usually be killed at some point overnight, taking module
 * state with it, so the held record lives in `app_settings`
 * (`quiet_hours_held_ids` / `quiet_hours_held_period`).
 *
 * `endAt` is what makes the record self-expiring. Without it, alerts held on
 * Monday night would keep counting into Tuesday night on a device that posted
 * nothing in between, and the summary would claim a count spanning two
 * nights. Comparing the stored `endAt` against the quiet-hours end computed
 * for the incoming alert answers "same period?" with no timer and no
 * daytime bookkeeping pass.
 */
export type HeldPeriod = { endAt: EpochMs; count: number };

export type HeldPlan = {
  /** How many alerts this quiet period has held, counting the incoming one. */
  count: number;
  /** Schedule the alert itself, or one summary standing for `count`. */
  mode: "individual" | "summary";
  /** Already-scheduled ids to cancel before scheduling. */
  cancel: string[];
  /** The ids that survive the plan — everything not in `cancel`. */
  keep: string[];
};

/**
 * Decides what to do with one alert being held until `deliverAt`, given what
 * this quiet period has already held.
 *
 * A `period` for a DIFFERENT `endAt` is a previous night's record: its count
 * starts over and its ids are dropped from the record rather than cancelled.
 * They were scheduled for a morning that has already come, so cancelling them
 * would either be a no-op (already fired) or would silently drop an alert rule
 * 7 promised to deliver.
 */
export function planHeld(
  period: HeldPeriod | null,
  heldIds: string[],
  deliverAt: EpochMs,
): HeldPlan {
  const samePeriod = period !== null && period.endAt === deliverAt;
  const priorCount = samePeriod ? period.count : 0;
  const priorIds = samePeriod ? heldIds : [];
  const count = priorCount + 1;

  if (count <= COALESCE_MAX_INDIVIDUAL) {
    return { count, mode: "individual", cancel: [], keep: priorIds };
  }
  return { count, mode: "summary", cancel: priorIds, keep: [] };
}
