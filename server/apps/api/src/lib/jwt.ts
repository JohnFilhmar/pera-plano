import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AccessTokenClaims = { sub: string; iat: number; exp: number };

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signAccessToken(
  userId: string,
  secret: string,
  nowMs: number = Date.now(),
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const iat = Math.floor(nowMs / 1000);
  const exp = Math.floor((nowMs + ACCESS_TOKEN_TTL_MS) / 1000);
  const payload = base64UrlEncode(JSON.stringify({ sub: userId, iat, exp }));
  const signature = hmacSign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

export function verifyAccessToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): AccessTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];

  // HS256 is the only algorithm this server issues or accepts. The signature
  // check alone already defeats a forged header, since the header is part of
  // the signed input, so this guard buys nothing today. It exists so that
  // adding a second algorithm later cannot silently turn this function into an
  // algorithm-confusion hole, which is the classic way JWT verifiers fail.
  try {
    const decodedHeader: unknown = JSON.parse(
      Buffer.from(header, "base64url").toString("utf8"),
    );
    if (
      typeof decodedHeader !== "object" ||
      decodedHeader === null ||
      (decodedHeader as { alg?: unknown }).alg !== "HS256"
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const expected = hmacSign(`${header}.${payload}`, secret);
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    signatureBuf.length !== expectedBuf.length ||
    !timingSafeEqual(signatureBuf, expectedBuf)
  ) {
    return null;
  }
  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as AccessTokenClaims;
  } catch {
    return null;
  }
  if (typeof claims.sub !== "string" || typeof claims.exp !== "number") {
    return null;
  }
  if (Math.floor(nowMs / 1000) >= claims.exp) return null;
  return claims;
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}
