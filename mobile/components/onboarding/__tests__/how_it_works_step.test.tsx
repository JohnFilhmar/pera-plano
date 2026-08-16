// components/onboarding/__tests__/how_it_works_step.test.tsx — not one of
// task-2-brief.md's named tests, same rationale as welcome_step.test.tsx:
// every other routed screen in this codebase has a test file, and docs rule
// 15 ("all notification samples in onboarding are visibly marked as
// illustrative") is a concrete, checkable claim this screen makes.
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
}));

import { fireEvent, render, screen } from "@testing-library/react-native";
import HowItWorksScreen from "@/app/(onboarding)/how_it_works";

beforeEach(() => {
  jest.clearAllMocks();
});

test("explains the mechanism in plain language", () => {
  render(<HowItWorksScreen />);

  expect(screen.getByTestId("how-it-works-mechanism")).toBeTruthy();
  const tree = JSON.stringify(screen.toJSON()).toLowerCase();
  expect(tree).toMatch(/notification/);
  expect(tree).toMatch(/ledger/);
});

test("marks the sample notification as illustrative, not real", () => {
  render(<HowItWorksScreen />);

  const tree = JSON.stringify(screen.toJSON()).toLowerCase();
  expect(tree).toMatch(/illustrative/);
  expect(tree).toMatch(/not a real notification/);
});

test("pressing back returns to welcome", () => {
  render(<HowItWorksScreen />);

  fireEvent.press(screen.getByTestId("onboarding-back-button"));

  expect(mockBack).toHaveBeenCalledTimes(1);
});

test("pressing the primary action advances to access", () => {
  render(<HowItWorksScreen />);

  fireEvent.press(screen.getByTestId("onboarding-primary-button"));

  expect(mockPush).toHaveBeenCalledWith("/(onboarding)/access");
});

test("has no skip link -- this screen has no permission to skip", () => {
  render(<HowItWorksScreen />);

  expect(screen.queryByTestId("onboarding-skip-link")).toBeNull();
});
