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
 *
 * Every state check is a conditional write, never a read followed by a write.
 * A read-then-update cap is bypassable: N concurrent verifies all read the same
 * `attempts`, all pass the check, and all get a guess, which turns a bounded
 * 6-digit brute force into an unbounded one. The same race let two concurrent
 * correct verifies both see `consumedAt === null` and mint two sessions from one
 * code. Postgres evaluates each `updateMany` predicate and its write as a single
 * statement, so exactly one caller can win each claim. Do not "simplify" these
 * back into a read plus an update.
 */
export async function verifyOtp(
  prisma: PrismaClient,
  requestId: string,
  code: string,
  otpSecret: string,
  nowMs: number = Date.now(),
): Promise<VerifyOtpResult> {
  // Claims one attempt. Expiry rides in the predicate so an expired request is
  // still refused without burning an attempt, exactly as before.
  const claimed = await prisma.otpRequest.updateMany({
    where: {
      id: requestId,
      consumedAt: null,
      expiresAt: { gt: BigInt(nowMs) },
      attempts: { lt: OTP_MAX_ATTEMPTS },
    },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    // Refused. Only now read the row, and only to say why.
    const refused = await prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    // A consumed request reports as not_found: that it existed is not the
    // caller's business.
    if (!refused || refused.consumedAt !== null) return { kind: "not_found" };
    if (isOtpExpired(Number(refused.expiresAt), nowMs)) {
      return { kind: "expired" };
    }
    return { kind: "too_many_attempts" };
  }

  const request = await prisma.otpRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) return { kind: "not_found" };
  if (hashOtpCode(requestId, code, otpSecret) !== request.codeHash) {
    return { kind: "invalid_code" };
  }
  const consumed = await prisma.otpRequest.updateMany({
    where: { id: requestId, consumedAt: null },
    data: { consumedAt: BigInt(nowMs) },
  });
  // Someone else consumed it first, so this caller mints nothing.
  if (consumed.count === 0) return { kind: "not_found" };
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
