// app/(onboarding)/__tests__/wallets_step.test.tsx — task-3-brief: one chip per
// PROVIDER in the "Also have one of these?" row, not one per Android package.
// Extended for task-4-brief rule 1: the "a blank opening balance ... does not
// block continue" requirement names a real end-to-end behaviour (a wallet row
// actually gets created, and the flow actually advances) that no purely
// presentational suite can prove — quick_wallet_list.test.tsx covers the
// field itself; this covers what happens when "Continue" is actually pressed
// against a real database, which is what this file already does for Task 3.
//
// WHY THIS FILE, SEPARATE FROM providers_step.test.tsx. That suite already
// covers the wallet step end to end against single-package providers (gcash,
// maya, bpi, bdo) — the defect here only shows up for a provider with SEVERAL
// packages, and `assets/parser_rules/seed.json` ships exactly one of those:
// `sms_relay` (Google Messages, Samsung Messages, AOSP MMS). This suite seeds
// that shape directly rather than the real seed file, so it stays pinned to
// the rule ("dedupe by provider, attach every package") rather than to
// whatever the seed happens to contain.
//
// expo-router IS MOCKED, same as providers_step.test.tsx: the wallet step is a
// ROUTE, mounted with no props, and "Continue" has to both write rows and
// advance on its own.
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
}));

// A distinguishing override for exactly one key, so "uses the shared provider
// labels" below can prove the screen actually reads `constants/providers.ts`
// rather than a private copy that merely happens to agree with it today. Every
// other key falls through to the real table unchanged.
jest.mock("@/constants/providers", () => {
  const actual = jest.requireActual("@/constants/providers");
  return {
    ...actual,
    providerLabel: (key: string) =>
      key === "gcash" ? "GCash (via shared constants/providers.ts)" : actual.providerLabel(key),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { KeypadHost } from "@/components/ui/keypad_host";
import { KeypadProvider } from "@/contexts/keypad_context";
import { listObservedPackages } from "@/modules/notification_listener";
import { closeDatabase } from "@/lib/db/database";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { listMatchers } from "@/lib/db/repos/wallet_matchers_repo";
import { listWallets } from "@/lib/db/repos/wallets_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import { typeAmount } from "@/test_support/keypad";
import type { ObservedPackage } from "@/modules/notification_listener";

import WalletsScreen from "@/app/(onboarding)/wallets";

const mockListObservedPackages = listObservedPackages as jest.Mock;

const GMESSAGES = "com.google.android.apps.messaging";
const SMESSAGES = "com.samsung.android.messaging";
const AOSP_MMS = "com.android.mms";
const GCASH = "com.globe.gcash.android";

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

// KeypadProvider AND A HOST, MOUNTED BEFORE THE SCREEN (numeric-input-system
// Task 13). The opening-balance field is a NumericField now, and its
// `useKeypad()` throws with no provider above it; the host is what the panel
// actually renders into, so `typeAmount` has nothing to press without one.
// Host first, subject second: contexts/keypad_context.tsx hands the panel to
// the HIGHEST live token, and effects flush in completion order, so a host
// mounted after the screen would outrank anything the screen mounts itself.
function renderScreen(): void {
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
  render(<WalletsScreen />, { wrapper: Wrapper });
}

/** Mirrors the real seed's `sms_relay` provider: one providerKey, three packages. */
async function seedMultiPackageCatalogue(): Promise<void> {
  await upsertRuleset({
    version: 1,
    providers: [
      {
        providerKey: "gcash",
        packageNames: [GCASH],
        version: 1,
        channel: "push",
        templates: [],
      },
      {
        providerKey: "sms_relay",
        packageNames: [GMESSAGES, SMESSAGES, AOSP_MMS],
        version: 1,
        channel: "sms",
        templates: [],
      },
    ],
  });
}

async function renderReady(observedPackages: string[] = []): Promise<void> {
  mockListObservedPackages.mockResolvedValue(
    observedPackages.map((packageName) => ({
      packageName,
      count: 3,
      lastSeenAt: 1_755_000_000_000,
    })) satisfies ObservedPackage[],
  );
  renderScreen();
  await screen.findByTestId("quick-wallet-list");
}

beforeEach(async () => {
  await freshDb();
  await seedMultiPackageCatalogue();
  jest.clearAllMocks();
});

afterEach(async () => {
  await closeDatabase();
});

describe("the quick-add row", () => {
  test("offers one chip per provider even when a provider has several packages", async () => {
    // None of sms_relay's three packages have been observed, so all three
    // would previously render as separate "+ Bank SMS" chips.
    await renderReady([]);

    expect(screen.getByTestId(`wallet-add-${GMESSAGES}`)).toBeTruthy();
    // The other two packages' chips must not exist AT ALL — not just be
    // visually identical to the first.
    expect(screen.queryByTestId(`wallet-add-${SMESSAGES}`)).toBeNull();
    expect(screen.queryByTestId(`wallet-add-${AOSP_MMS}`)).toBeNull();

    expect(screen.getAllByText("+ Bank SMS")).toHaveLength(1);
  });

  test("adding a multi-package provider attaches all of its packages as matchers", async () => {
    await renderReady([]);

    fireEvent.press(screen.getByTestId(`wallet-add-${GMESSAGES}`));
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    const smsWallet = (await listWallets()).find((wallet) => wallet.name === "Bank SMS")!;
    expect(smsWallet).toBeTruthy();

    const matchers = await listMatchers(smsWallet.id);
    // All three packages, not just the one the chip happened to be keyed on —
    // otherwise a user whose bank texts arrive via com.android.mms silently
    // catches nothing.
    expect(matchers.map((matcher) => matcher.packageName).sort()).toEqual(
      [GMESSAGES, SMESSAGES, AOSP_MMS].sort(),
    );
  });

  test("uses the shared provider labels", async () => {
    // constants/providers.ts is the one place a provider's human name is
    // allowed to live; a second, private copy in this screen is how "GCash"
    // becomes "Gcash" on one screen and not another. If this screen still
    // carried its own private table, the mocked override above would change
    // nothing on screen — the assertion below only passes because the label
    // actually comes from the shared import.
    await renderReady([GCASH]);

    // The row's NAME field is a TextInput, whose `value` prop is where the
    // rendered name actually lives — not a `<Text>` child `toHaveTextContent`
    // would see.
    expect(screen.getByTestId(`wallet-proposal-name-${GCASH}`).props.value).toBe(
      "GCash (via shared constants/providers.ts)",
    );
  });
});

describe("the observed (auto-proposed) row respects provider boundaries too (review fix, 2026-08-18)", () => {
  test("two observed packages of the same multi-package provider produce ONE proposal, not two", async () => {
    // Both Google Messages and Samsung Messages have posted sms_relay
    // notifications on this device. Before this fix, buildProviderChoices'
    // per-package shape flowed straight through to two identically-named
    // "Bank SMS" proposals, splitting one provider's traffic by default.
    await renderReady([GMESSAGES, SMESSAGES]);

    expect(screen.getByTestId(`wallet-proposal-${GMESSAGES}`)).toBeTruthy();
    expect(screen.queryByTestId(`wallet-proposal-${SMESSAGES}`)).toBeNull();

    const names = screen
      .queryAllByTestId(/^wallet-proposal-name-/)
      .map((el) => el.props.value);
    expect(names.filter((name) => name === "Bank SMS")).toHaveLength(1);
  });

  test("an observed multi-package provider catches every package, not just the one observed", async () => {
    // Only Google Messages was observed; sms_relay also owns Samsung
    // Messages and AOSP MMS. The created wallet must still match all three,
    // or switching SMS apps silently stops tracking.
    await renderReady([GMESSAGES]);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    const smsWallet = (await listWallets()).find((wallet) => wallet.name === "Bank SMS")!;
    expect(smsWallet).toBeTruthy();

    const matchers = await listMatchers(smsWallet.id);
    expect(matchers.map((matcher) => matcher.packageName).sort()).toEqual(
      [GMESSAGES, SMESSAGES, AOSP_MMS].sort(),
    );
  });
});

describe("opening balances at creation (task-4-brief rule 1)", () => {
  test("a blank opening balance creates the wallet at zero and does not block continue", async () => {
    await renderReady([GCASH]);

    // Nothing typed into the balance field at all — the default, untouched
    // state every proposal starts in.
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    const gcashWallet = (await listWallets()).find((wallet) => wallet.type === "e-wallet")!;
    expect(gcashWallet.balance).toBe(0);
    // And Continue actually continued — a blank balance is a real, complete
    // answer, not a validation error silently holding the flow in place.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/income"));
  });

  test("a typed opening balance is what the wallet is actually created with", async () => {
    await renderReady([GCASH]);

    // "3000", not "300000" (numeric-input-system Task 13): the wallet this
    // test is about still opens at ₱3,000.00 — only the keystrokes that get
    // it there changed, because a digit is a PESO now rather than a centavo.
    typeAmount(`wallet-proposal-balance-${GCASH}`, "3000");
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    const gcashWallet = (await listWallets()).find((wallet) => wallet.type === "e-wallet")!;
    expect(gcashWallet.balance).toBe(300_000);
  });
});
