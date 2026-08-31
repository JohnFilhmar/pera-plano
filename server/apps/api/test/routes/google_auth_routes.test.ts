import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import {
  computeRequestHash,
  type InstallClaim,
  type IntegrityPayload,
} from "../../src/lib/play_integrity.js";
import type { GoogleJwks } from "../../src/lib/google_id_token.js";

const PACKAGE = "com.filldev.peraplano";
const AUDIENCE = "123.apps.googleusercontent.com";
const WINDOW_START = 1_750_000_000_000;
const WINDOW_END = 1_760_000_000_000;
const KID = "test-key-1";

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; destination: string };
};
type LinkResponse = { identity: { googleSub: string; email: string; linkedAt: number } };
type ErrorResponse = { error: { code: string; message: string } };

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const jwks: GoogleJwks = {
  keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }],
};

// The claim is fixed in the beta window; the ID token's own iat/exp are minted against the
// real clock, because the route reads Date.now() and nothing here can inject a clock into it.
const CLAIM: InstallClaim = {
  packageName: PACKAGE,
  claimSource: "package_manager",
  installBeginAt: null,
  firstInstallAt: 1_755_000_000_000,
  appVersionAtInstall: "0.1.0",
};

let licensingVerdict = "LICENSED";
let requestHashOverride: string | null = null;
let currentIdToken = "";
let currentClaim: InstallClaim = CLAIM;

// Seams, so nothing in this file parses a service-account key or opens a socket.
const app = buildApp(
  {
    googleOauthClientId: AUDIENCE,
    playPackageName: PACKAGE,
    betaWindowStartAt: WINDOW_START,
    betaWindowEndAt: WINDOW_END,
  },
  {
    fetchJwks: () => Promise.resolve(jwks),
    decodeIntegrity: (): Promise<IntegrityPayload> =>
      Promise.resolve({
        requestDetails: {
          requestPackageName: PACKAGE,
          requestHash: requestHashOverride ?? computeRequestHash(currentIdToken, currentClaim),
          timestampMillis: String(Date.now()),
        },
        appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
        accountDetails: { appLicensingVerdict: licensingVerdict },
      }),
  },
);

function makeIdToken(
  sub = "sub_1",
  email = "user@example.com",
  overrides: Record<string, unknown> = {},
): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      sub,
      email,
      email_verified: true,
      iat: nowSeconds - 60,
      exp: nowSeconds + 3600,
      ...overrides,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(createPrivateKey(privateKeyPem)).toString("base64url")}`;
}

function body(idToken: string, claim: InstallClaim = CLAIM) {
  return { idToken, integrityToken: "integrity", installClaim: claim };
}

function post(
  url: string,
  idToken: string,
  claim: InstallClaim = CLAIM,
  headers: Record<string, string> = {},
) {
  currentIdToken = idToken;
  currentClaim = claim;
  return app.inject({ method: "POST", url, payload: body(idToken, claim), headers });
}

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await resetDb(app.prisma);
  licensingVerdict = "LICENSED";
  requestHashOverride = null;
});

afterAll(async () => {
  await app.close();
});

describe("POST /v1/auth/google/verify", () => {
  it("returns exactly the OTP-verify keys and nothing about tier", async () => {
    const response = await post("/v1/auth/google/verify", makeIdToken());
    expect(response.statusCode).toBe(200);
    const payload = response.json<AuthResponse>();
    expect(Object.keys(payload).sort()).toEqual(["accessToken", "refreshToken", "user"]);
    expect(Object.keys(payload.user).sort()).toEqual(["destination", "id"]);
  });

  it("issues a token pair that the entitlements route accepts", async () => {
    const verify = await post("/v1/auth/google/verify", makeIdToken());
    const entitlements = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${verify.json<AuthResponse>().accessToken}` },
    });
    expect(entitlements.json()).toEqual({ tier: "plus", source: "beta_cohort" });
  });

  it("rejects a body missing installClaim with validation_error", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/google/verify",
      payload: { idToken: "a", integrityToken: "b" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponse>().error.code).toBe("validation_error");
  });

  it("rejects an unknown extra field", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/google/verify",
      payload: { ...body(makeIdToken()), sneaky: "value" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponse>().error.code).toBe("validation_error");
  });

  it("returns 401 invalid_google_token for a foreign audience", async () => {
    const response = await post(
      "/v1/auth/google/verify",
      makeIdToken("s", "e@example.com", { aud: "999" }),
    );
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorResponse>().error.code).toBe("invalid_google_token");
  });

  it("returns 401 google_email_unverified", async () => {
    const response = await post(
      "/v1/auth/google/verify",
      makeIdToken("s", "e@example.com", { email_verified: false }),
    );
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorResponse>().error.code).toBe("google_email_unverified");
  });

  it("returns 401 integrity_request_mismatch when the hash is bound elsewhere", async () => {
    requestHashOverride = "not-the-right-hash";
    const response = await post("/v1/auth/google/verify", makeIdToken());
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorResponse>().error.code).toBe("integrity_request_mismatch");
  });

  it("returns 403 app_not_play_licensed for a sideloaded install", async () => {
    licensingVerdict = "UNLICENSED";
    const response = await post("/v1/auth/google/verify", makeIdToken());
    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorResponse>().error.code).toBe("app_not_play_licensed");
  });

  it("returns 400 install_claim_invalid when both timestamps are null", async () => {
    const response = await post("/v1/auth/google/verify", makeIdToken(), {
      ...CLAIM,
      installBeginAt: null,
      firstInstallAt: null,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponse>().error.code).toBe("install_claim_invalid");
  });
});

describe("POST /v1/auth/google/link", () => {
  it("requires a bearer token", async () => {
    const response = await post("/v1/auth/google/link", makeIdToken());
    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorResponse>().error.code).toBe("unauthorized");
  });

  it("links a google account to the authenticated user", async () => {
    const first = await post("/v1/auth/google/verify", makeIdToken("sub_a", "a@example.com"));
    const accessToken = first.json<AuthResponse>().accessToken;
    const response = await post(
      "/v1/auth/google/link",
      makeIdToken("sub_a", "a@example.com"),
      CLAIM,
      { authorization: `Bearer ${accessToken}` },
    );
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json<LinkResponse>())).toEqual(["identity"]);
    expect(response.json<LinkResponse>().identity.googleSub).toBe("sub_a");
  });

  it("returns 409 google_identity_already_linked", async () => {
    const owner = await post("/v1/auth/google/verify", makeIdToken("sub_b", "b@example.com"));
    const other = await post("/v1/auth/google/verify", makeIdToken("sub_c", "c@example.com"));
    expect(owner.statusCode).toBe(200);

    const response = await post(
      "/v1/auth/google/link",
      makeIdToken("sub_b", "b@example.com"),
      CLAIM,
      { authorization: `Bearer ${other.json<AuthResponse>().accessToken}` },
    );
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorResponse>().error.code).toBe("google_identity_already_linked");
  });
});
