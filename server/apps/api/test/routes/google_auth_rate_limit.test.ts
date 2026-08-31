import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import type { IntegrityPayload } from "../../src/lib/play_integrity.js";

// A 2-request budget keeps the test fast and deterministic: no waiting out a window.
// The seams guarantee the two accepted requests never reach Google; the ID token below is
// garbage, so verification fails locally with a 401 long before any decode would happen.
const app = buildApp(
  { googleAuthRateLimitMax: 2 },
  {
    fetchJwks: () => Promise.resolve({ keys: [] }),
    decodeIntegrity: () =>
      Promise.reject(new Error("decodeIntegrity must not be reached in this suite")),
  },
);

const PAYLOAD = {
  idToken: "not.a.token",
  integrityToken: "integrity",
  installClaim: {
    packageName: "com.filldev.peraplano",
    claimSource: "package_manager",
    installBeginAt: null,
    firstInstallAt: 1_755_000_000_000,
    appVersionAtInstall: "0.1.0",
  },
};

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

// Two unauthenticated endpoints that each cost outbound calls to Google, so they carry the
// strictest per-IP budget in the app.
describe.each(["/v1/auth/google/verify", "/v1/auth/google/link"])(
  "per-IP rate limiting on POST %s",
  (url) => {
    const remoteAddress = url.endsWith("verify") ? "10.8.0.1" : "10.8.0.2";

    it("serves the budget then answers 429 rate_limited", async () => {
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({ method: "POST", url, payload: PAYLOAD, remoteAddress });
        expect(res.statusCode).not.toBe(429);
      }
      const limited = await app.inject({
        method: "POST",
        url,
        payload: PAYLOAD,
        remoteAddress,
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.json<{ error: { code: string } }>().error.code).toBe("rate_limited");
    });

    it("keys the budget per IP", async () => {
      const otherIp = await app.inject({
        method: "POST",
        url,
        payload: PAYLOAD,
        remoteAddress: `${remoteAddress}00`,
      });
      expect(otherIp.statusCode).not.toBe(429);
    });
  },
);

// Guards the assumption the suite above rests on: an unexported decoder is never
// constructed when a seam is supplied, so no test parses a service-account key.
describe("buildApp seams", () => {
  it("never calls the integrity decoder for a request that fails ID token verification", async () => {
    let calls = 0;
    const seamed = buildApp(
      { googleAuthRateLimitMax: 10 },
      {
        fetchJwks: () => Promise.resolve({ keys: [] }),
        decodeIntegrity: (): Promise<IntegrityPayload> => {
          calls += 1;
          return Promise.reject(new Error("unreachable"));
        },
      },
    );
    await seamed.ready();
    const res = await seamed.inject({
      method: "POST",
      url: "/v1/auth/google/verify",
      payload: PAYLOAD,
      remoteAddress: "10.8.0.9",
    });
    expect(res.statusCode).toBe(401);
    expect(calls).toBe(0);
    await seamed.close();
  });
});
