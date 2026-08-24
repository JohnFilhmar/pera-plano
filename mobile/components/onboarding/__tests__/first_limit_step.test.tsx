// components/onboarding/__tests__/first_limit_step.test.tsx — task-3-brief
// rules 4-5: the live preview sentence and the percent-of-income basis being
// offered only once income is known. Covers both
// components/onboarding/first_limit_form.tsx (presentational) and
// app/(onboarding)/first_limit.tsx (the route that owns the write), the same
// split provider_picker.test.tsx and wallet_routes.test.tsx already use for
// their own pairs.
//
// expo-router IS MOCKED HERE NOW, for the reason income_step.test.tsx's header
// gives at length: the screen is a route, so its forward action navigates for
// itself rather than relying on an `onDone` the router never supplies. The
// `onDone` tests below still pin that a supplied callback wins.
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
import { TextInput } from "react-native";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { typeAmount } from "@/test_support/keypad";
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

/**
 * Both of this form's fields are NumericFields now (numeric-input-system Task
 * 12) and `useKeypad` throws without a provider, so the bare-component cases
 * need the same shell the routed ones do. The host is rendered BEFORE the
 * subject: mount effects commit in completion order, and keypad_context.tsx
 * gives the panel to the highest live token, so a root stand-in registered
 * first leaves the higher tokens to anything the subject mounts later.
 */
function renderForm(ui: ReactElement) {
  return render(
    <KeypadProvider>
      <KeypadHost />
      {ui}
    </KeypadProvider>,
  );
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
  render(<FirstLimitScreen {...props} />, { wrapper: Wrapper });
  // Waits out both queries (income summary, wallets are not read here) so no
  // test fires an event before React Query's async resolution has settled --
  // otherwise that resolution lands outside any `act()` the test itself ran.
  await screen.findByTestId("first-limit-form-intro");
}

beforeEach(async () => {
  jest.clearAllMocks();
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
    renderForm(<FirstLimitForm monthlyIncome={null} onSubmit={jest.fn()} />);

    // Was changeText "1000000" read as centavos; now "10000" read as pesos.
    // The SAME ₱10,000.00, so the sentence below is unchanged.
    typeAmount("first-limit-amount", "10000");

    // ₱328.77, NOT the ₱333.33 THIS TEST USED TO EXPECT, and the change is
    // deliberate (2026-08-20). The daily figure came from a hardcoded `÷ 30`,
    // which was only defensible while monthly was the sole cadence. Now that
    // the user picks one, it comes from `dailyRateOf` — 12 periods a year over
    // 365 days, the same ratio `baseFor` uses to resolve a percent-of-income
    // limit. Keeping `÷ 30` would make this sentence disagree with the limit
    // the app actually enforces afterwards.
    //
    //   1,000,000 centavos × 12 ÷ 365 = 32,876.7 centavos = ₱328.77
    expect(screen.getByTestId("first-limit-preview")).toHaveTextContent(
      "₱10,000.00 every month is about ₱328.77 a day.",
    );
  });

  test("THE ONBOARDING LIMIT STEP NEVER RAISES THE ANDROID KEYBOARD", () => {
    // The `add-numpad-to-this-section` screenshot this task closes. Not a
    // convention about props — there is no TextInput in the tree at all, so
    // no later edit to this form can bring the OS keypad back by accident.
    renderForm(<FirstLimitForm monthlyIncome={3_000_000} onSubmit={jest.fn()} />);

    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);

    fireEvent.press(screen.getByTestId("first-limit-basis-percent"));

    expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  });

  test("A PERCENT LIMIT TYPES ON THE KEYPAD AND READS BACK WITH A PERCENT SIGN", () => {
    // `mode="rate"`, not `peso`: the panel's own read-out and the field both
    // suffix a %, and nothing here is ever formatted as money.
    renderForm(<FirstLimitForm monthlyIncome={3_000_000} onSubmit={jest.fn()} />);

    fireEvent.press(screen.getByTestId("first-limit-basis-percent"));
    typeAmount("first-limit-percent", "50");

    expect(screen.getByText("50%")).toBeTruthy();
  });

  test("percent-of-income is hidden entirely when no income was declared, with a note explaining why", () => {
    renderForm(<FirstLimitForm monthlyIncome={null} onSubmit={jest.fn()} />);

    expect(screen.queryByTestId("first-limit-basis-percent")).toBeNull();
    expect(screen.getByTestId("first-limit-no-income-note")).toBeTruthy();
  });

  test("percent-of-income is offered once income is known, and the preview reflects it", () => {
    // ₱30,000.00 monthly income.
    renderForm(<FirstLimitForm monthlyIncome={3_000_000} onSubmit={jest.fn()} />);

    expect(screen.queryByTestId("first-limit-no-income-note")).toBeNull();
    fireEvent.press(screen.getByTestId("first-limit-basis-percent"));
    typeAmount("first-limit-percent", "20");

    // 20% of ₱30,000.00 = ₱6,000.00 a month — now resolved by `baseFor` itself
    // rather than by a local `monthlyIncome × percent ÷ 10,000` helper, so the
    // percent path and the engine cannot drift.
    //
    //   600,000 centavos × 12 ÷ 365 = 19,726.0 centavos = ₱197.26 a day
    //   (was ₱200.00 under the old hardcoded ÷ 30 — see the note above).
    expect(screen.getByTestId("first-limit-preview")).toHaveTextContent(
      "₱6,000.00 every month is about ₱197.26 a day.",
    );
  });

  test("submitting a percent basis reports the percent-times-100 encoding, never the raw percent", () => {
    const onSubmit = jest.fn();
    renderForm(<FirstLimitForm monthlyIncome={3_000_000} onSubmit={onSubmit} />);

    fireEvent.press(screen.getByTestId("first-limit-basis-percent"));
    typeAmount("first-limit-percent", "20");
    fireEvent.press(screen.getByTestId("first-limit-save"));

    // The trap task-3-brief warns about: 20% must store 2000, never 20.
    // `scope` joined the payload on 2026-08-20 and defaults to monthly.
    expect(onSubmit).toHaveBeenCalledWith({
      basis: "percent-of-income",
      value: 2000,
      scope: "monthly",
    });
  });

  // -------------------------------------------------------------------------
  // The cadence, which used to be pinned (owner, 2026-08-20: the onboarding
  // limit is "unmodifiable and it should be modifiable to change it to daily,
  // weekly, monthly, or annually").
  // -------------------------------------------------------------------------

  test("monthly is preselected, keeping docs rule 14's default", () => {
    const onSubmit = jest.fn();
    renderForm(<FirstLimitForm monthlyIncome={null} onSubmit={onSubmit} />);

    expect(screen.getByTestId("first-limit-scope-monthly").props.accessibilityState.selected).toBe(
      true,
    );
  });

  test("picking a cadence reports it", () => {
    const onSubmit = jest.fn();
    renderForm(<FirstLimitForm monthlyIncome={null} onSubmit={onSubmit} />);

    fireEvent.press(screen.getByTestId("first-limit-scope-weekly"));
    typeAmount("first-limit-amount", "2000");
    fireEvent.press(screen.getByTestId("first-limit-save"));

    expect(onSubmit).toHaveBeenCalledWith({ basis: "fixed", value: 200_000, scope: "weekly" });
  });

  test("the preview sentence names the period the user actually picked", () => {
    const onSubmit = jest.fn();
    renderForm(<FirstLimitForm monthlyIncome={null} onSubmit={onSubmit} />);

    typeAmount("first-limit-amount", "2000");
    fireEvent.press(screen.getByTestId("first-limit-scope-weekly"));

    // Rule 4's sentence has to follow the cadence; "every month" on a weekly
    // limit would be a live preview of something the user did not ask for.
    expect(screen.getByTestId("first-limit-preview").props.children).toContain("every week");
  });

  test("a daily limit does not say its own figure twice", () => {
    const onSubmit = jest.fn();
    renderForm(<FirstLimitForm monthlyIncome={null} onSubmit={onSubmit} />);

    typeAmount("first-limit-amount", "500");
    fireEvent.press(screen.getByTestId("first-limit-scope-daily"));

    // "…every day is about ₱500 a day" states the same thing twice.
    const preview = String(screen.getByTestId("first-limit-preview").props.children);
    expect(preview).not.toContain("a day.");
    expect(preview).toContain("every day.");
  });
});

// ---------------------------------------------------------------------------
// app/(onboarding)/first_limit.tsx — owns the write.
// ---------------------------------------------------------------------------

describe("FirstLimitScreen", () => {
  test("saving creates a monthly, non-rollover Limit with the entered fixed amount", async () => {
    await renderScreen();

    typeAmount("first-limit-amount", "10000"); // was "1000000" in centavos
    fireEvent.press(screen.getByTestId("first-limit-save"));

    // FOUR LIMITS, NOT ONE (owner, 2026-08-20). The entered one plus the same
    // limit restated at the other three cadences, so Plan -> Limits is
    // populated rather than showing the single row that was typed. See
    // lib/limits/limit_derivation.ts.
    await waitFor(async () => expect(await listLimits()).toHaveLength(4));

    const limits = await listLimits();
    const entered = limits.find((candidate) => candidate.derivedFrom === null);
    expect(entered!.scope).toBe("monthly");
    expect(entered!.basis).toBe("fixed");
    expect(entered!.value).toBe(1_000_000);
    expect(entered!.rollover).toBe(false);
    expect(entered!.thresholdsFired).toEqual([]);

    // EXACTLY ONE IS THE USER'S. The other three must be marked derived, or
    // they would count against the free tier's one-active-limit cap and gate a
    // user who has just finished onboarding.
    expect(limits.filter((candidate) => candidate.derivedFrom === null)).toHaveLength(1);
    expect(limits.filter((candidate) => candidate.derivedFrom === entered!.id)).toHaveLength(3);
    expect(limits.map((candidate) => candidate.scope).sort()).toEqual([
      "annual",
      "daily",
      "monthly",
      "weekly",
    ]);

    // With no `onDone` supplied — which is how the router mounts it — saving
    // still has to move the flow on by itself, and "done" is the one
    // transition onboarding_state.ts's `nextStep` doc calls out as stranding
    // the user if it is wrong.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/done"));
  });

  test("the cadence the user picks is the one that is NOT derived", async () => {
    await renderScreen();

    fireEvent.press(screen.getByTestId("first-limit-scope-weekly"));
    typeAmount("first-limit-amount", "2000");
    fireEvent.press(screen.getByTestId("first-limit-save"));

    await waitFor(async () => expect(await listLimits()).toHaveLength(4));

    const limits = await listLimits();
    const entered = limits.find((candidate) => candidate.derivedFrom === null);
    expect(entered!.scope).toBe("weekly");
    expect(entered!.value).toBe(200_000);
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

    typeAmount("first-limit-amount", "5000"); // was "500000" in centavos
    fireEvent.press(screen.getByTestId("first-limit-save"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
