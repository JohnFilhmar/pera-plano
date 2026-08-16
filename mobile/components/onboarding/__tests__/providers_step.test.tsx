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
jest.mock("@/modules/notification_listener", () => ({
  listObservedPackages: jest.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { listObservedPackages } from "@/modules/notification_listener";
import { closeDatabase } from "@/lib/db/database";
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

function renderScreen(props: { onDone?: () => void } = {}): void {
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
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

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    const names = (await listWallets()).map((w) => w.name).sort();
    expect(names).toEqual(["Cash", "GCash"].sort());
  });

  test("an edited name and type are what gets saved, not the default", async () => {
    await renderReady([GCASH]);

    fireEvent.changeText(screen.getByTestId(`wallet-proposal-name-${GCASH}`), "My GCash");
    fireEvent.press(screen.getByTestId(`wallet-proposal-type-${GCASH}-savings`));
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    const gcashWallet = (await listWallets()).find((w) => w.name === "My GCash");
    expect(gcashWallet).toBeTruthy();
    expect(gcashWallet!.type).toBe("savings");
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

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

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
