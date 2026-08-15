// lib/alerts/channels.ts — the two Android notification channels every M2
// alert is delivered on.
//
// Its own file, and not a pair of constants inside alerts_service.ts, because
// an Android channel id is a PERMANENT identifier: once a channel exists on a
// device, the OS lets the app change only its name and description. Importance,
// sound and vibration are frozen from the first creation, and a user who turns
// a channel off has turned that id off forever. Renaming `CHANNEL_LIMITS` in a
// future refactor therefore does not "rename a channel" — it abandons the old
// one, silently, on every device that already has it, and creates a fresh one
// the user has never seen. Keeping the ids somewhere deliberate is the point.
//
// Two channels rather than one so the user can silence due-date reminders
// without silencing limit alerts, which is the split the specs assume when they
// say a limit alert should interrupt and a reminder should not.

/** Limit threshold alerts (limits rule 24). Interrupting — a heads-up banner. */
export const CHANNEL_LIMITS = "limits";

/** Bill and loan due-date reminders (bills rule 12, loans rule 15). Quiet. */
export const CHANNEL_REMINDERS = "reminders";

/** The channel ids, as a type — so a caller cannot invent a third one. */
export type AlertChannel = typeof CHANNEL_LIMITS | typeof CHANNEL_REMINDERS;
