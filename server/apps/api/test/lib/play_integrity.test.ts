import { describe, it, expect } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { ApiError } from "../../src/lib/errors.js";
import {
  assertPlayLicensed,
  assertRequestBinding,
  computeRequestHash,
  createPlayIntegrityDecoder,
  type InstallClaim,
  type IntegrityPayload,
} from "../../src/lib/play_integrity.js";

const PACKAGE = "com.filldev.peraplano";
const NOW = 1_756_000_000_000;
const ID_TOKEN = "header.payload.signature";

const CLAIM: InstallClaim = {
  packageName: PACKAGE,
  claimSource: "package_manager",
  installBeginAt: null,
  firstInstallAt: 1_750_000_000_000,
  appVersionAtInstall: "0.1.0",
};

function payload(overrides: Partial<IntegrityPayload> = {}): IntegrityPayload {
  return {
    requestDetails: {
      requestPackageName: PACKAGE,
      requestHash: computeRequestHash(ID_TOKEN, CLAIM),
      timestampMillis: String(NOW - 1_000),
    },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
    accountDetails: { appLicensingVerdict: "LICENSED" },
    ...overrides,
  };
}

/** Same rationale as Task 2's copy: assert the ApiError code, never its message. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).code;
  }
  return expect.fail("expected the call to throw an ApiError, but it returned");
}

function check(p: IntegrityPayload) {
  assertRequestBinding({
    payload: p,
    idToken: ID_TOKEN,
    claim: CLAIM,
    expectedPackageName: PACKAGE,
    nowMs: NOW,
    maxSkewMs: 300_000,
  });
  assertPlayLicensed(p);
}

describe("computeRequestHash", () => {
  it("serializes the claim with alphabetical keys and no whitespace", () => {
    const canonical =
      '{"appVersionAtInstall":"0.1.0","claimSource":"package_manager","firstInstallAt":1750000000000,"installBeginAt":null,"packageName":"com.filldev.peraplano"}';
    const expected = createHash("sha256").update(`${ID_TOKEN}.${canonical}`).digest("base64url");
    expect(computeRequestHash(ID_TOKEN, CLAIM)).toBe(expected);
  });

  it("changes when any claim field changes", () => {
    const other = computeRequestHash(ID_TOKEN, { ...CLAIM, firstInstallAt: 1 });
    expect(other).not.toBe(computeRequestHash(ID_TOKEN, CLAIM));
  });

  it("matches the fixed cross-boundary vector the mobile client asserts", () => {
    expect(
      computeRequestHash("header.payload.signature", {
        packageName: "com.filldev.peraplano",
        claimSource: "package_manager",
        installBeginAt: null,
        firstInstallAt: 1_750_000_000_000,
        appVersionAtInstall: "0.1.0",
      }),
    ).toBe("93FKR_3bMXQjd9Z33gZoVd0Ltoy9pOhiqvHBHakkPNo");
  });
});

describe("assertRequestBinding and assertPlayLicensed", () => {
  it("passes a well-formed licensed payload", () => {
    expect(() => check(payload())).not.toThrow();
  });

  it("binding passes an unlicensed payload, so a pregrant can still proceed", () => {
    const p = payload();
    p.accountDetails.appLicensingVerdict = "UNLICENSED";
    expect(() =>
      assertRequestBinding({
        payload: p,
        idToken: ID_TOKEN,
        claim: CLAIM,
        expectedPackageName: PACKAGE,
        nowMs: NOW,
        maxSkewMs: 300_000,
      }),
    ).not.toThrow();
    expect(codeOf(() => assertPlayLicensed(p))).toBe("app_not_play_licensed");
  });

  it("rejects a foreign package name", () => {
    const p = payload();
    p.requestDetails.requestPackageName = "com.evil.app";
    expect(codeOf(() => check(p))).toBe("integrity_token_invalid");
  });

  it("rejects a request hash bound to a different claim", () => {
    const p = payload();
    p.requestDetails.requestHash = computeRequestHash(ID_TOKEN, { ...CLAIM, firstInstallAt: 1 });
    expect(codeOf(() => check(p))).toBe("integrity_request_mismatch");
  });

  it("rejects a missing request hash", () => {
    const p = payload();
    delete p.requestDetails.requestHash;
    expect(codeOf(() => check(p))).toBe("integrity_request_mismatch");
  });

  it("rejects a stale timestamp", () => {
    const p = payload();
    p.requestDetails.timestampMillis = String(NOW - 300_001);
    expect(codeOf(() => check(p))).toBe("integrity_stale");
  });

  it("rejects a timestamp from the future", () => {
    const p = payload();
    p.requestDetails.timestampMillis = String(NOW + 300_001);
    expect(codeOf(() => check(p))).toBe("integrity_stale");
  });

  it.each(["UNLICENSED", "UNEVALUATED", "UNKNOWN"])(
    "rejects the %s licensing verdict",
    (verdict) => {
      const p = payload();
      p.accountDetails.appLicensingVerdict = verdict;
      expect(codeOf(() => check(p))).toBe("app_not_play_licensed");
    },
  );

  it("rejects an unrecognized app version", () => {
    const p = payload();
    p.appIntegrity.appRecognitionVerdict = "UNRECOGNIZED_VERSION";
    expect(codeOf(() => check(p))).toBe("app_not_play_licensed");
  });
});

function fakeServiceAccount(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    client_email: "api@peraplano.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
}

describe("createPlayIntegrityDecoder", () => {
  it("exchanges a service-account assertion then returns the decoded payload", async () => {
    const seen: string[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      seen.push(url);
      if (url.includes("oauth2")) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "at_123" }), { status: 200 }),
        );
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer at_123");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            tokenPayloadExternal: {
              requestDetails: {
                requestPackageName: PACKAGE,
                requestHash: "h",
                timestampMillis: "1",
              },
              appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
              accountDetails: { appLicensingVerdict: "LICENSED" },
            },
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const decode = createPlayIntegrityDecoder({
      packageName: PACKAGE,
      serviceAccountJson: fakeServiceAccount(),
      fetchImpl,
    });
    const result = await decode("integrity_token_value");
    expect(result.accountDetails.appLicensingVerdict).toBe("LICENSED");
    expect(seen[1]).toContain(`${PACKAGE}:decodeIntegrityToken`);
  });

  it("raises google_upstream_unavailable when Play returns an error", async () => {
    const fetchImpl = ((url: string) =>
      Promise.resolve(
        url.includes("oauth2")
          ? new Response(JSON.stringify({ access_token: "at_123" }), { status: 200 })
          : new Response("boom", { status: 500 }),
      )) as unknown as typeof fetch;
    const decode = createPlayIntegrityDecoder({
      packageName: PACKAGE,
      serviceAccountJson: fakeServiceAccount(),
      fetchImpl,
    });
    await expect(decode("t")).rejects.toMatchObject({ code: "google_upstream_unavailable" });
  });

  // A 200 with no usable access_token used to produce the header "Bearer undefined", so the
  // caller saw a confusing Play-side error instead of the truthful, retryable upstream code.
  it.each([
    ["no access_token field", JSON.stringify({ expires_in: 3599 })],
    ["an empty access_token", JSON.stringify({ access_token: "" })],
    ["a non-string access_token", JSON.stringify({ access_token: 42 })],
    ["a body that is not JSON", "<html>"],
  ])("raises google_upstream_unavailable when the token response carries %s", async (_case, oauthBody) => {
    let decodeCalls = 0;
    const fetchImpl = ((url: string) => {
      if (url.includes("oauth2")) {
        return Promise.resolve(new Response(oauthBody, { status: 200 }));
      }
      decodeCalls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    const decode = createPlayIntegrityDecoder({
      packageName: PACKAGE,
      serviceAccountJson: fakeServiceAccount(),
      fetchImpl,
    });
    await expect(decode("t")).rejects.toMatchObject({ code: "google_upstream_unavailable" });
    // Never sent, rather than sent with a useless Authorization header.
    expect(decodeCalls).toBe(0);
  });

  // Failing fast at boot is right; failing with "Unexpected token in JSON" tells an operator
  // nothing about which secret is wrong.
  it("names the offending variable when the service-account JSON does not parse", () => {
    expect(() =>
      createPlayIntegrityDecoder({ packageName: PACKAGE, serviceAccountJson: "not json" }),
    ).toThrow("PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON");
  });

  it("names the offending variable when the service-account JSON is missing its fields", () => {
    expect(() =>
      createPlayIntegrityDecoder({
        packageName: PACKAGE,
        serviceAccountJson: JSON.stringify({ client_email: "a@b" }),
      }),
    ).toThrow("PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON");
  });
});
