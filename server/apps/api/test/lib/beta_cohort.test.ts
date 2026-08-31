import { describe, it, expect } from "vitest";
import {
  effectiveInstallAt,
  qualifiesForBetaCohort,
} from "../../src/lib/beta_cohort.js";
import type {
  InstallClaim,
  IntegrityPayload,
} from "../../src/lib/play_integrity.js";

const PACKAGE = "com.filldev.peraplano";
const WINDOW_START = 1_750_000_000_000;
const WINDOW_END = 1_760_000_000_000;
const NOW = 1_761_000_000_000;

const CLAIM: InstallClaim = {
  packageName: PACKAGE,
  claimSource: "package_manager",
  installBeginAt: null,
  firstInstallAt: 1_755_000_000_000,
  appVersionAtInstall: "0.1.0",
};

const PAYLOAD: IntegrityPayload = {
  requestDetails: {
    requestPackageName: PACKAGE,
    requestHash: "h",
    timestampMillis: String(NOW),
  },
  appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
  accountDetails: { appLicensingVerdict: "LICENSED" },
};

function qualifies(
  claim: InstallClaim = CLAIM,
  payload: IntegrityPayload = PAYLOAD,
): boolean {
  return qualifiesForBetaCohort({
    payload,
    claim,
    expectedPackageName: PACKAGE,
    windowStartAt: WINDOW_START,
    windowEndAt: WINDOW_END,
    nowMs: NOW,
  });
}

describe("effectiveInstallAt", () => {
  it("prefers the Play-supplied install begin timestamp", () => {
    expect(effectiveInstallAt({ ...CLAIM, installBeginAt: 42 })).toBe(42);
  });

  it("falls back to the device first-install time", () => {
    expect(effectiveInstallAt(CLAIM)).toBe(1_755_000_000_000);
  });

  it("returns null when the claim carries neither", () => {
    expect(effectiveInstallAt({ ...CLAIM, firstInstallAt: null })).toBeNull();
  });
});

describe("qualifiesForBetaCohort", () => {
  it("grants an in-window licensed install", () => {
    expect(qualifies()).toBe(true);
  });

  it("grants on the inclusive window boundaries", () => {
    expect(qualifies({ ...CLAIM, firstInstallAt: WINDOW_START })).toBe(true);
    expect(qualifies({ ...CLAIM, firstInstallAt: WINDOW_END })).toBe(true);
  });

  it("refuses an install before the window", () => {
    expect(qualifies({ ...CLAIM, firstInstallAt: WINDOW_START - 1 })).toBe(
      false,
    );
  });

  it("refuses an install after the window", () => {
    expect(qualifies({ ...CLAIM, firstInstallAt: WINDOW_END + 1 })).toBe(false);
  });

  it("refuses an install time in the future", () => {
    expect(
      qualifiesForBetaCohort({
        payload: PAYLOAD,
        claim: { ...CLAIM, firstInstallAt: NOW + 1 },
        expectedPackageName: PACKAGE,
        windowStartAt: WINDOW_START,
        windowEndAt: NOW + 10_000,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("refuses a claim with no install time at all", () => {
    expect(qualifies({ ...CLAIM, firstInstallAt: null })).toBe(false);
  });

  it("refuses an unlicensed account", () => {
    expect(
      qualifies(CLAIM, {
        ...PAYLOAD,
        accountDetails: { appLicensingVerdict: "UNLICENSED" },
      }),
    ).toBe(false);
  });

  it("refuses an unrecognized build", () => {
    expect(
      qualifies(CLAIM, {
        ...PAYLOAD,
        appIntegrity: { appRecognitionVerdict: "UNRECOGNIZED_VERSION" },
      }),
    ).toBe(false);
  });

  it("refuses a claim naming a different package", () => {
    expect(qualifies({ ...CLAIM, packageName: "com.evil.app" })).toBe(false);
  });
});
