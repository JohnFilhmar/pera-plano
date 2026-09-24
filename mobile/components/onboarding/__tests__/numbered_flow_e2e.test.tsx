// components/onboarding/__tests__/numbered_flow_e2e.test.tsx — the
// regression test for the severed-chain defect. app/(onboarding)/battery.tsx
// pushed "/(onboarding)/providers", a screen that had already run once earlier
// in the same session inside app/(onboarding)/index.tsx's pre-flow sequencer
// with its `onDone` prop wired. Pushed a second time via expo-router it mounted
// with no props, so `onDone` was `undefined` and every user who reached
// "battery" -- by tapping through OR by skipping every step -- was stranded
// there with no forward action.
//
// THE FIX AT THE TIME WAS TO SKIP THE PICKER, AND THAT IS NOT THE FIX ANY MORE
// (GAP-091). Jumping battery -> wallets left the picker running before
// notification access existed, where `listObservedPackages()` can only ever
// return an empty list. The picker moved into this flow instead and navigates
// itself, so the chain is battery -> providers -> wallets and the screen mounts
// with the props a route actually gets.
//
// A PER-SCREEN UNIT TEST CANNOT CATCH THIS. Each of welcome_step.test.tsx,
// how_it_works_step.test.tsx, access_step.test.tsx and battery_step.test.tsx
// only asserts its own screen's push target in isolation -- exactly the class
// of regression that shipped, because nothing ever exercised the CHAIN. This
// file renders all four routed screens (welcome -> how_it_works -> access ->
// battery) in the order expo-router would actually mount them -- each one,
// then whichever the previous screen's push target names next -- and asserts
// the chain lands on "/(onboarding)/providers" via a full tap-through AND a
// full skip-through.
//
// IT USED TO ASSERT THE OPPOSITE (GAP-091): "wallets, never providers", because
// the picker ran in app/(onboarding)/index.tsx's pre-flow sequencer and mounting
// it again here would have left it with no `onDone` and no forward action. The
// picker has moved into this flow -- it has to run AFTER notification access
// exists, or it has nothing to show -- and navigates itself, so the reserved
// slot is a real route and the detour past it is the regression now.
//
// react-native's `AppState`/`Linking` are stubbed via `jest.spyOn` on the
// REAL module (never `jest.mock("react-native", ...)`) — this file imports
// all four routed screens together, and each one mounts
// components/onboarding/onboarding_frame.tsx, which pulls in
// lucide-react-native's whole icon barrel (-> react-native-svg ->
// nativewind's jsx-runtime -> react-native-css-interop). That chain makes ITS
// OWN nested `require("react-native")` while resolving, and a synthetic
// Proxy standing in for the whole module there (the technique
// access_step.test.tsx and battery_step.test.tsx each use in isolation, where
// this reentrant path is never hit) crashes on that reentrant access. Real
// module, two spied methods, `jest.restoreAllMocks()` after each test — the
// simplest thing proven not to fight that chain.
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
  // A mocked push never unmounts or blurs anything, so focus here is only ever
  // the mount one — a plain effect is the whole of what this file can model.
  // The re-focus behaviour access.tsx depends on is covered against the real
  // navigator in app/(onboarding)/__tests__/setup_flow_e2e.test.tsx.
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(callback, [callback]);
  },
}));

// The listener module is NATIVE and cannot be required under Jest
// (access_step.test.tsx's own note).
jest.mock("@/modules/notification_listener", () => ({
  isAccessGranted: jest.fn(),
  openAccessSettings: jest.fn(),
}));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Linking, type AppStateStatus } from "react-native";
import { isAccessGranted } from "@/modules/notification_listener";
import WelcomeScreen from "@/app/(onboarding)/welcome";
import HowItWorksScreen from "@/app/(onboarding)/how_it_works";
import AccessScreen from "@/app/(onboarding)/access";
import BatteryScreen from "@/app/(onboarding)/battery";

const mockIsAccessGranted = isAccessGranted as jest.Mock;

let appStateListeners: Array<(state: AppStateStatus) => void> = [];

function emitAppState(state: AppStateStatus) {
  for (const cb of [...appStateListeners]) cb(state);
}

function lastPush(): unknown {
  return mockPush.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  appStateListeners = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListeners.push(listener);
    return {
      remove: jest.fn(() => {
        const idx = appStateListeners.indexOf(listener);
        if (idx >= 0) appStateListeners.splice(idx, 1);
      }),
    };
  });
  jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("full tap-through of welcome -> how_it_works -> access -> battery lands on the provider picker", async () => {
  mockIsAccessGranted.mockResolvedValue(true);

  render(<WelcomeScreen />);
  fireEvent.press(screen.getByTestId("onboarding-primary-button"));
  expect(lastPush()).toBe("/(onboarding)/how_it_works");
  screen.unmount();

  render(<HowItWorksScreen />);
  fireEvent.press(screen.getByTestId("onboarding-primary-button"));
  expect(lastPush()).toBe("/(onboarding)/access");
  screen.unmount();

  render(<AccessScreen />);
  fireEvent.press(screen.getByTestId("onboarding-primary-button"));
  await act(async () => {
    emitAppState("active");
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(lastPush()).toBe("/(onboarding)/battery"));
  screen.unmount();

  render(<BatteryScreen brand={null} />);
  fireEvent.press(screen.getByTestId("onboarding-primary-button"));

  expect(lastPush()).toBe("/(onboarding)/providers");
  // The defect this file was written for, in its current form: jumping the
  // picker entirely. It is a real route now, so skipping past it is the break.
  expect(lastPush()).not.toBe("/(onboarding)/wallets");
});

test("full skip-through of welcome -> how_it_works -> access -> battery lands on the provider picker", () => {
  // welcome and how_it_works offer no skip link (nothing to skip yet) --
  // their own primary action is the only forward affordance either has, the
  // same distinction welcome_step.test.tsx and how_it_works_step.test.tsx
  // each pin individually.
  render(<WelcomeScreen />);
  expect(screen.queryByTestId("onboarding-skip-link")).toBeNull();
  fireEvent.press(screen.getByTestId("onboarding-primary-button"));
  expect(lastPush()).toBe("/(onboarding)/how_it_works");
  screen.unmount();

  render(<HowItWorksScreen />);
  expect(screen.queryByTestId("onboarding-skip-link")).toBeNull();
  fireEvent.press(screen.getByTestId("onboarding-primary-button"));
  expect(lastPush()).toBe("/(onboarding)/access");
  screen.unmount();

  render(<AccessScreen />);
  fireEvent.press(screen.getByTestId("onboarding-skip-link"));
  expect(lastPush()).toBe("/(onboarding)/battery");
  screen.unmount();

  render(<BatteryScreen brand={null} />);
  fireEvent.press(screen.getByTestId("onboarding-skip-link"));

  expect(lastPush()).toBe("/(onboarding)/providers");
  // The defect this file was written for, in its current form: jumping the
  // picker entirely. It is a real route now, so skipping past it is the break.
  expect(lastPush()).not.toBe("/(onboarding)/wallets");
});
