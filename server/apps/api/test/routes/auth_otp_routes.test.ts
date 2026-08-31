import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { OTP_TTL_MS } from "../../src/lib/otp.js";

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
