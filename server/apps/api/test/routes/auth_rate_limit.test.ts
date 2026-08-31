import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";

// A 2-request budget keeps the test fast and deterministic: no waiting out a window.
const app = buildApp({ authRateLimitMax: 2 });

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app.prisma);
});

describe("per-IP rate limiting on the auth endpoints", () => {
  it("limits POST /v1/auth/otp/request and keys the budget per IP", async () => {
    for (let i = 0; i < 2; i++) {
      const ok = await app.inject({
        method: "POST",
        url: "/v1/auth/otp/request",
        payload: { channel: "email", destination: "limited@example.com" },
        remoteAddress: "10.9.0.1",
      });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { channel: "email", destination: "limited@example.com" },
      remoteAddress: "10.9.0.1",
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string } }>().error.code).toBe(
      "rate_limited",
    );

    const otherIp = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { channel: "email", destination: "other@example.com" },
      remoteAddress: "10.9.0.99",
    });
    expect(otherIp.statusCode).toBe(200);
  });

  it("limits POST /v1/auth/otp/verify", async () => {
    const payload = { requestId: randomUUID(), code: "000000" };
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        payload,
        remoteAddress: "10.9.0.2",
      });
      expect(res.statusCode).not.toBe(429);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload,
      remoteAddress: "10.9.0.2",
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string } }>().error.code).toBe(
      "rate_limited",
    );
  });

  it("limits POST /v1/auth/token/refresh", async () => {
    const payload = { refreshToken: "not-a-real-token" };
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/token/refresh",
        payload,
        remoteAddress: "10.9.0.3",
      });
      expect(res.statusCode).not.toBe(429);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload,
      remoteAddress: "10.9.0.3",
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string } }>().error.code).toBe(
      "rate_limited",
    );
  });
});
