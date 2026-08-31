import { describe, it, expect, beforeAll } from "vitest";
import { createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { ApiError } from "../../src/lib/errors.js";
import {
  createGoogleJwksFetcher,
  verifyGoogleIdToken,
  type GoogleJwks,
} from "../../src/lib/google_id_token.js";

const AUDIENCE = "123.apps.googleusercontent.com";
const NOW = 1_756_000_000_000;
const KID = "test-key-1";

let jwks: GoogleJwks;
let privateKeyPem: string;

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwk = publicKey.export({ format: "jwk" });
  jwks = { keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] };
});

function b64url(value: object | string): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(raw).toString("base64url");
}

function makeToken(
  overrides: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): string {
  const encodedHeader = b64url({ alg: "RS256", typ: "JWT", kid: KID, ...header });
  const encodedPayload = b64url({
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    sub: "1234567890",
    email: "Tester@Example.com",
    email_verified: true,
    iat: Math.floor(NOW / 1000) - 60,
    exp: Math.floor(NOW / 1000) + 3600,
    ...overrides,
  });
  const signer = createSign("RSA-SHA256");
  signer.update(`${encodedHeader}.${encodedPayload}`);
  const signature = signer.sign(createPrivateKey(privateKeyPem)).toString("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verify(token: string) {
  return verifyGoogleIdToken({ idToken: token, jwks, expectedAudience: AUDIENCE, nowMs: NOW });
}

/**
 * ApiError.message is the human-facing sentence; the machine-readable value is
 * .code. `expect(fn).toThrow("invalid_google_token")` matches the MESSAGE and
 * would pass only by accident, so assertions go through here instead.
 */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).code;
  }
  return expect.fail("expected the call to throw an ApiError, but it returned");
}

describe("verifyGoogleIdToken", () => {
  it("returns the subject and a lowercased email for a valid token", () => {
    expect(verify(makeToken())).toEqual({ googleSub: "1234567890", email: "tester@example.com" });
  });

  it("accepts the bare accounts.google.com issuer", () => {
    expect(verify(makeToken({ iss: "accounts.google.com" })).googleSub).toBe("1234567890");
  });

  it("rejects a malformed token", () => {
    expect(codeOf(() => verify("not.a.jwt"))).toBe("invalid_google_token");
  });

  it("rejects an unknown kid", () => {
    expect(codeOf(() => verify(makeToken({}, { kid: "other" })))).toBe("invalid_google_token");
  });

  it("rejects a non-RS256 algorithm", () => {
    expect(codeOf(() => verify(makeToken({}, { alg: "none" })))).toBe("invalid_google_token");
  });

  it("rejects a tampered payload", () => {
    const [header, , signature] = makeToken().split(".") as [string, string, string];
    const forged = b64url({ iss: "https://accounts.google.com", aud: AUDIENCE, sub: "evil" });
    expect(codeOf(() => verify(`${header}.${forged}.${signature}`))).toBe("invalid_google_token");
  });

  it("rejects a foreign issuer", () => {
    expect(codeOf(() => verify(makeToken({ iss: "https://evil.example" })))).toBe(
      "invalid_google_token",
    );
  });

  it("rejects a foreign audience", () => {
    expect(codeOf(() => verify(makeToken({ aud: "999.apps.googleusercontent.com" })))).toBe(
      "invalid_google_token",
    );
  });

  it("rejects an expired token", () => {
    expect(codeOf(() => verify(makeToken({ exp: Math.floor(NOW / 1000) - 1 })))).toBe(
      "invalid_google_token",
    );
  });

  it("rejects a token issued beyond the skew window", () => {
    expect(codeOf(() => verify(makeToken({ iat: Math.floor(NOW / 1000) + 3600 })))).toBe(
      "invalid_google_token",
    );
  });

  it("rejects an unverified email with its own code", () => {
    expect(codeOf(() => verify(makeToken({ email_verified: false })))).toBe(
      "google_email_unverified",
    );
  });

  it("rejects a token with no email", () => {
    expect(codeOf(() => verify(makeToken({ email: undefined })))).toBe("invalid_google_token");
  });
});

describe("createGoogleJwksFetcher", () => {
  it("fetches once and serves the cached key set until the ttl expires", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(new Response(JSON.stringify({ keys: [] }), { status: 200 }));
    };
    const fetcher = createGoogleJwksFetcher({
      url: "https://example.test/certs",
      ttlMs: 60_000,
      fetchImpl,
    });
    await fetcher();
    await fetcher();
    expect(calls).toBe(1);
  });

  it("raises google_upstream_unavailable on a non-200", async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response("nope", { status: 500 }));
    const fetcher = createGoogleJwksFetcher({ url: "https://example.test/certs", fetchImpl });
    await expect(fetcher()).rejects.toMatchObject({ code: "google_upstream_unavailable" });
  });
});
