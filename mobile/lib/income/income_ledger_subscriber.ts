// lib/income/income_ledger_subscriber.ts — re-run income detection when the
// ledger changes (m2-part2 Task 14, rules 2 and 3).
//
// An incoming credit may be the one that completes the evidence for a cadence,
// so detection has to run again after a commit. It must NOT run once per
// commit: draining the native capture buffer after the phone has been offline
// commits a burst of transactions in a tight loop, and detection reads 130 days
// of ledger and every loan payment each time. Debounced, that burst is one
// pass.
//
// NOTHING HERE MAY BREAK THE APP (rule 3). Income is a derived convenience —
// the ledger is the product. A failure is logged and swallowed, exactly as
// `startIngest`'s own catch in app/_layout.tsx does, because an app that will
// not open cannot be fixed by the user at all.
import { systemClock } from "@/lib/clock";
import { onAppEvent } from "@/lib/events/app_events";

import { maybeEmitPayday, refreshIncomeDetection } from "./income_service";

/**
 * Long enough to swallow a drained burst, short enough that a single manual
 * entry updates the Income screen while the user is still looking at it.
 */
const DEFAULT_DEBOUNCE_MS = 750;

/**
 * One detection pass: re-read the evidence, then announce a payday if the
 * credit that just landed is one.
 *
 * ORDER MATTERS. `maybeEmitPayday` reads the profile that `refreshIncomeDetection`
 * may have just written — running it first would test a credit against the
 * income figures from before that credit existed, so the very first payday of a
 * newly-confirmed stream would never announce itself.
 *
 * Exported because bootstrap runs the same pass once at startup (rule 1), and
 * two copies of this two-step order would eventually disagree about it.
 */
export async function runIncomePass(now: number): Promise<void> {
  try {
    await refreshIncomeDetection(now);
    await maybeEmitPayday(now);
  } catch (error) {
    console.warn("income detection failed; the app runs without it", error);
  }
}

/**
 * Subscribes to `ledger:committed` and runs a debounced detection pass.
 * Returns the teardown, which also cancels a pass still waiting to fire.
 */
export function startIncomeLedgerSubscriber(
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
      void runIncomePass(systemClock.now());
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
