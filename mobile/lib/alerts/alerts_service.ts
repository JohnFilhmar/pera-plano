// lib/alerts/alerts_service.ts — the transport half of the alerts layer
// (m2 Task 2). `alert_copy.ts` decides WHAT an alert says; this file decides
// whether, when, and on which channel it is delivered.
//
// EVERY FUNCTION HERE TAKES AN `AlertCopy`, NEVER A TITLE AND A BODY. The m2
// plan's own encryption amendment states it outright: "A task that supplies one
// string instead of two is incomplete." A single string would let a caller post
// an amount and never learn it had done so — which is the failure docs/12 §7a
// was written to prevent, and it fails silently on a lock screen rather than in
// a test.
//
// NO `Platform` BRANCH, DELIBERATELY. PeraPlano is Android-only in the strong
// sense: the whole product reads Android notifications through a
// NotificationListenerService that has no iOS equivalent, and nothing else in
// `lib/`, `app/` or `components/` references `Platform` at all. A
// `Platform.OS !== "android"` early return here would be dead code that also
// forces every test of this file to replace the react-native module wholesale.
//
// ---------------------------------------------------------------------------
// The one thing this file cannot do, stated plainly
// ---------------------------------------------------------------------------
// docs/12 §7a says the alerts service "checks isKeyguardLocked() at post time
// and selects the variant ... because a reminder scheduled hours earlier has no
// idea what state the phone will be in when it fires."
//
// `postAlert` does exactly that. `scheduleReminder` CANNOT, and no amount of
// care makes it able to: a scheduled reminder is handed to the Android OS days
// in advance and rendered by the OS, with this app's process long dead. There
// is no post-time hook to run the check in.
//
// So a scheduled reminder ALWAYS carries the locked variant. An unlocked user
// sees less than they could have — the locked copy is written to stay
// actionable ("Meralco is due in 3 days"), so what they lose is the figure, not
// the prompt. The alternative, scheduling the unlocked copy, leaks an amount
// onto the lock screen every time the phone happens to be locked when a 9am
// reminder fires, which for a morning reminder is most of the time.
//
// KNOWN RESIDUAL, not introduced here but worth writing down: `postAlert`'s
// check is correct at the instant it posts, and a notification stays in the
// shade afterwards. A user who is unlocked when a limit alert arrives, and
// locks the phone a moment later, has an amount-bearing notification on their
// lock screen. Closing that would mean setting the channel's lockscreen
// visibility to PRIVATE, which makes Android render "Contents hidden" for BOTH
// variants and throws away the actionability §7a asks for. Left open on
// purpose; raise it with the spec owner rather than fixing it here.
//
// ---------------------------------------------------------------------------
// Notification governance — IA §6.2 rules 6 and 7
// ---------------------------------------------------------------------------
// This file is the single choke point every app-generated notification passes
// through, so it is the only place §6.2's two GLOBAL rules can be enforced
// without every notifier having to remember them:
//
//   rule 6, coalescing — more than 3 notifications inside a few minutes
//   collapse into one summary;
//   rule 7, quiet hours — everything except listener-health warnings is held
//   until the window ends, and a 100% limit breach at 2am is delivered in the
//   morning rather than dropped.
//
// EVERY DECISION IS IN `notification_policy.ts`, WHICH IMPORTS NEITHER
// `expo-notifications` NOR THE NATIVE LISTENER, and can therefore be required
// under Jest. This file only carries out what that module returns. If a
// judgement about timing ever needs to be made here, it belongs there instead.
//
// THE HOLD IS AN OS SCHEDULE, NEVER A TIMER. Rule 7's "not dropped" rules out
// every in-process design: a `setTimeout` until morning dies with the app, and
// so does an in-memory queue. Handing the notification to the Android
// scheduler with a DATE trigger is the only mechanism that survives the
// overnight process kill the app will almost certainly take. Held alerts are
// therefore rendered by the OS, hours later, with this process dead — so, for
// exactly the reason `scheduleReminder` documents above, a held alert carries
// the LOCKED variant.
//
// `systemClock.now()` IS READ HERE, and only here in the alerts layer. This is
// a composition edge in lib/clock.ts's own sense — the boundary where the app
// hands work to the operating system — the same way `startIngest` in
// `lib/ingest/pipeline.ts` is one. The instant is read once per call and
// passed into the pure policy functions, which never read a clock themselves.
import * as Notifications from "expo-notifications";

import { systemClock } from "@/lib/clock";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { isKeyguardLocked } from "@/modules/notification_listener";
import type { EpochMs } from "@/types/domain";

import { coalescedUpdatesAlertCopy, selectAlertCopy, type AlertCopy } from "./alert_copy";
import { CHANNEL_LIMITS, CHANNEL_REMINDERS, type AlertChannel } from "./channels";
import {
  EMPTY_BURST,
  isWithinQuietHours,
  planBurst,
  planHeld,
  quietHoursDelivery,
  type BurstState,
  type QuietHours,
} from "./notification_policy";

/**
 * Creates both channels. Idempotent — Android treats a repeat call as a
 * no-op for everything except name and description, so calling it on every
 * launch is both safe and the only way a fresh install gets its channels.
 */
export async function ensureNotificationChannels(): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNEL_LIMITS, {
    name: "Limit alerts",
    // Interrupting. A limit alert is the one notification this app sends that
    // is worth stopping the user for — it is the only one that is still
    // actionable when it arrives.
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_REMINDERS, {
    name: "Due-date reminders",
    // Quiet. A bill due in three days does not need to interrupt anything, and
    // a reminder that behaves like an alarm is a reminder the user turns off.
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Asks for notification permission, and does NOT ask again once granted.
 *
 * Android 13+ shows the system dialog once per app, ever. Spending that single
 * prompt on a user who has already said yes means a later genuine request
 * resolves to whatever the OS remembers, with no dialog and no explanation.
 */
export async function requestAlertPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Reads the current grant WITHOUT prompting.
 *
 * Every posting path goes through here rather than `requestAlertPermission`,
 * because posting happens from background recomputes — a ledger commit fanning
 * out to the limit engine. Putting a system permission dialog in front of a
 * user who is not looking at the app is worse than losing the notification,
 * and the in-app surface shows the event either way.
 */
async function hasPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

/**
 * A trigger meaning "now, on this channel".
 *
 * `trigger: null` is the documented way to say "immediately" and it is NOT
 * usable here: `channelId` lives on the TRIGGER in expo-notifications, and a
 * null trigger has nowhere to put one. The notification then lands on the app's
 * default channel at default importance — so `CHANNEL_LIMITS` would be created
 * with HIGH importance, be visible in Android's settings, and route nothing.
 * That failure is invisible in JS: the post succeeds and returns an id.
 *
 * A one-second interval is the smallest trigger that carries a channel. The
 * delay is immaterial for an alert that is already the asynchronous
 * consequence of a ledger commit.
 */
function immediateTrigger(channel: AlertChannel): Notifications.NotificationTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: 1,
    channelId: channel,
  };
}

/** A trigger meaning "at this instant, on this channel". */
function dateTrigger(channel: AlertChannel, at: EpochMs): Notifications.NotificationTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: new Date(at),
    channelId: channel,
  };
}

// ---------------------------------------------------------------------------
// The coalesced summary (§6.2 rule 6)
// ---------------------------------------------------------------------------

/**
 * `CHANNEL_LIMITS`, NOT `CHANNEL_REMINDERS`, for the summary that replaces a
 * burst — and not a third channel either (`channels.ts`'s header: a channel id
 * is permanent, and the type deliberately forbids inventing one).
 *
 * The summary stands in for whatever the burst contained, and a burst can
 * contain the 100% limit breach §6.2 rule 7 names by hand. Posting it on the
 * quiet channel would silently DOWNGRADE that breach from interrupting to
 * unobtrusive as a side effect of coalescing — the alert would technically be
 * delivered while losing the one property that made it worth sending. The
 * error in the other direction is a bill reminder that interrupts once,
 * inside a burst the user was going to look at anyway.
 */
const SUMMARY_CHANNEL: AlertChannel = CHANNEL_LIMITS;

/** `kind` is the tap-routing discriminant `alert_routes.ts` switches on. */
const SUMMARY_KIND = "coalescedUpdates";

/**
 * The burst in progress, module state.
 *
 * IN MEMORY IS THE RIGHT PLACE FOR THIS ONE, unlike the overnight hold. Rule
 * 6's window is five minutes, which is within a single JS session by
 * definition; if the process dies mid-burst there is no burst left to
 * coalesce, only notifications that were already delivered. The quiet-hours
 * hold is the opposite case — it is designed to span a process kill — and is
 * recorded in `app_settings` instead.
 */
let burst: BurstState = EMPTY_BURST;

/**
 * Forgets the burst in progress. FOR TESTS: module state that survived between
 * test cases would make the fourth alert of one test coalesce the first alert
 * of the next. Production never calls this — a burst expires on its own by
 * ageing out of the window.
 */
export function __resetAlertBurstForTests(): void {
  burst = EMPTY_BURST;
}

/**
 * Removes one notification the app posted, whether or not the OS has drawn it
 * yet.
 *
 * BOTH CALLS, DELIBERATELY. `dismissNotificationAsync` removes a notification
 * that has been PRESENTED; `cancelScheduledNotificationAsync` removes one that
 * is still PENDING. Every "immediate" post here rides a one-second interval
 * trigger (see `immediateTrigger`), so an alert posted a few hundred
 * milliseconds ago — which is exactly what a burst looks like — may well still
 * be pending, and dismissing it alone would leave it to appear a moment later
 * beside the summary that was supposed to replace it. Each call is a no-op for
 * the state it does not apply to.
 */
async function clearFromShade(identifier: string): Promise<void> {
  await Notifications.dismissNotificationAsync(identifier);
  await Notifications.cancelScheduledNotificationAsync(identifier);
}

// ---------------------------------------------------------------------------
// Quiet hours (§6.2 rule 7)
// ---------------------------------------------------------------------------

/** The user's window, read fresh — the Settings screen can change it any time. */
async function readQuietHours(): Promise<QuietHours> {
  return {
    enabled: await getSetting("quiet_hours_enabled"),
    startMinute: await getSetting("quiet_hours_start_minute"),
    endMinute: await getSetting("quiet_hours_end_minute"),
  };
}

/**
 * Forgets a finished quiet period's held record, so the next night starts its
 * own count from one.
 *
 * Called from the ordinary posting path rather than from a timer, because
 * there is nothing to clean up until something wants to post — and
 * `planHeld` treats a record from a different period as absent anyway, so a
 * device that posts nothing all day is still correct, just untidy.
 */
async function clearHeldRecord(): Promise<void> {
  if ((await getSetting("quiet_hours_held_period")) === null) return;
  await setSetting("quiet_hours_held_ids", []);
  await setSetting("quiet_hours_held_period", null);
}

/**
 * Hands one alert to the OS for delivery at `deliverAt`, and keeps the durable
 * record §6.2 rule 6 needs to collapse a night's worth of them into one.
 *
 * The LOCKED variant, always — see this file's header. A held alert is
 * rendered by Android hours later with this process dead, which is the same
 * situation `scheduleReminder` is in and has the same answer.
 */
async function holdUntilQuietHoursEnd(
  input: { channel: AlertChannel; copy: AlertCopy; data?: Record<string, unknown> },
  deliverAt: EpochMs,
): Promise<string> {
  const period = await getSetting("quiet_hours_held_period");
  const heldIds = await getSetting("quiet_hours_held_ids");
  const plan = planHeld(period, heldIds, deliverAt);

  for (const id of plan.cancel) await cancelScheduled(id);

  const summarising = plan.mode === "summary";
  const copy = summarising ? coalescedUpdatesAlertCopy({ count: plan.count }) : input.copy;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: copy.locked.title,
      body: copy.locked.body,
      data: summarising ? { kind: SUMMARY_KIND } : (input.data ?? {}),
    },
    trigger: dateTrigger(summarising ? SUMMARY_CHANNEL : input.channel, deliverAt),
  });

  await setSetting("quiet_hours_held_ids", [...plan.keep, id]);
  await setSetting("quiet_hours_held_period", { endAt: deliverAt, count: plan.count });
  return id;
}

/** Posts one alert now, applying rule 6's burst collapse. */
async function postImmediately(
  input: { channel: AlertChannel; copy: AlertCopy; data?: Record<string, unknown> },
  now: EpochMs,
): Promise<string> {
  const plan = planBurst(burst, now);
  for (const id of plan.dismiss) await clearFromShade(id);

  const summarising = plan.mode === "summary";
  const copy = summarising ? coalescedUpdatesAlertCopy({ count: plan.count }) : input.copy;

  // Read per post, never cached: the state between two alerts is exactly the
  // thing that is allowed to change.
  const variant = selectAlertCopy(copy, await isKeyguardLocked());

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: variant.title,
      body: variant.body,
      data: summarising ? { kind: SUMMARY_KIND } : (input.data ?? {}),
    },
    trigger: immediateTrigger(summarising ? SUMMARY_CHANNEL : input.channel),
  });

  burst = summarising
    ? { ...plan.carry, summaryId: id }
    : { ...plan.carry, individualIds: [...plan.carry.individualIds, id] };
  return id;
}

/**
 * Posts an alert now — or, during quiet hours, hands it to the OS for the
 * morning — choosing the variant from the phone's state AT POST TIME
 * (docs/12 §7a).
 *
 * Returns the OS notification id, or `null` when notification permission is
 * denied — never throws for that case. Specs limits r24 / loans r15 / bills r12
 * all say the same thing: the event still surfaces in-app, and only the system
 * notification is lost. The id may belong to a coalesced SUMMARY rather than
 * to this alert alone (§6.2 rule 6); no caller in the app cancels a posted
 * alert, so nothing depends on the distinction.
 *
 * `bypassQuietHours` IS PER CALL SITE AND EXPLICIT — set in exactly one place,
 * `lib/alerts/tracking_notifier.ts`, which is §6.2 rule 7's one exemption
 * ("everything except listener-health warnings"). It is deliberately NOT keyed
 * off `CHANNEL_LIMITS`: listener-health shares that channel with limit alerts
 * on purpose (see `tracking_notifier.ts`'s header on why it does not create a
 * third channel), so a channel-based exemption would quietly exempt every
 * limit alert as well — including the 100% breach rule 7 names by hand as the
 * thing that must be HELD until morning. That would defeat the rule while
 * appearing to implement it.
 */
export async function postAlert(input: {
  channel: AlertChannel;
  copy: AlertCopy;
  data?: Record<string, unknown>;
  bypassQuietHours?: boolean;
}): Promise<string | null> {
  if (!(await hasPermission())) return null;

  const now = systemClock.now();
  const quiet = await readQuietHours();

  if (input.bypassQuietHours !== true) {
    const deliverAt = quietHoursDelivery(now, quiet);
    if (deliverAt !== null) return holdUntilQuietHoursEnd(input, deliverAt);
  }

  // Only once the window has actually ended — an exempt listener-health notice
  // posted at 2am must not wipe the record of what is still being held.
  if (!isWithinQuietHours(now, quiet)) await clearHeldRecord();

  return postImmediately(input, now);
}

/**
 * Schedules a reminder for a future instant. Returns the OS identifier to keep
 * (so it can be cancelled when the bill is paid or the loan closed), or `null`
 * when permission is denied.
 *
 * ALWAYS SCHEDULES THE LOCKED VARIANT, and never calls `isKeyguardLocked()` —
 * see this file's header for why that is a limit of the platform rather than an
 * oversight. Not calling it is deliberate: a service that read the keyguard
 * here would eventually be "improved" into using the answer, which would be a
 * post-time check run at schedule time, i.e. the exact mistake §7a names.
 *
 * QUIET HOURS ARE APPLIED TO `fireAt`, NOT TO NOW (§6.2 rule 7). A reminder
 * set for 22:00 three days from now is shifted to the quiet-hours end that
 * follows THAT instant — 08:00 on the fourth morning — not to tomorrow's 08:00
 * and not to the present moment. Computing the shift from the current time
 * instead is the subtle version of this bug: it passes any test where `fireAt`
 * happens to be tonight, and moves every other reminder to the wrong morning.
 *
 * NOT COALESCED, AND THAT IS A REAL GAP IN §6.2 RULE 6 RATHER THAN AN
 * OVERSIGHT. Rule 6 is about notifications that "would post within a few
 * minutes" of each other, and four bill reminders queued for 9:00 AM next
 * Tuesday qualify — but the app is not running when the OS draws them, so
 * there is nothing to notice the burst and nothing to dismiss. Coalescing them
 * at SCHEDULE time is the only alternative and it costs more than it buys: the
 * ids handed back here are what `bill_reminder_ids` / `loan_reminder_ids` use
 * to cancel one cycle's reminders the moment it is paid (bills rule 11), and a
 * merged notification cannot be un-merged when one of the bills behind it is
 * settled — the user would either keep a reminder for a bill they have paid or
 * lose the ones they have not. Held alerts (`postAlert` above) DO coalesce,
 * because there the app is running at the moment each one is held.
 */
export async function scheduleReminder(input: {
  channel: AlertChannel;
  copy: AlertCopy;
  fireAt: number;
  data?: Record<string, unknown>;
}): Promise<string | null> {
  if (!(await hasPermission())) return null;

  const quiet = await readQuietHours();
  const fireAt = quietHoursDelivery(input.fireAt, quiet) ?? input.fireAt;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: input.copy.locked.title,
      body: input.copy.locked.body,
      data: input.data ?? {},
    },
    trigger: dateTrigger(input.channel, fireAt),
  });
}

/** Cancels a still-pending scheduled reminder by its OS identifier. */
export async function cancelScheduled(identifier: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifier);
}
