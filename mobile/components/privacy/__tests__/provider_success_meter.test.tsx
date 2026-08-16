// components/privacy/__tests__/provider_success_meter.test.tsx — m3b Task 7
// Step 2.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { ProviderSuccessMeter } from "../provider_success_meter";
import type { ProviderParseStats } from "@/lib/diagnostics/parse_stats_repo";

test("renders parsed and failed counts per provider", () => {
  const stats: ProviderParseStats[] = [
    { providerKey: "gcash", parsed: 40, failed: 2 },
    { providerKey: "bpi-sms", parsed: 10, failed: 0 },
  ];

  render(<ProviderSuccessMeter stats={stats} onReport={jest.fn()} />);

  screen.getByText("gcash");
  screen.getByText("40 parsed · 2 failed");
  screen.getByText("bpi-sms");
  screen.getByText("10 parsed · 0 failed");
});

test("a provider above the failure threshold is highlighted", () => {
  // 3/10 = 30% failure, well above the 5% threshold.
  const stats: ProviderParseStats[] = [{ providerKey: "maya", parsed: 7, failed: 3 }];

  render(<ProviderSuccessMeter stats={stats} onReport={jest.fn()} />);

  screen.getByTestId("provider-success-maya-flag");
  screen.getByText(/parse success has dropped/i);
});

test("a provider at or under the failure threshold is not highlighted", () => {
  // 1/100 = 1% failure, comfortably under 5%.
  const stats: ProviderParseStats[] = [{ providerKey: "gotyme", parsed: 99, failed: 1 }];

  render(<ProviderSuccessMeter stats={stats} onReport={jest.fn()} />);

  expect(screen.queryByTestId("provider-success-gotyme-flag")).toBeNull();
});

test("a provider with zero activity is not flagged (no data is not a failure)", () => {
  const stats: ProviderParseStats[] = [{ providerKey: "unionbank", parsed: 0, failed: 0 }];

  render(<ProviderSuccessMeter stats={stats} onReport={jest.fn()} />);

  expect(screen.queryByTestId("provider-success-unionbank-flag")).toBeNull();
});

test("report this sends only the aggregate row for that provider", () => {
  const onReport = jest.fn();
  const stats: ProviderParseStats[] = [{ providerKey: "gcash", parsed: 5, failed: 1 }];

  render(<ProviderSuccessMeter stats={stats} onReport={onReport} />);
  fireEvent.press(screen.getByTestId("provider-success-gcash-report"));

  // Exactly the aggregate — nothing content-shaped could be in this payload
  // even by accident, because `ProviderParseStats` has nowhere to put it.
  expect(onReport).toHaveBeenCalledWith({ providerKey: "gcash", parsed: 5, failed: 1 });
  expect(onReport).toHaveBeenCalledTimes(1);
});

test("no activity anywhere shows the empty state, not an empty list", () => {
  render(<ProviderSuccessMeter stats={[]} onReport={jest.fn()} />);

  screen.getByTestId("provider-success-meter-empty");
  screen.getByText("No parse activity yet");
});
