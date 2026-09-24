// components/home/__tests__/tracking_banner.test.tsx — no dedicated test file
// existed before this fix (home_screen.test.tsx exercises this component only
// indirectly, and is a documented flaky suite — see the branch's own testing
// notes). Covers the design F1 sweep's touch-target fix for "Resume" and
// "Fix tracking", anchored on a positive render assertion first.
import { render, screen } from "@testing-library/react-native";

import { TrackingBanner } from "../tracking_banner";
import type { TrackingHealth } from "@/hooks/queries/use_listener_health";

function health(overrides: Partial<TrackingHealth>): TrackingHealth {
  return {
    granted: true,
    serviceConnected: true,
    lastCaptureAt: null,
    pendingCaptures: 0,
    evictedCaptures: 0,
    captureEnabled: true,
    ...overrides,
  };
}

// Positive assertion FIRST, on purpose: a "renders nothing" guard proves
// nothing about a component that renders nothing unconditionally, so this
// establishes the component actually renders real content before either
// negative case below leans on that being true.
test("a paused banner renders the Resume action — the positive case every guard below relies on", () => {
  render(
    <TrackingBanner
      health={health({ captureEnabled: false })}
      onResume={() => {}}
      onFix={() => {}}
    />,
  );
  expect(screen.getByText("Resume")).toBeTruthy();
});

test("renders nothing while health is unknown", () => {
  render(<TrackingBanner health={undefined} onResume={() => {}} onFix={() => {}} />);
  expect(screen.queryByTestId("tracking-paused")).toBeNull();
  expect(screen.queryByTestId("tracking-interrupted")).toBeNull();
});

test("renders nothing when tracking is healthy", () => {
  render(
    <TrackingBanner health={health({})} onResume={() => {}} onFix={() => {}} />,
  );
  expect(screen.queryByTestId("tracking-paused")).toBeNull();
  expect(screen.queryByTestId("tracking-interrupted")).toBeNull();
});

// Design F1 sweep: "Resume" carries no padding class and no size guarantee on
// its Text, and no hitSlop to compensate. Pins the slop VALUE, not tap
// behaviour — Jest has no real hit-testing.
test("Resume carries a hitSlop compensating for its unpadded touch target", () => {
  render(
    <TrackingBanner
      health={health({ captureEnabled: false })}
      onResume={() => {}}
      onFix={() => {}}
    />,
  );
  expect(screen.getByTestId("tracking-resume").props.hitSlop).toEqual({
    top: 16,
    bottom: 16,
    left: 16,
    right: 16,
  });
});

test("an interrupted banner renders the Fix tracking action", () => {
  render(
    <TrackingBanner
      health={health({ serviceConnected: false })}
      onResume={() => {}}
      onFix={() => {}}
    />,
  );
  expect(screen.getByText("Fix tracking")).toBeTruthy();
});

test("Fix tracking carries a hitSlop compensating for its unpadded touch target", () => {
  render(
    <TrackingBanner
      health={health({ serviceConnected: false })}
      onResume={() => {}}
      onFix={() => {}}
    />,
  );
  expect(screen.getByTestId("tracking-fix").props.hitSlop).toEqual({
    top: 16,
    bottom: 16,
    left: 16,
    right: 16,
  });
});
