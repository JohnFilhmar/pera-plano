import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
} from "../../src/lib/jwt.js";

const SECRET = "unit_test_secret";
const NOW = 1_754_000_000_000;

describe("signAccessToken / verifyAccessToken", () => {
  it("round-trips a userId", () => {
    const token = signAccessToken("user-1", SECRET, NOW);
    const claims = verifyAccessToken(token, SECRET, NOW + 1000);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe("user-1");
  });

  it("sets exp exactly 15 minutes after issue", () => {
    const token = signAccessToken("user-1", SECRET, NOW);
    const claims = verifyAccessToken(token, SECRET, NOW);
    expect(ACCESS_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    expect(claims?.exp).toBe(Math.floor((NOW + ACCESS_TOKEN_TTL_MS) / 1000));
    expect(claims?.iat).toBe(Math.floor(NOW / 1000));
  });

  it("rejects a token at and after expiry", () => {
    const token = signAccessToken("user-1", SECRET, NOW);
    expect(verifyAccessToken(token, SECRET, NOW + ACCESS_TOKEN_TTL_MS)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signAccessToken("user-1", "other_secret", NOW);
    expect(verifyAccessToken(token, SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = signAccessToken("user-1", SECRET, NOW);
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: "attacker", iat: 0, exp: 99_999_999_999 }),
    ).toString("base64url");
    expect(
      verifyAccessToken(`${header}.${forgedPayload}.${signature}`, SECRET, NOW),
    ).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    expect(verifyAccessToken("not.a.jwt", SECRET, NOW)).toBeNull();
    expect(verifyAccessToken("nope", SECRET, NOW)).toBeNull();
    expect(verifyAccessToken("", SECRET, NOW)).toBeNull();
  });

  // A correctly HMAC-signed token that claims a different algorithm. The
  // signature alone cannot catch this, because the header is part of the signed
  // input and we signed it ourselves. Only an explicit alg check rejects it.
  // Today nothing else would accept such a token; the guard exists so that the
  // day a second algorithm is supported, this file is not the hole.
  it("rejects a validly signed token whose header lies about the algorithm", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
      .toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "user-1",
        iat: Math.floor(NOW / 1000),
        exp: Math.floor(NOW / 1000) + 900,
      }),
    ).toString("base64url");
    const signature = createHmac("sha256", SECRET)
      .update(`${header}.${payload}`)
      .digest("base64url");

    expect(verifyAccessToken(`${header}.${payload}.${signature}`, SECRET, NOW)).toBeNull();
  });
});

describe("generateRefreshToken", () => {
  it("returns unique, url-safe, 43-char opaque tokens", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("pins the refresh TTL to 30 days", () => {
    expect(REFRESH_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
