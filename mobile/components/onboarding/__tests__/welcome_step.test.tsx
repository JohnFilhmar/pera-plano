// components/onboarding/__tests__/welcome_step.test.tsx — not one of
// task-2-brief.md's named tests (only access_step.test.tsx and
// battery_step.test.tsx are named), but every other routed screen in this
// codebase has a test file, and this one is the first thing a brand-new user
// ever reads — worth pinning the same way.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import WelcomeScreen from "@/app/(onboarding)/welcome";

beforeEach(() => {
  jest.clearAllMocks();
});

test("states the core promise and the trust framing", () => {
  render(<WelcomeScreen />);

  expect(screen.getByTestId("welcome-promise")).toBeTruthy();
  expect(screen.getByTestId("welcome-trust")).toBeTruthy();
  const tree = JSON.stringify(screen.toJSON()).toLowerCase();
  expect(tree).toMatch(/never log a transaction/);
  expect(tree).toMatch(/no bank passwords/);
});

test("has no back affordance -- there is nowhere to go back to", () => {
  render(<WelcomeScreen />);

  expect(screen.queryByTestId("onboarding-back-button")).toBeNull();
});

test("has no skip link -- there is nothing here to skip", () => {
  render(<WelcomeScreen />);

  expect(screen.queryByTestId("onboarding-skip-link")).toBeNull();
});

test("pressing the primary action advances to how_it_works", () => {
  render(<WelcomeScreen />);

  fireEvent.press(screen.getByTestId("onboarding-primary-button"));

  expect(mockPush).toHaveBeenCalledWith("/(onboarding)/how_it_works");
});

// ---------------------------------------------------------------------------
// The mark itself (follow-up to task-7-brief.md: a fresh install never
// passes through app/index.tsx's own splash launch beat -- lock_context.tsx's
// "needs_onboarding" status routes straight through app/lock.tsx to
// app/(onboarding)/index.tsx, which lands on THIS screen first
// (lib/onboarding/onboarding_state.ts's ONBOARDING_STEPS starts at
// "welcome"). This mark is therefore the first brand mark a brand-new user
// ever sees, not the splash's.
//
// Same discriminator and harness as components/ui/__tests__/motion_placement.test.tsx
// and components/ui/__tests__/brand_mark_motion.test.tsx: the static branch
// renders the imported `.svg` directly, so under test_support/svg_mock.tsx
// its size arrives as a `width` PROP; every animated branch wraps it in
// Reanimated boxes that carry size in `style` instead.
// ---------------------------------------------------------------------------
describe("the welcome mark", () => {
  let removeReduceMotionListener: jest.Mock;
  let emitReduceMotionChange: (enabled: boolean) => void;

  beforeEach(() => {
    removeReduceMotionListener = jest.fn();
    emitReduceMotionChange = () => {
      throw new Error("no reduceMotionChanged listener was registered");
    };

    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockImplementation(((event: string, listener: (enabled: boolean) => void) => {
        if (event === "reduceMotionChanged") {
          emitReduceMotionChange = listener;
        }
        return { remove: removeReduceMotionListener };
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function isStaticMark(node: { props: Record<string, unknown> }): boolean {
    return typeof node.props.width === "number";
  }

  test("with reduce motion off, the mark takes off (no width prop)", async () => {
    render(<WelcomeScreen />);

    await waitFor(() => {
      expect(isStaticMark(screen.getByTestId("welcome-brand-mark"))).toBe(false);
    });
  });

  test("with reduce motion on, the mark degrades to its static frame (width prop present)", async () => {
    render(<WelcomeScreen />);

    // Guard against a vacuous pass: confirm it was actually animating first.
    await waitFor(() => {
      expect(isStaticMark(screen.getByTestId("welcome-brand-mark"))).toBe(false);
    });

    act(() => {
      emitReduceMotionChange(true);
    });

    expect(isStaticMark(screen.getByTestId("welcome-brand-mark"))).toBe(true);
  });
});
