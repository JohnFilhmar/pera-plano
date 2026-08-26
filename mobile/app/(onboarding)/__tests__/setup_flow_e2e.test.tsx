// app/(onboarding)/__tests__/setup_flow_e2e.test.tsx — the whole numbered
// onboarding flow, driven through the REAL expo-router, from "welcome" to the
// tap that ends onboarding.
//
// WHY THIS FILE EXISTS. Every one of the nine steps already had a passing
// per-screen suite, and the flow was still impossible to finish: the last four
// routed screens (wallets, income, first_limit, done) were written as if they
// were child components of a sequencer that does not exist -- they took
// `onDone`/`onBack` props, and expo-router mounts a route with no props at all.
// So on a real device "Continue" on the wallet step ran the creation loop,
// wrote real Wallet rows, and then called `onDone?.()`, which was `undefined`:
// nothing happened, after the database had already been mutated. Every
// per-screen test passed throughout, because each one SUPPLIED the prop the
// app never supplies. The only test that can catch that is one that mounts
// these screens the way the router does -- by route, with no props -- and
// walks the chain BETWEEN them.
//
// components/onboarding/__tests__/numbered_flow_e2e.test.tsx is the earlier,
// narrower version of this idea (welcome -> battery, asserting on a mocked
// `router.push`). This file deliberately does NOT mock expo-router: a mocked
// push proves a screen ASKED to navigate, not that anything arrived. The
// assertions below are on what is actually on screen after each tap, and on
// the rows the flow actually wrote.
//
// A REAL DATABASE, exactly like the per-step suites use (test_support/db.ts's
// freshDb + the sqlite mock): the last four steps write Wallets, an
// IncomeProfile, a Limit and finally `onboarding_complete`, and "the flow
// finished" is only worth asserting against the rows it claims to have made.
jest.mock("@/modules/notification_listener", () => ({
  listObservedPackages: jest.fn(),
  isAccessGranted: jest.fn(),
  openAccessSettings: jest.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderRouter, screen } from "expo-router/testing-library";
import { Stack } from "expo-router";
import { AppState, Linking, Text, type AppStateStatus } from "react-native";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { typeAmount } from "@/test_support/keypad";
import { closeDatabase } from "@/lib/db/database";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { getIncomeProfile } from "@/lib/db/repos/income_repo";
import { listLimits } from "@/lib/db/repos/limits_repo";
import { listWallets } from "@/lib/db/repos/wallets_repo";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import {
  isAccessGranted,
  listObservedPackages,
  openAccessSettings,
} from "@/modules/notification_listener";
import type { ObservedPackage } from "@/modules/notification_listener";

import OnboardingLayout from "../_layout";
import WelcomeScreen from "../welcome";
import HowItWorksScreen from "../how_it_works";
import AccessScreen from "../access";
import BatteryScreen from "../battery";
import WalletsScreen from "../wallets";
import IncomeScreen from "../income";
import FirstLimitScreen from "../first_limit";
import DoneScreen from "../done";

const mockIsAccessGranted = isAccessGranted as jest.Mock;
const mockListObservedPackages = listObservedPackages as jest.Mock;
const mockOpenAccessSettings = openAccessSettings as jest.Mock;

const GCASH = "com.globe.gcash.android";

let client: QueryClient;

/**
 * Stands in for app/_layout.tsx's post-unlock subtree: a QueryClientProvider
 * around the root Stack. The real one is PersistQueryClientProvider, which
 * additionally restores an ENCRYPTED cache from AsyncStorage — irrelevant to
 * navigation and unavailable without a DEK, so a plain provider around the
 * same Stack is the honest stand-in here.
 */
function TestRoot() {
  return (
    <QueryClientProvider client={client}>
      {/* app/_layout.tsx's own pairing: KeypadProvider wraps the whole shell
          and one KeypadHost sits beside the Stack. The income and first-limit
          steps hold NumericFields now (numeric-input-system Task 12), and
          `useKeypad` throws without the provider — so a flow test that mounts
          those two routes needs both halves, exactly like the real app. The
          host is rendered before the Stack rather than after it: mount
          effects commit in completion order and keypad_context.tsx gives the
          panel to the highest live token, so registering the root stand-in
          first leaves the higher tokens for anything a screen mounts later. */}
      <KeypadProvider>
        <KeypadHost />
        <Stack screenOptions={{ headerShown: false }} />
      </KeypadProvider>
    </QueryClientProvider>
  );
}

/** Where the flow's last hop is supposed to land. A stub, so this file never
 * pulls the whole Home screen in just to prove onboarding let go of the user. */
function HomeStub() {
  return <Text testID="home-stub">home</Text>;
}

function renderFlow() {
  return renderRouter(
    {
      _layout: TestRoot,
      "(onboarding)/_layout": OnboardingLayout,
      "(onboarding)/welcome": WelcomeScreen,
      "(onboarding)/how_it_works": HowItWorksScreen,
      "(onboarding)/access": AccessScreen,
      "(onboarding)/battery": BatteryScreen,
      "(onboarding)/wallets": WalletsScreen,
      "(onboarding)/income": IncomeScreen,
      "(onboarding)/first_limit": FirstLimitScreen,
      "(onboarding)/done": DoneScreen,
      "(tabs)/index": HomeStub,
    },
    { initialUrl: "/(onboarding)/welcome" },
  );
}

let appStateListeners: Array<(state: AppStateStatus) => void> = [];

function emitAppState(state: AppStateStatus) {
  for (const cb of [...appStateListeners]) cb(state);
}

function pressPrimary() {
  fireEvent.press(screen.getByTestId("onboarding-primary-button"));
}

function pressSkip() {
  fireEvent.press(screen.getByTestId("onboarding-skip-link"));
}

function pressBack() {
  fireEvent.press(screen.getByTestId("onboarding-back-button"));
}

/** welcome -> how_it_works -> access, the two taps every test below starts with. */
async function walkToAccess() {
  pressPrimary();
  await waitFor(() => expect(screen.getByTestId("how-it-works-mechanism")).toBeTruthy());
  pressPrimary();
  await waitFor(() => expect(screen.getByTestId("access-explainer")).toBeTruthy());
}

/** The access step's own "tap through to Settings and come back" round trip. */
async function returnFromAccessSettings() {
  await act(async () => {
    emitAppState("active");
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  await freshDb();
  // The catalogue bootstrapApp() seeds on a real launch — the wallet step
  // proposes one Wallet per OBSERVED provider found in the active ruleset.
  await upsertRuleset({
    version: 1,
    providers: [
      { providerKey: "gcash", packageNames: [GCASH], version: 1, channel: "push", templates: [] },
    ],
  });

  jest.clearAllMocks();
  mockListObservedPackages.mockResolvedValue([
    { packageName: GCASH, count: 3, lastSeenAt: 1_755_000_000_000 } satisfies ObservedPackage,
  ]);
  mockIsAccessGranted.mockResolvedValue(true);

  // react-native's AppState/Linking are spied on the REAL module rather than
  // replaced with jest.mock("react-native", ...) — see
  // components/onboarding/__tests__/numbered_flow_e2e.test.tsx's header for
  // the reentrant-require crash that technique causes once every step screen
  // is imported into one file, as they are here.
  appStateListeners = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    appStateListeners.push(listener);
    return {
      remove: jest.fn(() => {
        const idx = appStateListeners.indexOf(listener);
        if (idx >= 0) appStateListeners.splice(idx, 1);
      }),
    };
  });
  jest.spyOn(Linking, "sendIntent").mockResolvedValue(undefined);

  const defaults = appQueryClient.getDefaultOptions();
  client = new QueryClient({
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, gcTime: Infinity },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await closeDatabase();
});

test("a user who taps through every step reaches the end, and onboarding actually completes", async () => {
  renderFlow();

  // 1. welcome -> 2. how_it_works
  expect(screen.getByTestId("welcome-promise")).toBeTruthy();
  pressPrimary();
  await waitFor(() => expect(screen.getByTestId("how-it-works-mechanism")).toBeTruthy());

  // 2. how_it_works -> 3. access
  pressPrimary();
  await waitFor(() => expect(screen.getByTestId("access-explainer")).toBeTruthy());

  // 3. access -> 4. battery. The primary action opens the system screen; the
  // step advances on the way back once the permission reads as granted.
  pressPrimary();
  await act(async () => {
    emitAppState("active");
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByTestId("battery-explainer")).toBeTruthy());

  // 4. battery -> 5. wallets (NOT the provider picker — that name in
  // ONBOARDING_STEPS is reserved, not routed).
  pressPrimary();
  await waitFor(() => expect(screen.getByTestId("quick-wallet-list")).toBeTruthy());

  // 5. wallets -> 6. income. THE DEFECT THIS FILE WAS WRITTEN FOR: this tap
  // creates real rows and then has to advance. It used to do only the first
  // half.
  pressPrimary();
  await waitFor(() => expect(screen.getByTestId("income-quick-form-intro")).toBeTruthy());
  expect((await listWallets()).map((wallet) => wallet.name).sort()).toEqual(["Cash", "GCash"]);

  // 6. income -> 7. first_limit, via the form's own save button (the path the
  // mutation takes, distinct from the frame's "figure it out" primary).
  // Pesos now, not centavo digits: "12000" is the ₱12,000.00 that "1200000"
  // used to mean. The assertion below is deliberately unchanged.
  typeAmount("income-quick-amount", "12000");
  fireEvent.press(screen.getByTestId("income-quick-save"));
  await waitFor(() => expect(screen.getByTestId("first-limit-form-intro")).toBeTruthy());
  expect((await getIncomeProfile())?.averageAmount).toBe(1_200_000);

  // 7. first_limit -> 8. done, again through the write path.
  typeAmount("first-limit-amount", "10000"); // was "1000000" in centavos
  fireEvent.press(screen.getByTestId("first-limit-save"));
  await waitFor(() => expect(screen.getByTestId("done-step-intro")).toBeTruthy());

  // FOUR LIMITS FROM ONE ANSWER, not the one this used to expect
  // (owner-approved 2026-08-20). Entering a limit also creates the equivalent
  // at the other three cadences, so Plan -> Limits is populated rather than
  // showing the single row that was typed — the owner's report was that it
  // "only shows the entered onboarding data, not calculated". See
  // lib/limits/limit_derivation.ts.
  const limits = await listLimits();
  expect(limits).toHaveLength(4);

  // EXACTLY ONE IS THE USER'S. The other three carry `derivedFrom`, which is
  // what keeps them off the free tier's one-active-limit cap — without it a
  // user would be gated the moment they finished onboarding.
  const entered = limits.filter((limit) => limit.derivedFrom === null);
  expect(entered).toHaveLength(1);
  expect(entered[0].scope).toBe("monthly");
  expect(entered[0].value).toBe(1_000_000);
  expect(limits.filter((limit) => limit.derivedFrom === entered[0].id)).toHaveLength(3);

  // 8. done -> out of onboarding entirely.
  expect(await getSetting("onboarding_complete")).toBe(false);
  pressPrimary();

  await waitFor(async () => expect(await getSetting("onboarding_complete")).toBe(true));
  // Landed OUTSIDE the onboarding group, and the last step is gone rather
  // than stacked underneath (done.tsx replaces rather than pushes, so a back
  // gesture from Home cannot re-enter a step that would re-run its writes).
  await waitFor(() => expect(screen.getByTestId("home-stub")).toBeTruthy());
  expect(screen.queryByTestId("done-step-intro")).toBeNull();
  expect(screen.queryByTestId("onboarding-frame")).toBeNull();
});

// ---------------------------------------------------------------------------
// Going BACK into a step that has already been left once. The owner's report:
// "pressing 'skip for now' during permissions gets the user stuck on toggling
// notification ... accidentally presses back, and stuck toggling the
// permissions on and off unless the user goes back one more step and proceeds".
//
// `router.push` leaves the pushing screen mounted underneath the pushed one, so
// a back gesture re-enters a LIVE component rather than a fresh one, and
// access.tsx's `advancedRef` double-tap latch was still tripped from the first
// visit -- every forward affordance on the second visit called `advance()` and
// returned silently. Only these two tests can catch that class of defect: they
// drive the REAL router, and the latch is invisible to any suite that renders
// the screen once.
// ---------------------------------------------------------------------------

test("skipping the access step and then going back to it leaves it able to move on again", async () => {
  renderFlow();
  await walkToAccess();

  pressSkip();
  await waitFor(() => expect(screen.getByTestId("battery-explainer")).toBeTruthy());

  pressBack();
  await waitFor(() => expect(screen.getByTestId("access-explainer")).toBeTruthy());

  // THE REGRESSION: this second skip used to do nothing at all.
  pressSkip();
  await waitFor(() => expect(screen.getByTestId("battery-explainer")).toBeTruthy());
});

test("going back to the access step after granting continues without asking for the permission again", async () => {
  renderFlow();
  await walkToAccess();

  pressPrimary();
  await returnFromAccessSettings();
  await waitFor(() => expect(screen.getByTestId("battery-explainer")).toBeTruthy());

  pressBack();
  await waitFor(() => expect(screen.getByTestId("access-explainer")).toBeTruthy());

  // The permission is already on, so re-entering the step must not send the
  // user back into Settings to toggle a switch that is already in the right
  // position -- the primary action is a plain Continue.
  await waitFor(() => expect(screen.getByText("Continue")).toBeTruthy());
  mockOpenAccessSettings.mockClear();

  pressPrimary();
  await waitFor(() => expect(screen.getByTestId("battery-explainer")).toBeTruthy());
  expect(mockOpenAccessSettings).not.toHaveBeenCalled();
});

test("a user who skips everything skippable still reaches the end, and onboarding actually completes", async () => {
  renderFlow();

  // welcome and how_it_works have no skip link — nothing is asked of the user
  // on either, so their primary action is the only forward affordance.
  expect(screen.queryByTestId("onboarding-skip-link")).toBeNull();
  pressPrimary();
  await waitFor(() => expect(screen.getByTestId("how-it-works-mechanism")).toBeTruthy());

  expect(screen.queryByTestId("onboarding-skip-link")).toBeNull();
  pressPrimary();
  await waitFor(() => expect(screen.getByTestId("access-explainer")).toBeTruthy());

  pressSkip();
  await waitFor(() => expect(screen.getByTestId("battery-explainer")).toBeTruthy());

  pressSkip();
  await waitFor(() => expect(screen.getByTestId("quick-wallet-list")).toBeTruthy());

  pressSkip();
  await waitFor(() => expect(screen.getByTestId("income-quick-form-intro")).toBeTruthy());

  pressSkip();
  await waitFor(() => expect(screen.getByTestId("first-limit-form-intro")).toBeTruthy());

  pressSkip();
  await waitFor(() => expect(screen.getByTestId("done-step-intro")).toBeTruthy());

  // Skipping wrote nothing at all — and still has to end somewhere.
  expect(await listWallets()).toEqual([]);
  expect(await getIncomeProfile()).toBeNull();
  expect(await listLimits()).toEqual([]);

  // "done" is what a skipped flow lands on, so it has nothing left to skip.
  expect(screen.queryByTestId("onboarding-skip-link")).toBeNull();
  pressPrimary();

  await waitFor(async () => expect(await getSetting("onboarding_complete")).toBe(true));
  // Landed OUTSIDE the onboarding group, and the last step is gone rather
  // than stacked underneath (done.tsx replaces rather than pushes, so a back
  // gesture from Home cannot re-enter a step that would re-run its writes).
  await waitFor(() => expect(screen.getByTestId("home-stub")).toBeTruthy());
  expect(screen.queryByTestId("done-step-intro")).toBeNull();
  expect(screen.queryByTestId("onboarding-frame")).toBeNull();
});
