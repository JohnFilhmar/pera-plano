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
import {
  clearToasts,
  createMutationErrorCache,
  getToasts,
  MUTATION_FAILURE_TOAST,
  queryClient as appQueryClient,
} from "@/lib/query_client";
import { ProviderFilterNotStoredError, setProviderFilter } from "@/modules/notification_listener";
import { freshDb } from "@/test_support/db";

import {
  PROVIDER_PAUSE_NOT_STORED_TOAST,
  useSetProviderPause,
} from "../mutations/use_set_provider_pause";

// The error CLASS is part of the mock, not just the function: the hook tells a
// dropped native write from a failed settings write with `instanceof`, and a
// mock that omitted it would leave that branch unreachable — a test that passes
// while the user is told the wrong thing.
//
// A STAND-IN CLASS, not the real one, because `modules/notification_listener/
// index.ts` calls `requireNativeModule` at import time and cannot be required
// under Jest at all. Identity is the only property this file needs: the hook
// and the assertions below both reach the class through this same mock, so
// `instanceof` means here exactly what it means on a device. What the real
// class carries — its `code`, and that `rethrowTyped` produces it for that code
// and for no other — is pinned in modules/notification_listener/__tests__/
// index.test.ts, against the real file.
jest.mock("@/modules/notification_listener", () => ({
  setProviderFilter: jest.fn().mockResolvedValue(undefined),
  ProviderFilterNotStoredError: class ProviderFilterNotStoredError extends Error {
    readonly code = "ProviderFilterNotStored";
    constructor(message = "the provider filter could not be stored on this device") {
      super(message);
      this.name = "ProviderFilterNotStoredError";
    }
  },
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
  clearToasts();
  mockSetProviderFilter.mockResolvedValue(undefined);
  const defaults = appQueryClient.getDefaultOptions();
  client = new QueryClient({
    ...defaults,
    // The app's own failure surface, not a bare client: without it a hook that
    // silently swallowed every rejection would look identical here (see
    // lib/query_client.ts's header). It is also what the GAP-114 assertions
    // below need in order to prove the specific copy REPLACES the generic card
    // rather than stacking a second one on top of it.
    mutationCache: createMutationErrorCache(),
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, retry: 0, staleTime: 0, gcTime: Infinity },
      mutations: { ...defaults.mutations, gcTime: 0 },
    },
  });
});

afterEach(async () => {
  client.clear();
  clearToasts();
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

// ---------------------------------------------------------------------------
// GAP-114. Until the native side reported it, a device that could not seal the
// allowlist RESOLVED — so the ordering above was ordering a settings write
// behind a call that had merely claimed to have happened. The row was written,
// the switch showed "Paused", and the listener went on capturing from that
// provider with nothing anywhere able to notice: this bridge has a setter and
// no getter, and `paused_provider_packages` is the only readable record.
//
// The rejection is asserted here rather than the Kotlin behaviour behind it,
// like the rest of this file. That the seal failure actually produces it lives
// in CapturePrefsTest and NotificationListenerModuleTest, which need Gradle.
// ---------------------------------------------------------------------------

/** What the bridge now rejects with when the scope did not reach disk. */
function notStored(): Error {
  return new ProviderFilterNotStoredError();
}

test("A DROPPED NATIVE WRITE DOES NOT RECORD THE PAUSE, SO THE SWITCH HAS NOTHING TO STICK TO", async () => {
  mockSetProviderFilter.mockRejectedValueOnce(notStored());

  const { result } = renderHook(() => useSetProviderPause(), { wrapper: Wrapper });
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        packageNames: [GCASH],
        paused: true,
        allPackageNames: EVERY_PACKAGE,
      }),
    ).rejects.toBeInstanceOf(ProviderFilterNotStoredError);
  });

  // Nothing paused, which is where the row started. The switch renders off this
  // row (`usePausedProviderPackages`), so an unwritten row IS the switch
  // staying where it was — there is no separate revert to get wrong.
  expect(await getSetting("paused_provider_packages")).toEqual([]);
});

test("the dropped-write card says what is still being read, and replaces the generic one", async () => {
  mockSetProviderFilter.mockRejectedValueOnce(notStored());

  const { result } = renderHook(() => useSetProviderPause(), { wrapper: Wrapper });
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        packageNames: [GCASH],
        paused: true,
        allPackageNames: EVERY_PACKAGE,
      }),
    ).rejects.toBeInstanceOf(ProviderFilterNotStoredError);
  });

  // ONE card, not two: the hook publishes under the app-wide dedupe key, so its
  // copy swaps into the entry the mutation cache already queued.
  const queued = getToasts();
  expect(queued).toHaveLength(1);
  expect(queued[0].title).toBe(PROVIDER_PAUSE_NOT_STORED_TOAST.title);
  expect(queued[0].body).toBe(PROVIDER_PAUSE_NOT_STORED_TOAST.body);
  expect(queued[0].tone).toBe("failure");
  // The generic copy cannot say the thing that matters on this screen — that
  // the bank the user just switched off is still being read — so its presence
  // here would be the defect, not merely a weaker wording.
  expect(queued[0].body).not.toBe(MUTATION_FAILURE_TOAST.body);
});

test("any OTHER failure keeps the app-wide card, because the reworded one would be a false statement", async () => {
  // The reason the reworded copy is behind an `instanceof` and not applied to
  // every rejection this mutation can produce. A settings-row write that failed
  // AFTER the bridge resolved changed the listener's scope for real, so
  // "PeraPlano is still reading the same apps it was before" would be untrue —
  // and telling that user to restart would fix nothing. Exercised through a
  // bridge failure of a different kind, which lands in the same branch.
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

  const queued = getToasts();
  expect(queued).toHaveLength(1);
  expect(queued[0].title).toBe(MUTATION_FAILURE_TOAST.title);
  expect(queued[0].body).toBe(MUTATION_FAILURE_TOAST.body);
});
