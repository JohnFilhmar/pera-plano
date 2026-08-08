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
  const title = "Payday summary";
  return {
    locked: {
      title,
      body: "Your payday summary is ready to view.",
    },
    unlocked: {
      title,
      body: `You received ${formatPeso(params.amount)} this payday — your summary is ready.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Tracking-interrupted notice (M3). Even a bare transaction COUNT is withheld
// locked — it is not an amount, but it is still a figure about the user's
// finances that a stranger reading the lock screen has no business seeing.
// ---------------------------------------------------------------------------
export function trackingInterruptedAlertCopy(params: { pendingCount: number }): AlertCopy {
  const title = "Tracking paused";
  const { pendingCount } = params;
  return {
    locked: {
      title,
      body: "Some of your transactions need your attention before tracking can continue.",
    },
    unlocked: {
      title,
      body: `PeraPlano paused tracking for ${pendingCount} transaction${pendingCount === 1 ? "" : "s"} — tap to review.`,
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
    copy: trackingInterruptedAlertCopy({ pendingCount: 4 }),
  },
];
