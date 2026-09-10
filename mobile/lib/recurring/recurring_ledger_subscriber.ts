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
import { hasRecurringDetection } from "@/lib/entitlements";
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
 * FREE DOES NOT RUN THIS PASS AT ALL (GAP-118; owner's decision, 2026-09-10).
 * `refreshPatterns` asks for 800 days because three instances of an ANNUAL
 * charge span roughly two years, and `listTransactions` clamps that request to
 * the Free tier's 90-day browsing floor (lib/entitlements.ts) — so on Free the
 * pass paid for a full detection sweep and got back an answer no annual and few
 * monthly patterns can survive, for a surface `hasRecurringDetection()` gates
 * anyway (app/(tabs)/more/subscriptions.tsx). The answer chosen was not to
 * widen the window but to skip the work.
 *
 * WHY THIS IS SKIPPED WHERE `sumSpend` AND `listFullLedgerBetween` ARE EXEMPTED
 * INSTEAD: recurring detection is the one computation in this app whose OUTPUT
 * is tier-gated. GAP-105, GAP-111 and GAP-118's income half all read past the
 * floor precisely because nothing gates what they feed — a limit's headroom and
 * a learned category are the same in both tiers, so their sample must be too.
 * A pattern list is not.
 *
 * CHECKED PER PASS, NOT PER SUBSCRIPTION, SO AN UPGRADE NEEDS NO RESTART. The
 * subscriber below stays subscribed on Free, and every production entry point
 * (here and lib/bootstrap.ts) runs through this function, so the first ledger
 * commit after the tier flips runs a full 800-day sweep with nothing to
 * re-register. `refreshPatterns` itself is left ungated for the same reason: an
 * upgrade handler that wants patterns on screen immediately (Reports rule 19's
 * "on upgrade, patterns computed from the full retained history appear
 * immediately") can call it directly instead of having to defeat a gate buried
 * inside it.
 *
 * SKIPPING ALSO SKIPS `decayStalePatterns`, AND THAT IS THE RIGHT WAY ROUND.
 * Entitlements gate principle 2 is that existing records keep working after a
 * downgrade; a Free period that quietly forgot the patterns a Plus period had
 * found would be the gate deleting data, which principle 1 forbids outright.
 *
 * KNOWN CONSEQUENCE, RECORDED RATHER THAN HIDDEN. Reports rule 19
 * (docs/04-features/10-reports.md) wants the Free locked preview to show "the
 * count of detected patterns only". With this skip that count is zero for a
 * user who has never been on Plus. It costs nothing today, because the only
 * route to that screen — the More-tab row in app/(tabs)/more/index.tsx — is
 * `PlusGate`-wrapped and intercepts the press before navigation, leaving
 * `LockedPreview` unreachable on Free. Whoever makes it reachable has to pick
 * one of the two: the count, or the skipped work.
 */
export async function runRecurringPass(now: number): Promise<void> {
  if (!hasRecurringDetection()) return;

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
