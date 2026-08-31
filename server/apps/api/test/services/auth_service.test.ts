import { describe, it, expect } from "vitest";
import { classifyRefreshToken } from "../../src/services/auth_service.js";

const NOW = 1_754_000_000_000;

describe("classifyRefreshToken", () => {
  it("classifies a live, unrevoked token as valid", () => {
    expect(
      classifyRefreshToken({ expiresAt: NOW + 1000, revokedAt: null }, NOW),
    ).toBe("valid");
  });

  it("classifies a token at/after its expiry as expired", () => {
    expect(classifyRefreshToken({ expiresAt: NOW, revokedAt: null }, NOW)).toBe(
      "expired",
    );
    expect(
      classifyRefreshToken({ expiresAt: NOW - 1, revokedAt: null }, NOW),
    ).toBe("expired");
  });

  it("classifies any revoked token as reused: reuse wins even over expiry", () => {
    expect(
      classifyRefreshToken({ expiresAt: NOW + 1000, revokedAt: NOW - 500 }, NOW),
    ).toBe("reused");
    expect(
      classifyRefreshToken(
        { expiresAt: NOW - 1000, revokedAt: NOW - 500 },
        NOW,
      ),
    ).toBe("reused");
  });
});
