// components/onboarding/__tests__/onboarding_frame.test.tsx — task-1-brief.md's
// remaining two named tests: the frame renders progress, back, primary and
// skip, and skip advances to the next step. The frame is pure chrome (rule
// 2), so every case here renders it directly with plain content -- no
// database, no navigation mock.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { nextStep, type OnboardingStep } from "@/lib/onboarding/onboarding_state";
import { OnboardingFrame } from "../onboarding_frame";

test("renders the progress dots, a primary action, and the skip link", () => {
  render(
    <OnboardingFrame step="welcome" title="Welcome" onPrimary={jest.fn()} onSkip={jest.fn()}>
      <Text>content</Text>
    </OnboardingFrame>,
  );

  expect(screen.getByTestId("onboarding-step-progress")).toBeTruthy();
  expect(screen.getByTestId("onboarding-primary-button")).toBeTruthy();
  expect(screen.getByTestId("onboarding-skip-link")).toBeTruthy();
});

test("renders a back affordance only when the caller supplies onBack", () => {
  const { rerender } = render(
    <OnboardingFrame step="welcome" title="Welcome" onPrimary={jest.fn()}>
      <Text>content</Text>
    </OnboardingFrame>,
  );
  expect(screen.queryByTestId("onboarding-back-button")).toBeNull();

  rerender(
    <OnboardingFrame
      step="how_it_works"
      title="How it works"
      onPrimary={jest.fn()}
      onBack={jest.fn()}
    >
      <Text>content</Text>
    </OnboardingFrame>,
  );
  expect(screen.getByTestId("onboarding-back-button")).toBeTruthy();
});

test("pressing back calls onBack", () => {
  const onBack = jest.fn();
  render(
    <OnboardingFrame step="how_it_works" title="How it works" onPrimary={jest.fn()} onBack={onBack}>
      <Text>content</Text>
    </OnboardingFrame>,
  );

  fireEvent.press(screen.getByTestId("onboarding-back-button"));

  expect(onBack).toHaveBeenCalledTimes(1);
});

test("pressing the primary action calls onPrimary", () => {
  const onPrimary = jest.fn();
  render(
    <OnboardingFrame step="welcome" title="Welcome" onPrimary={onPrimary}>
      <Text>content</Text>
    </OnboardingFrame>,
  );

  fireEvent.press(screen.getByTestId("onboarding-primary-button"));

  expect(onPrimary).toHaveBeenCalledTimes(1);
});

test("skip is absent when the caller supplies no onSkip -- the finish step has nothing left to skip", () => {
  render(
    <OnboardingFrame step="done" title="All set" onPrimary={jest.fn()}>
      <Text>content</Text>
    </OnboardingFrame>,
  );

  expect(screen.queryByTestId("onboarding-skip-link")).toBeNull();
});

test("skip advances to the next step -- the wiring rule 1's dead-end guard depends on", () => {
  // Wires onSkip to nextStep exactly the way a real step screen will:
  // skipping the LAST content step must still land on "done", never strand
  // the user where they started. That step is "alerts" since GAP-003 put the
  // POST_NOTIFICATIONS ask between "first_limit" and "done".
  let step: OnboardingStep = "alerts";
  const handleSkip = jest.fn(() => {
    step = nextStep(step) ?? step;
  });

  render(
    <OnboardingFrame step={step} title="Turn on alerts" onPrimary={jest.fn()} onSkip={handleSkip}>
      <Text>content</Text>
    </OnboardingFrame>,
  );

  fireEvent.press(screen.getByTestId("onboarding-skip-link"));

  expect(handleSkip).toHaveBeenCalledTimes(1);
  expect(step).toBe("done");
});
