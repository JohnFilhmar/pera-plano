import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";
import { ApiError } from "./errors.js";

export type GoogleJwks = { keys: JsonWebKey[] };
export type JwksFetcher = () => Promise<GoogleJwks>;
export type GoogleIdentityClaims = { googleSub: string; email: string };

export type VerifyGoogleIdTokenInput = {
  idToken: string;
  jwks: GoogleJwks;
  expectedAudience: string;
  nowMs: number;
  maxSkewMs?: number;
};

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const DEFAULT_MAX_SKEW_MS = 300_000;

function invalid(message: string): ApiError {
  return new ApiError(401, "invalid_google_token", message);
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw invalid("ID token segment is not valid JSON");
  }
}

export function verifyGoogleIdToken({
  idToken,
  jwks,
  expectedAudience,
  nowMs,
  maxSkewMs = DEFAULT_MAX_SKEW_MS,
}: VerifyGoogleIdTokenInput): GoogleIdentityClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw invalid("ID token is not a three-part JWT");
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  const header = decodeSegment(encodedHeader);
  if (header.alg !== "RS256") throw invalid("ID token algorithm is not RS256");
  const kid = header.kid;
  if (typeof kid !== "string") throw invalid("ID token has no key id");

  const jwk = jwks.keys.find((key) => key.kid === kid);
  if (!jwk) throw invalid("No Google signing key matches the token key id");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  const signatureValid = verifier.verify(
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!signatureValid) throw invalid("ID token signature does not verify");

  const payload = decodeSegment(encodedPayload);

  if (typeof payload.iss !== "string" || !GOOGLE_ISSUERS.includes(payload.iss)) {
    throw invalid("ID token issuer is not Google");
  }
  if (payload.aud !== expectedAudience) throw invalid("ID token audience is not this app");
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= nowMs) {
    throw invalid("ID token has expired");
  }
  if (typeof payload.iat !== "number" || payload.iat * 1000 > nowMs + maxSkewMs) {
    throw invalid("ID token was issued in the future");
  }
  if (payload.email_verified !== true) {
    throw new ApiError(
      401,
      "google_email_unverified",
      "This Google account has no verified email address",
    );
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw invalid("ID token has no subject");
  }
  if (typeof payload.email !== "string" || payload.email.length === 0) {
    throw invalid("ID token has no email");
  }

  return { googleSub: payload.sub, email: payload.email.toLowerCase() };
}

export function createGoogleJwksFetcher(options: {
  url: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
}): JwksFetcher {
  const ttlMs = options.ttlMs ?? 3_600_000;
  const doFetch = options.fetchImpl ?? fetch;
  let cached: { jwks: GoogleJwks; fetchedAtMs: number } | null = null;

  return async () => {
    const nowMs = Date.now();
    if (cached && nowMs - cached.fetchedAtMs < ttlMs) return cached.jwks;
    let response: Response;
    try {
      response = await doFetch(options.url);
    } catch {
      throw new ApiError(503, "google_upstream_unavailable", "Could not reach Google's key service");
    }
    if (!response.ok) {
      throw new ApiError(
        503,
        "google_upstream_unavailable",
        "Google's key service returned an error",
      );
    }
    const jwks = (await response.json()) as GoogleJwks;
    cached = { jwks, fetchedAtMs: nowMs };
    return jwks;
  };
}
