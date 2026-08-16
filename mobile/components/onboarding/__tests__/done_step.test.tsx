// components/onboarding/__tests__/done_step.test.tsx — task-3-brief rule 6:
// the last onboarding step confirms what was actually set up and is the only
// place `onboarding_complete` gets written.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { closeDatabase } from "@/lib/db/database";
import { createLimit } from "@/lib/db/repos/limits_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { setManualIncome } from "@/lib/income/income_service";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";

import DoneScreen from "@/app/(onboarding)/done";

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
  render(<DoneScreen {...props} />, { wrapper: Wrapper });
  await screen.findByTestId("done-step-intro");
}

beforeEach(async () => {
  await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

describe("DoneScreen", () => {
  test("a fully-skipped setup still confirms a usable, empty app rather than an error", async () => {
    await renderScreen();

    expect(screen.getByTestId("done-wallets-summary")).toHaveTextContent(/No wallets yet/);
    expect(screen.getByTestId("done-income-summary")).toHaveTextContent(/Income not set yet/);
    expect(screen.getByTestId("done-limit-summary")).toHaveTextContent(/No Limit set yet/);
  });

  test("confirms the wallets, income and Limit that were actually set up", async () => {
    await createWallet({ name: "GCash", type: "e-wallet" });
    await createWallet({ name: "Cash", type: "cash" });
    await setManualIncome(
      { cadence: "kinsenas", averageAmount: 1_200_000, sourceWalletIds: [] },
      Date.now(),
    );
    await createLimit({ scope: "monthly", basis: "fixed", value: 1_000_000, rollover: false });

    await renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId("done-wallets-summary")).toHaveTextContent(/2 wallets ready/),
    );
    expect(screen.getByTestId("done-income-summary")).toHaveTextContent(/Income declared/);
    expect(screen.getByTestId("done-limit-summary")).toHaveTextContent(/Your first Limit is active/);
  });

  test("completing writes onboarding_complete and advances", async () => {
    const onDone = jest.fn();
    await renderScreen({ onDone });

    expect(await getSetting("onboarding_complete")).toBe(false);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await getSetting("onboarding_complete")).toBe(true));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test("done has nothing left to skip — no skip link renders", async () => {
    await renderScreen();

    expect(screen.queryByTestId("onboarding-skip-link")).toBeNull();
  });
});
