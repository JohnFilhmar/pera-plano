// components/onboarding/__tests__/welcome_step.test.tsx — not one of
// task-2-brief.md's named tests (only access_step.test.tsx and
// battery_step.test.tsx are named), but every other routed screen in this
// codebase has a test file, and this one is the first thing a brand-new user
// ever reads — worth pinning the same way.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
}));

import { fireEvent, render, screen } from "@testing-library/react-native";
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
