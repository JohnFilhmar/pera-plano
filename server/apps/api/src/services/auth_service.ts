import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { OTP_TTL_MS, generateOtpCode, hashOtpCode } from "../lib/otp.js";

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
