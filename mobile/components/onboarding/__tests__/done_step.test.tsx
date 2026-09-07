// components/onboarding/__tests__/done_step.test.tsx — task-3-brief rule 6:
// the last onboarding step confirms what was actually set up and is the only
// place `onboarding_complete` gets written.
//
// CONFIRMS is the operative word, and GAP-090 is what this file now also pins:
// three sentences on this screen were stated rather than checked — automatic
// pickup regardless of the grant, "Monthly limit" over every scope, and an
// "active" Limit whose own body told the user to go and add one.

// The listener module is NATIVE and cannot be required under Jest
// (components/onboarding/__tests__/access_step.test.tsx's own note). This
// screen reads the notification-access grant to decide whether it may promise
// automatic tracking, so the mock is what lets a test declare either answer.
jest.mock("@/modules/notification_listener", () => ({
  isAccessGranted: jest.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { closeDatabase } from "@/lib/db/database";
import { createLimit } from "@/lib/db/repos/limits_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { setManualIncome } from "@/lib/income/income_service";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { isAccessGranted } from "@/modules/notification_listener";
import { freshDb } from "@/test_support/db";

import DoneScreen from "@/app/(onboarding)/done";

const mockIsAccessGranted = isAccessGranted as jest.Mock;

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
  // Auto mode unless a test says otherwise — the state the pre-existing
  // assertions below were written against.
  mockIsAccessGranted.mockReset();
  mockIsAccessGranted.mockResolvedValue(true);
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
    await createWallet({ name: "GCash" });
    await createWallet({ name: "Cash" });
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

  // GAP-078. `completeOnboarding()` is a bare repository write with no
  // mutation hook behind it, so lib/query_client.ts's MutationCache handler
  // never sees it — this screen is the only thing that can report the failure.
  test("a write that fails says so and hands the button back, instead of a spinner that stops with no message", async () => {
    const onDone = jest.fn();
    await renderScreen({ onDone });

    // The real failure this path takes: the app-lock timeout closes the
    // database out from under an onboarding screen, so `setSetting` rejects
    // with DatabaseLockedError. No mock — the rejection is genuine.
    await closeDatabase();

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    const failure = await screen.findByTestId("done-finish-error");
    // Every step before this one wrote its own rows; only the completion flag
    // did not land, so a retry is both safe and the whole remedy.
    expect(failure).toHaveTextContent(/Everything you set up is saved/);
    // Not advanced — the flag is still false, so sending the user to Home
    // would put them one relaunch away from starting setup over.
    expect(onDone).not.toHaveBeenCalled();
    // And the button has to come back, or the message asks for a retry the
    // screen will not accept.
    await waitFor(() => {
      expect(
        screen.getByTestId("onboarding-primary-button").props.accessibilityState.disabled,
      ).toBeFalsy();
    });
  });

  test("done has nothing left to skip — no skip link renders", async () => {
    await renderScreen();

    expect(screen.queryByTestId("onboarding-skip-link")).toBeNull();
  });

  test("the medallion carries the launch mark (task-7-brief.md Step 4)", async () => {
    await renderScreen();

    expect(screen.getByTestId("done-mark")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GAP-090 — the three sentences that were stated rather than checked.
// ---------------------------------------------------------------------------

describe("the wallets card and the notification-access grant", () => {
  test("promises automatic pickup only when access was actually granted", async () => {
    mockIsAccessGranted.mockResolvedValue(true);
    await createWallet({ name: "GCash" });

    await renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId("done-wallets-mode")).toHaveTextContent(/automatically/),
    );
  });

  test("declined access gets the manual-mode copy, never the automatic promise", async () => {
    // docs step 10: manual mode is a first-class outcome, and this was the
    // screen that told those users the opposite on their way out of setup.
    mockIsAccessGranted.mockResolvedValue(false);
    await createWallet({ name: "GCash" });

    await renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId("done-wallets-mode")).toHaveTextContent(/manual mode/),
    );
    expect(screen.getByTestId("done-wallets-summary")).not.toHaveTextContent(
      /pick up transactions from these automatically/,
    );
  });
});

describe("the Limit card", () => {
  test("labels a WEEKLY limit weekly, not monthly", async () => {
    // The first-Limit step has offered daily/weekly/monthly/annual since
    // 2026-08-20; this card called every one of them "Monthly limit".
    await createLimit({ scope: "weekly", basis: "fixed", value: 200_000, rollover: false });

    await renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId("done-limit-summary")).toHaveTextContent(/Weekly limit:/),
    );
    expect(screen.getByTestId("done-limit-summary")).not.toHaveTextContent(/Monthly limit:/);
  });

  test("a monthly limit still reads monthly", async () => {
    await createLimit({ scope: "monthly", basis: "fixed", value: 1_000_000, rollover: false });

    await renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId("done-limit-summary")).toHaveTextContent(/Monthly limit:/),
    );
  });

  test("a Limit with no resolvable figure is not called active while asking for one", async () => {
    // A percent-of-income Limit with no income declared: `baseFor` returns
    // null, so `getLimitStatuses` reports `paused` with `effectiveLimit: null`.
    // The card used to read "Your first Limit is active" over a body telling
    // the user to go and add a Limit — both about the same limit, at once.
    await createLimit({
      scope: "monthly",
      basis: "percent-of-income",
      value: 2_000,
      rollover: false,
    });

    await renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId("done-limit-summary")).toHaveTextContent(/waiting on your income/),
    );
    const card = screen.getByTestId("done-limit-summary");
    expect(card).not.toHaveTextContent(/is active/);
    expect(card).not.toHaveTextContent(/Add one any time from the Plan tab/);
  });
});
