// app/__tests__/index.test.tsx — the entry route's ordering hazard
// (task-17-brief.md): the (onboarding) route group does not exist yet (it
// ships in a later plan), so routing there would crash with "no route named
// (onboarding)". These tests prove the entry route falls through to the tabs
// unconditionally today, and specifically that it never even ATTEMPTS the
// nonexistent route — captured via a mocked Redirect rather than asserted
// indirectly, so a regression that reintroduces the onboarding href fails
// here instead of at a runtime crash.
import { render } from "@testing-library/react-native";

let capturedHref: string | undefined;

jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => {
    capturedHref = props.href;
    return null;
  },
}));

jest.mock("@/lib/bootstrap", () => ({
  getLastBootstrapResult: jest.fn(),
}));

import { getLastBootstrapResult } from "@/lib/bootstrap";
import Index from "../index";

const mockGetLastBootstrapResult = getLastBootstrapResult as jest.Mock;

beforeEach(() => {
  capturedHref = undefined;
  mockGetLastBootstrapResult.mockReset();
});

test("a first-run user (onboarding_complete false) is sent to the tabs, not the nonexistent onboarding route", () => {
  mockGetLastBootstrapResult.mockReturnValue({ onboardingComplete: false });
  render(<Index />);
  expect(capturedHref).toBe("/(tabs)");
  expect(capturedHref).not.toBe("/(onboarding)");
});

test("a returning user (onboarding_complete true) is also sent to the tabs", () => {
  mockGetLastBootstrapResult.mockReturnValue({ onboardingComplete: true });
  render(<Index />);
  expect(capturedHref).toBe("/(tabs)");
});

test("falls through to the tabs even if bootstrap's result isn't available yet (defensive null)", () => {
  mockGetLastBootstrapResult.mockReturnValue(null);
  render(<Index />);
  expect(capturedHref).toBe("/(tabs)");
});
