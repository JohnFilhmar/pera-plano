// app/__tests__/privacy_screen.test.tsx — m3b Task 6 Step 4/5, against
// app/(tabs)/more/privacy.tsx.
//
// Path note: the task-6 brief names components/privacy/__tests__/
// privacy_screen.test.tsx; screen tests in this repo live under
// app/__tests__/ (see e.g. app/__tests__/transaction_detail.test.tsx), so
// this file is there instead — the coordinator's own correction.
//
// `modules/notification_listener` is a native module and cannot be required
// under Jest — mocked the same way app/__tests__/home_screen.test.tsx mocks
// it. `lib/privacy/data_export.ts` and `contexts/lock_context.tsx` are mocked
// wholesale here: their own behaviour is proven elsewhere (lib/privacy/
// __tests__/data_export.test.ts; contexts/__tests__/lock_context.test.tsx and
// lib/security/__tests__/wipe.test.ts for the wipe) — this file's job is to
// prove the SCREEN calls them correctly and only when it should, not to
// re-prove what they do internally.
//
// WHAT THE WIPE ASSERTIONS MOCK, AND WHY IT CHANGED. This suite used to mock
// `@/lib/privacy/data_wipe` and assert `wipeAllData` fired. That call was the
// bug: a logical `DELETE FROM` sweep that kept the SQLCipher file and both key
// wraps, so the user landed back in onboarding with the SAME recovery phrase
// and the SAME device-lock enrolment (observed on a real Samsung A54) despite
// copy promising a permanent, unrecoverable erase. The screen now calls the
// lock context's `wipeAndStartOver` — wipeDatabase → wipeKeys →
// clearCaptureBuffer, then status "needs_onboarding", which is the fresh-
// install branch that re-runs device lock and issues a brand-new phrase — so
// that is what these tests mock and assert against. Every guarantee the old
// suite carried is kept verbatim below: both confirmations required,
// cancelling either wipes nothing, a wrong word never enables the button, and
// a failure surfaces `privacy-wipe-error` instead of a stuck spinner.
//
// `getListenerHealth`/`openAccessSettings` join that same native mock because
// the capture row now states the LIVE grant rather than the switch's position
// (GAP-089): the screen reads `useListenerHealth()` and hands the settings
// opener down to `CaptureToggle`, exactly as app/(tabs)/more/listener_health.tsx
// already does for the health card.
jest.mock("@/modules/notification_listener", () => ({
  getListenerHealth: jest.fn(),
  openAccessSettings: jest.fn(),
  setCaptureEnabled: jest.fn().mockResolvedValue(undefined),
  setProviderFilter: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/privacy/data_export", () => ({
  exportAllData: jest.fn().mockResolvedValue("file:///cache/peraplano-export-fake.json"),
}));

// The whole lock context is stubbed: mounting a real LockProvider here would
// drag in expo-local-authentication and the native key manager for no added
// proof. Two values, because the screen uses two — and `errorMessage` is the
// one a failed wipe actually arrives on. The real `wipeAndStartOver` NEVER
// REJECTS (its own doc; contexts/__tests__/lock_context.test.tsx pins both
// failure kinds as `resolves` and asserts the message each one leaves behind),
// so the stub below fails the way the real one does: it sets the message and
// then resolves. A stub that rejected instead would be testing a promise the
// app cannot produce.
const mockWipeAndStartOver = jest.fn().mockResolvedValue(undefined);
let mockLockErrorMessage: string | null = null;
jest.mock("@/contexts/lock_context", () => ({
  useLock: () => ({
    wipeAndStartOver: mockWipeAndStartOver,
    errorMessage: mockLockErrorMessage,
  }),
}));

// Nothing in the screen navigates any more — the lock context's status change
// to "needs_onboarding" is what swaps the whole tree for the lock gate (see
// handleWipeConfirmed's own doc). The mock stays so that any router use
// reintroduced here fails loudly rather than reaching the real module, and
// `mockReplace` is asserted to stay untouched on the wipe paths below.
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: (...args: unknown[]) => mockReplace(...args) }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { WIPE_STEP_ONE_BODY, WIPE_STEP_TWO_BODY } from "@/components/privacy/wipe_flow";
import { closeDatabase } from "@/lib/db/database";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { seedDefaultCategories } from "@/lib/db/repos/categories_repo";
import { upsertRuleset } from "@/lib/db/repos/parser_rulesets_repo";
import { storeRawCapture, RAW_CAPTURE_TTL_MS } from "@/lib/db/repos/raw_notifications_repo";
import { listDataTableNames } from "@/lib/db/table_names";
import { exportAllData } from "@/lib/privacy/data_export";
import { queryClient as appQueryClient } from "@/lib/query_client";
import { WipeIncompleteError } from "@/lib/security/wipe";
import { freshDb } from "@/test_support/db";
import {
  getListenerHealth,
  openAccessSettings,
  setCaptureEnabled,
  setProviderFilter,
} from "@/modules/notification_listener";

import PrivacyScreen from "../(tabs)/more/privacy";
import type { SQLiteDatabase } from "@/lib/db/database";

const mockSetCaptureEnabled = setCaptureEnabled as jest.Mock;
const mockSetProviderFilter = setProviderFilter as jest.Mock;
const mockExportAllData = exportAllData as jest.Mock;
const mockGetListenerHealth = getListenerHealth as jest.MockedFunction<typeof getListenerHealth>;
const mockOpenAccessSettings = openAccessSettings as jest.Mock;

const HEALTHY = { granted: true, serviceConnected: true, lastCaptureAt: null };
const REVOKED = { granted: false, serviceConnected: false, lastCaptureAt: null };
const DISCONNECTED = { granted: true, serviceConnected: false, lastCaptureAt: null };

// The exact sentences the row may print, quoted rather than imported: the whole
// point of GAP-089 is what a reader SEES, and a test that imports the constant
// it asserts would keep passing through any rewording, including a rewording
// back to a claim the app cannot support.
const ACTIVE_COPY =
  "PeraPlano is reading your bank and e-wallet notifications to record transactions automatically.";
const NO_ACCESS_COPY =
  "Notification access is off, so PeraPlano is reading nothing. Grant it again to resume automatic tracking.";
const DISCONNECTED_COPY =
  "Notification access is on, but the listener service is not running, so nothing is being read right now.";
const CHECKING_COPY = "Checking whether PeraPlano can read your notifications right now.";

const DAY_MS = 24 * 60 * 60 * 1000;
const GCASH_PACKAGE = "com.globe.gcash.android";
const BPI_PACKAGE = "com.bpi.ng.app";

// Same discipline transaction_detail.test.tsx uses: the screen reads the
// wall clock for its countdown and its capture list, so fixtures are
// positioned RELATIVE to it rather than against a hand-picked constant.
const NOW = Date.now();

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

async function renderPrivacyScreen(): Promise<void> {
  const client = makeTestClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<PrivacyScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId("privacy-screen")).toBeTruthy());
}

let db: SQLiteDatabase;

beforeEach(async () => {
  jest.clearAllMocks();
  mockLockErrorMessage = null;
  // Healthy by default, so every test that is not about the grant renders the
  // same screen it always did.
  mockGetListenerHealth.mockResolvedValue(HEALTHY);
  db = await freshDb();
  await seedDefaultCategories();
  await upsertRuleset({
    version: 1,
    providers: [
      { providerKey: "gcash", packageNames: [GCASH_PACKAGE], version: 1, channel: "push", templates: [] },
      { providerKey: "bpi", packageNames: [BPI_PACKAGE], version: 1, channel: "push", templates: [] },
    ],
    tunables: {},
  });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Master pause (rule 1)
// ---------------------------------------------------------------------------

test("the master pause calls the native setter and persists the setting", async () => {
  await renderPrivacyScreen();
  await waitFor(() => expect(screen.getByTestId("capture-toggle-switch")).toBeTruthy());

  fireEvent(screen.getByTestId("capture-toggle-switch"), "valueChange", false);

  await waitFor(() => expect(mockSetCaptureEnabled).toHaveBeenCalledWith(false));
  await waitFor(async () => expect(await getSetting("capture_enabled")).toBe(false));
});

// ---------------------------------------------------------------------------
// The capture row states the LIVE grant, not the switch's position (GAP-089).
//
// The switch is the user's INTENT; whether anything is actually being read
// also needs Notification Access and a connected listener, which only
// `getListenerHealth()` knows. The row used to print "PeraPlano is reading
// your bank and e-wallet notifications" whenever `capture_enabled` was not
// `false` — to a user who declined the permission, to one whose OEM revoked
// it on a reboot, and during the frames before either value had loaded.
//
// ASSERTED ON RENDERED TEXT, and every case asserts the ABSENCE of the active
// sentence as well as the presence of the honest one: a subtitle that computed
// the right string and then failed to reach the screen would satisfy a
// presence-only test while the user still read the false claim.
// ---------------------------------------------------------------------------

test("with notification access revoked the row says access is off and offers the settings fix", async () => {
  mockGetListenerHealth.mockResolvedValue(REVOKED);

  await renderPrivacyScreen();

  await waitFor(() => expect(screen.getByText(NO_ACCESS_COPY)).toBeTruthy());
  expect(screen.queryByText(ACTIVE_COPY)).toBeNull();

  fireEvent.press(screen.getByTestId("capture-toggle-open-settings"));
  expect(mockOpenAccessSettings).toHaveBeenCalledTimes(1);
});

test("a granted permission with a dead listener service reads as disconnected, not as tracking", async () => {
  mockGetListenerHealth.mockResolvedValue(DISCONNECTED);

  await renderPrivacyScreen();

  await waitFor(() => expect(screen.getByText(DISCONNECTED_COPY)).toBeTruthy());
  expect(screen.queryByText(ACTIVE_COPY)).toBeNull();
  // Same destination: re-granting access in system settings is what rebinds
  // the listener, so the fix prompt is offered for this state too.
  expect(screen.getByTestId("capture-toggle-open-settings")).toBeTruthy();
});

test("the active claim survives only when the grant and the service both confirm it", async () => {
  await renderPrivacyScreen();

  await waitFor(() => expect(screen.getByText(ACTIVE_COPY)).toBeTruthy());
  // Nothing to fix, so nothing is offered — a permanent settings link would
  // train the reader to ignore the one that means something.
  expect(screen.queryByTestId("capture-toggle-open-settings")).toBeNull();
  expect(mockOpenAccessSettings).not.toHaveBeenCalled();
});

test("the row claims nothing while the live read has not landed", async () => {
  // Never resolves: the state the screen is in for its first frames, and the
  // state it stays in if the bridge hangs. `retry: false` on the hook means a
  // throw lands here too.
  mockGetListenerHealth.mockReturnValue(new Promise<never>(() => {}));

  await renderPrivacyScreen();

  await waitFor(() => expect(screen.getByText(CHECKING_COPY)).toBeTruthy());
  expect(screen.queryByText(ACTIVE_COPY)).toBeNull();
  expect(screen.queryByTestId("capture-toggle-open-settings")).toBeNull();
});

test("a user who paused on purpose is told they paused, not that the permission is broken", async () => {
  // Both faults at once, which is the ordinary consequence of pausing rather
  // than a second problem — the precedence components/home/tracking_banner.tsx
  // and use_listener_health.ts's header already set for this pair.
  mockGetListenerHealth.mockResolvedValue(REVOKED);
  await setSetting("capture_enabled", false);

  await renderPrivacyScreen();

  await waitFor(() =>
    expect(
      screen.getByText(
        "While paused, PeraPlano reads and stores nothing from any provider — not even for the Review Queue. Turn it back on to resume.",
      ),
    ).toBeTruthy(),
  );
  expect(screen.queryByText(NO_ACCESS_COPY)).toBeNull();
  expect(screen.queryByText(ACTIVE_COPY)).toBeNull();
  expect(screen.queryByTestId("capture-toggle-open-settings")).toBeNull();
});

// ---------------------------------------------------------------------------
// Per-provider switches (rule 2)
// ---------------------------------------------------------------------------

test("a provider switch calls setProviderFilter with the remaining packages", async () => {
  await renderPrivacyScreen();
  await waitFor(() => expect(screen.getByTestId("provider-switch-gcash")).toBeTruthy());

  fireEvent(screen.getByTestId("provider-switch-gcash"), "valueChange", false);

  await waitFor(() => expect(mockSetProviderFilter).toHaveBeenCalled());
  // Pausing gcash means "allow every OTHER known package" — bpi survives,
  // gcash does not, and the filter is not simply cleared to allow-all.
  const lastCall = mockSetProviderFilter.mock.calls[mockSetProviderFilter.mock.calls.length - 1];
  expect(lastCall[0]).toEqual([BPI_PACKAGE]);
  // Not a deny-all: bpi is still capturing, and the second argument is what
  // says so (GAP-103).
  expect(lastCall[1]).toBe(false);
});

test("resuming a paused provider clears the filter back to allow-all once nothing is paused", async () => {
  await setSetting("paused_provider_packages", [GCASH_PACKAGE]);

  await renderPrivacyScreen();
  await waitFor(() => expect(screen.getByTestId("provider-switch-paused-gcash")).toBeTruthy());

  fireEvent(screen.getByTestId("provider-switch-gcash"), "valueChange", true);

  await waitFor(() => expect(mockSetProviderFilter).toHaveBeenCalledWith([], false));
});

test("PAUSING THE LAST REMAINING PROVIDER SENDS DENY-ALL FROM THIS SCREEN", async () => {
  // The defect this closes was reachable from here, not only from the hook:
  // switching off the last provider computed `[]`, which the listener reads as
  // allow-all. Two providers exist in this ruleset, so pausing the second one
  // empties the allowlist.
  await setSetting("paused_provider_packages", [GCASH_PACKAGE]);

  await renderPrivacyScreen();
  await waitFor(() => expect(screen.getByTestId("provider-switch-bpi")).toBeTruthy());

  fireEvent(screen.getByTestId("provider-switch-bpi"), "valueChange", false);

  await waitFor(() => expect(mockSetProviderFilter).toHaveBeenCalledWith([], true));
  // And the master capture switch is NOT touched: the two controls stay
  // independent, which is the whole reason the bridge grew a deny-all instead
  // of the screen reaching for setCaptureEnabled(false).
  expect(mockSetCaptureEnabled).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Captured list + expiry countdown (rule 3)
// ---------------------------------------------------------------------------

test("the captured list renders real rows newest first", async () => {
  await storeRawCapture(
    {
      id: "older",
      packageName: GCASH_PACKAGE,
      title: "GCash",
      text: "You sent PHP 100 to Juan",
      subText: null,
      bigText: null,
      postedAt: NOW - 2 * DAY_MS,
      capturedAt: NOW - 2 * DAY_MS,
    },
    NOW - 2 * DAY_MS,
  );
  await storeRawCapture(
    {
      id: "newer",
      packageName: BPI_PACKAGE,
      title: "BPI",
      text: "You received PHP 200",
      subText: null,
      bigText: null,
      postedAt: NOW,
      capturedAt: NOW,
    },
    NOW,
  );

  await renderPrivacyScreen();
  await waitFor(() => expect(screen.getByTestId("captured-item-newer")).toBeTruthy());

  const items = screen.getAllByTestId(/^captured-item-(newer|older)$/);
  expect(items.map((el) => el.props.testID)).toEqual(["captured-item-newer", "captured-item-older"]);
  // Contains, not equals: the rendered block also carries the notification's
  // title line ("BPI"/"GCash") ahead of the body text — see captureLines()'s
  // own doc for why the title is included alongside the text.
  expect(screen.getByTestId("captured-item-text-newer")).toHaveTextContent(/You received PHP 200/);
  expect(screen.getByTestId("captured-item-text-older")).toHaveTextContent(/You sent PHP 100 to Juan/);
});

test("the countdown renders the correct remaining days for a pinned clock", async () => {
  // Stored 18 days before NOW: the 30-day TTL puts its expiry 12 days from
  // NOW — the exact fixture transaction_detail.test.tsx uses for the same
  // arithmetic against the same captureExpiryLabel().
  await storeRawCapture(
    {
      id: "cap-1",
      packageName: GCASH_PACKAGE,
      title: "GCash",
      text: "You sent PHP 500",
      subText: null,
      bigText: null,
      postedAt: NOW - 18 * DAY_MS,
      capturedAt: NOW - 18 * DAY_MS,
    },
    NOW - 18 * DAY_MS,
  );

  await renderPrivacyScreen();

  await waitFor(() =>
    expect(screen.getByTestId("captured-item-expiry-cap-1")).toHaveTextContent(
      "This capture is deleted in 12 days",
    ),
  );
});

test("an expired capture is not listed", async () => {
  // Stored 31 days before NOW: past the 30-day TTL, expired relative to
  // whatever instant the screen actually queries at.
  await storeRawCapture(
    {
      id: "expired",
      packageName: GCASH_PACKAGE,
      title: "GCash",
      text: "You sent PHP 999",
      subText: null,
      bigText: null,
      postedAt: NOW - 31 * DAY_MS,
      capturedAt: NOW - 31 * DAY_MS,
    },
    NOW - 31 * DAY_MS,
  );
  expect(RAW_CAPTURE_TTL_MS).toBe(30 * DAY_MS);

  await renderPrivacyScreen();

  await waitFor(() => expect(screen.getByTestId("captured-list-empty")).toBeTruthy());
  expect(screen.queryByTestId("captured-item-expired")).toBeNull();
});

// ---------------------------------------------------------------------------
// Export (rule 4)
// ---------------------------------------------------------------------------

test("export calls exportAllData", async () => {
  await renderPrivacyScreen();

  fireEvent.press(screen.getByTestId("export-everything"));

  await waitFor(() => expect(mockExportAllData).toHaveBeenCalledWith(expect.any(Number)));
});

test("an export failure surfaces an error and releases the busy spinner", async () => {
  // Coordinator finding: handleExport's original `try { ... } finally { ... }`
  // had no `catch`, so a rejection here propagated as an unhandled promise
  // rejection with nothing shown on screen — only the `finally` ever ran.
  mockExportAllData.mockRejectedValueOnce(new Error("disk full"));
  await renderPrivacyScreen();

  fireEvent.press(screen.getByTestId("export-everything"));

  await waitFor(() => expect(screen.getByTestId("privacy-export-error")).toBeTruthy());
  screen.getByText("Export failed. Please try again.");
  expect(screen.getByTestId("export-everything").props.accessibilityState.busy).toBe(false);

  // branch-review-design.md F3's sweep: this error Text carried the same raw
  // `text-sm` the reassurance banner did. Asserted directly on the testID'd
  // node — no `cssInterop` wrapper sits between this `Text` and its own
  // `className` (see this file's type-scale section header).
  const errorClasses = String(screen.getByTestId("privacy-export-error").props.className ?? "")
    .split(/\s+/)
    .filter(Boolean);
  expect(errorClasses).toContain("text-body");
  expect(errorClasses).not.toContain("text-sm");
});

// ---------------------------------------------------------------------------
// The wipe's failure paths, and WHICH ONE THIS SCREEN CAN EVEN REPORT.
// lib/security/wipe.ts splits them at the database file: a `wipeDatabase()`
// rejection propagates as itself because nothing was destroyed, every later
// rejection is re-thrown as `WipeIncompleteError` because the file is gone.
// The lock context turns that split into two states, and only ONE of them
// leaves this screen mounted:
//
//   - after the database is gone -> status "needs_onboarding", so
//     app/_layout.tsx's AppShell replaces this whole Stack with the lock gate
//     and app/lock.tsx prints the notice (app/__tests__/lock_screen.test.tsx
//     asserts that rendered notice; contexts/__tests__/lock_context.test.tsx
//     asserts the message and the status). Nothing here could be seen.
//   - before anything is erased -> status stays "unlocked", this screen stays
//     mounted, and the promise RESOLVES. That is the case below, and until the
//     screen read `errorMessage` the user got a stopped spinner and no message
//     at all: the catch never ran, because nothing ever rejected.
//
// GAP-104 also asked for the catch itself to stop saying "Your data was
// erased" about a failure that erased nothing. It is unreachable while the
// context swallows every rejection, so the two tests that exercise it say so
// in their names; they mock ONLY to force the rejection, and assert what is
// rendered.
// ---------------------------------------------------------------------------

// contexts/lock_context.tsx's WIPE_FAILED_MESSAGE, quoted verbatim. What is
// pinned here is that the screen prints the CONTEXT's sentence for the failure
// that happened; that the context produces this one is pinned in its own suite.
const WIPE_FAILED_COPY =
  "Nothing was erased — that didn't go through. Your data and your recovery words are still here, so you can try again.";

test("a wipe that stops before the database is deleted says nothing was erased, instead of stopping the spinner in silence", async () => {
  // Exactly what the real context does with a `wipeDatabase()` failure: keep
  // the status, put its own sentence in `errorMessage`, resolve.
  mockWipeAndStartOver.mockImplementationOnce(async () => {
    mockLockErrorMessage = WIPE_FAILED_COPY;
  });
  await renderPrivacyScreen();

  fireEvent.press(screen.getByTestId("wipe-everything-trigger"));
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  fireEvent.changeText(screen.getByTestId("wipe-confirm-input"), "DELETE");
  fireEvent.press(screen.getByTestId("wipe-confirm-erase"));

  await waitFor(() => expect(mockWipeAndStartOver).toHaveBeenCalledTimes(1));
  // The words the user READS, not the state behind them: setting a message
  // that never reaches the screen is the failure this whole screen is about.
  await waitFor(() =>
    expect(screen.getByTestId("privacy-wipe-error")).toHaveTextContent(WIPE_FAILED_COPY),
  );
  // And it is the CONTEXT's sentence on screen, not a fixed one this screen
  // keeps for itself — the message has to follow which failure happened.
  expect(
    screen.queryByText(
      "Your data was erased, but PeraPlano could not finish resetting. Please close and reopen the app.",
    ),
  ).toBeNull();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.getByTestId("wipe-confirm-erase").props.accessibilityState.busy).toBe(false);
});

test("nothing is printed under the Erase button before a wipe is ever attempted", async () => {
  // The gate on the context's message. `errorMessage` is a channel the whole
  // lock shares, so an unlock failure's leftovers must not appear here as a
  // verdict on a wipe the user never ran.
  mockLockErrorMessage = "Something went wrong. Try again.";

  await renderPrivacyScreen();

  expect(screen.queryByTestId("privacy-wipe-error")).toBeNull();
});

test("if the context ever rejects instead, a post-database failure still says the data was erased", async () => {
  mockWipeAndStartOver.mockRejectedValueOnce(
    new WipeIncompleteError(new Error("wipe: keystore delete failed")),
  );
  await renderPrivacyScreen();

  fireEvent.press(screen.getByTestId("wipe-everything-trigger"));
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  fireEvent.changeText(screen.getByTestId("wipe-confirm-input"), "DELETE");
  fireEvent.press(screen.getByTestId("wipe-confirm-erase"));

  await waitFor(() => expect(mockWipeAndStartOver).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByTestId("privacy-wipe-error")).toHaveTextContent(
      "Your data was erased, but PeraPlano could not finish resetting. Please close and reopen the app.",
    ),
  );
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.getByTestId("wipe-confirm-erase").props.accessibilityState.busy).toBe(false);
});

test("if the context ever rejects instead, a pre-database failure does not claim the data was erased", async () => {
  // A bare Error is what `wipeAndStartOver` propagates when `wipeDatabase()`
  // itself failed. One message for both kinds told this user their ledger was
  // gone while it was still on the phone.
  mockWipeAndStartOver.mockRejectedValueOnce(new Error("disk I/O error"));
  await renderPrivacyScreen();

  fireEvent.press(screen.getByTestId("wipe-everything-trigger"));
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  fireEvent.changeText(screen.getByTestId("wipe-confirm-input"), "DELETE");
  fireEvent.press(screen.getByTestId("wipe-confirm-erase"));

  await waitFor(() => expect(mockWipeAndStartOver).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByTestId("privacy-wipe-error")).toHaveTextContent(
      "Nothing was erased. Your data and your recovery words are still on this phone, so you can try again.",
    ),
  );
  expect(
    screen.queryByText(
      "Your data was erased, but PeraPlano could not finish resetting. Please close and reopen the app.",
    ),
  ).toBeNull();
  expect(screen.getByTestId("wipe-confirm-erase").props.accessibilityState.busy).toBe(false);
});

// ---------------------------------------------------------------------------
// Wipe (rule 5) — the double confirmation
// ---------------------------------------------------------------------------

test("wipe requires both confirmations", async () => {
  await renderPrivacyScreen();

  fireEvent.press(screen.getByTestId("wipe-everything-trigger"));
  expect(mockWipeAndStartOver).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  // Step 1 alone must not wipe anything — the typed confirmation is still owed.
  expect(mockWipeAndStartOver).not.toHaveBeenCalled();
  expect(screen.getByTestId("wipe-confirm-input")).toBeTruthy();

  // The final button stays disabled until the exact word is typed.
  fireEvent.press(screen.getByTestId("wipe-confirm-erase"));
  expect(mockWipeAndStartOver).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByTestId("wipe-confirm-input"), "DELETE");
  fireEvent.press(screen.getByTestId("wipe-confirm-erase"));

  await waitFor(() => expect(mockWipeAndStartOver).toHaveBeenCalledTimes(1));
});

// ---------------------------------------------------------------------------
// The fix itself (real-device bug): the erase runs the FULL start-over and
// nothing else. Asserting the absences is the point — a `wipeAllData()` call
// would leave the keys alive, and a `bootstrapApp()` call would run against a
// database file that no longer exists.
// ---------------------------------------------------------------------------

test("the erase runs the lock context's full start-over — key material included — and never the logical table sweep", async () => {
  await renderPrivacyScreen();

  fireEvent.press(screen.getByTestId("wipe-everything-trigger"));
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  fireEvent.changeText(screen.getByTestId("wipe-confirm-input"), "DELETE");
  fireEvent.press(screen.getByTestId("wipe-confirm-erase"));

  await waitFor(() => expect(mockWipeAndStartOver).toHaveBeenCalledTimes(1));
  expect(mockWipeAndStartOver).toHaveBeenCalledWith();

  // No bootstrap, no navigation: the DEK is gone, so bootstrapApp() could only
  // throw, and the lock context's own status change swaps the tree for the
  // lock gate. Nothing else is asserted about the destination here — that
  // belongs to the lock context's suite, not the screen's.
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.getByTestId("wipe-confirm-erase").props.accessibilityState.busy).toBe(false);
});

test("cancelling the first confirmation wipes nothing", async () => {
  await renderPrivacyScreen();

  fireEvent.press(screen.getByTestId("wipe-everything-trigger"));
  fireEvent.press(screen.getByTestId("confirm-dialog-cancel"));

  expect(screen.queryByTestId("wipe-confirm-input")).toBeNull();
  expect(mockWipeAndStartOver).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test("cancelling the second confirmation wipes nothing", async () => {
  await renderPrivacyScreen();

  fireEvent.press(screen.getByTestId("wipe-everything-trigger"));
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  fireEvent.changeText(screen.getByTestId("wipe-confirm-input"), "DELETE");
  fireEvent.press(screen.getByTestId("wipe-confirm-cancel"));

  expect(mockWipeAndStartOver).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test("a wrong word never enables the final button", async () => {
  await renderPrivacyScreen();

  fireEvent.press(screen.getByTestId("wipe-everything-trigger"));
  fireEvent.press(screen.getByTestId("confirm-dialog-confirm"));
  fireEvent.changeText(screen.getByTestId("wipe-confirm-input"), "delete");
  fireEvent.press(screen.getByTestId("wipe-confirm-erase"));

  expect(mockWipeAndStartOver).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// The wipe-step-one copy actually names real, currently-existing tables.
// data_wipe.test.ts separately proves wipeAllData() empties every one of
// them, including the junction/history tables no sentence names by hand —
// see wipe_flow.tsx's own header for that split.
// ---------------------------------------------------------------------------

test("the wipe warning names a real domain entity for every major table currently in the schema", async () => {
  const tables = await listDataTableNames(db);
  const body = WIPE_STEP_ONE_BODY.toLowerCase();

  // table name -> the keyword the copy is expected to carry. Junction/history
  // tables (wallet_matchers, income_profile_sources, loan_payments,
  // loan_adjustments, bill_payments, bill_cycles, parser_rulesets,
  // schema_migrations) are deliberately not enumerated one-by-one in
  // user-facing copy — they are sub-records of an entity already named, or
  // internal bookkeeping — see wipe_flow.tsx's header for that reasoning.
  const keywordByTable: Record<string, string> = {
    wallets: "wallet",
    transactions: "transaction",
    transfer_links: "transfer",
    categories: "categor",
    limits: "limit",
    income_profiles: "income",
    goals: "goal",
    loans: "loan",
    bills: "bill",
    recurring_patterns: "recurring",
    user_rules: "rule",
    raw_notifications: "notification",
    review_queue_items: "review",
    app_settings: "setting",
  };

  // Both steps must also warn that the key material and the recovery phrase
  // go with it — the promise the screen only started keeping once it stopped
  // calling wipeAllData(). Without this, copy could quietly drift back to
  // "erase my data" while the code performs a factory reset.
  for (const copy of [WIPE_STEP_ONE_BODY, WIPE_STEP_TWO_BODY]) {
    const lowered = copy.toLowerCase();
    expect(lowered).toContain("encryption key");
    expect(lowered).toContain("recovery phrase");
  }
  expect(WIPE_STEP_ONE_BODY.toLowerCase()).toContain("from scratch");
  expect(WIPE_STEP_TWO_BODY.toLowerCase()).toContain("from scratch");

  for (const [table, keyword] of Object.entries(keywordByTable)) {
    // Guards the guard: if a table is renamed or dropped, this fails loudly
    // rather than silently checking a keyword against a table that no longer
    // exists.
    expect(tables).toContain(table);
    expect(body).toContain(keyword);
  }
});

// ---------------------------------------------------------------------------
// Type scale (branch-review-design.md F3). The reassurance banner shipped
// with raw `text-base`/`text-sm` instead of tailwind.config.ts's eight named
// sizes; this file's own four other pre-existing headings/body texts carried
// the same off-scale classes and are widened into this same fix (F3's own
// text: "a future type-scale pass should treat this whole screen").
//
// Asserted on the `<Text>` node itself, found by its own exact copy —
// `PrivacyScreen` renders plain `react-native` `Text`/`View`, neither of
// which is registered with `cssInterop` (unlike this app's icon components
// in components/ui/button.tsx), so `className` lands directly on that node's
// own props rather than being consumed by a wrapper — the same
// `.props.className` read components/ui/__tests__/primitives.test.tsx's own
// `classListOf` helper already relies on for Card/Button/Chip.
// ---------------------------------------------------------------------------

function classesOf(text: string): string[] {
  return String(screen.getByText(text).props.className ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

test("the reassurance banner uses the type scale, not raw Tailwind sizes", async () => {
  await renderPrivacyScreen();

  // Positive assertion first — the banner really rendered — before the
  // negative "not a raw size" checks below, so this cannot pass against a
  // banner that failed to render at all.
  const heading = screen.getByText("Everything stays on this phone");
  expect(heading).toBeTruthy();

  const headingClasses = classesOf("Everything stays on this phone");
  expect(headingClasses).toContain("text-section");
  expect(headingClasses).not.toContain("text-base");

  const bodyClasses = classesOf(
    "PeraPlano reads your bank and e-wallet notifications, parses them on this device, and never sends the raw text anywhere. Nothing here is sold, shared, or used for ads.",
  );
  expect(bodyClasses).toContain("text-body");
  expect(bodyClasses).not.toContain("text-sm");
});

test("the screen's other headings were widened into the same type-scale fix", async () => {
  await renderPrivacyScreen();

  for (const text of ["Providers", "What PeraPlano captured", "Your data"]) {
    const classes = classesOf(text);
    expect(classes).toContain("text-section");
    expect(classes).not.toContain("text-base");
  }
});
