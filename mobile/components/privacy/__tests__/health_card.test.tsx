// components/privacy/__tests__/health_card.test.tsx — m3b Task 7 Step 2.
//
// No native mock needed: `HealthCard` never imports
// `modules/notification_listener` (see the component's own header) — it
// takes `TrackingHealth` and a callback as props, the same split
// `components/home/tracking_banner.tsx` already uses.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { HealthCard } from "../health_card";
import type { TrackingHealth } from "@/hooks/queries/use_listener_health";

function health(overrides: Partial<TrackingHealth> = {}): TrackingHealth {
  return {
    granted: true,
    serviceConnected: true,
    lastCaptureAt: null,
    captureEnabled: true,
    pendingCaptures: 0,
    evictedCaptures: 0,
    ...overrides,
  };
}

test("renders all three facts — access, service, and last capture", () => {
  render(
    <HealthCard
      health={health({ lastCaptureAt: new Date(2026, 7, 10, 9, 30).getTime() })}
      onOpenAccessSettings={jest.fn()}
    />,
  );

  screen.getByText("Granted");
  screen.getByText("Connected");
  expect(screen.getByTestId("health-card-last-capture").props.children).toMatch(/Last capture/);
});

test("no capture yet reads as its own state, never an epoch date", () => {
  render(<HealthCard health={health({ lastCaptureAt: null })} onOpenAccessSettings={jest.fn()} />);

  screen.getByText("No capture yet");
});

test("a connected, granted listener shows no revoked warning", () => {
  render(<HealthCard health={health()} onOpenAccessSettings={jest.fn()} />);

  expect(screen.queryByTestId("health-card-revoked-warning")).toBeNull();
});

test("revoked access renders the loud warning and the settings action", () => {
  const onOpenAccessSettings = jest.fn();
  render(<HealthCard health={health({ granted: false })} onOpenAccessSettings={onOpenAccessSettings} />);

  screen.getByTestId("health-card-revoked-warning");
  screen.getByText("Notification access was revoked");
  screen.getByText("Revoked");

  fireEvent.press(screen.getByTestId("health-card-open-settings"));
  expect(onOpenAccessSettings).toHaveBeenCalledTimes(1);
});

test("a disconnected-but-granted service shows the fact plainly, with no revoked warning", () => {
  // Distinct from the revoked case: granted-but-disconnected still gets no
  // settings action here, because there is no single settings screen for it —
  // that is what the OEM guidance section on the same screen is for.
  render(
    <HealthCard health={health({ serviceConnected: false })} onOpenAccessSettings={jest.fn()} />,
  );

  screen.getByText("Disconnected");
  expect(screen.queryByTestId("health-card-revoked-warning")).toBeNull();
});

test("captures waiting to be read are shown as a plain figure", () => {
  render(<HealthCard health={health({ pendingCaptures: 7 })} onOpenAccessSettings={jest.fn()} />);

  expect(screen.getByTestId("health-card-pending").props.children).toMatch(/7/);
});

test("a buffer that has dropped nothing shows no loss warning at all", () => {
  // GAP-051: the eviction row is the whole point of the counter, so it must
  // not be a permanent "0 dropped" fixture that readers learn to ignore.
  render(<HealthCard health={health({ evictedCaptures: 0 })} onOpenAccessSettings={jest.fn()} />);

  expect(screen.queryByTestId("health-card-evicted")).toBeNull();
});

test("an evicted capture is reported as lost, with the count", () => {
  render(<HealthCard health={health({ evictedCaptures: 4 })} onOpenAccessSettings={jest.fn()} />);

  const evicted = screen.getByTestId("health-card-evicted");
  expect(evicted).toBeTruthy();
  screen.getByText(/4 captures were dropped/);
});

test("one dropped capture reads in the singular", () => {
  render(<HealthCard health={health({ evictedCaptures: 1 })} onOpenAccessSettings={jest.fn()} />);

  screen.getByText(/1 capture was dropped/);
});

test("undefined health (still loading) renders without throwing", () => {
  render(<HealthCard health={undefined} onOpenAccessSettings={jest.fn()} />);

  screen.getByTestId("health-card-loading");
});
