// components/onboarding/__tests__/first_limit_step.test.tsx — task-3-brief
// rules 4-5: the live preview sentence and the percent-of-income basis being
// offered only once income is known. Covers both
// components/onboarding/first_limit_form.tsx (presentational) and
// app/(onboarding)/first_limit.tsx (the route that owns the write), the same
// split provider_picker.test.tsx and wallet_routes.test.tsx already use for
// their own pairs.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { closeDatabase } from "@/lib/db/database";
import { listLimits } from "@/lib/db/repos/limits_repo";
import { setManualIncome } from "@/lib/income/income_service";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";

import { FirstLimitForm } from "../first_limit_form";
import FirstLimitScreen from "@/app/(onboarding)/first_limit";

function makeTestClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions();
  return new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
}

async function renderScreen(props: { onDone?: () => void } = {}): Promise<void> {
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<FirstLimitScreen {...props} />, { wrapper: Wrapper });
  // Waits out both queries (income summary, wallets are not read here) so no
  // test fires an event before React Query's async resolution has settled --
  // otherwise that resolution lands outside any `act()` the test itself ran.
  await screen.findByTestId("first-limit-form-intro");
}

beforeEach(async () => {
  await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// FirstLimitForm — purely presentational, live preview + rule 5's hiding.
// ---------------------------------------------------------------------------

describe("FirstLimitForm", () => {
  test("the preview sentence updates live as the fixed amount is typed", () => {
    render(<FirstLimitForm monthlyIncome={null} onSubmit={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId("first-limit-amount"), "1000000");

    // 1,000,000 centavos = ₱10,000.00 a month; ₱10,000.00 / 30 ≈ ₱333.33 a day.
    expect(screen.getByTestId("first-limit-preview")).toHaveTextContent(
      "₱10,000.00 every month is about ₱333.33 a day.",
    );
  });

  test("percent-of-income is hidden entirely when no income was declared, with a note explaining why", () => {
    render(<FirstLimitForm monthlyIncome={null} onSubmit={jest.fn()} />);

    expect(screen.queryByTestId("first-limit-basis-percent")).toBeNull();
    expect(screen.getByTestId("first-limit-no-income-note")).toBeTruthy();
  });

  test("percent-of-income is offered once income is known, and the preview reflects it", () => {
    // ₱30,000.00 monthly income.
    render(<FirstLimitForm monthlyIncome={3_000_000} onSubmit={jest.fn()} />);

    expect(screen.queryByTestId("first-limit-no-income-note")).toBeNull();
    fireEvent.press(screen.getByTestId("first-limit-basis-percent"));
    fireEvent.changeText(screen.getByTestId("first-limit-percent"), "20");

    // 20% of ₱30,000.00 = ₱6,000.00 a month; /30 = ₱200.00 a day.
    expect(screen.getByTestId("first-limit-preview")).toHaveTextContent(
      "₱6,000.00 every month is about ₱200.00 a day.",
    );
  });

  test("submitting a percent basis reports the percent-times-100 encoding, never the raw percent", () => {
    const onSubmit = jest.fn();
    render(<FirstLimitForm monthlyIncome={3_000_000} onSubmit={onSubmit} />);

    fireEvent.press(screen.getByTestId("first-limit-basis-percent"));
    fireEvent.changeText(screen.getByTestId("first-limit-percent"), "20");
    fireEvent.press(screen.getByTestId("first-limit-save"));

    // The trap task-3-brief warns about: 20% must store 2000, never 20.
    expect(onSubmit).toHaveBeenCalledWith({ basis: "percent-of-income", value: 2000 });
  });
});

// ---------------------------------------------------------------------------
// app/(onboarding)/first_limit.tsx — owns the write.
// ---------------------------------------------------------------------------

describe("FirstLimitScreen", () => {
  test("saving creates a monthly, non-rollover Limit with the entered fixed amount", async () => {
    await renderScreen();

    fireEvent.changeText(screen.getByTestId("first-limit-amount"), "1000000");
    fireEvent.press(screen.getByTestId("first-limit-save"));

    await waitFor(async () => expect(await listLimits()).toHaveLength(1));
    const [limit] = await listLimits();
    expect(limit!.scope).toBe("monthly");
    expect(limit!.basis).toBe("fixed");
    expect(limit!.value).toBe(1_000_000);
    expect(limit!.rollover).toBe(false);
    expect(limit!.thresholdsFired).toEqual([]);
  });

  test("percent-of-income is unavailable until an income has actually been declared", async () => {
    await renderScreen();
    expect(screen.queryByTestId("first-limit-no-income-note")).toBeTruthy();
    expect(screen.queryByTestId("first-limit-basis-percent")).toBeNull();
  });

  test("once income is declared, percent-of-income becomes available on this same step", async () => {
    await setManualIncome(
      { cadence: "monthly", averageAmount: 3_000_000, sourceWalletIds: [] },
      Date.now(),
    );

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId("first-limit-basis-percent")).toBeTruthy());
  });

  test("skipping creates no Limit at all and still advances", async () => {
    const onDone = jest.fn();
    await renderScreen({ onDone });

    fireEvent.press(screen.getByTestId("onboarding-skip-link"));

    expect(await listLimits()).toEqual([]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test("advances once the Limit is saved", async () => {
    const onDone = jest.fn();
    await renderScreen({ onDone });

    fireEvent.changeText(screen.getByTestId("first-limit-amount"), "500000");
    fireEvent.press(screen.getByTestId("first-limit-save"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
