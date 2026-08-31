import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { createUserWithToken } from "../helpers/auth.js";
import { grantBetaCohort } from "../../src/services/entitlement_service.js";

const app = buildApp();

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app.prisma);
});

describe("GET /v1/entitlements", () => {
  it("rejects a request without a token — 401 unauthorized", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/entitlements" });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "unauthorized",
    );
  });

  it("rejects an invalid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: "Bearer garbage" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns free/stub for a user with no grant", async () => {
    const { accessToken } = await createUserWithToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tier: "free", source: "stub" });
    expect(await app.prisma.entitlement.count()).toBe(0);
  });

  it("returns plus/beta_cohort once the user is granted", async () => {
    const { userId, accessToken } = await createUserWithToken(app);
    await grantBetaCohort(app.prisma, userId, 1_756_000_000_000);
    const res = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tier: "plus", source: "beta_cohort" });
  });
});
