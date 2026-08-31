import { randomInt } from "node:crypto";
import { sha256Hex } from "./hashing.js";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_CODE_LENGTH = 6;

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(OTP_CODE_LENGTH, "0");
}

export function hashOtpCode(requestId: string, code: string): string {
  return sha256Hex(`${requestId}:${code}`);
}

export function isOtpExpired(expiresAt: number, nowMs: number): boolean {
  return nowMs >= expiresAt;
}
