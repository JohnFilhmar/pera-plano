// hooks/__tests__/use_set_provider_pause.test.tsx — the Privacy centre's
// per-provider switches, and the one state an allowlist cannot express
// (GAP-103; m3b Task 6 rule 2; docs §04-features/11-settings-privacy.md Flow B).
//
// WHAT THIS FILE IS ABOUT. `setProviderFilter` is an allowlist whose EMPTY
// value means "allow every package" — the fresh-install default, pinned on the
// Kotlin side by CapturePrefsTest and relied on by
// `app/(onboarding)/providers.tsx`. Two different user actions compute an empty
// list, and they mean opposite things:
//
//   nothing paused      -> [] -> allow every package
//   EVERY provider paused -> [] -> ...also allow every package, which is the
//                            exact opposite of what the user just asked for.
//
// So the length of the computed list can never be what tells them apart. The
// second argument, `denyAll`, is what carries the difference across the bridge,
// and these tests assert BOTH arguments on every call for that reason: a test
// that checked only the array would pass on the defect this file exists to
// prevent.
//
// The native call is asserted rather than the Kotlin behaviour, because Kotlin
// runs in no Jest suite in this repository. What the deny-all flag does once it
// lands is pinned in `CapturePrefsTest`, which needs Gradle or a device.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { closeDatabase } from "@/lib/db/database";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { setProviderFilter } from "@/modules/notification_listener";
import { freshDb } from "@/test_support/db";

import { useSetProviderPause } from "../mutations/use_set_provider_pause";

jest.mock("@/modules/notification_listener", () => ({
  setProviderFilter: jest.fn().mockResolvedValue(undefined),
}));

const mockSetProviderFilter = setProviderFilter as jest.Mock;

// Illustrative PH e-wallet/bank package ids, used only as opaque allowlist
// strings — the same three CapturePrefsTest uses. `sms_relay` carrying several
// packages is why the settings row speaks packages and not provider keys, so
// one provider here owns two.
const GCASH = "com.globe.gcash.android";
const MAYA = "com.paymaya";
const SMS_A = "com.google.android.apps.messaging";
const SMS_B = "com.samsung.android.messaging";

const EVERY_PACKAGE = [GCASH, MAYA, SMS_A, SMS_B];

let client: QueryClient;

beforeEach(async () => {
  await freshDb();
  jest.clearAllMocks();
  mockSetProviderFilter.mockResolvedValue(undefined);
  const defaults = appQueryClient.getDefaultOptions();
  client = new QueryClient({
    ...defaults,
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, staleTime: 0, gcTime: Infinity },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
});

afterEach(async () => {
  client.clear();
  await closeDatabase();
});

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function pause(variables: {
  packageNames: string[];
  paused: boolean;
  allPackageNames: string[];
}): Promise<string[]> {
  const { result } = renderHook(() => useSetProviderPause(), { wrapper: Wrapper });
  let next: string[] = [];
  await act(async () => {
    next = await result.current.mutateAsync(variables);
  });
  return next;
}

/** The `[packageNames, denyAll]` pair of the most recent native call. */
function lastNativeCall(): [string[], boolean] {
  const calls = mockSetProviderFilter.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as [string[], boolean];
}

// ---------------------------------------------------------------------------
// The three states, and the two of them that compute the same empty array.
// ---------------------------------------------------------------------------

test("PAUSING EVERY PROVIDER SENDS DENY-ALL, NEVER A BARE EMPTY ALLOWLIST", async () => {
  // Everything but the provider being switched off is already paused, so this
  // toggle is the one that empties the allowlist. Before GAP-103 the computed
  // `[]` went across on its own and the listener read it as allow-all: the
  // most restrictive action in the app producing the least restrictive result.
  await setSetting("paused_provider_packages", [MAYA, SMS_A, SMS_B]);

  const nextPaused = await pause({
    packageNames: [GCASH],
    paused: true,
    allPackageNames: EVERY_PACKAGE,
  });

  const [packageNames, denyAll] = lastNativeCall();
  expect(denyAll).toBe(true);
  // The array is still `[]`, and that is fine — the flag is what carries the
  // meaning. What must never happen is `[]` WITHOUT the flag.
  expect(packageNames).toEqual([]);
  expect(mockSetProviderFilter).toHaveBeenCalledWith([], true);

  // The readable record has to agree, since the native module has a setter and
  // no getter: `paused_provider_packages` is the only way anything can find out
  // that this state is in force.
  expect(nextPaused.sort()).toEqual([...EVERY_PACKAGE].sort());
  expect((await getSetting("paused_provider_packages")).sort()).toEqual(
    [...EVERY_PACKAGE].sort(),
  );
});

test("pausing some providers sends the remaining packages, with deny-all off", async () => {
  const nextPaused = await pause({
    packageNames: [GCASH],
    paused: true,
    allPackageNames: EVERY_PACKAGE,
  });

  const [packageNames, denyAll] = lastNativeCall();
  // Pausing one provider means "allow everyone ELSE", so the allowlist is the
  // full universe minus the paused packages — not the paused packages.
  expect(packageNames.sort()).toEqual([MAYA, SMS_A, SMS_B].sort());
  expect(denyAll).toBe(false);
  expect(nextPaused).toEqual([GCASH]);
});

test("pausing nothing clears the filter to allow-all, with deny-all off", async () => {
  // Resuming the last paused provider. The empty array here is the genuine
  // allow-all, and it must NOT be sent as the full known package list: that
  // would silently block any package the listener learns about later, which is
  // the inverted default `app/(onboarding)/providers.tsx` documents.
  await setSetting("paused_provider_packages", [GCASH]);

  const nextPaused = await pause({
    packageNames: [GCASH],
    paused: false,
    allPackageNames: EVERY_PACKAGE,
  });

  expect(mockSetProviderFilter).toHaveBeenCalledWith([], false);
  expect(nextPaused).toEqual([]);
  expect(await getSetting("paused_provider_packages")).toEqual([]);
});

// ---------------------------------------------------------------------------
// The reverse transition. A deny-all that could only be undone by resuming
// EVERY provider would be a trap, and one that fell back to allow-all on the
// first resume would leak the providers still switched off.
// ---------------------------------------------------------------------------

test("resuming one provider out of the all-paused state allowlists exactly that provider", async () => {
  await setSetting("paused_provider_packages", EVERY_PACKAGE);

  const nextPaused = await pause({
    packageNames: [SMS_A, SMS_B],
    paused: false,
    allPackageNames: EVERY_PACKAGE,
  });

  const [packageNames, denyAll] = lastNativeCall();
  expect(denyAll).toBe(false);
  // Exactly the resumed provider's packages: not allow-all (`[]`), and not the
  // whole universe. Both of those would resume providers the user left off.
  expect(packageNames.sort()).toEqual([SMS_A, SMS_B].sort());
  expect(nextPaused.sort()).toEqual([GCASH, MAYA].sort());
});

// ---------------------------------------------------------------------------
// Native first, settings second (the hook's own doc). The settings row is the
// only readable record, so a row written for a native call that never landed
// would tell the switch list a provider is paused while it is still capturing.
// ---------------------------------------------------------------------------

test("a failed native write leaves the settings row untouched, deny-all included", async () => {
  await setSetting("paused_provider_packages", [MAYA, SMS_A, SMS_B]);
  mockSetProviderFilter.mockRejectedValueOnce(new Error("bridge unavailable"));

  const { result } = renderHook(() => useSetProviderPause(), { wrapper: Wrapper });
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        packageNames: [GCASH],
        paused: true,
        allPackageNames: EVERY_PACKAGE,
      }),
    ).rejects.toThrow("bridge unavailable");
  });

  expect(await getSetting("paused_provider_packages")).toEqual([MAYA, SMS_A, SMS_B]);
});
