// lib/onboarding/__tests__/google_link_client.test.ts — the device half of the
// Google link request (google-account-linking plan Task 8).
//
// THE CROSS-BOUNDARY TEST IS THE POINT. `computeRequestHash` is asserted
// against a FIXED literal that was computed from the canonical string in the
// plan, not by running the code under test. The server asserts the same
// constant in server/apps/api/test/lib/play_integrity.test.ts. A
// self-referential assertion would pass happily while both ends drifted
// together and every real sign-in failed with `integrity_request_mismatch`.
// If this vector ever fails, the implementation is wrong, not the vector.
import { buildInstallClaim, computeRequestHash, signInWithGoogle } from "../google_link_client";

// test_support/jest_setup.ts mocks expo-crypto project-wide with only the two
// members the crypto module needs (randomUUID, getRandomBytesAsync), so
// digestStringAsync is undefined under Jest. Suite-level mocks override the
// global one; node's crypto computes the identical SHA-256 over the identical
// UTF-8 bytes, and base64 is base64 on both runtimes.
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { BASE64: "base64" },
  digestStringAsync: (_algorithm: string, data: string, _options: unknown) =>
    Promise.resolve(require("crypto").createHash("sha256").update(data, "utf8").digest("base64")),
}));

const PACKAGE = "com.filldev.peraplano";

describe("buildInstallClaim", () => {
  it("maps stored evidence onto a package_manager claim", () => {
    expect(
      buildInstallClaim(
        {
          firstInstallAt: 1_750_000_000_000,
          installReferrer: "utm_source=google-play",
          capturedAt: 1_756_000_000_000,
          appVersionAtInstall: "0.1.0",
        },
        PACKAGE,
      ),
    ).toEqual({
      packageName: PACKAGE,
      claimSource: "package_manager",
      installBeginAt: null,
      firstInstallAt: 1_750_000_000_000,
      appVersionAtInstall: "0.1.0",
    });
  });

  it("produces an all-null claim when nothing was captured", () => {
    const claim = buildInstallClaim(null, PACKAGE);
    expect(claim.firstInstallAt).toBeNull();
    expect(claim.installBeginAt).toBeNull();
  });

  // AsyncStorage is a trust boundary: whatever getStoredInstallEvidence parsed
  // out of it is unvalidated JSON, possibly written by an older build. A shape
  // that does not validate must degrade to "no evidence", never travel.
  it("treats a stored value of the wrong shape as no evidence", () => {
    const claim = buildInstallClaim(
      { firstInstallAt: "1750000000000", appVersionAtInstall: 3 } as never,
      PACKAGE,
    );
    expect(claim).toEqual({
      packageName: PACKAGE,
      claimSource: "package_manager",
      installBeginAt: null,
      firstInstallAt: null,
      appVersionAtInstall: null,
    });
  });
});

describe("computeRequestHash", () => {
  it("matches the server's canonical serialization for a fixed vector", async () => {
    const claim = buildInstallClaim(
      {
        firstInstallAt: 1_750_000_000_000,
        installReferrer: null,
        capturedAt: 1_756_000_000_000,
        appVersionAtInstall: "0.1.0",
      },
      PACKAGE,
    );
    // Fixed vector, computed independently of both implementations from the
    // canonical string in Task 3:
    //   sha256("header.payload.signature." + canonicalClaimJson(claim)) as base64url
    // A mismatch here means the two canonical forms have diverged.
    expect(await computeRequestHash("header.payload.signature", claim)).toBe(
      "93FKR_3bMXQjd9Z33gZoVd0Ltoy9pOhiqvHBHakkPNo",
    );
  });

  it("emits base64url, never raw base64", async () => {
    const hash = await computeRequestHash("header.payload.signature", buildInstallClaim(null, PACKAGE));
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("signInWithGoogle", () => {
  const evidence = {
    firstInstallAt: 1_750_000_000_000,
    installReferrer: null,
    capturedAt: 1_756_000_000_000,
    appVersionAtInstall: "0.1.0",
  };

  it("binds the integrity token to the hash of the request it sends", async () => {
    const getIntegrityToken = jest.fn().mockResolvedValue("integrity-token");
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          accessToken: "access",
          refreshToken: "refresh",
          user: { id: "user-1", destination: "home" },
        }),
    });

    const result = await signInWithGoogle({
      baseUrl: "https://api.example.test",
      packageName: PACKAGE,
      getIdToken: () => Promise.resolve("header.payload.signature"),
      getIntegrityToken,
      getEvidence: () => Promise.resolve(evidence),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(getIntegrityToken).toHaveBeenCalledWith("93FKR_3bMXQjd9Z33gZoVd0Ltoy9pOhiqvHBHakkPNo");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.test/v1/auth/google/verify");
    expect(JSON.parse(String(init.body))).toEqual({
      idToken: "header.payload.signature",
      integrityToken: "integrity-token",
      installClaim: {
        packageName: PACKAGE,
        claimSource: "package_manager",
        installBeginAt: null,
        firstInstallAt: 1_750_000_000_000,
        appVersionAtInstall: "0.1.0",
      },
    });
    expect(result).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      user: { id: "user-1", destination: "home" },
    });
  });

  it("throws the server's error code so the caller can branch on it", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { code: "integrity_request_mismatch" } }),
    });

    await expect(
      signInWithGoogle({
        baseUrl: "https://api.example.test",
        packageName: PACKAGE,
        getIdToken: () => Promise.resolve("header.payload.signature"),
        getIntegrityToken: () => Promise.resolve("integrity-token"),
        getEvidence: () => Promise.resolve(null),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("integrity_request_mismatch");
  });

  it("falls back to a generic code when the failure body carries none", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    await expect(
      signInWithGoogle({
        baseUrl: "https://api.example.test",
        packageName: PACKAGE,
        getIdToken: () => Promise.resolve("header.payload.signature"),
        getIntegrityToken: () => Promise.resolve("integrity-token"),
        getEvidence: () => Promise.resolve(null),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("google_sign_in_failed");
  });
});
