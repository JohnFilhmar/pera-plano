import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { OTP_MAX_ATTEMPTS } from "../../src/lib/otp.js";
import {
  requestOtp,
  verifyOtp,
  issueRefreshToken,
  rotateRefreshToken,
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

    // One session, and nobody else gets one. Which refusal the losers see is a
    // timing detail, not an invariant: a caller refused by the attempt claim
    // reads `too_many_attempts`, one refused by the consume claim reads
    // `not_found`. Pinning it to `not_found` made this test fail about half the
    // time.
    expect(countKind(results, "ok")).toBe(1);
    expect(
      countKind(results, "not_found") + countKind(results, "too_many_attempts"),
    ).toBe(results.length - 1);
  });
});

describe("rotateRefreshToken under concurrency", () => {
  it("rotates one token exactly once, however parallel the presentations", async () => {
    const userId = randomUUID();
    await app.prisma.user.create({
      data: {
        id: userId,
        destination: "concurrent@example.com",
        createdAt: BigInt(Date.now()),
      },
    });
    const familyId = randomUUID();
    const token = await issueRefreshToken(app.prisma, userId, familyId);

    const results = await Promise.all(
      Array.from({ length: 2 }, () => rotateRefreshToken(app.prisma, token)),
    );

    // Exactly one caller may claim the presented token. A read-then-update
    // rotation lets both claim it, both mint a successor, and reuse detection
    // silently stops meaning anything.
    const rotated = results.filter((r) => r.kind === "ok");
    expect(rotated).toHaveLength(1);
    // The loser is not a legitimate rotation: the token it presented was
    // already revoked by the winner, which is exactly the replay signature.
    expect(results.filter((r) => r.kind === "reuse_detected")).toHaveLength(1);

    // One presented token plus one successor. A third row would mean two
    // successors were minted from a single token.
    const rows = await app.prisma.refreshToken.findMany({ where: { userId } });
    expect(rows).toHaveLength(2);
  });
});
