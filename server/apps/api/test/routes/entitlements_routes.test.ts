import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { createUserWithToken } from "../helpers/auth.js";

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

  it("returns the stub tier for an authenticated user", async () => {
    const { accessToken } = await createUserWithToken(app);
    const res = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tier: "free", source: "stub" });
  });
});
