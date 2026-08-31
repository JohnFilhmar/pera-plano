// lib/onboarding/install_evidence.ts — the install facts this device is the
// ONLY holder of (google-account-linking plan Task 7; design §3 fact 3).
//
// Google Play Console does not expose a per-account first-install date and the
// Play Integrity payload carries no install date either, so
// `PackageInfo.firstInstallTime`, read here through
// `expo-application`, is the single piece of evidence that anyone installed
// during the beta window — and an uninstall destroys it. That is why this runs
// at bootstrap, on every launch, rather than at the point of sign-in: by the
// time a user has a reason to link a Google account, the fact may be gone.
//
// `getInstallReferrerAsync` returns the referrer STRING only; the Play-supplied
// install-begin timestamp is not reachable through expo-application, so claims
// built from this evidence are `claimSource: "package_manager"` with a null
// `installBeginAt`. A native module could supply the Play timestamp later and
// upgrade them.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";

const STORAGE_KEY = "install_evidence_v1";

export type InstallEvidence = {
  firstInstallAt: number | null;
  installReferrer: string | null;
  capturedAt: number;
  appVersionAtInstall: string | null;
};

/**
 * Both readers swallow. A native read that fails stores null and the launch
 * continues: blocking startup, or crashing it, to record a marketing cohort
 * would be a far worse trade than a claim this app already treats as nullable
 * on both sides of the wire.
 */
async function readNumberOrNull(read: () => Promise<Date>): Promise<number | null> {
  try {
    return (await read()).getTime();
  } catch {
    return null;
  }
}

async function readStringOrNull(read: () => Promise<string>): Promise<string | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export async function getStoredInstallEvidence(): Promise<InstallEvidence | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as InstallEvidence);
}

/**
 * WRITE-ONCE, and that is the whole point of the function. A reinstall makes
 * `PackageInfo.firstInstallTime` report the LATER date, so a second capture
 * that overwrote would quietly replace a genuine in-window install with an
 * out-of-window one and destroy the evidence this module exists to keep. An
 * existing record is returned untouched, native calls not even attempted.
 */
export async function captureInstallEvidence(nowMs: number): Promise<InstallEvidence> {
  const existing = await getStoredInstallEvidence();
  if (existing !== null) return existing;

  const evidence: InstallEvidence = {
    firstInstallAt: await readNumberOrNull(Application.getInstallationTimeAsync),
    installReferrer: await readStringOrNull(Application.getInstallReferrerAsync),
    capturedAt: nowMs,
    appVersionAtInstall: Application.nativeApplicationVersion,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(evidence));
  return evidence;
}
