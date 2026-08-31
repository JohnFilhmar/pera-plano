import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  generateOtpCode,
  hashOtpCode,
  isOtpExpired,
} from "../lib/otp.js";
import { REFRESH_TOKEN_TTL_MS, generateRefreshToken } from "../lib/jwt.js";
import { sha256Hex } from "../lib/hashing.js";

/**
 * Returns the plaintext code to its caller and stores only the keyed hash. The
 * route logs the code in development and never puts it in a response; tests for
 * later tasks call this directly when they need a code to verify with.
 */
export async function requestOtp(
  prisma: PrismaClient,
  destination: string,
  otpSecret: string,
  nowMs: number = Date.now(),
): Promise<{ requestId: string; code: string }> {
  const requestId = randomUUID();
  const code = generateOtpCode();
  await prisma.otpRequest.create({
    data: {
      id: requestId,
      destination,
      codeHash: hashOtpCode(requestId, code, otpSecret),
      expiresAt: BigInt(nowMs + OTP_TTL_MS),
      attempts: 0,
      createdAt: BigInt(nowMs),
    },
  });
  return { requestId, code };
}

export type VerifyOtpResult =
  | { kind: "ok"; userId: string; destination: string }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "too_many_attempts" }
  | { kind: "invalid_code" };

/**
 * The attempt cap is checked before the code is compared, so a wrong guess can
 * never reset or step past the counter, and a consumed or expired request is
 * rejected before either. `otpSecret` is the same key that produced the stored
 * hash: without it the row cannot be verified, which is the point.
 */
export async function verifyOtp(
  prisma: PrismaClient,
  requestId: string,
  code: string,
  otpSecret: string,
  nowMs: number = Date.now(),
): Promise<VerifyOtpResult> {
  const request = await prisma.otpRequest.findUnique({
    where: { id: requestId },
  });
  if (!request || request.consumedAt !== null) return { kind: "not_found" };
  if (isOtpExpired(Number(request.expiresAt), nowMs)) {
    return { kind: "expired" };
  }
  if (request.attempts >= OTP_MAX_ATTEMPTS) {
    return { kind: "too_many_attempts" };
  }
  if (hashOtpCode(requestId, code, otpSecret) !== request.codeHash) {
    await prisma.otpRequest.update({
      where: { id: requestId },
      data: { attempts: { increment: 1 } },
    });
    return { kind: "invalid_code" };
  }
  await prisma.otpRequest.update({
    where: { id: requestId },
    data: { consumedAt: BigInt(nowMs) },
  });
  const user = await prisma.user.upsert({
    where: { destination: request.destination },
    update: {},
    create: {
      id: randomUUID(),
      destination: request.destination,
      createdAt: BigInt(nowMs),
    },
  });
  return { kind: "ok", userId: user.id, destination: user.destination };
}

/**
 * Returns the plaintext opaque token; only its sha256 is stored. The digest is
 * unkeyed on purpose: the token is 256 bits of randomness, so its input space
 * cannot be enumerated the way a 6-digit OTP's can.
 */
export async function issueRefreshToken(
  prisma: PrismaClient,
  userId: string,
  familyId: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const token = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      id: randomUUID(),
      userId,
      familyId,
      tokenHash: sha256Hex(token),
      expiresAt: BigInt(nowMs + REFRESH_TOKEN_TTL_MS),
      createdAt: BigInt(nowMs),
    },
  });
  return token;
}
