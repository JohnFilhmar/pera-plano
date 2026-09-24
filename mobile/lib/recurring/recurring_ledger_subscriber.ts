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
 *
 * THE PASS RUNS IN BOTH TIERS, AND THAT IS A REVERSAL (GAP-122; owner's
 * decision, 2026-09-10, second pass — it supersedes the recurring half of
 * GAP-118, taken the same day). GAP-118 returned early here on Free, on the
 * premise that no Free surface could ever display the result. Reports rule 19
 * says otherwise, and says it three times (docs/04-features/10-reports.md `:70`,
 * `:98`, `:157`): "The Free locked preview shows the count of detected patterns
 * only". The count of what a Free device never detected is zero, so honouring
 * rule 19 means detecting on Free. Shown the conflict, the owner chose the spec.
 *
 * WHAT IS TIER-GATED IS THE SURFACE, NOT THE PASS. `hasRecurringDetection()` is
 * asked once, by the screen that owns the data
 * (app/(tabs)/more/subscriptions.tsx), which on Free renders a count and
 * nothing else — no merchant, no amount, no locked-in total
 * (docs/05-monetization.md §5 rule 2: a locked preview is a labelled frame,
 * never real gated data behind a blur). One check, at the surface, is what rule
 * 19's "gated at the Entitlements call-site" asks for; a second check here only
 * made the first one unreachable.
 *
 * AND THE SAMPLE IS NOW THE SAME IN BOTH TIERS. `refreshPatterns` reads its 800
 * days through `listFullLedgerBetween`, which is exempt from the 90-day
 * browsing floor (see `LEDGER_WINDOW_DAYS` in recurring_service.ts). That is
 * load-bearing, not incidental: three instances of an ANNUAL charge span about
 * two years, so a floor-clamped Free pass could not detect the subscription a
 * user most wants flagged, and rule 19's teaser would understate in the one
 * direction that costs a conversion — "we found nothing".
 *
 * `decayStalePatterns` RUNS ON FREE TOO, and it is that floor exemption rather
 * than this guard's removal that makes it correct — its own doc in
 * recurring_service.ts works through why.
 *
 * NOTHING IS CHECKED PER SUBSCRIPTION EITHER, so an upgrade still needs no
 * restart: every production entry point (here and lib/bootstrap.ts) runs through
 * this function, and `refreshPatterns` stays ungated so an upgrade handler that
 * wants patterns on screen immediately (rule 19's "on upgrade, patterns computed
 * from the full retained history appear immediately") can call it directly.
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
