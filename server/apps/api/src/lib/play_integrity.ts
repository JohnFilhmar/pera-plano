import { createHash, createPrivateKey, createSign } from "node:crypto";
import { ApiError } from "./errors.js";

export type InstallClaimSource = "install_referrer" | "package_manager";

export type InstallClaim = {
  packageName: string;
  claimSource: InstallClaimSource;
  installBeginAt: number | null;
  firstInstallAt: number | null;
  appVersionAtInstall: string | null;
};

export type IntegrityPayload = {
  requestDetails: { requestPackageName: string; requestHash?: string; timestampMillis: string };
  appIntegrity: { appRecognitionVerdict: string };
  accountDetails: { appLicensingVerdict: string };
};

export type PlayIntegrityDecoder = (integrityToken: string) => Promise<IntegrityPayload>;

export type AssertIntegrityInput = {
  payload: IntegrityPayload;
  idToken: string;
  claim: InstallClaim;
  expectedPackageName: string;
  nowMs: number;
  maxSkewMs: number;
};

/**
 * The canonical claim serialization. Keys are listed alphabetically and
 * explicitly; the mobile client builds the identical string. Adding a field to
 * InstallClaim without adding it here, in both places, silently breaks every
 * request with integrity_request_mismatch.
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

export function computeRequestHash(idToken: string, claim: InstallClaim): string {
  return createHash("sha256").update(`${idToken}.${canonicalClaimJson(claim)}`).digest("base64url");
}

/**
 * Binding checks: is this token about our app, bound to this exact request, and
 * fresh. ALWAYS enforced, for every caller, pregrant or not. A pregrant excuses
 * a missing Play licence; it never excuses an unbound or replayed token.
 */
export function assertRequestBinding({
  payload,
  idToken,
  claim,
  expectedPackageName,
  nowMs,
  maxSkewMs,
}: AssertIntegrityInput): void {
  if (payload.requestDetails.requestPackageName !== expectedPackageName) {
    throw new ApiError(401, "integrity_token_invalid", "Integrity token is for a different app");
  }

  const expectedHash = computeRequestHash(idToken, claim);
  if (payload.requestDetails.requestHash !== expectedHash) {
    throw new ApiError(
      401,
      "integrity_request_mismatch",
      "Integrity token is not bound to this request",
    );
  }

  const timestampMs = Number(payload.requestDetails.timestampMillis);
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > maxSkewMs) {
    throw new ApiError(401, "integrity_stale", "Integrity token is outside the freshness window");
  }
}

/**
 * Licensing check, kept separate because it is the ONE check a pregranted
 * pre-Play tester is allowed to fail (design section 7.1). Callers that skip it
 * must have found an unclaimed pregrant for the verified email first.
 */
export function assertPlayLicensed(payload: IntegrityPayload): void {
  if (payload.appIntegrity.appRecognitionVerdict !== "PLAY_RECOGNIZED") {
    throw new ApiError(
      403,
      "app_not_play_licensed",
      "This app build is not recognized by Google Play",
    );
  }

  if (payload.accountDetails.appLicensingVerdict !== "LICENSED") {
    throw new ApiError(
      403,
      "app_not_play_licensed",
      "This Google account did not get the app from Google Play",
    );
  }
}

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const INTEGRITY_SCOPE = "https://www.googleapis.com/auth/playintegrity";

function unavailable(message: string): ApiError {
  return new ApiError(503, "google_upstream_unavailable", message);
}

/** Mints the RS256 assertion Google exchanges for an access token. No JWT library. */
function signServiceAccountAssertion(
  clientEmail: string,
  privateKeyPem: string,
  nowSeconds: number,
): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: clientEmail,
      scope: INTEGRITY_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(createPrivateKey(privateKeyPem)).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

export function createPlayIntegrityDecoder(options: {
  packageName: string;
  serviceAccountJson: string;
  fetchImpl?: typeof fetch;
}): PlayIntegrityDecoder {
  const doFetch = options.fetchImpl ?? fetch;
  const account = JSON.parse(options.serviceAccountJson) as {
    client_email: string;
    private_key: string;
  };

  return async (integrityToken: string) => {
    const assertion = signServiceAccountAssertion(
      account.client_email,
      account.private_key,
      Math.floor(Date.now() / 1000),
    );

    let tokenResponse: Response;
    try {
      tokenResponse = await doFetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
      });
    } catch {
      throw unavailable("Could not reach Google's token endpoint");
    }
    if (!tokenResponse.ok) throw unavailable("Google refused the service-account assertion");
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

    const url = `https://playintegrity.googleapis.com/v1/${options.packageName}:decodeIntegrityToken`;
    let decodeResponse: Response;
    try {
      decodeResponse = await doFetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ integrity_token: integrityToken }),
      });
    } catch {
      throw unavailable("Could not reach the Play Integrity service");
    }
    if (!decodeResponse.ok) throw unavailable("Play Integrity refused to decode the token");

    const body = (await decodeResponse.json()) as { tokenPayloadExternal?: IntegrityPayload };
    if (!body.tokenPayloadExternal) {
      throw new ApiError(401, "integrity_token_invalid", "Play Integrity returned no payload");
    }
    return body.tokenPayloadExternal;
  };
}
