import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { requestOtp } from "../../src/services/auth_service.js";

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

async function login(): Promise<{ refreshToken: string; userId: string }> {
  const { requestId, code } = await requestOtp(
    app.prisma,
    "juan@example.com",
    app.config.jwtSecret,
  );
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { requestId, code },
  });
  const body = res.json<{ refreshToken: string; user: { id: string } }>();
  return { refreshToken: body.refreshToken, userId: body.user.id };
}

describe("POST /v1/auth/token/refresh", () => {
  it("rotates a valid refresh token and returns a fresh access token", async () => {
    const { refreshToken } = await login();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ accessToken: string; refreshToken: string }>();
    expect(body.accessToken.split(".")).toHaveLength(3);
    expect(body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.refreshToken).not.toBe(refreshToken);
  });

  it("keeps the chain alive: the rotated token itself refreshes fine", async () => {
    const { refreshToken } = await login();
    const first = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/token/refresh",
        payload: { refreshToken },
      })
    ).json<{ refreshToken: string }>();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken: first.refreshToken },
    });
    expect(res.statusCode).toBe(200);
  });

  it("detects reuse of a rotated token and revokes the whole family", async () => {
    const { refreshToken, userId } = await login();
    const rotated = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/token/refresh",
        payload: { refreshToken },
      })
    ).json<{ refreshToken: string }>();

    // Attacker replays the OLD token after rotation.
    const reuse = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json<{ error: { code: string } }>().error.code).toBe(
      "token_reuse_detected",
    );

    // Every token in the family is now revoked...
    const live = await app.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
    });
    expect(live).toHaveLength(0);

    // ...so even the legitimate rotated token is dead.
    const afterRevoke = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it("rejects an unknown refresh token with 401 invalid_token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken: "definitely-not-issued" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "invalid_token",
    );
  });

  it("rejects an expired refresh token with 401 invalid_token", async () => {
    const { refreshToken, userId } = await login();
    await app.prisma.refreshToken.updateMany({
      where: { userId },
      data: { expiresAt: BigInt(Date.now() - 1) },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "invalid_token",
    );
  });

  it("rejects a missing refreshToken field with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "validation_error",
    );
  });
});
