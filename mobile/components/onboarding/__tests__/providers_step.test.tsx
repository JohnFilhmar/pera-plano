// components/onboarding/__tests__/providers_step.test.tsx — task-3-brief
// rules 1 and 2: what a provider selection turns into once it reaches the
// wallet step.
//
// WHY THIS FILE IS NOT ABOUT app/(onboarding)/providers.tsx ITSELF. Rule 1's
// "the checklist renders the catalogue with nothing pre-checked" and
// "selecting providers calls setProviderFilter with the chosen packages" are
// already pinned by components/onboarding/__tests__/provider_picker.test.tsx
// against the shipped screen — see app/(onboarding)/wallets.tsx's own header
// comment for why this task extended, rather than duplicated, that already-
// shipped checklist. What that suite does NOT cover is rule 1's remaining
// half, "and seeds wallet_matchers": a matcher needs a Wallet id, and no
// Wallet exists until app/(onboarding)/wallets.tsx creates one. THIS is that
// screen's suite — proposing, editing, creating and matching Wallets from a
// provider selection, plus rule 2's free-tier cap bypass, tested against a
// real (in-memory) database exactly the way app/__tests__/wallet_routes.test.tsx
// tests app/wallet/new.tsx.
//
// expo-router IS MOCKED HERE NOW. The wallet step is a ROUTE, mounted by
// expo-router with no props — so "Continue" can no longer end in a bare
// `onDone?.()` that does nothing (it wrote real Wallet rows first, which is
// what made that no-op so much worse than a dead button; see that file's
// header). It navigates for itself now, and the real `useRouter().push`
// asserts a mounted navigator. The `onDone` tests below still pass the prop
// and still pin it: a supplied callback continues to win over navigation.
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  }),
}));

jest.mock("@/modules/notification_listener", () => ({
  listObservedPackages: jest.fn(),
  // Never configured by this suite: it is about what a provider selection
  // TURNS INTO, not about what the apps are called. Left as a bare jest.fn()
  // DELIBERATELY — it resolves `undefined`, which is exactly the nullish map
  // `loadAppLabels`'s `?? {}` exists to absorb. Making it resolve `{}` here
  // would hide the wedged-forever-on-the-loading-skeleton bug that guard
  // prevents.
  getAppLabels: jest.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { listObservedPackages } from "@/modules/notification_listener";
import { closeDatabase } from "@/lib/db/database";
import { setSetting } from "@/lib/db/repos/app_settings_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { listMatchers } from "@/lib/db/repos/wallet_matchers_repo";
import { listWallets } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import type { ObservedPackage } from "@/modules/notification_listener";

import WalletsScreen from "@/app/(onboarding)/wallets";

const mockListObservedPackages = listObservedPackages as jest.Mock;

const GCASH = "com.globe.gcash.android";
const MAYA = "com.paymaya";
const BPI = "com.bpi.ng.app";
const BDO = "com.bdo.digitalbanking";

function observed(packageName: string): ObservedPackage {
  return { packageName, count: 3, lastSeenAt: 1_755_000_000_000 };
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

// KeypadProvider AND A HOST (numeric-input-system Task 13 follow-up). This
// screen renders QuickWalletList, whose opening-balance field is a
// NumericField now — its `useKeypad()` throws with no provider above it, and
// the tree unmounted before `quick-wallet-list` ever appeared. Host BEFORE the
// subject, matching every other suite that mounts a keypad field: the context
// gives the panel to the highest live host token and effects flush in
// completion order, so a host mounted after the screen would outrank one
// nested inside it. No assertion here types an amount; this is the wrapper and
// nothing else.
function renderScreen(props: { onDone?: () => void } = {}): void {
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
  render(<WalletsScreen {...props} />, { wrapper: Wrapper });
}

async function seedCatalogue(): Promise<void> {
  await upsertRuleset({
    version: 1,
    providers: [
      { providerKey: "gcash", packageNames: [GCASH], version: 1, channel: "push", templates: [] },
      { providerKey: "maya", packageNames: [MAYA], version: 1, channel: "push", templates: [] },
      { providerKey: "bpi", packageNames: [BPI], version: 1, channel: "push", templates: [] },
      { providerKey: "bdo", packageNames: [BDO], version: 1, channel: "push", templates: [] },
    ],
  });
}

async function renderReady(
  observedPackages: string[] = [GCASH],
  props: { onDone?: () => void } = {},
): Promise<void> {
  mockListObservedPackages.mockResolvedValue(observedPackages.map(observed));
  renderScreen(props);
  await screen.findByTestId("quick-wallet-list");
}

beforeEach(async () => {
  await freshDb();
  await seedCatalogue();
  jest.clearAllMocks();
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Proposals: one per OBSERVED provider, plus cash, editable inline.
// ---------------------------------------------------------------------------

describe("proposing wallets", () => {
  test("proposes exactly the observed providers plus cash, all pre-checked", async () => {
    await renderReady([GCASH]);

    expect(screen.getByTestId(`wallet-proposal-${GCASH}`)).toBeTruthy();
    expect(screen.getByTestId("wallet-proposal-cash")).toBeTruthy();
    // Maya was never observed, so it is not proposed outright.
    expect(screen.queryByTestId(`wallet-proposal-${MAYA}`)).toBeNull();

    expect(screen.getByTestId(`wallet-proposal-toggle-${GCASH}`).props.accessibilityState).toEqual({
      checked: true,
    });
    expect(screen.getByTestId("wallet-proposal-toggle-cash").props.accessibilityState).toEqual({
      checked: true,
    });
  });

  test("an unobserved catalogue provider is offered as a quick add, not auto-proposed", async () => {
    await renderReady([GCASH]);

    expect(screen.getByTestId(`wallet-add-${MAYA}`)).toBeTruthy();

    fireEvent.press(screen.getByTestId(`wallet-add-${MAYA}`));

    expect(screen.getByTestId(`wallet-proposal-${MAYA}`)).toBeTruthy();
    expect(screen.queryByTestId(`wallet-add-${MAYA}`)).toBeNull();
  });

  test("no observed providers still proposes the cash wallet alone", async () => {
    await renderReady([]);

    expect(screen.getByTestId("wallet-proposal-cash")).toBeTruthy();
    expect(screen.queryAllByTestId(/^wallet-proposal-com\./)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Creating: edits are respected, exclusions are respected, matchers seed.
// ---------------------------------------------------------------------------

describe("creating wallets", () => {
  test("confirming creates a wallet per included proposal", async () => {
    await renderReady([GCASH]);

    // GAP-052 INSTRUMENTATION, AND IT BISECTS THE FAILURE RATHER THAN GUESSING
    // AT IT. This is the test that reproduced under nine workers, with zero
    // wallets, no submit error, and — now that the swallow logs — no caught
    // exception either, which rules out the save throwing. What is left is a
    // press that iterated nothing, or a write that went somewhere this read
    // cannot see. These two lines tell those apart on the next reproduction:
    // if the proposals are missing, the readiness gate returned too early; if
    // they are present and no wallet appears, the fault is past the press.
    expect(screen.getByTestId(`wallet-proposal-${GCASH}`)).toBeTruthy();
    expect(screen.getByTestId("wallet-proposal-cash")).toBeTruthy();

    const button = screen.getByTestId("onboarding-primary-button");
    expect(button.props.accessibilityState?.disabled ?? false).toBe(false);
    fireEvent.press(button);

    expect(screen.queryByTestId("wallets-step-error")).toBeNull();

    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    const names = (await listWallets()).map((w) => w.name).sort();
    expect(names).toEqual(["Cash", "GCash"].sort());
    // With no `onDone` supplied — which is how the router mounts it — the tap
    // that wrote those rows also has to move the flow on. This exact pairing
    // is what failed on a device: rows written, screen frozen.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/income"));
    expect(screen.queryByTestId("wallets-step-error")).toBeNull();
  });

  test("an edited name is what gets saved, not the default", async () => {
    await renderReady([GCASH]);

    fireEvent.changeText(screen.getByTestId(`wallet-proposal-name-${GCASH}`), "My GCash");
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    expect((await listWallets()).some((w) => w.name === "My GCash")).toBe(true);
  });

  test("the step never asks what kind of wallet this is", async () => {
    // The whole point of the change: onboarding proposes wallets and asks for
    // nothing but a name and (optionally) what is already in them.
    await renderReady([GCASH]);

    expect(screen.queryByTestId(`wallet-proposal-type-${GCASH}-savings`)).toBeNull();
    for (const label of ["Bank", "E-wallet", "Savings", "Credit"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  test("unchecking a proposal excludes it from creation", async () => {
    await renderReady([GCASH]);

    fireEvent.press(screen.getByTestId("wallet-proposal-toggle-cash"));
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(1));
    expect((await listWallets())[0]!.name).toBe("GCash");
  });

  test("selecting providers seeds wallet_matchers for each provider-linked wallet, and none for cash", async () => {
    await renderReady([GCASH]);

    // GAP-052 INSTRUMENTATION. This is the one test in the suite that still
    // fails under nine workers, and its failure said only "expected 2, received
    // 0" — which cannot tell a press that did nothing from a save that threw and
    // was swallowed. These two checks split those apart before the wait, so a
    // reproduction names its own cause instead of needing another run.
    const button = screen.getByTestId("onboarding-primary-button");
    expect(button.props.accessibilityState?.disabled ?? false).toBe(false);

    fireEvent.press(button);

    // A submit that threw renders this, and it renders long before a 15 s wait
    // gives up. Checking it first turns a timeout into the sentence the screen
    // actually showed.
    expect(screen.queryByTestId("wallets-step-error")).toBeNull();

    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    const wallets = await listWallets();
    const gcashWallet = wallets.find((w) => w.name === "GCash")!;
    const cashWallet = wallets.find((w) => w.name === "Cash")!;

    const gcashMatchers = await listMatchers(gcashWallet.id);
    expect(gcashMatchers).toHaveLength(1);
    expect(gcashMatchers[0]!.packageName).toBe(GCASH);
    expect(await listMatchers(cashWallet.id)).toEqual([]);
  });

  test("a quick-added provider is created and matched exactly like an observed one", async () => {
    await renderReady([GCASH]);
    fireEvent.press(screen.getByTestId(`wallet-add-${MAYA}`));

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(3));
    const mayaWallet = (await listWallets()).find((w) => w.name === "Maya")!;
    expect(mayaWallet).toBeTruthy();
    expect((await listMatchers(mayaWallet.id))[0]!.packageName).toBe(MAYA);
  });

  test("skipping creates no wallets at all and still advances", async () => {
    const onDone = jest.fn();
    await renderReady([GCASH], { onDone });

    fireEvent.press(screen.getByTestId("onboarding-skip-link"));

    expect(await listWallets()).toEqual([]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test("advances once creation succeeds", async () => {
    const onDone = jest.fn();
    await renderReady([GCASH], { onDone });

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — the free-tier cap NEVER drops a wallet the user asked for.
// ---------------------------------------------------------------------------

describe("the free-tier wallet cap during onboarding", () => {
  test("exceeding the free cap still creates every wallet, silently dropping none", async () => {
    __setTierForTests("free");
    await renderReady([GCASH, MAYA, BPI, BDO]);

    // 4 observed providers + cash = 5, well past the free cap of 3.
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(5));
    // The explanation appears -- the cap is not silent -- but nothing was
    // ever blocked from being created.
    await waitFor(() => expect(screen.getByTestId("wallet-cap-note")).toBeTruthy());
  });

  test("the explanation only advances once the user has seen it", async () => {
    const onDone = jest.fn();
    __setTierForTests("free");
    await renderReady([GCASH, MAYA, BPI, BDO], { onDone });

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));
    await waitFor(() => expect(screen.getByTestId("wallet-cap-note")).toBeTruthy());
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  test("on the plus tier (MVP default), the same five wallets raise no explanation", async () => {
    await renderReady([GCASH, MAYA, BPI, BDO]);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(5));
    expect(screen.queryByTestId("wallet-cap-note")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WHAT THE PROVIDER STEP TURNED DOWN (GAP-091).
//
// The picker moved into the numbered flow, one screen ahead of this one, and
// writes `paused_provider_packages` before it navigates here -- the complement
// of what the user ticked. Before that there was no channel between the two
// screens at all, so this one re-derived from the observed list and proposed a
// wallet for every recognised provider on it, including the ones the user had
// just said no to: the flow contradicting itself one screen apart.
// ---------------------------------------------------------------------------

describe("the provider step's answer", () => {
  test("a provider the user declined is not proposed as a wallet", async () => {
    // The row the picker leaves behind when the user ticks GCash and not Maya.
    await setSetting("paused_provider_packages", [MAYA]);

    await renderReady([GCASH, MAYA]);

    expect(screen.getByTestId(`wallet-proposal-${GCASH}`)).toBeTruthy();
    expect(screen.queryByTestId(`wallet-proposal-${MAYA}`)).toBeNull();
    // Cash is not a provider choice and is never filtered by this.
    expect(screen.getByTestId("wallet-proposal-cash")).toBeTruthy();
  });

  test("declining it does not create its wallet either, not merely hide the row", async () => {
    await setSetting("paused_provider_packages", [MAYA]);
    await renderReady([GCASH, MAYA]);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () =>
      expect((await listWallets()).map((wallet) => wallet.name).sort()).toEqual(["Cash", "GCash"]),
    );
  });

  test("an empty row filters nothing, because that is what ticking nothing means", async () => {
    // NOT AN EDGE CASE, THE COMMON PATH. "Ticked nothing" and "tapped Skip"
    // both mean capture everything, and the picker records nothing paused for
    // either -- so reading an empty row as "everything is paused" would propose
    // no wallets at all to most users.
    await setSetting("paused_provider_packages", []);

    await renderReady([GCASH, MAYA]);

    expect(screen.getByTestId(`wallet-proposal-${GCASH}`)).toBeTruthy();
    expect(screen.getByTestId(`wallet-proposal-${MAYA}`)).toBeTruthy();
  });

  test("a declined provider stays offered as an add-another chip", async () => {
    // The chips take a deliberate tap, so nothing is created for a user who did
    // not ask twice -- and someone who changes their mind still has a way back
    // without leaving onboarding.
    await setSetting("paused_provider_packages", [MAYA]);

    await renderReady([GCASH]);

    expect(screen.getByTestId(`wallet-add-${MAYA}`)).toBeTruthy();
  });
});
