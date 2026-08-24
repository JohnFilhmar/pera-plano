// components/onboarding/__tests__/access_step.test.tsx — task-2-brief.md's
// named tests for the Notification Access step, covering both the
// presentational components/onboarding/access_explainer.tsx AND the routed
// screen app/(onboarding)/access.tsx that owns isAccessGranted()/
// openAccessSettings() and the return-from-Settings recheck. Same
// "explainer + screen in one file" shape components/onboarding/__tests__/
// device_lock.test.tsx already established.
//
// react-native's AppState is mocked via a Proxy over jest.requireActual, not
// a plain `{...actual}` spread — same reasoning device_lock.test.tsx and
// contexts/__tests__/lock_context.test.tsx document: spreading eagerly
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

// The listener module is NATIVE and cannot be required under Jest (task-2-
// brief.md's own note) — mocked the same way app/__tests__/home_screen.test.tsx
// mocks it.
jest.mock("@/modules/notification_listener", () => ({
  isAccessGranted: jest.fn(),
  openAccessSettings: jest.fn(),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
}));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { isAccessGranted, openAccessSettings } from "@/modules/notification_listener";
import { AccessExplainer } from "../access_explainer";
import AccessScreen from "@/app/(onboarding)/access";

const mockIsAccessGranted = isAccessGranted as jest.Mock;
const mockOpenAccessSettings = openAccessSettings as jest.Mock;

function emitAppState(state: "active" | "background") {
  (AppState as unknown as { __emit: (s: string) => void }).__emit(state);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// AccessExplainer — purely presentational.
// ---------------------------------------------------------------------------

describe("AccessExplainer", () => {
  test("states the local-first promise before naming what is extracted and discarded", () => {
    render(<AccessExplainer />);

    const tree = JSON.stringify(screen.toJSON());
    const localFirstIndex = tree.indexOf("parses them on this device");
    const extractedIndex = tree.indexOf("the amount");

    expect(localFirstIndex).toBeGreaterThan(-1);
    expect(extractedIndex).toBeGreaterThan(-1);
    expect(localFirstIndex).toBeLessThan(extractedIndex);
  });

  test("names what is extracted: amount, direction, merchant, reference", () => {
    render(<AccessExplainer />);

    const tree = JSON.stringify(screen.toJSON()).toLowerCase();
    expect(tree).toMatch(/amount/);
    expect(tree).toMatch(/direction/);
    expect(tree).toMatch(/merchant/);
    expect(tree).toMatch(/reference/);
  });

  test("names what is discarded: raw text after 30 days", () => {
    render(<AccessExplainer />);

    const tree = JSON.stringify(screen.toJSON()).toLowerCase();
    expect(tree).toMatch(/30 days/);
    expect(tree).toMatch(/deleted automatically/);
  });

  test("shows no declined notice by default", () => {
    render(<AccessExplainer />);

    expect(screen.queryByTestId("access-explainer-declined-notice")).toBeNull();
  });

  test("shows the later-in-settings notice only when outcome is 'declined'", () => {
    render(<AccessExplainer outcome="declined" />);

    expect(screen.getByTestId("access-explainer-declined-notice")).toBeTruthy();
    expect(screen.getByText(/turn this on later/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// app/(onboarding)/access.tsx — owns openAccessSettings() and the
// return-from-Settings recheck.
// ---------------------------------------------------------------------------

describe("AccessScreen", () => {
  test("pressing the primary action calls openAccessSettings", () => {
    render(<AccessScreen />);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    expect(mockOpenAccessSettings).toHaveBeenCalledTimes(1);
  });

  test("returning granted advances to the battery step", async () => {
    mockIsAccessGranted.mockResolvedValue(true);
    render(<AccessScreen />);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await act(async () => {
      emitAppState("active");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/battery"));
  });

  test("returning not granted shows the later-in-settings message, and continuing advances", async () => {
    mockIsAccessGranted.mockResolvedValue(false);
    render(<AccessScreen />);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await act(async () => {
      emitAppState("active");
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(/turn this on later/i)).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    expect(mockPush).toHaveBeenCalledWith("/(onboarding)/battery");
  });

  test("an app-state return that never opened settings does not trigger a recheck", async () => {
    render(<AccessScreen />);

    act(() => emitAppState("active"));

    expect(mockIsAccessGranted).not.toHaveBeenCalled();
  });

  test("skipping advances to the battery step without ever opening settings", () => {
    render(<AccessScreen />);

    fireEvent.press(screen.getByTestId("onboarding-skip-link"));

    expect(mockOpenAccessSettings).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/(onboarding)/battery");
  });

  test("pressing back returns to the previous step", () => {
    render(<AccessScreen />);

    fireEvent.press(screen.getByTestId("onboarding-back-button"));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
