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
import type { ReactElement, ReactNode } from "react";
import { StyleSheet } from "react-native";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { openKeypad, typeAmount } from "@/test_support/keypad";
import { closeDatabase } from "@/lib/db/database";
import { getIncomeProfile } from "@/lib/db/repos/income_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";

import { IncomeQuickForm } from "../income_quick_form";
import IncomeScreen from "@/app/(onboarding)/income";

/**
 * The amount field is a NumericField on the shared panel now
 * (numeric-input-system Task 12), so this file drives it through
 * test_support/keypad.ts rather than its own `numpad-key-*` loop — and every
 * amount below is retyped in PESOS for the same centavos as before.
 *
 * The host is rendered BEFORE the subject: mount effects commit in completion
 * order and keypad_context.tsx hands the panel to the highest live token, so
 * a root stand-in registered first leaves the higher tokens to anything the
 * subject mounts later.
 */
function renderForm(ui: ReactElement) {
  return render(
    <KeypadProvider>
      <KeypadHost />
      {ui}
    </KeypadProvider>,
  );
}

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
    return (
      <QueryClientProvider client={client}>
        <KeypadProvider>
          <KeypadHost />
          {children}
        </KeypadProvider>
      </QueryClientProvider>
    );
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
    renderForm(<IncomeQuickForm wallets={[]} onSubmit={jest.fn()} />);

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
    renderForm(<IncomeQuickForm wallets={[]} onSubmit={jest.fn()} />);

    expect(screen.getByTestId("cadence-kinsenas").props.accessibilityState).toEqual({
      selected: true,
    });
  });

  test("submitting reports the chosen cadence, amount and source wallets", () => {
    const onSubmit = jest.fn();
    renderForm(<IncomeQuickForm wallets={[]} onSubmit={onSubmit} />);

    fireEvent.press(screen.getByTestId("cadence-monthly"));
    typeAmount("income-quick-amount", "18500"); // was "1850000" in centavos
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
    typeAmount("income-quick-amount", "12000"); // was "1200000" in centavos
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

  test("SAVE MY INCOME IS NOT BURIED BY THE KEYPAD PANEL", async () => {
    // The owner's `save-income-button-burried` report. OnboardingFrame's
    // footer sits OUTSIDE its ScrollView, so scrolling can never lift it clear
    // of a panel pinned to the bottom of the window — the frame has to give
    // that band up itself. numeric-input-system Task 12 does that by growing
    // the footer's own bottom margin, which shrinks the flex-1 scroll area
    // above it in the same pass, so nothing else has to know.
    await renderScreen();

    const insetBottom =
      StyleSheet.flatten(screen.getByTestId("onboarding-frame").props.style).paddingBottom ?? 0;
    const marginOf = () =>
      StyleSheet.flatten(screen.getByTestId("onboarding-footer").props.style).marginBottom ?? 0;

    // Closed panel: the frame is exactly what it always was. This is what
    // makes the change a no-op on the seven onboarding steps with no numeric
    // field at all.
    expect(marginOf()).toBe(0);

    openKeypad("income-quick-amount");
    fireEvent(screen.getByTestId("keypad-host"), "layout", {
      nativeEvent: { layout: { height: 320, width: 400, x: 0, y: 0 } },
    });

    // The footer's own bottom edge already sits `insets.bottom` above the
    // window, and the panel's measured height already includes that same
    // strip — so the two together have to clear 320, and the margin alone
    // must not (that would be counting the inset twice).
    expect(marginOf() + insetBottom).toBeGreaterThanOrEqual(320);
    expect(marginOf()).toBeLessThanOrEqual(320);

    // WHAT THIS TEST CANNOT SEE, STATED RATHER THAN IMPLIED: jest maps the
    // compiled stylesheet to test_support/style_mock.ts, so NO className
    // resolves to a style here — checked by asserting the footer's own `pb-6`
    // and getting `undefined`. The margin above is the frame's own style
    // object, which is exactly what this assertion is about; that it composes
    // with `pb-6` rather than replacing it is a per-PROPERTY fact about
    // NativeWind, and the reason the lift is a margin and not a padding.
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

    typeAmount("income-quick-amount", "9000"); // was "900000" in centavos
    fireEvent.press(screen.getByTestId("income-quick-save"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
