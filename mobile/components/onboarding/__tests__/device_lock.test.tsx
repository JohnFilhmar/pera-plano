// components/onboarding/__tests__/device_lock.test.tsx — the docs §5a device
// screen-lock requirement (docs/12-encryption-and-app-lock.md §5a;
// task-9a-brief.md), covering both the presentational
// components/onboarding/device_lock_explainer.tsx AND the onboarding route
// app/(onboarding)/device_lock.tsx that owns the actual gating state.
//
// react-native's AppState is mocked via a Proxy over jest.requireActual, not
// a plain `{...actual}` spread -- the same reasoning
// contexts/__tests__/lock_context.test.tsx documents: spreading eagerly
// evaluates every lazy getter on the real module, including native-only
// exports that crash outside a real app.
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const listeners: Array<(state: string) => void> = [];
  const mockAppState = {
    currentState: "active",
    addEventListener: jest.fn((_event: string, cb: (state: string) => void) => {
      listeners.push(cb);
      return {
        remove: jest.fn(() => {
          const idx = listeners.indexOf(cb);
          if (idx >= 0) listeners.splice(idx, 1);
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

jest.mock("@/modules/notification_listener", () => ({
  isDeviceSecure: jest.fn(),
  openSecuritySettings: jest.fn(),
}));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { isDeviceSecure, openSecuritySettings } from "@/modules/notification_listener";
import { DeviceLockExplainer } from "../device_lock_explainer";
import DeviceLockScreen from "@/app/(onboarding)/device_lock";

const mockIsDeviceSecure = isDeviceSecure as jest.Mock;
const mockOpenSecuritySettings = openSecuritySettings as jest.Mock;

function emitAppState(state: "active" | "background") {
  (AppState as unknown as { __emit: (s: string) => void }).__emit(state);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// DeviceLockExplainer -- purely presentational.
// ---------------------------------------------------------------------------

describe("DeviceLockExplainer", () => {
  test("renders no skip affordance anywhere -- exactly one action, the settings button", () => {
    render(<DeviceLockExplainer onOpenSettings={jest.fn()} />);

    expect(screen.queryByText(/skip/i)).toBeNull();
    expect(screen.queryByText(/not now/i)).toBeNull();
    expect(screen.queryByText(/later/i)).toBeNull();
    expect(screen.queryByText(/maybe/i)).toBeNull();
    // Exactly one actionable control on the whole screen -- a future skip
    // button would show up here as a second one even under different copy.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  test("is honest that the app cannot continue, rather than implying the step is optional", () => {
    render(<DeviceLockExplainer onOpenSettings={jest.fn()} />);

    expect(screen.getByText(/cannot continue/i)).toBeTruthy();
  });

  test("tapping the action calls onOpenSettings", () => {
    const onOpenSettings = jest.fn();
    render(<DeviceLockExplainer onOpenSettings={onOpenSettings} />);

    fireEvent.press(screen.getByTestId("device-lock-open-settings-button"));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// app/(onboarding)/device_lock.tsx -- owns the actual isDeviceSecure()
// check and the return-from-Settings recheck.
// ---------------------------------------------------------------------------

describe("DeviceLockScreen", () => {
  test('a secure device skips the screen entirely -- the explainer never renders, not even for the "checking" frame before the first isDeviceSecure() resolves', async () => {
    let resolveSecure!: (secure: boolean) => void;
    mockIsDeviceSecure.mockReturnValue(
      new Promise((resolve) => {
        resolveSecure = resolve;
      }),
    );

    render(<DeviceLockScreen />);

    // Before the promise resolves: nothing renders at all, specifically
    // NOT the explainer. A broken implementation that defaults to
    // "insecure" until proven otherwise would fail exactly here.
    expect(screen.queryByTestId("device-lock-explainer")).toBeNull();

    await act(async () => {
      resolveSecure(true);
      await Promise.resolve();
    });

    // After resolving secure: still nothing -- the screen must skip
    // entirely, not merely render something else with the explainer absent
    // for an unrelated reason.
    expect(screen.queryByTestId("device-lock-explainer")).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });

  test("an insecure device renders the explainer and no skip affordance", async () => {
    mockIsDeviceSecure.mockResolvedValue(false);

    render(<DeviceLockScreen />);

    await waitFor(() => expect(screen.getByTestId("device-lock-explainer")).toBeTruthy());
    expect(screen.queryByText(/skip/i)).toBeNull();
    expect(screen.queryByText(/not now/i)).toBeNull();
  });

  test("the action calls openSecuritySettings", async () => {
    mockIsDeviceSecure.mockResolvedValue(false);

    render(<DeviceLockScreen />);
    await waitFor(() => expect(screen.getByTestId("device-lock-explainer")).toBeTruthy());

    fireEvent.press(screen.getByTestId("device-lock-open-settings-button"));

    expect(mockOpenSecuritySettings).toHaveBeenCalledTimes(1);
  });

  test("returning still-insecure re-renders the step rather than advancing", async () => {
    mockIsDeviceSecure.mockResolvedValue(false);

    render(<DeviceLockScreen />);
    await waitFor(() => expect(screen.getByTestId("device-lock-explainer")).toBeTruthy());

    await act(async () => {
      emitAppState("active");
      await Promise.resolve();
      await Promise.resolve();
    });

    // Still showing the gate -- did NOT advance -- and the recheck
    // genuinely ran a second time rather than trusting stale state.
    expect(screen.getByTestId("device-lock-explainer")).toBeTruthy();
    expect(mockIsDeviceSecure).toHaveBeenCalledTimes(2);
  });

  test("returning secure advances -- the explainer disappears once isDeviceSecure() reports true", async () => {
    mockIsDeviceSecure.mockResolvedValueOnce(false);

    render(<DeviceLockScreen />);
    await waitFor(() => expect(screen.getByTestId("device-lock-explainer")).toBeTruthy());

    mockIsDeviceSecure.mockResolvedValueOnce(true);
    await act(async () => {
      emitAppState("active");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByTestId("device-lock-explainer")).toBeNull());
    expect(mockIsDeviceSecure).toHaveBeenCalledTimes(2);
  });

  test("a background transition alone (never returning to active) never triggers a recheck", async () => {
    mockIsDeviceSecure.mockResolvedValue(false);

    render(<DeviceLockScreen />);
    await waitFor(() => expect(screen.getByTestId("device-lock-explainer")).toBeTruthy());
    mockIsDeviceSecure.mockClear();

    act(() => emitAppState("background"));

    expect(mockIsDeviceSecure).not.toHaveBeenCalled();
  });
});
