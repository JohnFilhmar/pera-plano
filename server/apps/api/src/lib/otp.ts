import { randomInt } from "node:crypto";
import { hmacSha256Hex } from "./hashing.js";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_CODE_LENGTH = 6;

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(OTP_CODE_LENGTH, "0");
}

/**
 * KEYED, not a plain digest. A 6-digit code carries about 20 bits of entropy,
 * so an unkeyed sha256 of it is recoverable from a database dump in roughly a
 * million hashes: milliseconds. That would turn read access to otp_requests
 * into the ability to authenticate as any user with a code in flight, since
 * the row stores requestId beside the hash. With the server-side key the dump
 * alone proves nothing.
 *
 * The "otp:v1:" prefix is domain separation: the same key signs access tokens,
 * and a value produced for one purpose must never be valid for another. The
 * version segment leaves room to rotate the scheme without ambiguity.
 */
export function hashOtpCode(
  requestId: string,
  code: string,
  secret: string,
): string {
  return hmacSha256Hex(secret, `otp:v1:${requestId}:${code}`);
}

export function isOtpExpired(expiresAt: number, nowMs: number): boolean {
  return nowMs >= expiresAt;
}
