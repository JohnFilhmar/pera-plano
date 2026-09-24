// lib/privacy/__tests__/capture_guard.test.ts — the app-wide screenshot block.
//
// WHAT IS ACTUALLY AT RISK IF THIS REGRESSES. Before this, FLAG_SECURE was set
// on exactly three surfaces (the two phrase screens and the recovery unlock
// form). Every other screen -- balances, wallets, the whole transaction
// ledger, Safe-to-Spend -- was screenshotable and screen-recordable by anything
// with a capture path. The owner asked for it everywhere, 2026-09-08.
//
// The one exemption is development builds, so the on-device verification
// walkthrough and bug reports can still capture evidence. That exemption is the
// interesting case: get its polarity wrong and either the owner cannot
// screenshot their own dev build, or real users' balances become capturable.

jest.mock("expo-screen-capture", () => ({
  preventScreenCaptureAsync: jest.fn(async () => undefined),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { appVariant: "production" } } },
}));

import { preventScreenCaptureAsync } from "expo-screen-capture";
import Constants from "expo-constants";

import { applyCaptureGuard, shouldPreventCapture } from "@/lib/privacy/capture_guard";

beforeEach(() => {
  jest.clearAllMocks();
});

test("production and preview builds are guarded", () => {
  expect(shouldPreventCapture("production")).toBe(true);
  expect(shouldPreventCapture("preview")).toBe(true);
});

// The exemption, and the only one. A development build is on the owner's own
// device, and blocking capture there costs the docs/13 walkthrough its evidence.
test("development builds are exempt", () => {
  expect(shouldPreventCapture("development")).toBe(false);
});

// FAIL TOWARDS PROTECTION. A missing or unrecognised variant means something
// went wrong in the config chain, and the safe answer to "I don't know which
// build this is" is to guard it: an over-guarded dev build is an inconvenience,
// an unguarded production build leaks the user's finances to any screen
// recorder.
test("an unknown or absent variant is guarded", () => {
  expect(shouldPreventCapture(undefined)).toBe(true);
  expect(shouldPreventCapture("")).toBe(true);
  expect(shouldPreventCapture("staging")).toBe(true);
});

test("applying the guard on a production build calls through", async () => {
  await applyCaptureGuard();

  expect(preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
});

test("applying the guard on a development build calls nothing", async () => {
  (Constants as { expoConfig: unknown }).expoConfig = {
    extra: { appVariant: "development" },
  };

  await applyCaptureGuard();

  expect(preventScreenCaptureAsync).not.toHaveBeenCalled();

  (Constants as { expoConfig: unknown }).expoConfig = {
    extra: { appVariant: "production" },
  };
});

// The root layout awaits nothing and has no error path. A rejected native call
// here must not surface as an unhandled rejection on app start, and must not
// stop the rest of the layout mounting.
test("a failing native call is swallowed rather than thrown at app start", async () => {
  (preventScreenCaptureAsync as jest.Mock).mockRejectedValueOnce(new Error("no window"));

  await expect(applyCaptureGuard()).resolves.toBeUndefined();
});
