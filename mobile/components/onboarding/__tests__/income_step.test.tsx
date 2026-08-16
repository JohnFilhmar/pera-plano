// components/onboarding/__tests__/income_step.test.tsx — task-3-brief rule 3:
// kinsenas first among the four cadences, and "let PeraPlano figure it out"
// skipping straight to automatic detection. Covers
// components/onboarding/income_quick_form.tsx (presentational) and
// app/(onboarding)/income.tsx (the route that owns the write), the same split
// every other step in this suite uses.
//
// expo-router IS MOCKED HERE NOW. The screen is a ROUTE: expo-router mounts it
// with no props at all, so its forward action can no longer be a bare
// `onDone?.()` that silently does nothing when nobody supplies one (see
// app/(onboarding)/wallets.tsx's header for the defect that shipped). It
// navigates for itself, which means the real `useRouter().push` asserts a
// mounted navigator — the same mock welcome_step.test.tsx has always used.
// The `onDone` tests below still pass the prop and still pin it: a supplied
// callback continues to win over navigation.
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { closeDatabase } from "@/lib/db/database";
import { getIncomeProfile } from "@/lib/db/repos/income_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";

import { IncomeQuickForm } from "../income_quick_form";
import IncomeScreen from "@/app/(onboarding)/income";

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
  render(<IncomeScreen {...props} />, { wrapper: Wrapper });
  await screen.findByTestId("income-quick-form-intro");
}

beforeEach(async () => {
  jest.clearAllMocks();
  await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// IncomeQuickForm — purely presentational, rule 3's cadence ordering.
// ---------------------------------------------------------------------------

describe("IncomeQuickForm", () => {
  test("lists the four cadences with kinsenas first, the Philippine norm", () => {
    render(<IncomeQuickForm wallets={[]} onSubmit={jest.fn()} />);

    // components/income/cadence_picker.tsx renders one row per cadence, in
    // its own fixed order — reused here rather than re-listed so the two
    // screens can never disagree about which comes first.
    const rows = screen.getAllByRole("radio");
    expect(rows.map((row) => row.props.testID)).toEqual([
      "cadence-kinsenas",
      "cadence-weekly",
      "cadence-monthly",
      "cadence-irregular",
    ]);
  });

  test("kinsenas is selected by default, before any tap", () => {
    render(<IncomeQuickForm wallets={[]} onSubmit={jest.fn()} />);

    expect(screen.getByTestId("cadence-kinsenas").props.accessibilityState).toEqual({
      selected: true,
    });
  });

  test("submitting reports the chosen cadence, amount and source wallets", () => {
    const onSubmit = jest.fn();
    render(<IncomeQuickForm wallets={[]} onSubmit={onSubmit} />);

    fireEvent.press(screen.getByTestId("cadence-monthly"));
    fireEvent.changeText(screen.getByTestId("income-quick-amount"), "1850000");
    fireEvent.press(screen.getByTestId("income-quick-save"));

    expect(onSubmit).toHaveBeenCalledWith({
      cadence: "monthly",
      averageAmount: 1_850_000,
      sourceWalletIds: [],
    });
  });
});

// ---------------------------------------------------------------------------
// app/(onboarding)/income.tsx — owns the write, and the escape hatch.
// ---------------------------------------------------------------------------

describe("IncomeScreen", () => {
  test("declaring income sets a manual IncomeProfile with the entered figures", async () => {
    const gcash = await createWallet({ name: "GCash", type: "e-wallet" });
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId(`income-quick-wallet-${gcash.id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId("cadence-kinsenas"));
    fireEvent.changeText(screen.getByTestId("income-quick-amount"), "1200000");
    fireEvent.press(screen.getByTestId(`income-quick-wallet-${gcash.id}`));
    fireEvent.press(screen.getByTestId("income-quick-save"));

    await waitFor(async () => expect(await getIncomeProfile()).not.toBeNull());
    const profile = await getIncomeProfile();
    expect(profile!.cadence).toBe("kinsenas");
    expect(profile!.averageAmount).toBe(1_200_000);
    expect(profile!.sourceWalletIds).toEqual([gcash.id]);
    expect(profile!.isManualOverride).toBe(true);
    // With no `onDone` supplied — which is how the router mounts it — saving
    // still has to move the flow on by itself.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/first_limit"));
  });

  test('"let PeraPlano figure it out" skips to detection: no IncomeProfile is created', async () => {
    const onDone = jest.fn();
    await renderScreen({ onDone });

    // The frame's primary button IS "let PeraPlano figure it out" for this
    // step (app/(onboarding)/income.tsx wires it that way).
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    expect(await getIncomeProfile()).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test("skipping is the same action as letting PeraPlano figure it out: no IncomeProfile either way", async () => {
    const onDone = jest.fn();
    await renderScreen({ onDone });

    fireEvent.press(screen.getByTestId("onboarding-skip-link"));

    expect(await getIncomeProfile()).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test("advances once the income is saved", async () => {
    const onDone = jest.fn();
    await renderScreen({ onDone });

    fireEvent.changeText(screen.getByTestId("income-quick-amount"), "900000");
    fireEvent.press(screen.getByTestId("income-quick-save"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
