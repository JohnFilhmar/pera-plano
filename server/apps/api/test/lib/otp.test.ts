import { describe, it, expect } from "vitest";
import { sha256Hex } from "../../src/lib/hashing.js";
import {
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_CODE_LENGTH,
  generateOtpCode,
  hashOtpCode,
  isOtpExpired,
} from "../../src/lib/otp.js";

describe("sha256Hex", () => {
  it("hashes deterministically to the known sha256 of 'abc'", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("generateOtpCode", () => {
  it("always returns a 6-digit numeric string", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe("hashOtpCode", () => {
  it("is deterministic for the same requestId and code", () => {
    expect(hashOtpCode("req-1", "123456")).toBe(hashOtpCode("req-1", "123456"));
  });

  it("differs across requestIds, since requestId acts as salt", () => {
    expect(hashOtpCode("req-1", "123456")).not.toBe(
      hashOtpCode("req-2", "123456"),
    );
  });

  it("is a 64-char hex digest that never contains the raw code", () => {
    const hash = hashOtpCode("req-1", "123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("123456");
  });
});

describe("isOtpExpired", () => {
  it("is not expired strictly before the deadline", () => {
    expect(isOtpExpired(1_000_000, 999_999)).toBe(false);
  });

  it("is expired at and after the deadline", () => {
    expect(isOtpExpired(1_000_000, 1_000_000)).toBe(true);
    expect(isOtpExpired(1_000_000, 1_000_001)).toBe(true);
  });
});

describe("constants", () => {
  it("pins TTL to 10 minutes, attempts to 5, length to 6", () => {
    expect(OTP_TTL_MS).toBe(600_000);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_CODE_LENGTH).toBe(6);
  });
});
