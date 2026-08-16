// lib/recurring/recurring_ledger_subscriber.ts — re-run recurring-pattern
// detection when the ledger changes (M3 Part 2 Task 6, plan rule 4). Mirrors
// lib/income/income_ledger_subscriber.ts exactly — same debounce shape, same
// swallow-its-own-failures discipline — because the two subscribers exist for
// the same reason.
//
// An incoming (or edited) transaction may be the one that completes the
// evidence for a cadence, so detection has to run again after a commit. It
// must NOT run once per commit: draining the native capture buffer after the
// phone has been offline commits a burst of transactions in a tight loop, and
// `refreshPatterns` reads up to 800 days of ledger each time. Debounced, that
// burst is one pass.
//
// NOTHING HERE MAY BREAK THE APP. Recurring detection is a derived
// convenience — the ledger is the product. A failure is logged and swallowed,
// exactly as `startIngest`'s own catch in app/_layout.tsx does, because an app
// that will not open cannot be fixed by the user at all.
import { systemClock } from "@/lib/clock";
import { onAppEvent } from "@/lib/events/app_events";

import { refreshPatterns } from "./recurring_service";

/**
 * Long enough to swallow a drained burst, short enough that a single manual
 * entry updates the Subscriptions screen while the user is still looking at it.
 */
const DEFAULT_DEBOUNCE_MS = 750;

/**
 * One detection pass: re-run `refreshPatterns` against the current clock.
 *
 * Exported because bootstrap can run the same pass once at startup (rule 4's
 * "and on app foreground") and a second, independently-written copy of this
 * one-line try/catch would eventually disagree with this one about what
 * "failed safely" means.
 */
export async function runRecurringPass(now: number): Promise<void> {
  try {
    await refreshPatterns(now);
  } catch (error) {
    console.warn("recurring detection failed; the app runs without it", error);
  }
}

/**
 * Subscribes to `ledger:committed` and runs a debounced detection pass.
 * Returns the teardown, which also cancels a pass still waiting to fire.
 */
export function startRecurringLedgerSubscriber(
  options: { debounceMs?: number } = {},
): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let pending: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = onAppEvent("ledger:committed", () => {
    // Restarting the timer rather than letting the first one stand is what
    // makes this trailing-edge: a burst of fifty commits schedules one pass,
    // and that pass sees all fifty.
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      void runRecurringPass(systemClock.now());
    }, debounceMs);
  });

  return () => {
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    unsubscribe();
  };
}
