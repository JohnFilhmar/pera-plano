// hooks/use_day_rollover.ts — the local-midnight recompute trigger.
//
// docs/04-features/09-safe-to-spend.md rule 13 lists nine triggers for
// recomputing the hero. Eight of them are writes, and they are handled on the
// cache (`installSafeToSpendCascade`, lib/query_client.ts). The ninth is not a
// write at all: the calendar day changes on its own, and every query that
// resolves "today" inside its `queryFn` — the Limit window, the bill due
// states, the seven-day bar strip, the loan overdue flags — answers for
// yesterday until something invalidates it. Nothing did.
//
// WHY NOT `useFocusEffect`. It is a NAVIGATION hook: it fires when a screen
// gains focus inside the router, which is not what happens when the user comes
// back to a backgrounded app. Android hands the app to the same route it left,
// and no navigation event is emitted, so a screen relying on focus alone stays
// exactly as stale as it was.
//
// WHY NOT TanStack's `focusManager`. Binding it to AppState looks like the
// obvious fix and does nothing here: `queryClient.mount()` reacts to a focus
// event by calling `queryCache.onFocus()`, which asks every observer
// `shouldFetchOnWindowFocus()`, which is `shouldFetchOn(query, options,
// options.refetchOnWindowFocus)` — and that returns `false` outright when the
// resolved option is `false` (@tanstack/query-core 5.101.4,
// queryObserver.js's `shouldFetchOn`). lib/query_client.ts sets
// `refetchOnWindowFocus: false` app-wide and no query overrides it, so a bound
// `focusManager` would refetch nothing. Turning the option on instead would
// refetch EVERY mounted query in the app on every foreground, against an
// encrypted database — which is the cost this screen-scoped trigger exists to
// avoid.
//
// TWO WAKE-UPS, because a day can turn in two different situations and neither
// covers the other:
//   - the app is in the background at midnight — no timer of ours is trusted
//     to run (Android throttles and freezes JS timers for backgrounded apps),
//     so the AppState "active" transition is what notices, on the next open;
//   - the app is open and foregrounded at midnight — no AppState transition
//     ever happens, so the scheduled timeout is what notices.
// Both funnel through the same guarded check, so a resume that did NOT cross
// midnight costs nothing: the callback fires on a DAY CHANGE, not on every
// foreground.
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { systemClock } from "@/lib/clock";
import { endOfLocalDay, toDateIso } from "@/lib/dates";

/**
 * How far past local midnight the timer aims.
 *
 * A timer that fires a millisecond EARLY reads the old date, finds no change
 * and reschedules — correct, but it costs a wake-up. Landing just inside the
 * new day makes the first read the right one. A late timer is harmless: the
 * check is "has the date changed", never "is it exactly midnight".
 */
export const DAY_ROLLOVER_SKEW_MS = 1_000;

/**
 * Calls `onRollover` when the LOCAL calendar day changes underneath a mounted
 * screen — on resume, or on the stroke of midnight while the app is open.
 *
 * The callback is read from a ref rather than captured, so a caller may pass a
 * fresh closure on every render without the subscription and the timer being
 * torn down and rebuilt each time.
 */
export function useDayRollover(onRollover: () => void): void {
  const handlerRef = useRef(onRollover);
  useEffect(() => {
    handlerRef.current = onRollover;
  });

  useEffect(() => {
    // The day this screen last rendered against. Captured at subscribe time,
    // not at module load: a screen mounted at 23:59 must compare against the
    // day it actually showed.
    let dayKey = toDateIso(new Date(systemClock.now()));
    let timer: ReturnType<typeof setTimeout> | undefined;

    function scheduleNextMidnight(now: number): void {
      if (timer !== undefined) clearTimeout(timer);
      // `endOfLocalDay` is the EXCLUSIVE end of today, i.e. tomorrow's local
      // midnight — the same boundary every period window in lib/ tiles on.
      timer = setTimeout(check, Math.max(endOfLocalDay(now) - now, 0) + DAY_ROLLOVER_SKEW_MS);
    }

    function check(): void {
      const now = systemClock.now();
      const today = toDateIso(new Date(now));
      // RESCHEDULED FIRST, unconditionally. A `return` on the no-change path
      // that skipped this would leave the screen with no timer at all for the
      // rest of its life the first time a resume arrived before midnight.
      scheduleNextMidnight(now);
      if (today === dayKey) return;
      dayKey = today;
      handlerRef.current();
    }

    scheduleNextMidnight(systemClock.now());
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next !== "active") return;
      check();
    });

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      subscription.remove();
    };
    // Subscribes ONCE for the life of the screen — see `handlerRef` above.
  }, []);
}
