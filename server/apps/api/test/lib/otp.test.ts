import { describe, it, expect } from "vitest";
import { hmacSha256Hex, sha256Hex } from "../../src/lib/hashing.js";
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

describe("hmacSha256Hex", () => {
  it("matches the RFC 4231 test case 1 vector", () => {
    const key = Buffer.from("0b".repeat(20), "hex").toString("binary");
    expect(hmacSha256Hex(key, "Hi There")).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
  });

  it("changes completely when the key changes", () => {
    expect(hmacSha256Hex("key-a", "same message")).not.toBe(
      hmacSha256Hex("key-b", "same message"),
    );
  });
});

describe("hashOtpCode", () => {
  const SECRET = "server_side_otp_secret";

  it("is deterministic for the same requestId, code and secret", () => {
    expect(hashOtpCode("req-1", "123456", SECRET)).toBe(
      hashOtpCode("req-1", "123456", SECRET),
    );
  });

  it("differs across requestIds, since requestId acts as salt", () => {
    expect(hashOtpCode("req-1", "123456", SECRET)).not.toBe(
      hashOtpCode("req-2", "123456", SECRET),
    );
  });

  // The point of the key. A 6-digit code is about 20 bits of entropy, so an
  // unkeyed digest is brute-forceable from a database dump in milliseconds.
  // Without the server-side secret the stored hash must be useless.
  it("is unreproducible without the secret", () => {
    expect(hashOtpCode("req-1", "123456", SECRET)).not.toBe(
      hashOtpCode("req-1", "123456", "wrong_secret"),
    );
  });

  it("is not a plain sha256 of the salted code, which would be reversible", () => {
    expect(hashOtpCode("req-1", "123456", SECRET)).not.toBe(
      sha256Hex("req-1:123456"),
    );
  });

  it("is domain-separated, so an otp digest cannot collide with another use of the same key", () => {
    expect(hashOtpCode("req-1", "123456", SECRET)).not.toBe(
      hmacSha256Hex(SECRET, "req-1:123456"),
    );
  });

  it("is a 64-char hex digest that never contains the raw code", () => {
    const hash = hashOtpCode("req-1", "123456", SECRET);
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
