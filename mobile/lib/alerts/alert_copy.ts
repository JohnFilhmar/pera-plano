// lib/alerts/alert_copy.ts — the amount-free lock-screen copy contract
// (docs/12-encryption-and-app-lock.md §7a; interface contract §4/§10).
//
// A notification reading "You've spent ₱8,400 of your ₱10,000 limit" on a
// phone face-up on a desk undoes the encryption work in the most visible
// way available. So every app-generated alert supplies TWO variants — one
// safe to render on a locked screen, one for an unlocked phone — and the
// caller picks between them at the moment it actually posts, never earlier:
//
//   selectAlertCopy(copy, await isKeyguardLocked())
//
// `isKeyguardLocked()` (mobile/modules/notification_listener/index.ts) is
// the ONLY place this is checked, and it is checked at POST time. A bill or
// loan reminder queued days earlier cannot know what state the phone will
// be in when it actually fires — checking at schedule time would be
// checking the wrong moment entirely.
//
// This module owns two things:
//   1. `selectAlertCopy` — the pure selector every alert-posting task calls.
//   2. A catalogue of builder functions, one per alert kind this plan has
//      named so far (docs §7a rule: binds M2's limit alerts, M2b's loan
//      reminders, M2c's bill reminders, M3's payday summary and
//      tracking-interrupted notice) — so those tasks have a tested,
//      reusable place to get an `AlertCopy` instead of hand-rolling the
//      "no amount locked" discipline five separate times.
import type { LimitAlert } from "@/types/control";
import type { Centavos, LimitScope, LimitThreshold, LoanDirection } from "@/types/domain";

type AlertCopyVariant = { title: string; body: string };

export type AlertCopy = {
  locked: AlertCopyVariant;
  unlocked: AlertCopyVariant;
};

/**
 * Picks the variant to actually post. `keyguardOn` must come from a POST-time
 * check (`await isKeyguardLocked()`), never a value computed when the alert
 * was scheduled — see this file's header comment for why that distinction is
 * the entire point of the two-variant design.
 */
export function selectAlertCopy(copy: AlertCopy, keyguardOn: boolean): AlertCopyVariant {
  return keyguardOn ? copy.locked : copy.unlocked;
}

/** ₱8,400 — integer pesos, comma-grouped, no decimals. Unlocked-copy only. */
function formatPeso(centavos: Centavos): string {
  const pesos = Math.round(centavos / 100);
  return `₱${pesos.toLocaleString("en-US")}`;
}

/** "1 day" / "3 days" — the one figure docs §7a's own examples show locked. */
function dayPhrase(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

// ---------------------------------------------------------------------------
// Limit threshold alert (M2). docs §7a's canonical example:
//   locked:   "You've reached 80% of your monthly limit."
//   unlocked: "You've spent ₱8,400 of your ₱10,000 monthly limit."
// ---------------------------------------------------------------------------
export function limitThresholdAlertCopy(params: {
  threshold: LimitThreshold;
  scope: LimitScope;
  spent: Centavos;
  limit: Centavos;
}): AlertCopy {
  const { threshold, scope, spent, limit } = params;
  const title = "Spending limit alert";
  return {
    locked: {
      title,
      body: `You've reached ${threshold}% of your ${scope} limit.`,
    },
    unlocked: {
      title,
      body: `You've spent ${formatPeso(spent)} of your ${formatPeso(limit)} ${scope} limit.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Bill due reminder (M2c). docs §7a's other canonical example. `billName` is
// a name the user themselves chose (rule 4) — carries no figure, so it is
// safe in BOTH variants, unlike a loan's counterparty below.
//   locked:   "Meralco is due in 3 days."
//   unlocked: "Meralco, around ₱2,100, is due in 3 days."
// ---------------------------------------------------------------------------
export function billDueAlertCopy(params: {
  billName: string;
  daysUntilDue: number;
  amount: Centavos;
}): AlertCopy {
  const { billName, daysUntilDue, amount } = params;
  const title = "Bill reminder";
  const days = dayPhrase(daysUntilDue);
  return {
    locked: {
      title,
      body: `${billName} is due in ${days}.`,
    },
    unlocked: {
      title,
      body: `${billName}, around ${formatPeso(amount)}, is due in ${days}.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Bill overdue escalation (M2c). Bills rule 22 caps this at THREE per cycle —
// "nagging forever erodes trust" — so the copy names the lateness rather than
// repeating the same sentence louder.
//   locked:   "Meralco was due 3 days ago."
//   unlocked: "Meralco, around ₱2,100, was due 3 days ago."
// ---------------------------------------------------------------------------
export function billOverdueAlertCopy(params: {
  billName: string;
  daysOverdue: number;
  amount: Centavos;
}): AlertCopy {
  const { billName, daysOverdue, amount } = params;
  const title = "Bill overdue";
  const days = dayPhrase(daysOverdue);
  return {
    locked: {
      title,
      body: `${billName} was due ${days} ago.`,
    },
    unlocked: {
      title,
      body: `${billName}, around ${formatPeso(amount)}, was due ${days} ago.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Loan reminder (M2b). A counterparty is explicitly NOT a name the user
// configured the way a bill or wallet is (rule 4) — it names another person,
// so it is withheld locked even though a bill's own name is not.
// ---------------------------------------------------------------------------
export function loanReminderAlertCopy(params: {
  direction: LoanDirection;
  counterparty: string;
  daysUntilDue: number;
  amount: Centavos;
}): AlertCopy {
  const { direction, counterparty, daysUntilDue, amount } = params;
  const title = "Loan reminder";
  const days = dayPhrase(daysUntilDue);
  const lockedBody =
    direction === "i-owe"
      ? `A loan payment you owe is due in ${days}.`
      : `A loan payment owed to you is due in ${days}.`;
  const unlockedBody =
    direction === "i-owe"
      ? `You owe ${counterparty} around ${formatPeso(amount)}, due in ${days}.`
      : `${counterparty} owes you around ${formatPeso(amount)}, due in ${days}.`;
  return {
    locked: { title, body: lockedBody },
    unlocked: { title, body: unlockedBody },
  };
}

// ---------------------------------------------------------------------------
// Payday summary (M3). No amount, balance or figure survives locked — just
// that a summary is waiting.
// ---------------------------------------------------------------------------
export function paydaySummaryAlertCopy(params: { amount: Centavos }): AlertCopy {
  // "Payday landed", not "Kinsenas landed" (task-5-brief's Step 6 table).
  // "Kinsenas" is the app's own label for this cadence
  // (components/income/cadence_picker.tsx) — but every generated SENTENCE
  // about it deliberately avoids the word for plain English instead
  // (income_summary_card.tsx's incomeSentence: "You're paid twice a
  // month..."; tested by income_screen.test.tsx's "the kinsenas sentence
  // never says 'kinsenas'"). A notification title is exactly that kind of
  // generated sentence, and this function is not even told the cadence —
  // only the amount.
  const title = "Payday landed";
  return {
    // No {goal} exists in this function's params or in
    // notifyPaydaySummary's call site, and with no notification action
    // buttons wired anywhere in the app (this dispatch's report), a body
    // phrased as a question — "Move ₱9,250 to Emergency Fund now?" — is a
    // dead end the user cannot answer from the notification itself. Both
    // variants end on the same invitation instead, one the tap resolves by
    // opening the app.
    locked: {
      title,
      body: "Your summary is ready — tap to decide where it goes.",
    },
    unlocked: {
      title,
      body: `You received ${formatPeso(params.amount)} — tap to decide where it goes.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Tracking-interrupted notice (M3).
//
// THE ONLY ALERT IN THIS CATALOGUE THAT STATES NO FIGURE AT ALL, in either
// variant, and therefore the only one whose two variants are identical.
//
// It used to take a `pendingCount` and render "{n} transactions missed"
// unlocked. That number could never be honest: a dead listener captures
// nothing, so the app has no record of what it missed, by construction. The
// only count on offer was the open review-queue count, which is unrelated to an
// outage and wrong in both directions — it reads "0 transactions missed"
// (actively reassuring, and false) once the queue is triaged, and it blames the
// outage for stale items that predate it. In the one notification whose whole
// job is to say the ledger stopped being trustworthy, a fabricated figure is
// worse than no figure.
//
// The parameter is DELETED rather than accepted and ignored: an unused
// parameter is an invitation for the next caller to invent a number to satisfy
// it. A native `countPendingCaptures()` is in the v2 backlog; the richer copy
// can return when a real number exists behind it.
// ---------------------------------------------------------------------------
export function trackingInterruptedAlertCopy(): AlertCopy {
  // "Tracking stopped working", not "Tracking paused" (task-5-brief's Step 6
  // table). "Paused" is already reserved, deliberately, for the user's OWN
  // switch elsewhere in the app (app/(tabs)/more/listener_health.tsx's
  // captureEnabled note: "Tracking is paused — you turned it off") — reusing
  // it here for an involuntary failure (a dead listener or revoked access)
  // collides with that distinction instead of respecting it.
  const title = "Tracking stopped working";
  // The body borrows docs/06 §6.1's own illustrative line rather than the
  // brief's "Notification access was revoked": nothing on this call path is
  // told which of the two live health facts failed (`!granted` vs
  // `!serviceConnected` — components/privacy/health_card.tsx), and "revoked"
  // specifically would misdescribe a disconnected-but-still-granted listener.
  // The brief's "{n} days" figure is left out for the same reason the count is:
  // nothing here measures how long the interruption has been running.
  const body = "PeraPlano stopped receiving notifications. Tap to fix tracking.";
  return {
    locked: { title, body },
    unlocked: { title, body },
  };
}

// ---------------------------------------------------------------------------
// Coalesced multi-limit alert (M2 Task 6). Limits rule 22: "If a single commit
// trips thresholds on multiple Limits, the alerts coalesce into one
// notification summarizing each affected Limit, ordered most-severe first."
//
// The ORDERING is `coalesceAlerts` in lib/limits/limit_engine.ts, not here —
// this renders whatever order it is handed, so a caller that forgets to
// coalesce produces a badly ordered notification rather than a wrong one.
//
// THE COUNT IS WITHHELD LOCKED: "how many of your limits are in trouble" is not
// an amount, but it is still a figure about the user's finances that a stranger
// reading the lock screen has no business seeing. The catalogue scan enforces it
// independently — a bare digit in a locked variant fails `looksLikeAnAmount`.
//
// This is now the catalogue's PRIMARY statement of that rule.
// `trackingInterruptedAlertCopy` used to share it and is no longer an example:
// it carries no count in either variant to withhold.
// ---------------------------------------------------------------------------

/** One limit's line in the coalesced body. Whole pesos, like every figure here. */
function limitLine(alert: LimitAlert): string {
  if (alert.spend > alert.effectiveLimit) {
    return `${alert.limitName}: over by ${formatPeso(alert.spend - alert.effectiveLimit)}`;
  }
  const remaining = alert.effectiveLimit - alert.spend;
  return `${alert.limitName}: ${formatPeso(remaining)} left, ${dayPhrase(alert.daysLeft)} to go`;
}

/**
 * Copy for one or more limits that just tripped a threshold.
 *
 * A SINGLE alert delegates to `limitThresholdAlertCopy`, which is docs §7a's
 * own canonical example and therefore the wording the spec actually names.
 * Re-deriving it here would give the commonest alert in the app two spellings.
 *
 * Throws on an empty list rather than returning empty copy: a notification with
 * nothing to say is a caller bug, and posting it would put a blank line on the
 * user's lock screen.
 */
export function limitAlertsCopy(alerts: LimitAlert[]): AlertCopy {
  if (alerts.length === 0) {
    throw new Error("limitAlertsCopy: no alerts to describe");
  }

  if (alerts.length === 1) {
    const [only] = alerts;
    return limitThresholdAlertCopy({
      threshold: only.threshold,
      scope: only.scope,
      spent: only.spend,
      limit: only.effectiveLimit,
    });
  }

  return {
    locked: {
      title: "Spending limit alert",
      // "Several", not the count — see this section's header.
      body: "Several of your limits need a look.",
    },
    unlocked: {
      title: `${alerts.length} limits need a look`,
      body: alerts.map(limitLine).join("\n"),
    },
  };
}

// ---------------------------------------------------------------------------
// Coalesced cross-channel summary (IA §6.2 rule 6). The one notification that
// stands in for a whole burst — a live catch-up after reconnecting, or a
// night's worth of alerts held through quiet hours (rule 7) and released in
// the morning. `lib/alerts/notification_policy.ts` decides WHEN this replaces
// a set of individual alerts; this only says what it reads.
//
// THE SPEC'S OWN EXAMPLE STRING IS THE UNLOCKED VARIANT, NOT BOTH. Rule 6
// writes the copy as "3 updates while you were away", and that sentence
// carries a bare count — which `limitAlertsCopy` already withholds from a lock
// screen for a stated reason ("not an amount, but still a figure about the
// user's finances"), and
// which alert_copy.test.ts's catalogue scan rejects outright. Rendering the
// spec's sentence locked would be the only entry in the catalogue that leaks a
// digit, and the scan that exists to catch exactly that would have to be
// weakened to let it through. So the count goes unlocked, where the spec's
// wording is reproduced verbatim, and the locked variant says the same thing
// without the number — the identical split `limitAlertsCopy` makes with
// "Several of your limits need a look."
// ---------------------------------------------------------------------------
export function coalescedUpdatesAlertCopy(params: { count: number }): AlertCopy {
  // Only ever built past the coalescing threshold (rule 6's "more than 3"), so
  // the count is always at least 4 and the plural is never wrong.
  return {
    locked: {
      title: "Updates while you were away",
      body: "Several updates arrived — tap to catch up.",
    },
    unlocked: {
      title: `${params.count} updates while you were away`,
      body: "Tap to catch up.",
    },
  };
}

// ---------------------------------------------------------------------------
// The catalogue. Every alert kind above, built once with representative —
// deliberately amount-laden — sample parameters, so the test suite can
// iterate this array and scan every locked variant programmatically rather
// than hand-checking each entry. A future alert kind belongs here too: that
// is what makes the scan test in alert_copy.test.ts catch it automatically
// instead of relying on someone remembering to check by hand.
// ---------------------------------------------------------------------------
export const ALERT_COPY_CATALOGUE: Array<{ name: string; copy: AlertCopy }> = [
  {
    name: "limitThreshold@80-monthly",
    copy: limitThresholdAlertCopy({ threshold: 80, scope: "monthly", spent: 840000, limit: 1000000 }),
  },
  {
    name: "limitThreshold@100-daily",
    copy: limitThresholdAlertCopy({ threshold: 100, scope: "daily", spent: 500000, limit: 500000 }),
  },
  {
    name: "billDue",
    copy: billDueAlertCopy({ billName: "Meralco", daysUntilDue: 3, amount: 210000 }),
  },
  {
    name: "billOverdue",
    copy: billOverdueAlertCopy({ billName: "Meralco", daysOverdue: 3, amount: 210000 }),
  },
  {
    name: "loanDue-i-owe",
    copy: loanReminderAlertCopy({ direction: "i-owe", counterparty: "Aling Nena", daysUntilDue: 2, amount: 500000 }),
  },
  {
    name: "loanDue-owed-to-me",
    copy: loanReminderAlertCopy({ direction: "owed-to-me", counterparty: "Juan", daysUntilDue: 7, amount: 1500000 }),
  },
  {
    name: "paydaySummary",
    copy: paydaySummaryAlertCopy({ amount: 3500000 }),
  },
  {
    name: "trackingInterrupted",
    copy: trackingInterruptedAlertCopy(),
  },
  {
    name: "limitAlerts-coalesced",
    copy: limitAlertsCopy([
      {
        limitId: "l-breached",
        limitName: "GCash daily",
        scope: "daily",
        threshold: 100,
        spend: 110000,
        effectiveLimit: 100000,
        daysLeft: 1,
      },
      {
        limitId: "l-warned",
        limitName: "Food & Dining",
        scope: "monthly",
        threshold: 80,
        spend: 850000,
        effectiveLimit: 1000000,
        daysLeft: 9,
      },
    ]),
  },
  {
    name: "coalescedUpdates",
    copy: coalescedUpdatesAlertCopy({ count: 6 }),
  },
];
