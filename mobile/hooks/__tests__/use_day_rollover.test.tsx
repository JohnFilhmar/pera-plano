// hooks/__tests__/use_day_rollover.test.tsx — the local-midnight trigger's two
// wake-ups (docs/04-features/09-safe-to-spend.md rule 13, ninth trigger).
//
// WHAT THIS FILE CAN AND CANNOT PROVE. React Native's own Jest preset replaces
// `AppState` with a stub whose `addEventListener` is a `jest.fn` that never
// emits (react-native/jest/mocks/AppState.js, installed by
// react-native/jest/setup.js) — there is no real AppState under Jest at all,
// and a `DeviceEventEmitter.emit("appStateDidChange", ...)` reaches nothing.
// So this file drives the SAME object production code imports, and pins the
// contract with it: the subscription is on the "change" event, and the handler
// production registered is the one invoked. What no JS test in this repo can
// prove is that Android actually delivers that event; that stays an on-device
// check.
//
// The timer half needs no such caveat — `setTimeout` is real (faked) here, and
// this is the only wake-up available to an app that is OPEN when the day turns.
import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";

import { DAY_ROLLOVER_SKEW_MS, useDayRollover } from "@/hooks/use_day_rollover";
import { systemClock } from "@/lib/clock";

const addEventListener = AppState.addEventListener as jest.Mock;

/** Local instants, never a UTC parse — lib/clock.ts's fixture convention. */
const LATE_ON_DAY_ONE = new Date(2026, 4, 20, 23, 59, 0).getTime();
const JUST_AFTER_MIDNIGHT = new Date(2026, 4, 21, 0, 0, 1).getTime();
const DAY_THREE = new Date(2026, 4, 22, 0, 0, 1).getTime();

let nowSpy: jest.SpyInstance<number, []>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  nowSpy = jest.spyOn(systemClock, "now").mockReturnValue(LATE_ON_DAY_ONE);
});

afterEach(() => {
  nowSpy.mockRestore();
  jest.useRealTimers();
});

/** The listener production handed to `AppState.addEventListener("change", …)`. */
function appStateHandler(): (state: string) => void {
  const call = addEventListener.mock.calls.find(([event]) => event === "change");
  if (call === undefined) throw new Error("nothing subscribed to AppState 'change'");
  return call[1] as (state: string) => void;
}

test("THE APP OPEN AT MIDNIGHT IS WOKEN BY THE TIMER, WITH NO APPSTATE EVENT AT ALL", () => {
  // The case the resume trigger cannot cover: nobody backgrounds the app, so
  // there is no foreground transition to react to. Left to AppState alone, a
  // phone sitting on the table through midnight shows yesterday's period until
  // the user happens to switch apps.
  const onRollover = jest.fn();
  renderHook(() => useDayRollover(onRollover));

  expect(onRollover).not.toHaveBeenCalled();

  nowSpy.mockReturnValue(JUST_AFTER_MIDNIGHT);
  act(() => {
    jest.advanceTimersByTime(60_000 + DAY_ROLLOVER_SKEW_MS);
  });

  expect(onRollover).toHaveBeenCalledTimes(1);
});

test("the timer rearms, so the second midnight fires too", () => {
  // A one-shot timeout would make this trigger work for exactly one night and
  // then go quiet for the life of the screen.
  const onRollover = jest.fn();
  renderHook(() => useDayRollover(onRollover));

  nowSpy.mockReturnValue(JUST_AFTER_MIDNIGHT);
  act(() => {
    jest.advanceTimersByTime(60_000 + DAY_ROLLOVER_SKEW_MS);
  });
  nowSpy.mockReturnValue(DAY_THREE);
  act(() => {
    jest.advanceTimersByTime(86_400_000);
  });

  expect(onRollover).toHaveBeenCalledTimes(2);
});

test("A RESUME AFTER MIDNIGHT FIRES, AND THE SUBSCRIPTION IS ON APPSTATE'S OWN 'change'", () => {
  const onRollover = jest.fn();
  renderHook(() => useDayRollover(onRollover));

  expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

  nowSpy.mockReturnValue(JUST_AFTER_MIDNIGHT);
  act(() => appStateHandler()("active"));

  expect(onRollover).toHaveBeenCalledTimes(1);
});

test("A RESUME ON THE SAME DAY COSTS NOTHING — the trigger is a day change, not a foreground", () => {
  // The reason this is not `refetchOnWindowFocus: true`. Every alt-tab would
  // otherwise re-run six queries against the encrypted database for a screen
  // whose inputs did not move.
  const onRollover = jest.fn();
  renderHook(() => useDayRollover(onRollover));

  act(() => {
    appStateHandler()("background");
    appStateHandler()("active");
    appStateHandler()("active");
  });

  expect(onRollover).not.toHaveBeenCalled();
});

test("a backgrounding that crosses midnight fires once on the return, not twice", () => {
  const onRollover = jest.fn();
  renderHook(() => useDayRollover(onRollover));

  nowSpy.mockReturnValue(JUST_AFTER_MIDNIGHT);
  act(() => {
    appStateHandler()("active");
    appStateHandler()("active");
  });

  expect(onRollover).toHaveBeenCalledTimes(1);
});

test("a resume before midnight leaves the timer armed", () => {
  // Regression guard for the ordering inside `check`: an early `return` on the
  // no-change path that skipped the reschedule would silently disarm the only
  // wake-up an open app has, and the failure would show up a day later.
  const onRollover = jest.fn();
  renderHook(() => useDayRollover(onRollover));

  act(() => appStateHandler()("active"));

  nowSpy.mockReturnValue(JUST_AFTER_MIDNIGHT);
  act(() => {
    jest.advanceTimersByTime(60_000 + DAY_ROLLOVER_SKEW_MS);
  });

  expect(onRollover).toHaveBeenCalledTimes(1);
});

test("unmounting stops both wake-ups", () => {
  // The AppState half is asserted through the subscription's own `remove`
  // rather than by re-invoking the captured handler: this file holds a direct
  // reference to that closure, so calling it would bypass the very
  // unsubscribe being tested and prove nothing either way.
  const onRollover = jest.fn();
  const { unmount } = renderHook(() => useDayRollover(onRollover));
  const remove = addEventListener.mock.results[0].value.remove as jest.Mock;

  unmount();

  expect(remove).toHaveBeenCalled();
  nowSpy.mockReturnValue(JUST_AFTER_MIDNIGHT);
  act(() => {
    jest.advanceTimersByTime(86_400_000);
  });
  expect(onRollover).not.toHaveBeenCalled();
});
