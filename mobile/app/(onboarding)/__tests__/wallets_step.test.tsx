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
  getAppLabels: jest.fn(),
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
import { getAppLabels, listObservedPackages } from "@/modules/notification_listener";
import { closeDatabase } from "@/lib/db/database";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { listMatchers } from "@/lib/db/repos/wallet_matchers_repo";
import { createWallet, listWallets } from "@/lib/db/repos/wallets_repo";
import { clearWalletDraft } from "@/lib/onboarding/wallet_draft";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { freshDb } from "@/test_support/db";
import { typeAmount } from "@/test_support/keypad";
import type { ObservedPackage } from "@/modules/notification_listener";

import WalletsScreen from "@/app/(onboarding)/wallets";

const mockListObservedPackages = listObservedPackages as jest.Mock;
const mockGetAppLabels = getAppLabels as jest.Mock;

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

async function renderReady(
  observedPackages: string[] = [],
  appLabels: Record<string, string> = {},
): Promise<void> {
  mockGetAppLabels.mockResolvedValue(appLabels);
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

describe("only RECOGNISED observed providers are proposed (task-2-brief)", () => {
  const UNKNOWN_APP = "com.termux";

  test("an observed package the ruleset does not recognise gets no proposal", async () => {
    // com.termux has posted a notification (`seen: true`) but no provider in
    // the ruleset claims it (`suggested: false`) — buildProviderChoices still
    // emits it, raw-named, for the picker. This screen must not turn that
    // into a pre-checked "com.termux" Wallet.
    await renderReady([UNKNOWN_APP]);

    expect(screen.queryByTestId(`wallet-proposal-${UNKNOWN_APP}`)).toBeNull();
    const names = screen.queryAllByTestId(/^wallet-proposal-name-/).map((el) => el.props.value);
    expect(names).not.toContain(UNKNOWN_APP);
    // The quick-add row is unaffected — it was never sourced from `seen`
    // packages in the first place, only from the rest of the catalogue.
    expect(screen.queryByTestId(`wallet-add-${UNKNOWN_APP}`)).toBeNull();
  });

  test("an observed AND recognised provider still gets proposed, checked", async () => {
    await renderReady([GCASH]);

    expect(screen.getByTestId(`wallet-proposal-${GCASH}`)).toBeTruthy();
  });

  test("no recognised observed package still leaves a usable step — cash alone, Continue creates no junk", async () => {
    await renderReady([UNKNOWN_APP]);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    // Only the cash wallet the screen always proposes — nothing named after
    // the raw, unrecognised package.
    await waitFor(async () => expect(await listWallets()).toHaveLength(1));
    const wallets = await listWallets();
    expect(wallets[0].name).toBe("Cash");
    expect(wallets.some((wallet) => wallet.name === UNKNOWN_APP)).toBe(false);
  });
});

describe("opening balances at creation (task-4-brief rule 1)", () => {
  test("a blank opening balance creates the wallet at zero and does not block continue", async () => {
    await renderReady([GCASH]);

    // Nothing typed into the balance field at all — the default, untouched
    // state every proposal starts in.
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    // The proposal, not the cash row the step always adds. Selected by
    // exclusion rather than by name: the name comes from `providerLabel`, and
    // this test is about the BALANCE, not about what the label resolves to.
    const gcashWallet = (await listWallets()).find((wallet) => wallet.name !== "Cash")!;
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
    const gcashWallet = (await listWallets()).find((wallet) => wallet.name !== "Cash")!;
    expect(gcashWallet.balance).toBe(300_000);
  });
});

// ---------------------------------------------------------------------------
// REAL APP NAMES (app-label plan).
//
// The wallet step re-derives its candidates the same way the provider picker
// does, so the two screens have to agree about what an app is CALLED.
// Proposing "SeaBank" one screen after the user tapped a tile reading
// "Maribank" makes them doubt they picked the right app — and a wallet named
// after a bank that rebranded is not something they can spot later.
// ---------------------------------------------------------------------------

describe("proposed wallet names follow the device, not the seed", () => {
  test("a proposal is named from the app's real label", async () => {
    await renderReady([GCASH], { [GCASH]: "GCash Bank Pilipinas" });

    expect(screen.getByTestId(`wallet-proposal-name-${GCASH}`).props.value).toBe(
      "GCash Bank Pilipinas",
    );
  });

  test("a quick-add chip is named from the app's real label too", async () => {
    // The chip and the proposal it becomes must not disagree: the user taps
    // "+ X" and gets a wallet called X.
    await renderReady([], { [GMESSAGES]: "Google Messages" });

    expect(screen.getByLabelText("Add Google Messages")).toBeTruthy();
  });

  test("no label falls back to the shared provider label, not to a package id", async () => {
    await renderReady([GCASH], {});

    expect(screen.getByTestId(`wallet-proposal-name-${GCASH}`).props.value).toBe(
      "GCash (via shared constants/providers.ts)",
    );
  });

  test("a renamed app still matches on its PACKAGE, never on its label", async () => {
    await renderReady([GCASH], { [GCASH]: "GCash Bank Pilipinas" });

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    await waitFor(async () => {
      const wallets = await listWallets();
      expect(wallets.some((wallet) => wallet.name === "GCash Bank Pilipinas")).toBe(true);
    });

    const wallets = await listWallets();
    const renamed = wallets.find((wallet) => wallet.name === "GCash Bank Pilipinas");
    const matchers = await listMatchers(renamed!.id);

    // The label is display only. Routing keys on the package id, which is
    // exactly what does NOT change when a bank rebrands.
    expect(matchers.map((matcher) => matcher.packageName)).toContain(GCASH);
  });
});

// ---------------------------------------------------------------------------
// COMING BACK TO THIS STEP (owner's report, 2026-08-28).
//
// The reported flow: set up wallets, tap Continue, realise on the next screen
// that one wallet was missed, walk back. What the user met was a list rebuilt
// from scratch — the same providers proposed again, every balance they had
// keyed replaced by a blank field — and a Continue that answered "Some wallets
// couldn't be saved", because `createWallet` refuses a duplicate name and the
// first refusal abandoned every proposal after it, INCLUDING the one wallet
// they had come back to add.
//
// These tests pin the two halves of the fix: the step recognises what it has
// already written (from the database, so it holds even across a relaunch), and
// it keeps what the user has typed but not yet saved (from the in-memory
// draft). A remount with a fresh QueryClient is what "walked back to this
// screen" actually looks like here — `renderScreen` builds a new client every
// call, so nothing is carried by the query cache.
// ---------------------------------------------------------------------------

describe("coming back to the wallet step after it has already created wallets", () => {
  test("a wallet created on the first pass returns as a saved row, not a blank proposal", async () => {
    await renderReady([GCASH]);
    typeAmount(`wallet-proposal-balance-${GCASH}`, "500");
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));
    await waitFor(async () => expect(await listWallets()).toHaveLength(2));

    // The draft is dropped deliberately: this asserts the DATABASE half of the
    // fix on its own, which is the only half a user who relaunches still has.
    screen.unmount();
    clearWalletDraft();
    await renderReady([GCASH]);

    await waitFor(() => expect(screen.getByTestId(`wallet-proposal-saved-${GCASH}`)).toBeTruthy());
    // And it is not asking for the figure a second time: the row carries the
    // wallet's real balance, not the blank field that made the user think
    // their first pass had been thrown away.
    expect(screen.getByTestId(`wallet-proposal-balance-preview-${GCASH}`)).toHaveTextContent(
      "₱500.00",
    );
  });

  test("Continue on the return visit saves the missed wallet and reports no error", async () => {
    await renderReady([GCASH]);
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));
    await waitFor(async () => expect(await listWallets()).toHaveLength(2));

    // Back on the step, this time with a provider that was missed the first
    // time round — exactly the reason the user walks back.
    screen.unmount();
    clearWalletDraft();
    mockPush.mockClear();
    await renderReady([GCASH, GMESSAGES]);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));

    // The missed wallet lands...
    await waitFor(async () => expect(await listWallets()).toHaveLength(3));
    // ...the ones that already existed are not duplicated...
    const wallets = await listWallets();
    expect(wallets.filter((wallet) => wallet.name === "Cash")).toHaveLength(1);
    // ...nothing is reported as lost...
    expect(screen.queryByTestId("wallets-step-error")).toBeNull();
    // ...and the flow moves on, which the old duplicate-name throw prevented.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/income"));
  });

  test("an opening balance typed but not yet saved survives leaving and coming back", async () => {
    await renderReady([GCASH]);
    typeAmount(`wallet-proposal-balance-${GCASH}`, "1234");

    // Left WITHOUT pressing Continue — nothing is in the database yet, so the
    // in-memory draft is the only thing standing between the user and typing
    // all of it again.
    screen.unmount();
    await renderReady([GCASH]);

    fireEvent.press(screen.getByTestId("onboarding-primary-button"));
    await waitFor(async () => expect(await listWallets()).toHaveLength(2));
    const gcashWallet = (await listWallets()).find((wallet) => wallet.name !== "Cash")!;
    expect(gcashWallet.balance).toBe(123_400);
  });

  test("a wallet that exists but no proposal covers is still shown as saved", async () => {
    // Nothing on this run proposes it — it is simply already there, and a step
    // that hid it would be telling the user their wallet list is emptier than
    // it is right before asking them to add to it.
    await createWallet({ name: "Palawan Pera Padala", openingBalance: 25_000 });

    await renderReady([GCASH]);

    expect(screen.getByDisplayValue("Palawan Pera Padala")).toBeTruthy();
  });

  test("a saved row cannot be unchecked — a step never deletes a wallet", async () => {
    await renderReady([GCASH]);
    fireEvent.press(screen.getByTestId("onboarding-primary-button"));
    await waitFor(async () => expect(await listWallets()).toHaveLength(2));

    screen.unmount();
    clearWalletDraft();
    await renderReady([GCASH]);
    await waitFor(() => expect(screen.getByTestId(`wallet-proposal-saved-${GCASH}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId(`wallet-proposal-toggle-${GCASH}`));

    // Still saved, still there: the toggle is inert on a row that is already a
    // real Wallet, because the only thing an uncheck could mean here is a
    // delete this flow is not allowed to perform.
    expect(screen.getByTestId(`wallet-proposal-saved-${GCASH}`)).toBeTruthy();
    expect(await listWallets()).toHaveLength(2);
  });
});
