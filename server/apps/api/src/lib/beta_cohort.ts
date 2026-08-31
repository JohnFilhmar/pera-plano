import type { InstallClaim, IntegrityPayload } from "./play_integrity.js";

export type Tier = "free" | "plus";
export type EntitlementSource =
  | "stub"
  | "beta_cohort"
  | "manual_grant"
  | "play_billing";

/**
 * The Play-supplied timestamp wins. firstInstallAt comes from PackageManager and
 * moves with the device clock, so it is the fallback, never the preference.
 */
export function effectiveInstallAt(claim: InstallClaim): number | null {
  return claim.installBeginAt ?? claim.firstInstallAt ?? null;
}

export function qualifiesForBetaCohort(input: {
  payload: IntegrityPayload;
  claim: InstallClaim;
  expectedPackageName: string;
  windowStartAt: number;
  windowEndAt: number;
  nowMs: number;
}): boolean {
  const {
    payload,
    claim,
    expectedPackageName,
    windowStartAt,
    windowEndAt,
    nowMs,
  } = input;

  if (payload.accountDetails.appLicensingVerdict !== "LICENSED") return false;
  if (payload.appIntegrity.appRecognitionVerdict !== "PLAY_RECOGNIZED") {
    return false;
  }
  if (payload.requestDetails.requestPackageName !== expectedPackageName) {
    return false;
  }
  if (claim.packageName !== expectedPackageName) return false;

  const installedAt = effectiveInstallAt(claim);
  if (installedAt === null) return false;
  if (installedAt > nowMs) return false;
  return installedAt >= windowStartAt && installedAt <= windowEndAt;
}
