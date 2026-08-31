import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { OTP_TTL_MS, OTP_MAX_ATTEMPTS } from "../../src/lib/otp.js";
import { requestOtp } from "../../src/services/auth_service.js";
import { sha256Hex } from "../../src/lib/hashing.js";

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

describe("POST /v1/auth/otp/request", () => {
  it("returns a requestId and stores a hashed, expiring OTP", async () => {
    const before = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { channel: "email", destination: "juan@example.com" },
    });
    expect(res.statusCode).toBe(200);
    const { requestId } = res.json<{ requestId: string }>();
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const row = await app.prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    expect(row).not.toBeNull();
    expect(row?.destination).toBe("juan@example.com");
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/); // hashed — plaintext never stored
    expect(row?.attempts).toBe(0);
    expect(row?.consumedAt).toBeNull();
    expect(Number(row?.expiresAt)).toBeGreaterThanOrEqual(before + OTP_TTL_MS);
    expect(Number(row?.expiresAt)).toBeLessThanOrEqual(Date.now() + OTP_TTL_MS);
  });

  it("rejects a non-email channel with a validation_error envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { channel: "sms", destination: "juan@example.com" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "validation_error",
    );
  });

  it("rejects a malformed destination", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { channel: "email", destination: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "validation_error",
    );
  });

  it("rejects a missing body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/auth/otp/verify", () => {
  // Not `async`: it awaits nothing itself, and require-await is an error here.
  // The route never exposes the code; tests obtain it from the service directly.
  function createOtp(
    destination = "juan@example.com",
  ): Promise<{ requestId: string; code: string }> {
    return requestOtp(app.prisma, destination, app.config.jwtSecret);
  }

  it("verifies a correct code, creates the user, and returns both tokens", async () => {
    const { requestId, code } = await createOtp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      accessToken: string;
      refreshToken: string;
      user: { id: string; destination: string };
    }>();
    expect(body.accessToken.split(".")).toHaveLength(3);
    expect(body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.user.destination).toBe("juan@example.com");
    // the code must never travel back to the caller
    expect(JSON.stringify(body)).not.toContain(code);
    const user = await app.prisma.user.findUnique({
      where: { destination: "juan@example.com" },
    });
    expect(user?.id).toBe(body.user.id);
    const stored = await app.prisma.refreshToken.findMany({
      where: { userId: body.user.id },
    });
    expect(stored).toHaveLength(1);
    // stored hashed, never plaintext
    expect(stored[0]?.tokenHash).toBe(sha256Hex(body.refreshToken));
    expect(stored[0]?.revokedAt).toBeNull();
  });

  it("reuses the existing user on a second login for the same destination", async () => {
    const first = await createOtp();
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId: first.requestId, code: first.code },
    });
    const second = await createOtp();
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId: second.requestId, code: second.code },
    });
    const id1 = res1.json<{ user: { id: string } }>().user.id;
    const id2 = res2.json<{ user: { id: string } }>().user.id;
    expect(id1).toBe(id2);
  });

  it("rejects a wrong code with 401 invalid_code and increments attempts", async () => {
    const { requestId, code } = await createOtp();
    const wrong = code === "000000" ? "000001" : "000000";
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code: wrong },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "invalid_code",
    );
    const row = await app.prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    expect(row?.attempts).toBe(1);
  });

  it("locks out after OTP_MAX_ATTEMPTS wrong codes, even with the right code", async () => {
    const { requestId, code } = await createOtp();
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        payload: { requestId, code: wrong },
      });
      expect(res.statusCode).toBe(401);
    }
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "too_many_attempts",
    );
  });

  it("rejects an expired code with 401 otp_expired", async () => {
    const { requestId, code } = await createOtp();
    await app.prisma.otpRequest.update({
      where: { id: requestId },
      data: { expiresAt: BigInt(Date.now() - 1) },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "otp_expired",
    );
  });

  it("rejects an unknown requestId with 404 otp_not_found", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        requestId: "00000000-0000-4000-8000-000000000000",
        code: "123456",
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "otp_not_found",
    );
  });

  it("rejects a consumed requestId, codes are single-use", async () => {
    const { requestId, code } = await createOtp();
    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a malformed code shape with 400 (schema gate, no attempt burned)", async () => {
    const { requestId } = await createOtp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { requestId, code: "12ab56" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "validation_error",
    );
    const row = await app.prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    expect(row?.attempts).toBe(0);
  });
});
