// lib/onboarding/google_link_client.ts — builds and sends the Google link
// request (google-account-linking plan Task 8).
//
// Everything the server needs to decide whether this device installed during
// the beta window travels in one POST: the Google ID token that names the
// account, the install claim assembled from the evidence Task 7 captured, and
// a Play Integrity token bound to a hash of both. The hash is what stops a
// claim being lifted off one request and replayed on another.
//
// DELIBERATELY NOT HERE, each its own task once the API is reachable and real
// Google client credentials exist: obtaining the ID token through Credential
// Manager, obtaining the Play Integrity token, and storing the returned token
// pair. All three are injected, so this module is testable today and the real
// providers drop in without touching it.
import * as Crypto from "expo-crypto";
import type { InstallEvidence } from "./install_evidence";

export type InstallClaimSource = "install_referrer" | "package_manager";

export type InstallClaim = {
  packageName: string;
  claimSource: InstallClaimSource;
  installBeginAt: number | null;
  firstInstallAt: number | null;
  appVersionAtInstall: string | null;
};

export type GoogleLinkDeps = {
  baseUrl: string;
  packageName: string;
  getIdToken: () => Promise<string>;
  getIntegrityToken: (requestHash: string) => Promise<string>;
  getEvidence: () => Promise<InstallEvidence | null>;
  fetchImpl?: typeof fetch;
};

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * AsyncStorage is a trust boundary. `getStoredInstallEvidence` hands back
 * whatever JSON.parse made of the stored string — a value an older build wrote
 * in a different shape, or a half-written one — and without this check a
 * malformed record would be spread straight into a signed request and rejected
 * by the server as a mismatch rather than degrading cleanly. Anything that
 * does not validate is "no evidence", which the claim already expresses as
 * nulls.
 */
function parseStoredEvidence(value: unknown): InstallEvidence | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (!isNumberOrNull(candidate.firstInstallAt)) return null;
  if (!isStringOrNull(candidate.installReferrer)) return null;
  if (typeof candidate.capturedAt !== "number" || !Number.isFinite(candidate.capturedAt)) return null;
  if (!isStringOrNull(candidate.appVersionAtInstall)) return null;
  return {
    firstInstallAt: candidate.firstInstallAt,
    installReferrer: candidate.installReferrer,
    capturedAt: candidate.capturedAt,
    appVersionAtInstall: candidate.appVersionAtInstall,
  };
}

export function buildInstallClaim(
  evidence: InstallEvidence | null,
  packageName: string,
): InstallClaim {
  const validated = parseStoredEvidence(evidence);
  return {
    packageName,
    claimSource: "package_manager",
    installBeginAt: null,
    firstInstallAt: validated?.firstInstallAt ?? null,
    appVersionAtInstall: validated?.appVersionAtInstall ?? null,
  };
}

/**
 * MUST match server/apps/api/src/lib/play_integrity.ts canonicalClaimJson
 * exactly: five keys, alphabetical, no whitespace. The keys are written out as
 * a literal in that order on purpose — a spread would carry insertion order in
 * from wherever the claim was built. Changing one side without the other
 * rejects every request with integrity_request_mismatch, which is why both
 * ends assert the same fixed vector in their tests.
 */
function canonicalClaimJson(claim: InstallClaim): string {
  return JSON.stringify({
    appVersionAtInstall: claim.appVersionAtInstall,
    claimSource: claim.claimSource,
    firstInstallAt: claim.firstInstallAt,
    installBeginAt: claim.installBeginAt,
    packageName: claim.packageName,
  });
}

export async function computeRequestHash(idToken: string, claim: InstallClaim): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${idToken}.${canonicalClaimJson(claim)}`,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signInWithGoogle(
  deps: GoogleLinkDeps,
): Promise<{
  accessToken: string;
  refreshToken: string;
  user: { id: string; destination: string };
}> {
  const doFetch = deps.fetchImpl ?? fetch;
  const idToken = await deps.getIdToken();
  const claim = buildInstallClaim(await deps.getEvidence(), deps.packageName);
  const integrityToken = await deps.getIntegrityToken(await computeRequestHash(idToken, claim));

  const response = await doFetch(`${deps.baseUrl}/v1/auth/google/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken, integrityToken, installClaim: claim }),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { code?: string } };
    throw new Error(body.error?.code ?? "google_sign_in_failed");
  }
  return response.json() as Promise<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; destination: string };
  }>;
}
