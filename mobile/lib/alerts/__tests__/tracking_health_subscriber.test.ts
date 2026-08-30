// lib/alerts/__tests__/tracking_health_subscriber.test.ts — the wiring defect
// this subscriber closes.
//
// `notifyTrackingInterrupted` had no production caller. `TrackingBanner` covers
// the user who opens the app; the push is the app-closed case, which is the one
// that matters — the listener dies, nobody opens the app for four days, and
// four days of transactions are gone with no signal at all.
//
// The day cap and the copy are `tracking_notifier.ts`'s own, proven in
// alert_audit.test.ts. What is proven HERE is the trigger: which health shape
// counts as a fault, that a continuing outage is not re-announced every
// foreground, and that a recovery re-arms the notice.
// react-native's AppState is mocked via a Proxy over jest.requireActual, not a
// plain `{...actual}` spread — same technique and reason as
// lib/__tests__/bootstrap.test.ts: spreading eagerly evaluates every lazy
// getter on the real module, including native-only exports that crash outside
// a real app.
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const listeners: Array<(state: string) => void> = [];
  const mockAppState = {
    currentState: "active",
    addEventListener: jest.fn((_event: string, cb: (state: string) => void) => {
      listeners.push(cb);
      return {
        remove: jest.fn(() => {
          const index = listeners.indexOf(cb);
          if (index >= 0) listeners.splice(index, 1);
        }),
      };
    }),
    __emit: (state: string) => {
      for (const cb of [...listeners]) cb(state);
    },
  };
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === "AppState") return mockAppState;
      return Reflect.get(target, prop, receiver);
    },
  });
});

jest.mock("@/lib/alerts/tracking_notifier", () => ({
  notifyTrackingInterrupted: jest.fn().mockResolvedValue("os-id"),
}));

jest.mock("@/modules/notification_listener", () => ({
  getListenerHealth: jest.fn(),
}));

jest.mock("@/lib/db/repos/app_settings_repo", () => ({
  getSetting: jest.fn(),
}));

import { AppState } from "react-native";

import { notifyTrackingInterrupted } from "@/lib/alerts/tracking_notifier";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { getListenerHealth } from "@/modules/notification_listener";

import { runTrackingHealthCheck, startTrackingHealthSubscriber } from "../tracking_health_subscriber";

const mockNotify = notifyTrackingInterrupted as jest.MockedFunction<
  typeof notifyTrackingInterrupted
>;
const mockHealth = getListenerHealth as jest.MockedFunction<typeof getListenerHealth>;
const mockSetting = getSetting as jest.MockedFunction<typeof getSetting>;

const NOW = new Date(2026, 6, 10, 12, 0).getTime();

/** Capture is on and the listener is alive: nothing to say. */
function healthy(): void {
  mockHealth.mockResolvedValue({ granted: true, serviceConnected: true, lastCaptureAt: NOW });
  mockSetting.mockResolvedValue(true as never);
}

/** Access still granted, service silently dead — the failure this notice exists for. */
function disconnected(): void {
  mockHealth.mockResolvedValue({ granted: true, serviceConnected: false, lastCaptureAt: NOW });
  mockSetting.mockResolvedValue(true as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotify.mockResolvedValue("os-id");
  healthy();
});

test("a healthy listener posts nothing", async () => {
  await runTrackingHealthCheck(NOW);

  expect(mockNotify).not.toHaveBeenCalled();
});

test("A DEAD LISTENER POSTS THE INTERRUPTED NOTICE", async () => {
  disconnected();

  await runTrackingHealthCheck(NOW);

  // The instant and NOTHING ELSE. There is no honest count of what a dead
  // listener missed, so the notice states no figure — see the notifier and
  // `trackingInterruptedAlertCopy`. A second argument reappearing here means
  // someone found a number to pass, which needs a real source behind it.
  expect(mockNotify).toHaveBeenCalledWith(NOW);
});

test("revoked notification access is a fault too", async () => {
  mockHealth.mockResolvedValue({ granted: false, serviceConnected: false, lastCaptureAt: NOW });
  mockSetting.mockResolvedValue(true as never);

  await runTrackingHealthCheck(NOW);

  expect(mockNotify).toHaveBeenCalled();
});

test("PAUSING ON PURPOSE IS NOT A FAULT", async () => {
  // Exactly TrackingBanner's own precedence rule: the user's switch comes
  // first. Pushing a fault notice at someone who turned capture off themselves
  // trains them to ignore the notice that matters.
  mockHealth.mockResolvedValue({ granted: true, serviceConnected: false, lastCaptureAt: NOW });
  mockSetting.mockResolvedValue(false as never);

  await runTrackingHealthCheck(NOW);

  expect(mockNotify).not.toHaveBeenCalled();
});

test("A CHECK THAT THROWS IS SWALLOWED", async () => {
  // A native bridge that is not there at all still must not break the app.
  mockHealth.mockRejectedValue(new Error("no native module"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(runTrackingHealthCheck(NOW)).resolves.toBe(false);

  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

// ---------------------------------------------------------------------------
// The live subscription
// ---------------------------------------------------------------------------

test("THE SUBSCRIBER CHECKS ONCE ON START", async () => {
  disconnected();

  const stop = startTrackingHealthSubscriber();
  await flush();
  stop();

  expect(mockNotify).toHaveBeenCalledTimes(1);
});

test("ONE OUTAGE IS ANNOUNCED ONCE, NOT ONCE PER FOREGROUND", async () => {
  // IA §6.2 rule 4's first half — "at most one per DISTINCT interruption".
  // `notifyTrackingInterrupted` only enforces the day cap; telling a continuing
  // outage from a fresh one is this subscriber's job, and without it every
  // return to the app would re-post the moment the cap lapsed.
  disconnected();

  const stop = startTrackingHealthSubscriber();
  await flush();
  await foreground();
  await foreground();
  stop();

  expect(mockNotify).toHaveBeenCalledTimes(1);
});

test("A RECOVERY RE-ARMS THE NOTICE", async () => {
  // The other half of the same rule: a second interruption after the listener
  // came back is a genuinely new one and deserves to be said.
  disconnected();
  const stop = startTrackingHealthSubscriber();
  await flush();

  healthy();
  await foreground();

  disconnected();
  await foreground();
  stop();

  expect(mockNotify).toHaveBeenCalledTimes(2);
});

test("backgrounding is not a check", async () => {
  disconnected();
  const stop = startTrackingHealthSubscriber();
  await flush();

  await appState("background");
  await appState("inactive");
  stop();

  expect(mockHealth).toHaveBeenCalledTimes(1);
});

test("tearing down removes the AppState listener", async () => {
  healthy();
  const stop = startTrackingHealthSubscriber();
  await flush();
  stop();

  disconnected();
  await foreground();

  expect(mockNotify).not.toHaveBeenCalled();
});

/** Lets the fire-and-forget check's promise chain settle. */
async function flush(): Promise<void> {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

async function appState(next: "active" | "background" | "inactive"): Promise<void> {
  (AppState as unknown as { __emit: (state: string) => void }).__emit(next);
  await flush();
}

const foreground = () => appState("active");
