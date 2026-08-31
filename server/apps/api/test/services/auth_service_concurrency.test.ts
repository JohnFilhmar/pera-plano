import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { OTP_MAX_ATTEMPTS } from "../../src/lib/otp.js";
import {
  requestOtp,
  verifyOtp,
  type VerifyOtpResult,
} from "../../src/services/auth_service.js";

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

function countKind(
  results: VerifyOtpResult[],
  kind: VerifyOtpResult["kind"],
): number {
  return results.filter((r) => r.kind === kind).length;
}

describe("verifyOtp under concurrency", () => {
  it("never hands out more than OTP_MAX_ATTEMPTS guesses, however parallel the guessing", async () => {
    const { requestId, code } = await requestOtp(
      app.prisma,
      "juan@example.com",
      app.config.jwtSecret,
    );
    const wrong = code === "000000" ? "000001" : "000000";
    const fired = OTP_MAX_ATTEMPTS + 5;

    const results = await Promise.all(
      Array.from({ length: fired }, () =>
        verifyOtp(app.prisma, requestId, wrong, app.config.jwtSecret),
      ),
    );

    const invalid = countKind(results, "invalid_code");
    const capped = countKind(results, "too_many_attempts");
    expect(invalid).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    expect(invalid + capped).toBe(fired);

    const row = await app.prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    expect(row?.attempts).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
  });

  it("consumes a code exactly once, however parallel the correct verifies", async () => {
    const { requestId, code } = await requestOtp(
      app.prisma,
      "maria@example.com",
      app.config.jwtSecret,
    );

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        verifyOtp(app.prisma, requestId, code, app.config.jwtSecret),
      ),
    );

    expect(countKind(results, "ok")).toBe(1);
    expect(countKind(results, "not_found")).toBe(results.length - 1);
  });
});
