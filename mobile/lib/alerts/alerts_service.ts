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
import * as Notifications from "expo-notifications";

import { isKeyguardLocked } from "@/modules/notification_listener";

import { selectAlertCopy, type AlertCopy } from "./alert_copy";
import { CHANNEL_LIMITS, CHANNEL_REMINDERS, type AlertChannel } from "./channels";

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

/**
 * Posts an alert now, choosing the variant from the phone's state AT THIS
 * INSTANT (docs/12 §7a).
 *
 * Returns the OS notification id, or `null` when notification permission is
 * denied — never throws for that case. Specs limits r24 / loans r15 / bills r12
 * all say the same thing: the event still surfaces in-app, and only the system
 * notification is lost.
 */
export async function postAlert(input: {
  channel: AlertChannel;
  copy: AlertCopy;
  data?: Record<string, unknown>;
}): Promise<string | null> {
  if (!(await hasPermission())) return null;

  // Read per call, never cached: the state between two alerts is exactly the
  // thing that is allowed to change.
  const variant = selectAlertCopy(input.copy, await isKeyguardLocked());

  return Notifications.scheduleNotificationAsync({
    content: {
      title: variant.title,
      body: variant.body,
      data: input.data ?? {},
    },
    trigger: immediateTrigger(input.channel),
  });
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
 */
export async function scheduleReminder(input: {
  channel: AlertChannel;
  copy: AlertCopy;
  fireAt: number;
  data?: Record<string, unknown>;
}): Promise<string | null> {
  if (!(await hasPermission())) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: input.copy.locked.title,
      body: input.copy.locked.body,
      data: input.data ?? {},
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(input.fireAt),
      channelId: input.channel,
    },
  });
}

/** Cancels a still-pending scheduled reminder by its OS identifier. */
export async function cancelScheduled(identifier: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifier);
}
