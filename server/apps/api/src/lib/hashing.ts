import { createHash, createHmac } from "node:crypto";

/**
 * Unkeyed digest. Correct only for high-entropy inputs, such as the 256-bit
 * random refresh tokens, where brute force is infeasible by construction.
 * Never use it on a low-entropy secret: see hashOtpCode in ./otp.ts.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Keyed digest, for anything whose input space is small enough to enumerate.
 * The key never leaves the server, so a stolen database row cannot be attacked
 * offline the way a plain digest of the same value can.
 */
export function hmacSha256Hex(secret: string, input: string): string {
  return createHmac("sha256", secret).update(input, "utf8").digest("hex");
}
