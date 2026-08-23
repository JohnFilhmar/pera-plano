// components/privacy/__tests__/provider_success_meter.test.tsx — m3b Task 7
// Step 2.
import { render, screen } from "@testing-library/react-native";

import { ProviderSuccessMeter } from "../provider_success_meter";
import type { ProviderParseStats } from "@/lib/diagnostics/parse_stats_repo";

test("renders parsed and failed counts per provider", () => {
  const stats: ProviderParseStats[] = [
    { providerKey: "gcash", parsed: 40, failed: 2 },
    { providerKey: "bpi-sms", parsed: 10, failed: 0 },
  ];

  render(<ProviderSuccessMeter stats={stats} />);

  screen.getByText("gcash");
  screen.getByText("40 parsed · 2 failed");
  screen.getByText("bpi-sms");
  screen.getByText("10 parsed · 0 failed");
});

test("a provider above the failure threshold is highlighted", () => {
  // 3/10 = 30% failure, well above the 5% threshold.
  const stats: ProviderParseStats[] = [{ providerKey: "maya", parsed: 7, failed: 3 }];

  render(<ProviderSuccessMeter stats={stats} />);

  screen.getByTestId("provider-success-maya-flag");
  screen.getByText(/parse success has dropped/i);
});

test("a provider at or under the failure threshold is not highlighted", () => {
  // 1/100 = 1% failure, comfortably under 5%.
  const stats: ProviderParseStats[] = [{ providerKey: "gotyme", parsed: 99, failed: 1 }];

  render(<ProviderSuccessMeter stats={stats} />);

  expect(screen.queryByTestId("provider-success-gotyme-flag")).toBeNull();
});

test("a provider with zero activity is not flagged (no data is not a failure)", () => {
  const stats: ProviderParseStats[] = [{ providerKey: "unionbank", parsed: 0, failed: 0 }];

  render(<ProviderSuccessMeter stats={stats} />);

  expect(screen.queryByTestId("provider-success-unionbank-flag")).toBeNull();
});

// NO "REPORT THIS" ANYMORE. A per-row "Report this" Pressable used to sit
// here, wired to an `onReport` prop that the screen turned into a purely
// local `useState` write — no network call ever happened, yet the screen
// showed a "Thanks — reported…" confirmation regardless of the user's
// telemetry opt-out (rest-state-promise-audit.md Finding 1). `onReport` is
// gone from `ProviderSuccessMeterProps` entirely, so there is no prop left
// to wire a report control back up to without a type change — this guard
// covers the render output directly, in case a future control calls
// something else (e.g. a new prop, or a direct `services/telemetry` import)
// instead of resurrecting `onReport`.
//
// Two targeted checks, not a blanket "no pressable anywhere" sweep — this
// component's own rows may reasonably grow other per-provider actions later
// (e.g. "view raw samples"), and a blanket sweep would fail on those for a
// reason unrelated to this defect. This checks only the two artifacts the
// removed control was made of: its exact visible label, and its testID
// convention (which a relabelled-but-still-local-state button would likely
// keep, since it is derived mechanically from `providerKey`).
test("renders no per-row control claiming to report or send a provider's counts", () => {
  const stats: ProviderParseStats[] = [{ providerKey: "gcash", parsed: 5, failed: 1 }];

  render(<ProviderSuccessMeter stats={stats} />);

  // Anchor the negatives on something positive first. Two `queryBy…toBeNull`
  // assertions alone also pass against a component that renders NOTHING —
  // this test stayed green with the body forced to `return null` — so
  // without this line the guard cannot tell "the report control is gone"
  // from "the whole meter is gone".
  screen.getByTestId("provider-success-gcash");

  expect(screen.queryByText("Report this")).toBeNull();
  expect(JSON.stringify(screen.toJSON())).not.toMatch(/-report"/);
});

test("no activity anywhere shows the empty state, not an empty list", () => {
  render(<ProviderSuccessMeter stats={[]} />);

  screen.getByTestId("provider-success-meter-empty");
  screen.getByText("No parse activity yet");
});
