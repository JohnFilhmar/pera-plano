# Google Account Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user sign in with their Google account, prove through Play Integrity that the account acquired the app from Google Play, and grant permanent Plus to anyone whose device-attested install falls inside the beta window.

**Architecture:** Two unauthenticated-entry routes sit over one service that verifies a Google ID token and a Play Integrity token, upserts the user and identity, records an install attestation, resolves an entitlement, and issues the same token pair the OTP path already issues. Both Google dependencies are behind injected ports, so no test touches the network. Tier is decided in exactly one file and is never returned from an auth route.

**Tech Stack:** Fastify 5, Prisma 6, PostgreSQL 16, vitest 4, Node `>=22`, TypeScript strict NodeNext ESM. All Google token verification uses `node:crypto` directly. No JWT library, no Firebase, no Google SDK.

**Spec:** [../specs/2026-08-31-google-account-linking-design.md](../specs/2026-08-31-google-account-linking-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **This plan starts after `2026-08-02-server-functional-core.md` Tasks 1 through 10.** Those build the scaffold, schema, `buildApp()`, Prisma plugin, hashing, OTP, JWT, both OTP routes, refresh rotation, and the auth plugin. Nothing here can be tested without them.
- **Paths.** All server paths are under `server/apps/api/`. Never write to `server/` root: `server/package.json`, `server/tsconfig.base.json`, `server/vitest.config.ts`, `server/eslint.config.mjs` belong to the shipped `@peraplano/web`.
- **Naming:** snake_case for all file and directory names and all database identifiers. TypeScript symbols keep TS idioms: `camelCase` values and functions, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants.
- **Time:** epoch milliseconds as `number` in code, `BIGINT` in Postgres. Prisma exposes `BIGINT` as JS `bigint`: wrap with `BigInt(...)` on write, convert with `Number(...)` before any JSON response. A raw `bigint` reaching `JSON.stringify` throws.
- **IDs:** UUIDv4 from `crypto.randomUUID()`, generated server-side.
- **Clocks are injected.** Every function that needs the current time takes `nowMs: number`. No production code calls `Date.now()` inside a verifiable branch, because a test that cannot pin the clock cannot test a time window.
- **Error envelope:** `{ error: { code: string, message: string } }` for every non-2xx, thrown as `ApiError` from `src/lib/errors.ts` (core Task 3).
- **Commits:** Conventional Commits. No AI-attribution trailers or footers of any kind.
- **TDD:** every behavior lands test-first, red then green then commit.
- **Secrets:** never commit a real `.env`, only `.env.example`. Never delete or overwrite an existing `.env`.
- **Existing signatures this plan consumes verbatim** (from the functional core plan, do not rename):
  - `buildApp(overrides?: Partial<AppConfig>): FastifyInstance` from `src/app.ts`
  - `class ApiError extends Error { constructor(statusCode: number, code: string, message: string) }` from `src/lib/errors.ts`
  - `app.config: AppConfig`, `app.prisma: PrismaClient`
  - `app.authenticate` preHandler and `request.userId: string` from `src/plugins/auth_plugin.ts`
  - `signAccessToken`, `verifyAccessToken`, `generateRefreshToken`, `ACCESS_TOKEN_TTL_MS`, `REFRESH_TOKEN_TTL_MS` from `src/lib/jwt.ts`
  - `issueRefreshToken(prisma: PrismaClient, userId: string, familyId: string, nowMs?: number): Promise<string>` from `src/services/auth_service.ts`
  - `resetDb(prisma: PrismaClient): Promise<void>` from `test/helpers/db.ts`

---

## Delivery order

This plan's nine tasks, and where they sit against the functional core plan.

| Group | Runs | Contains | Blocked by |
|---|---|---|---|
| Core A | sequential | core Tasks 1 to 10 | nothing |
| G1 | parallel, immediately | Task 2, Task 3, Task 7, Task 9 | nothing |
| G2 | after core Task 2 | Task 1 | core Task 2 |
| G3 | after G2 | Task 4 | Task 1 |
| G4 | after G1 and G3 | Task 5 | Tasks 1, 2, 3, 4 |
| G5 | after G4 | Task 6 | Task 5 |
| G6 | after G5 and Task 7 | Task 8 | Tasks 6, 7 |

Tasks 2, 3, 7 and 9 have no dependency on the server schema and can start the moment this plan is approved, in parallel with core Tasks 1 to 10.

**Task 7 is the time-sensitive one.** It captures install evidence on the device. The device is the only source of an install date (spec §3 fact 3), and it stops being one when the app is uninstalled. Ship it in the next mobile release regardless of when the server lands.

---

### Task 1: Prisma models for identity and attestation

**Files:**
- Modify: `server/apps/api/prisma/schema.prisma`
- Create: `server/apps/api/prisma/migrations/<timestamp>_google_linking/migration.sql` (generated)
- Modify: `server/apps/api/test/prisma_schema.test.ts`
- Modify: `server/apps/api/test/helpers/db.ts`

**Interfaces:**
- Consumes: the seven models from core Task 2.
- Produces: `prisma.googleIdentity` → `{ id: string; userId: string; googleSub: string; email: string; emailVerified: boolean; linkedAt: bigint; lastVerifiedAt: bigint }` and `prisma.installAttestation` → `{ id; userId; googleSub; packageName; claimSource; installBeginAt: bigint | null; firstInstallAt: bigint | null; appVersionAtInstall: string | null; licensingVerdict; recognitionVerdict; cohortGranted: boolean; createdAt: bigint }`. Tasks 4 and 5 depend on these exact names.

- [ ] **Step 1: Update the failing schema test**

In `server/apps/api/test/prisma_schema.test.ts`, replace the expected table list and append two tests:

```ts
    expect(rows.map((r) => r.table_name)).toEqual([
      "backup_vaults",
      "entitlements",
      "google_identities",
      "install_attestations",
      "otp_requests",
      "parser_rulesets",
      "refresh_tokens",
      "telemetry_parse_stats",
      "users",
    ]);
```

```ts
  it("rejects a second identity for the same google_sub", async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const googleSub = `sub_${randomUUID()}`;
    const now = BigInt(Date.now());
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, destination: `${id}@example.com`, createdAt: now },
      });
    }
    await prisma.googleIdentity.create({
      data: {
        id: randomUUID(),
        userId,
        googleSub,
        email: `${userId}@example.com`,
        emailVerified: true,
        linkedAt: now,
        lastVerifiedAt: now,
      },
    });
    await expect(
      prisma.googleIdentity.create({
        data: {
          id: randomUUID(),
          userId: otherUserId,
          googleSub,
          email: `${otherUserId}@example.com`,
          emailVerified: true,
          linkedAt: now,
          lastVerifiedAt: now,
        },
      }),
    ).rejects.toThrow();
  });

  it("stores an attestation with both install timestamps nullable", async () => {
    const userId = randomUUID();
    const now = BigInt(Date.now());
    await prisma.user.create({
      data: { id: userId, destination: `${userId}@example.com`, createdAt: now },
    });
    const created = await prisma.installAttestation.create({
      data: {
        id: randomUUID(),
        userId,
        googleSub: `sub_${userId}`,
        packageName: "com.filldev.peraplano",
        claimSource: "package_manager",
        installBeginAt: null,
        firstInstallAt: now,
        appVersionAtInstall: null,
        licensingVerdict: "LICENSED",
        recognitionVerdict: "PLAY_RECOGNIZED",
        cohortGranted: true,
        createdAt: now,
      },
    });
    expect(created.installBeginAt).toBeNull();
    expect(created.firstInstallAt).toBe(now);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/prisma_schema.test.ts`
Expected: FAIL. The table-list assertion reports seven entries where nine were expected, and the two new tests throw `TypeError: Cannot read properties of undefined (reading 'create')` because `prisma.googleIdentity` does not exist.

- [ ] **Step 3: Add the two models**

Append to `server/apps/api/prisma/schema.prisma`:

```prisma
model GoogleIdentity {
  id             String  @id
  userId         String  @map("user_id")
  googleSub      String  @unique @map("google_sub")
  email          String
  emailVerified  Boolean @map("email_verified")
  linkedAt       BigInt  @map("linked_at")
  lastVerifiedAt BigInt  @map("last_verified_at")

  user User @relation(fields: [userId], references: [id])

  @@map("google_identities")
}

model InstallAttestation {
  id                  String  @id
  userId              String  @map("user_id")
  googleSub           String  @map("google_sub")
  packageName         String  @map("package_name")
  claimSource         String  @map("claim_source")
  installBeginAt      BigInt? @map("install_begin_at")
  firstInstallAt      BigInt? @map("first_install_at")
  appVersionAtInstall String? @map("app_version_at_install")
  licensingVerdict    String  @map("licensing_verdict")
  recognitionVerdict  String  @map("recognition_verdict")
  cohortGranted       Boolean @map("cohort_granted")
  createdAt           BigInt  @map("created_at")

  user User @relation(fields: [userId], references: [id])

  @@map("install_attestations")
}
```

Add the two back-relations to the existing `User` model, beside `refreshTokens`:

```prisma
  googleIdentity      GoogleIdentity?
  installAttestations InstallAttestation[]
```

- [ ] **Step 4: Generate the migration**

Run: `npx prisma migrate dev --name google_linking`
Expected: creates `google_identities` and `install_attestations`, regenerates the client. `google_identities.google_sub` gets a unique index; `install_attestations` does not.

- [ ] **Step 5: Update the truncation helper**

In `server/apps/api/test/helpers/db.ts`, extend the TRUNCATE to cover both new tables. A table missing here leaks rows between test files and produces failures that look random:

```ts
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "users", "otp_requests", "refresh_tokens", "parser_rulesets", "telemetry_parse_stats", "backup_vaults", "entitlements", "google_identities", "install_attestations" CASCADE',
  );
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, including every core-plan test. If an earlier test now fails on a foreign key, the back-relations in Step 3 were added to the wrong model.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations test/prisma_schema.test.ts test/helpers/db.ts
git commit -m "feat(api): add google identity and install attestation models"
```

---

### Task 2: Google ID token verification

**Files:**
- Create: `server/apps/api/src/lib/google_id_token.ts`
- Test: `server/apps/api/test/lib/google_id_token.test.ts`

**Interfaces:**
- Consumes: `ApiError` from `src/lib/errors.ts`.
- Produces:
  - `type GoogleJwks = { keys: JsonWebKey[] }`
  - `type JwksFetcher = () => Promise<GoogleJwks>`
  - `type GoogleIdentityClaims = { googleSub: string; email: string }`
  - `verifyGoogleIdToken(input: VerifyGoogleIdTokenInput): GoogleIdentityClaims` where `VerifyGoogleIdTokenInput = { idToken: string; jwks: GoogleJwks; expectedAudience: string; nowMs: number; maxSkewMs?: number }`
  - `createGoogleJwksFetcher(options: { url: string; ttlMs?: number; fetchImpl?: typeof fetch }): JwksFetcher`

Verification is a pure synchronous function that takes the key set as an argument. Fetching is a separate adapter. That split is what lets Task 5 test every failure branch without a network stub.

- [ ] **Step 1: Write the failing tests**

`server/apps/api/test/lib/google_id_token.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync } from "node:crypto";
import { verifyGoogleIdToken, type GoogleJwks } from "../../src/lib/google_id_token.js";

const AUDIENCE = "123.apps.googleusercontent.com";
const NOW = 1_756_000_000_000;
const KID = "test-key-1";

let jwks: GoogleJwks;
let privateKeyPem: string;

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwk = publicKey.export({ format: "jwk" });
  jwks = { keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] };
});

function b64url(value: object | string): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(raw).toString("base64url");
}

function makeToken(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const encodedHeader = b64url({ alg: "RS256", typ: "JWT", kid: KID, ...header });
  const encodedPayload = b64url({
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    sub: "1234567890",
    email: "Tester@Example.com",
    email_verified: true,
    iat: Math.floor(NOW / 1000) - 60,
    exp: Math.floor(NOW / 1000) + 3600,
    ...overrides,
  });
  const signer = createSign("RSA-SHA256");
  signer.update(`${encodedHeader}.${encodedPayload}`);
  const signature = signer.sign(createPrivateKey(privateKeyPem)).toString("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verify(token: string) {
  return verifyGoogleIdToken({ idToken: token, jwks, expectedAudience: AUDIENCE, nowMs: NOW });
}

describe("verifyGoogleIdToken", () => {
  it("returns the subject and a lowercased email for a valid token", () => {
    expect(verify(makeToken())).toEqual({ googleSub: "1234567890", email: "tester@example.com" });
  });

  it("accepts the bare accounts.google.com issuer", () => {
    expect(verify(makeToken({ iss: "accounts.google.com" })).googleSub).toBe("1234567890");
  });

  it("rejects a malformed token", () => {
    expect(() => verify("not.a.jwt")).toThrow("invalid_google_token");
  });

  it("rejects an unknown kid", () => {
    expect(() => verify(makeToken({}, { kid: "other" }))).toThrow("invalid_google_token");
  });

  it("rejects a non-RS256 algorithm", () => {
    expect(() => verify(makeToken({}, { alg: "none" }))).toThrow("invalid_google_token");
  });

  it("rejects a tampered payload", () => {
    const [header, , signature] = makeToken().split(".");
    const forged = b64url({ iss: "https://accounts.google.com", aud: AUDIENCE, sub: "evil" });
    expect(() => verify(`${header}.${forged}.${signature}`)).toThrow("invalid_google_token");
  });

  it("rejects a foreign issuer", () => {
    expect(() => verify(makeToken({ iss: "https://evil.example" }))).toThrow("invalid_google_token");
  });

  it("rejects a foreign audience", () => {
    expect(() => verify(makeToken({ aud: "999.apps.googleusercontent.com" }))).toThrow("invalid_google_token");
  });

  it("rejects an expired token", () => {
    expect(() => verify(makeToken({ exp: Math.floor(NOW / 1000) - 1 }))).toThrow("invalid_google_token");
  });

  it("rejects a token issued beyond the skew window", () => {
    expect(() => verify(makeToken({ iat: Math.floor(NOW / 1000) + 3600 }))).toThrow("invalid_google_token");
  });

  it("rejects an unverified email with its own code", () => {
    expect(() => verify(makeToken({ email_verified: false }))).toThrow("google_email_unverified");
  });

  it("rejects a token with no email", () => {
    expect(() => verify(makeToken({ email: undefined }))).toThrow("invalid_google_token");
  });
});
```

The assertions match on the error **code**, not the message, because the code is the part of `ApiError` that reaches the client and that Task 6 asserts on.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lib/google_id_token.test.ts`
Expected: FAIL, "Failed to load url ../../src/lib/google_id_token.js".

- [ ] **Step 3: Implement the verifier**

`server/apps/api/src/lib/google_id_token.ts`:

```ts
import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";
import { ApiError } from "./errors.js";

export type GoogleJwks = { keys: JsonWebKey[] };
export type JwksFetcher = () => Promise<GoogleJwks>;
export type GoogleIdentityClaims = { googleSub: string; email: string };

export type VerifyGoogleIdTokenInput = {
  idToken: string;
  jwks: GoogleJwks;
  expectedAudience: string;
  nowMs: number;
  maxSkewMs?: number;
};

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const DEFAULT_MAX_SKEW_MS = 300_000;

function invalid(message: string): ApiError {
  return new ApiError(401, "invalid_google_token", message);
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw invalid("ID token segment is not valid JSON");
  }
}

export function verifyGoogleIdToken({
  idToken,
  jwks,
  expectedAudience,
  nowMs,
  maxSkewMs = DEFAULT_MAX_SKEW_MS,
}: VerifyGoogleIdTokenInput): GoogleIdentityClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw invalid("ID token is not a three-part JWT");
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  const header = decodeSegment(encodedHeader);
  if (header.alg !== "RS256") throw invalid("ID token algorithm is not RS256");
  if (typeof header.kid !== "string") throw invalid("ID token has no key id");

  const jwk = jwks.keys.find((key) => (key as { kid?: string }).kid === header.kid);
  if (!jwk) throw invalid("No Google signing key matches the token key id");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  const signatureValid = verifier.verify(
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!signatureValid) throw invalid("ID token signature does not verify");

  const payload = decodeSegment(encodedPayload);

  if (typeof payload.iss !== "string" || !GOOGLE_ISSUERS.includes(payload.iss)) {
    throw invalid("ID token issuer is not Google");
  }
  if (payload.aud !== expectedAudience) throw invalid("ID token audience is not this app");
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= nowMs) {
    throw invalid("ID token has expired");
  }
  if (typeof payload.iat !== "number" || payload.iat * 1000 > nowMs + maxSkewMs) {
    throw invalid("ID token was issued in the future");
  }
  if (payload.email_verified !== true) {
    throw new ApiError(401, "google_email_unverified", "This Google account has no verified email address");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) throw invalid("ID token has no subject");
  if (typeof payload.email !== "string" || payload.email.length === 0) throw invalid("ID token has no email");

  return { googleSub: payload.sub, email: payload.email.toLowerCase() };
}
```

The signature is checked **before** any claim, so a forged payload never reaches the issuer or audience comparison. Reordering these is a real vulnerability, not a style preference.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lib/google_id_token.test.ts`
Expected: PASS, 12 tests green.

- [ ] **Step 5: Write the failing fetcher test**

Append to the same test file:

```ts
import { createGoogleJwksFetcher } from "../../src/lib/google_id_token.js";

describe("createGoogleJwksFetcher", () => {
  it("fetches once and serves the cached key set until the ttl expires", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const fetcher = createGoogleJwksFetcher({ url: "https://example.test/certs", ttlMs: 60_000, fetchImpl });
    await fetcher();
    await fetcher();
    expect(calls).toBe(1);
  });

  it("raises google_upstream_unavailable on a non-200", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const fetcher = createGoogleJwksFetcher({ url: "https://example.test/certs", fetchImpl });
    await expect(fetcher()).rejects.toThrow("google_upstream_unavailable");
  });
});
```

- [ ] **Step 6: Run to verify it fails, then implement the fetcher**

Run: `npx vitest run test/lib/google_id_token.test.ts`
Expected: FAIL, `createGoogleJwksFetcher is not a function`.

Append to `src/lib/google_id_token.ts`:

```ts
export function createGoogleJwksFetcher(options: {
  url: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
}): JwksFetcher {
  const ttlMs = options.ttlMs ?? 3_600_000;
  const doFetch = options.fetchImpl ?? fetch;
  let cached: { jwks: GoogleJwks; fetchedAtMs: number } | null = null;

  return async () => {
    const nowMs = Date.now();
    if (cached && nowMs - cached.fetchedAtMs < ttlMs) return cached.jwks;
    let response: Response;
    try {
      response = await doFetch(options.url);
    } catch {
      throw new ApiError(503, "google_upstream_unavailable", "Could not reach Google's key service");
    }
    if (!response.ok) {
      throw new ApiError(503, "google_upstream_unavailable", "Google's key service returned an error");
    }
    const jwks = (await response.json()) as GoogleJwks;
    cached = { jwks, fetchedAtMs: nowMs };
    return jwks;
  };
}
```

`Date.now()` is acceptable here and nowhere else in this plan: a cache age is not a verifiable branch, and the tests assert call counts rather than timing.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/lib/google_id_token.test.ts`
Expected: PASS, 14 tests green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/google_id_token.ts test/lib/google_id_token.test.ts
git commit -m "feat(api): verify google id tokens against the published key set"
```

---

### Task 3: Play Integrity verdict checking

**Files:**
- Create: `server/apps/api/src/lib/play_integrity.ts`
- Test: `server/apps/api/test/lib/play_integrity.test.ts`

**Interfaces:**
- Consumes: `ApiError` from `src/lib/errors.ts`.
- Produces:
  - `type InstallClaim = { packageName: string; claimSource: "install_referrer" | "package_manager"; installBeginAt: number | null; firstInstallAt: number | null; appVersionAtInstall: string | null }`
  - `type IntegrityPayload = { requestDetails: { requestPackageName: string; requestHash?: string; timestampMillis: string }; appIntegrity: { appRecognitionVerdict: string }; accountDetails: { appLicensingVerdict: string } }`
  - `type PlayIntegrityDecoder = (integrityToken: string) => Promise<IntegrityPayload>`
  - `computeRequestHash(idToken: string, claim: InstallClaim): string`
  - `assertIntegrity(input: AssertIntegrityInput): void` where `AssertIntegrityInput = { payload: IntegrityPayload; idToken: string; claim: InstallClaim; expectedPackageName: string; nowMs: number; maxSkewMs: number }`
  - `createPlayIntegrityDecoder(options: { packageName: string; serviceAccountJson: string; fetchImpl?: typeof fetch }): PlayIntegrityDecoder`

**The request hash is a cross-boundary contract with the mobile client.** Both sides must serialize the claim identically or every request fails with `integrity_request_mismatch`. The canonical form is a JSON object with exactly these five keys in this alphabetical order and no whitespace:

```
appVersionAtInstall, claimSource, firstInstallAt, installBeginAt, packageName
```

Never rely on object insertion order to produce it. The implementation below builds the object literal in that order explicitly, and Task 8 mirrors it on the client.

- [ ] **Step 1: Write the failing tests**

`server/apps/api/test/lib/play_integrity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  assertIntegrity,
  computeRequestHash,
  type InstallClaim,
  type IntegrityPayload,
} from "../../src/lib/play_integrity.js";

const PACKAGE = "com.filldev.peraplano";
const NOW = 1_756_000_000_000;
const ID_TOKEN = "header.payload.signature";

const CLAIM: InstallClaim = {
  packageName: PACKAGE,
  claimSource: "package_manager",
  installBeginAt: null,
  firstInstallAt: 1_750_000_000_000,
  appVersionAtInstall: "0.1.0",
};

function payload(overrides: Partial<IntegrityPayload> = {}): IntegrityPayload {
  return {
    requestDetails: {
      requestPackageName: PACKAGE,
      requestHash: computeRequestHash(ID_TOKEN, CLAIM),
      timestampMillis: String(NOW - 1_000),
    },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
    accountDetails: { appLicensingVerdict: "LICENSED" },
    ...overrides,
  };
}

function check(p: IntegrityPayload) {
  assertIntegrity({
    payload: p,
    idToken: ID_TOKEN,
    claim: CLAIM,
    expectedPackageName: PACKAGE,
    nowMs: NOW,
    maxSkewMs: 300_000,
  });
}

describe("computeRequestHash", () => {
  it("serializes the claim with alphabetical keys and no whitespace", () => {
    const canonical =
      '{"appVersionAtInstall":"0.1.0","claimSource":"package_manager","firstInstallAt":1750000000000,"installBeginAt":null,"packageName":"com.filldev.peraplano"}';
    const expected = createHash("sha256").update(`${ID_TOKEN}.${canonical}`).digest("base64url");
    expect(computeRequestHash(ID_TOKEN, CLAIM)).toBe(expected);
  });

  it("changes when any claim field changes", () => {
    const other = computeRequestHash(ID_TOKEN, { ...CLAIM, firstInstallAt: 1 });
    expect(other).not.toBe(computeRequestHash(ID_TOKEN, CLAIM));
  });
});

describe("assertIntegrity", () => {
  it("passes a well-formed licensed payload", () => {
    expect(() => check(payload())).not.toThrow();
  });

  it("rejects a foreign package name", () => {
    const p = payload();
    p.requestDetails.requestPackageName = "com.evil.app";
    expect(() => check(p)).toThrow("integrity_token_invalid");
  });

  it("rejects a request hash bound to a different claim", () => {
    const p = payload();
    p.requestDetails.requestHash = computeRequestHash(ID_TOKEN, { ...CLAIM, firstInstallAt: 1 });
    expect(() => check(p)).toThrow("integrity_request_mismatch");
  });

  it("rejects a missing request hash", () => {
    const p = payload();
    delete p.requestDetails.requestHash;
    expect(() => check(p)).toThrow("integrity_request_mismatch");
  });

  it("rejects a stale timestamp", () => {
    const p = payload();
    p.requestDetails.timestampMillis = String(NOW - 300_001);
    expect(() => check(p)).toThrow("integrity_stale");
  });

  it("rejects a timestamp from the future", () => {
    const p = payload();
    p.requestDetails.timestampMillis = String(NOW + 300_001);
    expect(() => check(p)).toThrow("integrity_stale");
  });

  it.each(["UNLICENSED", "UNEVALUATED", "UNKNOWN"])(
    "rejects the %s licensing verdict",
    (verdict) => {
      const p = payload();
      p.accountDetails.appLicensingVerdict = verdict;
      expect(() => check(p)).toThrow("app_not_play_licensed");
    },
  );

  it("rejects an unrecognized app version", () => {
    const p = payload();
    p.appIntegrity.appRecognitionVerdict = "UNRECOGNIZED_VERSION";
    expect(() => check(p)).toThrow("app_not_play_licensed");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lib/play_integrity.test.ts`
Expected: FAIL, "Failed to load url ../../src/lib/play_integrity.js".

- [ ] **Step 3: Implement the verdict checks**

`server/apps/api/src/lib/play_integrity.ts`:

```ts
import { createHash } from "node:crypto";
import { ApiError } from "./errors.js";

export type InstallClaimSource = "install_referrer" | "package_manager";

export type InstallClaim = {
  packageName: string;
  claimSource: InstallClaimSource;
  installBeginAt: number | null;
  firstInstallAt: number | null;
  appVersionAtInstall: string | null;
};

export type IntegrityPayload = {
  requestDetails: { requestPackageName: string; requestHash?: string; timestampMillis: string };
  appIntegrity: { appRecognitionVerdict: string };
  accountDetails: { appLicensingVerdict: string };
};

export type PlayIntegrityDecoder = (integrityToken: string) => Promise<IntegrityPayload>;

export type AssertIntegrityInput = {
  payload: IntegrityPayload;
  idToken: string;
  claim: InstallClaim;
  expectedPackageName: string;
  nowMs: number;
  maxSkewMs: number;
};

/**
 * The canonical claim serialization. Keys are listed alphabetically and
 * explicitly; the mobile client builds the identical string. Adding a field to
 * InstallClaim without adding it here, in both places, silently breaks every
 * request with integrity_request_mismatch.
 */
function canonicalClaimJson(claim: InstallClaim): string {
  return JSON.stringify({
    appVersionAtInstall: claim.appVersionAtInstall,
    claimSource: claim.claimSource,
    firstInstallAt: claim.firstInstallAt,
    installBeginAt: claim.installBeginAt,
    packageName: claim.packageName,
  });
}

export function computeRequestHash(idToken: string, claim: InstallClaim): string {
  return createHash("sha256").update(`${idToken}.${canonicalClaimJson(claim)}`).digest("base64url");
}

export function assertIntegrity({
  payload,
  idToken,
  claim,
  expectedPackageName,
  nowMs,
  maxSkewMs,
}: AssertIntegrityInput): void {
  if (payload.requestDetails.requestPackageName !== expectedPackageName) {
    throw new ApiError(401, "integrity_token_invalid", "Integrity token is for a different app");
  }

  const expectedHash = computeRequestHash(idToken, claim);
  if (payload.requestDetails.requestHash !== expectedHash) {
    throw new ApiError(401, "integrity_request_mismatch", "Integrity token is not bound to this request");
  }

  const timestampMs = Number(payload.requestDetails.timestampMillis);
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > maxSkewMs) {
    throw new ApiError(401, "integrity_stale", "Integrity token is outside the freshness window");
  }

  if (payload.appIntegrity.appRecognitionVerdict !== "PLAY_RECOGNIZED") {
    throw new ApiError(403, "app_not_play_licensed", "This app build is not recognized by Google Play");
  }

  if (payload.accountDetails.appLicensingVerdict !== "LICENSED") {
    throw new ApiError(403, "app_not_play_licensed", "This Google account did not get the app from Google Play");
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lib/play_integrity.test.ts`
Expected: PASS, 11 tests green.

- [ ] **Step 5: Write the failing decoder test**

Append to the same test file:

```ts
import { createPlayIntegrityDecoder } from "../../src/lib/play_integrity.js";
import { generateKeyPairSync } from "node:crypto";

function fakeServiceAccount(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    client_email: "api@peraplano.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
}

describe("createPlayIntegrityDecoder", () => {
  it("exchanges a service-account assertion then returns the decoded payload", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push(url);
      if (url.includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "at_123" }), { status: 200 });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer at_123");
      return new Response(
        JSON.stringify({
          tokenPayloadExternal: {
            requestDetails: { requestPackageName: PACKAGE, requestHash: "h", timestampMillis: "1" },
            appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
            accountDetails: { appLicensingVerdict: "LICENSED" },
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const decode = createPlayIntegrityDecoder({
      packageName: PACKAGE,
      serviceAccountJson: fakeServiceAccount(),
      fetchImpl,
    });
    const result = await decode("integrity_token_value");
    expect(result.accountDetails.appLicensingVerdict).toBe("LICENSED");
    expect(seen[1]).toContain(`${PACKAGE}:decodeIntegrityToken`);
  });

  it("raises google_upstream_unavailable when Play returns an error", async () => {
    const fetchImpl = (async (url: string) =>
      url.includes("oauth2")
        ? new Response(JSON.stringify({ access_token: "at_123" }), { status: 200 })
        : new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const decode = createPlayIntegrityDecoder({
      packageName: PACKAGE,
      serviceAccountJson: fakeServiceAccount(),
      fetchImpl,
    });
    await expect(decode("t")).rejects.toThrow("google_upstream_unavailable");
  });
});
```

- [ ] **Step 6: Run to verify it fails, then implement the decoder**

Run: `npx vitest run test/lib/play_integrity.test.ts`
Expected: FAIL, `createPlayIntegrityDecoder is not a function`.

Append to `src/lib/play_integrity.ts`:

```ts
import { createPrivateKey, createSign } from "node:crypto";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const INTEGRITY_SCOPE = "https://www.googleapis.com/auth/playintegrity";

function unavailable(message: string): ApiError {
  return new ApiError(503, "google_upstream_unavailable", message);
}

/** Mints the RS256 assertion Google exchanges for an access token. No JWT library. */
function signServiceAccountAssertion(clientEmail: string, privateKeyPem: string, nowSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: clientEmail,
      scope: INTEGRITY_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(createPrivateKey(privateKeyPem)).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

export function createPlayIntegrityDecoder(options: {
  packageName: string;
  serviceAccountJson: string;
  fetchImpl?: typeof fetch;
}): PlayIntegrityDecoder {
  const doFetch = options.fetchImpl ?? fetch;
  const account = JSON.parse(options.serviceAccountJson) as { client_email: string; private_key: string };

  return async (integrityToken: string) => {
    const assertion = signServiceAccountAssertion(
      account.client_email,
      account.private_key,
      Math.floor(Date.now() / 1000),
    );

    let tokenResponse: Response;
    try {
      tokenResponse = await doFetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
      });
    } catch {
      throw unavailable("Could not reach Google's token endpoint");
    }
    if (!tokenResponse.ok) throw unavailable("Google refused the service-account assertion");
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

    const url = `https://playintegrity.googleapis.com/v1/${options.packageName}:decodeIntegrityToken`;
    let decodeResponse: Response;
    try {
      decodeResponse = await doFetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ integrity_token: integrityToken }),
      });
    } catch {
      throw unavailable("Could not reach the Play Integrity service");
    }
    if (!decodeResponse.ok) throw unavailable("Play Integrity refused to decode the token");

    const body = (await decodeResponse.json()) as { tokenPayloadExternal?: IntegrityPayload };
    if (!body.tokenPayloadExternal) {
      throw new ApiError(401, "integrity_token_invalid", "Play Integrity returned no payload");
    }
    return body.tokenPayloadExternal;
  };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/lib/play_integrity.test.ts`
Expected: PASS, 13 tests green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/play_integrity.ts test/lib/play_integrity.test.ts
git commit -m "feat(api): check play integrity verdicts and bind them to the request"
```

---

### Task 4: Beta cohort rule and entitlement resolution

**Files:**
- Create: `server/apps/api/src/lib/beta_cohort.ts`
- Create: `server/apps/api/src/services/entitlement_service.ts`
- Modify: `server/apps/api/src/routes/entitlements_routes.ts`
- Test: `server/apps/api/test/lib/beta_cohort.test.ts`
- Test: `server/apps/api/test/services/entitlement_service.test.ts`
- Modify: `server/apps/api/test/routes/entitlements_routes.test.ts`

**Interfaces:**
- Consumes: `prisma.entitlement`, `prisma.googleIdentity` (Task 1); `InstallClaim`, `IntegrityPayload` (Task 3).
- Produces:
  - `type Tier = "free" | "plus"`
  - `type EntitlementSource = "stub" | "beta_cohort" | "play_billing"`
  - `effectiveInstallAt(claim: InstallClaim): number | null`
  - `qualifiesForBetaCohort(input: { payload: IntegrityPayload; claim: InstallClaim; expectedPackageName: string; windowStartAt: number; windowEndAt: number; nowMs: number }): boolean`
  - `resolveEntitlement(prisma: PrismaClient, userId: string): Promise<{ tier: Tier; source: EntitlementSource }>`
  - `grantBetaCohort(prisma: PrismaClient, userId: string, nowMs: number): Promise<void>`

- [ ] **Step 1: Write the failing cohort tests**

`server/apps/api/test/lib/beta_cohort.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { effectiveInstallAt, qualifiesForBetaCohort } from "../../src/lib/beta_cohort.js";
import type { InstallClaim, IntegrityPayload } from "../../src/lib/play_integrity.js";

const PACKAGE = "com.filldev.peraplano";
const WINDOW_START = 1_750_000_000_000;
const WINDOW_END = 1_760_000_000_000;
const NOW = 1_761_000_000_000;

const CLAIM: InstallClaim = {
  packageName: PACKAGE,
  claimSource: "package_manager",
  installBeginAt: null,
  firstInstallAt: 1_755_000_000_000,
  appVersionAtInstall: "0.1.0",
};

const PAYLOAD: IntegrityPayload = {
  requestDetails: { requestPackageName: PACKAGE, requestHash: "h", timestampMillis: String(NOW) },
  appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
  accountDetails: { appLicensingVerdict: "LICENSED" },
};

function qualifies(claim: InstallClaim = CLAIM, payload: IntegrityPayload = PAYLOAD): boolean {
  return qualifiesForBetaCohort({
    payload,
    claim,
    expectedPackageName: PACKAGE,
    windowStartAt: WINDOW_START,
    windowEndAt: WINDOW_END,
    nowMs: NOW,
  });
}

describe("effectiveInstallAt", () => {
  it("prefers the Play-supplied install begin timestamp", () => {
    expect(effectiveInstallAt({ ...CLAIM, installBeginAt: 42 })).toBe(42);
  });

  it("falls back to the device first-install time", () => {
    expect(effectiveInstallAt(CLAIM)).toBe(1_755_000_000_000);
  });

  it("returns null when the claim carries neither", () => {
    expect(effectiveInstallAt({ ...CLAIM, firstInstallAt: null })).toBeNull();
  });
});

describe("qualifiesForBetaCohort", () => {
  it("grants an in-window licensed install", () => {
    expect(qualifies()).toBe(true);
  });

  it("grants on the inclusive window boundaries", () => {
    expect(qualifies({ ...CLAIM, firstInstallAt: WINDOW_START })).toBe(true);
    expect(qualifies({ ...CLAIM, firstInstallAt: WINDOW_END })).toBe(true);
  });

  it("refuses an install before the window", () => {
    expect(qualifies({ ...CLAIM, firstInstallAt: WINDOW_START - 1 })).toBe(false);
  });

  it("refuses an install after the window", () => {
    expect(qualifies({ ...CLAIM, firstInstallAt: WINDOW_END + 1 })).toBe(false);
  });

  it("refuses an install time in the future", () => {
    expect(
      qualifiesForBetaCohort({
        payload: PAYLOAD,
        claim: { ...CLAIM, firstInstallAt: NOW + 1 },
        expectedPackageName: PACKAGE,
        windowStartAt: WINDOW_START,
        windowEndAt: NOW + 10_000,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("refuses a claim with no install time at all", () => {
    expect(qualifies({ ...CLAIM, firstInstallAt: null })).toBe(false);
  });

  it("refuses an unlicensed account", () => {
    expect(qualifies(CLAIM, { ...PAYLOAD, accountDetails: { appLicensingVerdict: "UNLICENSED" } })).toBe(false);
  });

  it("refuses an unrecognized build", () => {
    expect(qualifies(CLAIM, { ...PAYLOAD, appIntegrity: { appRecognitionVerdict: "UNRECOGNIZED_VERSION" } })).toBe(false);
  });

  it("refuses a claim naming a different package", () => {
    expect(qualifies({ ...CLAIM, packageName: "com.evil.app" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/lib/beta_cohort.test.ts`
Expected: FAIL, "Failed to load url ../../src/lib/beta_cohort.js".

- [ ] **Step 3: Implement the cohort predicate**

`server/apps/api/src/lib/beta_cohort.ts`:

```ts
import type { InstallClaim, IntegrityPayload } from "./play_integrity.js";

export type Tier = "free" | "plus";
export type EntitlementSource = "stub" | "beta_cohort" | "play_billing";

/**
 * The Play-supplied timestamp wins. firstInstallAt comes from PackageManager and
 * moves with the device clock, so it is the fallback, never the preference.
 */
export function effectiveInstallAt(claim: InstallClaim): number | null {
  return claim.installBeginAt ?? claim.firstInstallAt ?? null;
}

export function qualifiesForBetaCohort(input: {
  payload: IntegrityPayload;
  claim: InstallClaim;
  expectedPackageName: string;
  windowStartAt: number;
  windowEndAt: number;
  nowMs: number;
}): boolean {
  const { payload, claim, expectedPackageName, windowStartAt, windowEndAt, nowMs } = input;

  if (payload.accountDetails.appLicensingVerdict !== "LICENSED") return false;
  if (payload.appIntegrity.appRecognitionVerdict !== "PLAY_RECOGNIZED") return false;
  if (payload.requestDetails.requestPackageName !== expectedPackageName) return false;
  if (claim.packageName !== expectedPackageName) return false;

  const installedAt = effectiveInstallAt(claim);
  if (installedAt === null) return false;
  if (installedAt > nowMs) return false;
  return installedAt >= windowStartAt && installedAt <= windowEndAt;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/lib/beta_cohort.test.ts`
Expected: PASS, 13 tests green.

- [ ] **Step 5: Write the failing entitlement-service tests**

`server/apps/api/test/services/entitlement_service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../helpers/db.js";
import { grantBetaCohort, resolveEntitlement } from "../../src/services/entitlement_service.js";

const prisma = new PrismaClient();
const NOW = 1_756_000_000_000;

async function makeUser(): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({ data: { id, destination: `${id}@example.com`, createdAt: BigInt(NOW) } });
  return id;
}

beforeEach(async () => {
  await resetDb(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveEntitlement", () => {
  it("returns free/stub when the user has no entitlement row", async () => {
    const userId = await makeUser();
    expect(await resolveEntitlement(prisma, userId)).toEqual({ tier: "free", source: "stub" });
  });

  it("returns plus/beta_cohort after a grant", async () => {
    const userId = await makeUser();
    await grantBetaCohort(prisma, userId, NOW);
    expect(await resolveEntitlement(prisma, userId)).toEqual({ tier: "plus", source: "beta_cohort" });
  });

  it("does not resolve a play_billing row in this pass", async () => {
    const userId = await makeUser();
    await prisma.entitlement.create({
      data: { id: randomUUID(), userId, tier: "plus", source: "play_billing", updatedAt: BigInt(NOW) },
    });
    expect(await resolveEntitlement(prisma, userId)).toEqual({ tier: "free", source: "stub" });
  });
});

describe("grantBetaCohort", () => {
  it("is idempotent and keeps the original grant timestamp", async () => {
    const userId = await makeUser();
    await grantBetaCohort(prisma, userId, NOW);
    await grantBetaCohort(prisma, userId, NOW + 999_999);
    const rows = await prisma.entitlement.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.updatedAt).toBe(BigInt(NOW));
  });

  it("writes no row for a user who never qualified", async () => {
    await makeUser();
    expect(await prisma.entitlement.count()).toBe(0);
  });
});
```

- [ ] **Step 6: Run to verify they fail, then implement the service**

Run: `npx vitest run test/services/entitlement_service.test.ts`
Expected: FAIL, "Failed to load url ../../src/services/entitlement_service.js".

`server/apps/api/src/services/entitlement_service.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { EntitlementSource, Tier } from "../lib/beta_cohort.js";

/**
 * The only place tier is decided. Resolution order per the linking design §8:
 * a beta_cohort grant wins; play_billing is reserved and deliberately has no
 * branch; everything else is free. Do not add a play_billing check here without
 * a spec that defines what it verifies.
 */
export async function resolveEntitlement(
  prisma: PrismaClient,
  userId: string,
): Promise<{ tier: Tier; source: EntitlementSource }> {
  const row = await prisma.entitlement.findUnique({ where: { userId } });
  if (row?.source === "beta_cohort") return { tier: "plus", source: "beta_cohort" };
  return { tier: "free", source: "stub" };
}

/**
 * Permanent. Nothing in this codebase downgrades a beta_cohort grant, and the
 * idempotent write preserves the original timestamp so the grant stays audit-
 * traceable against its install_attestations row.
 */
export async function grantBetaCohort(prisma: PrismaClient, userId: string, nowMs: number): Promise<void> {
  const existing = await prisma.entitlement.findUnique({ where: { userId } });
  if (existing?.source === "beta_cohort") return;
  await prisma.entitlement.upsert({
    where: { userId },
    create: { id: randomUUID(), userId, tier: "plus", source: "beta_cohort", updatedAt: BigInt(nowMs) },
    update: { tier: "plus", source: "beta_cohort", updatedAt: BigInt(nowMs) },
  });
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/services/entitlement_service.test.ts`
Expected: PASS, 5 tests green.

- [ ] **Step 8: Update the entitlements route test**

Core Task 14 asserts the route always returns `{ tier: "free", source: "stub" }`. Replace that expectation and add the granted case in `test/routes/entitlements_routes.test.ts`:

```ts
  it("returns free/stub for a user with no grant", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tier: "free", source: "stub" });
  });

  it("returns plus/beta_cohort once the user is granted", async () => {
    await grantBetaCohort(app.prisma, userId, 1_756_000_000_000);
    const response = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.json()).toEqual({ tier: "plus", source: "beta_cohort" });
  });
```

Add `import { grantBetaCohort } from "../../src/services/entitlement_service.js";` at the top of that file.

- [ ] **Step 9: Run to verify it fails, then make the route resolve**

Run: `npx vitest run test/routes/entitlements_routes.test.ts`
Expected: FAIL on the second test, which still sees the hardcoded stub.

In `src/routes/entitlements_routes.ts`, replace the hardcoded body with a call into the service:

```ts
import { resolveEntitlement } from "../services/entitlement_service.js";

// inside the handler, replacing the literal `{ tier: "free", source: "stub" }`:
    return resolveEntitlement(app.prisma, request.userId);
```

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/beta_cohort.ts src/services/entitlement_service.ts src/routes/entitlements_routes.ts test/lib/beta_cohort.test.ts test/services/entitlement_service.test.ts test/routes/entitlements_routes.test.ts
git commit -m "feat(api): resolve entitlements from a permanent beta cohort grant"
```

---

### Task 5: The Google auth service

**Files:**
- Create: `server/apps/api/src/services/google_auth_service.ts`
- Test: `server/apps/api/test/services/google_auth_service.test.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 1 through 4, plus `signAccessToken` and `issueRefreshToken`.
- Produces:
  - `type GoogleAuthDeps = { prisma: PrismaClient; fetchJwks: JwksFetcher; decodeIntegrity: PlayIntegrityDecoder; expectedAudience: string; expectedPackageName: string; jwtSecret: string; betaWindowStartAt: number; betaWindowEndAt: number; maxSkewMs: number }`
  - `type GoogleAuthInput = { idToken: string; integrityToken: string; claim: InstallClaim; nowMs: number }`
  - `verifyWithGoogle(deps: GoogleAuthDeps, input: GoogleAuthInput): Promise<{ accessToken: string; refreshToken: string; user: { id: string; destination: string } }>`
  - `linkGoogleToUser(deps: GoogleAuthDeps, userId: string, input: GoogleAuthInput): Promise<{ googleSub: string; email: string; linkedAt: number }>`

- [ ] **Step 1: Write the failing tests**

`server/apps/api/test/services/google_auth_service.test.ts`:

```ts
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID, createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../helpers/db.js";
import { computeRequestHash, type InstallClaim, type IntegrityPayload } from "../../src/lib/play_integrity.js";
import type { GoogleJwks } from "../../src/lib/google_id_token.js";
import { linkGoogleToUser, verifyWithGoogle, type GoogleAuthDeps } from "../../src/services/google_auth_service.js";

const prisma = new PrismaClient();
const PACKAGE = "com.filldev.peraplano";
const AUDIENCE = "123.apps.googleusercontent.com";
const NOW = 1_761_000_000_000;
const WINDOW_START = 1_750_000_000_000;
const WINDOW_END = 1_760_000_000_000;
const KID = "test-key-1";

let jwks: GoogleJwks;
let privateKeyPem: string;

const IN_WINDOW: InstallClaim = {
  packageName: PACKAGE,
  claimSource: "package_manager",
  installBeginAt: null,
  firstInstallAt: 1_755_000_000_000,
  appVersionAtInstall: "0.1.0",
};
const OUT_OF_WINDOW: InstallClaim = { ...IN_WINDOW, firstInstallAt: WINDOW_END + 1 };

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] };
});

beforeEach(async () => {
  await resetDb(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

function makeIdToken(sub: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      sub,
      email,
      email_verified: true,
      iat: Math.floor(NOW / 1000) - 60,
      exp: Math.floor(NOW / 1000) + 3600,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(createPrivateKey(privateKeyPem)).toString("base64url")}`;
}

function makeDeps(overrides: Partial<GoogleAuthDeps> = {}): GoogleAuthDeps {
  return {
    prisma,
    fetchJwks: async () => jwks,
    decodeIntegrity: async () => ({}) as IntegrityPayload,
    expectedAudience: AUDIENCE,
    expectedPackageName: PACKAGE,
    jwtSecret: "test_secret",
    betaWindowStartAt: WINDOW_START,
    betaWindowEndAt: WINDOW_END,
    maxSkewMs: 300_000,
    ...overrides,
  };
}

function depsFor(idToken: string, claim: InstallClaim, verdict = "LICENSED"): GoogleAuthDeps {
  return makeDeps({
    decodeIntegrity: async () => ({
      requestDetails: {
        requestPackageName: PACKAGE,
        requestHash: computeRequestHash(idToken, claim),
        timestampMillis: String(NOW),
      },
      appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
      accountDetails: { appLicensingVerdict: verdict },
    }),
  });
}

describe("verifyWithGoogle", () => {
  it("creates a user, an identity, an attestation and a grant for an in-window install", async () => {
    const idToken = makeIdToken("sub_1", "first@example.com");
    const result = await verifyWithGoogle(depsFor(idToken, IN_WINDOW), {
      idToken,
      integrityToken: "it",
      claim: IN_WINDOW,
      nowMs: NOW,
    });

    expect(result.user.destination).toBe("first@example.com");
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    const identity = await prisma.googleIdentity.findUnique({ where: { googleSub: "sub_1" } });
    expect(identity?.userId).toBe(result.user.id);

    const attestation = await prisma.installAttestation.findFirst({ where: { userId: result.user.id } });
    expect(attestation?.cohortGranted).toBe(true);
    expect(attestation?.claimSource).toBe("package_manager");

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: result.user.id } });
    expect(entitlement?.source).toBe("beta_cohort");
  });

  it("returns the same user on a second sign-in and does not duplicate the identity", async () => {
    const idToken = makeIdToken("sub_1", "first@example.com");
    const deps = depsFor(idToken, IN_WINDOW);
    const first = await verifyWithGoogle(deps, { idToken, integrityToken: "it", claim: IN_WINDOW, nowMs: NOW });
    const second = await verifyWithGoogle(deps, { idToken, integrityToken: "it", claim: IN_WINDOW, nowMs: NOW + 1000 });

    expect(second.user.id).toBe(first.user.id);
    expect(await prisma.googleIdentity.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });

  it("attaches to an existing OTP user with the same email instead of creating a second user", async () => {
    const existingId = randomUUID();
    await prisma.user.create({
      data: { id: existingId, destination: "shared@example.com", createdAt: BigInt(NOW - 10_000) },
    });
    const idToken = makeIdToken("sub_2", "shared@example.com");
    const result = await verifyWithGoogle(depsFor(idToken, IN_WINDOW), {
      idToken,
      integrityToken: "it",
      claim: IN_WINDOW,
      nowMs: NOW,
    });

    expect(result.user.id).toBe(existingId);
    expect(await prisma.user.count()).toBe(1);
  });

  it("writes an ungranted attestation for an out-of-window install", async () => {
    const idToken = makeIdToken("sub_3", "late@example.com");
    const result = await verifyWithGoogle(depsFor(idToken, OUT_OF_WINDOW), {
      idToken,
      integrityToken: "it",
      claim: OUT_OF_WINDOW,
      nowMs: NOW,
    });

    const attestation = await prisma.installAttestation.findFirst({ where: { userId: result.user.id } });
    expect(attestation?.cohortGranted).toBe(false);
    expect(await prisma.entitlement.count()).toBe(0);
  });

  it("keeps a grant that already exists even when a later call would not qualify", async () => {
    const idToken = makeIdToken("sub_4", "early@example.com");
    const first = await verifyWithGoogle(depsFor(idToken, IN_WINDOW), {
      idToken,
      integrityToken: "it",
      claim: IN_WINDOW,
      nowMs: NOW,
    });
    await verifyWithGoogle(depsFor(idToken, OUT_OF_WINDOW), {
      idToken,
      integrityToken: "it",
      claim: OUT_OF_WINDOW,
      nowMs: NOW + 1000,
    });

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: first.user.id } });
    expect(entitlement?.source).toBe("beta_cohort");
  });

  it("rejects an unlicensed account before touching the database", async () => {
    const idToken = makeIdToken("sub_5", "sideload@example.com");
    await expect(
      verifyWithGoogle(depsFor(idToken, IN_WINDOW, "UNLICENSED"), {
        idToken,
        integrityToken: "it",
        claim: IN_WINDOW,
        nowMs: NOW,
      }),
    ).rejects.toThrow("app_not_play_licensed");
    expect(await prisma.user.count()).toBe(0);
  });
});

describe("linkGoogleToUser", () => {
  it("attaches an identity to the caller and grants an in-window cohort", async () => {
    const userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, destination: "otp@example.com", createdAt: BigInt(NOW - 10_000) },
    });
    const idToken = makeIdToken("sub_6", "google@example.com");
    const identity = await linkGoogleToUser(depsFor(idToken, IN_WINDOW), userId, {
      idToken,
      integrityToken: "it",
      claim: IN_WINDOW,
      nowMs: NOW,
    });

    expect(identity.googleSub).toBe("sub_6");
    expect(identity.linkedAt).toBe(NOW);
    const entitlement = await prisma.entitlement.findUnique({ where: { userId } });
    expect(entitlement?.source).toBe("beta_cohort");
  });

  it("refuses a google_sub already linked to a different user", async () => {
    const idToken = makeIdToken("sub_7", "taken@example.com");
    const owner = await verifyWithGoogle(depsFor(idToken, IN_WINDOW), {
      idToken,
      integrityToken: "it",
      claim: IN_WINDOW,
      nowMs: NOW,
    });
    const otherId = randomUUID();
    await prisma.user.create({
      data: { id: otherId, destination: "other@example.com", createdAt: BigInt(NOW) },
    });
    expect(owner.user.id).not.toBe(otherId);

    await expect(
      linkGoogleToUser(depsFor(idToken, IN_WINDOW), otherId, {
        idToken,
        integrityToken: "it",
        claim: IN_WINDOW,
        nowMs: NOW,
      }),
    ).rejects.toThrow("google_identity_already_linked");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/services/google_auth_service.test.ts`
Expected: FAIL, "Failed to load url ../../src/services/google_auth_service.js".

- [ ] **Step 3: Implement the service**

`server/apps/api/src/services/google_auth_service.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../lib/errors.js";
import { qualifiesForBetaCohort } from "../lib/beta_cohort.js";
import { signAccessToken } from "../lib/jwt.js";
import { assertIntegrity, type InstallClaim, type PlayIntegrityDecoder } from "../lib/play_integrity.js";
import { verifyGoogleIdToken, type JwksFetcher } from "../lib/google_id_token.js";
import { issueRefreshToken } from "./auth_service.js";
import { grantBetaCohort } from "./entitlement_service.js";

export type GoogleAuthDeps = {
  prisma: PrismaClient;
  fetchJwks: JwksFetcher;
  decodeIntegrity: PlayIntegrityDecoder;
  expectedAudience: string;
  expectedPackageName: string;
  jwtSecret: string;
  betaWindowStartAt: number;
  betaWindowEndAt: number;
  maxSkewMs: number;
};

export type GoogleAuthInput = {
  idToken: string;
  integrityToken: string;
  claim: InstallClaim;
  nowMs: number;
};

type VerifiedRequest = {
  googleSub: string;
  email: string;
  qualifies: boolean;
  licensingVerdict: string;
  recognitionVerdict: string;
};

/**
 * Both entry points share this. Every Google and Play check happens here, before
 * any write, so a rejected request leaves no rows behind.
 */
async function verifyRequest(deps: GoogleAuthDeps, input: GoogleAuthInput): Promise<VerifiedRequest> {
  const jwks = await deps.fetchJwks();
  const claims = verifyGoogleIdToken({
    idToken: input.idToken,
    jwks,
    expectedAudience: deps.expectedAudience,
    nowMs: input.nowMs,
    maxSkewMs: deps.maxSkewMs,
  });

  const payload = await deps.decodeIntegrity(input.integrityToken);
  assertIntegrity({
    payload,
    idToken: input.idToken,
    claim: input.claim,
    expectedPackageName: deps.expectedPackageName,
    nowMs: input.nowMs,
    maxSkewMs: deps.maxSkewMs,
  });

  return {
    googleSub: claims.googleSub,
    email: claims.email,
    qualifies: qualifiesForBetaCohort({
      payload,
      claim: input.claim,
      expectedPackageName: deps.expectedPackageName,
      windowStartAt: deps.betaWindowStartAt,
      windowEndAt: deps.betaWindowEndAt,
      nowMs: input.nowMs,
    }),
    licensingVerdict: payload.accountDetails.appLicensingVerdict,
    recognitionVerdict: payload.appIntegrity.appRecognitionVerdict,
  };
}

async function recordAttestation(
  deps: GoogleAuthDeps,
  userId: string,
  verified: VerifiedRequest,
  input: GoogleAuthInput,
): Promise<void> {
  await deps.prisma.installAttestation.create({
    data: {
      id: randomUUID(),
      userId,
      googleSub: verified.googleSub,
      packageName: input.claim.packageName,
      claimSource: input.claim.claimSource,
      installBeginAt: input.claim.installBeginAt === null ? null : BigInt(input.claim.installBeginAt),
      firstInstallAt: input.claim.firstInstallAt === null ? null : BigInt(input.claim.firstInstallAt),
      appVersionAtInstall: input.claim.appVersionAtInstall,
      licensingVerdict: verified.licensingVerdict,
      recognitionVerdict: verified.recognitionVerdict,
      cohortGranted: verified.qualifies,
      createdAt: BigInt(input.nowMs),
    },
  });
  if (verified.qualifies) {
    await grantBetaCohort(deps.prisma, userId, input.nowMs);
  }
}

export async function verifyWithGoogle(
  deps: GoogleAuthDeps,
  input: GoogleAuthInput,
): Promise<{ accessToken: string; refreshToken: string; user: { id: string; destination: string } }> {
  const verified = await verifyRequest(deps, input);

  const existingIdentity = await deps.prisma.googleIdentity.findUnique({
    where: { googleSub: verified.googleSub },
  });

  let userId: string;
  let destination: string;

  if (existingIdentity) {
    const user = await deps.prisma.user.findUniqueOrThrow({ where: { id: existingIdentity.userId } });
    userId = user.id;
    destination = user.destination;
    await deps.prisma.googleIdentity.update({
      where: { googleSub: verified.googleSub },
      data: { lastVerifiedAt: BigInt(input.nowMs), email: verified.email },
    });
  } else {
    const byEmail = await deps.prisma.user.findUnique({ where: { destination: verified.email } });
    const user =
      byEmail ??
      (await deps.prisma.user.create({
        data: { id: randomUUID(), destination: verified.email, createdAt: BigInt(input.nowMs) },
      }));
    userId = user.id;
    destination = user.destination;
    await deps.prisma.googleIdentity.create({
      data: {
        id: randomUUID(),
        userId,
        googleSub: verified.googleSub,
        email: verified.email,
        emailVerified: true,
        linkedAt: BigInt(input.nowMs),
        lastVerifiedAt: BigInt(input.nowMs),
      },
    });
  }

  await recordAttestation(deps, userId, verified, input);

  const accessToken = signAccessToken(userId, deps.jwtSecret, input.nowMs);
  const refreshToken = await issueRefreshToken(deps.prisma, userId, randomUUID(), input.nowMs);
  return { accessToken, refreshToken, user: { id: userId, destination } };
}

export async function linkGoogleToUser(
  deps: GoogleAuthDeps,
  userId: string,
  input: GoogleAuthInput,
): Promise<{ googleSub: string; email: string; linkedAt: number }> {
  const verified = await verifyRequest(deps, input);

  const existing = await deps.prisma.googleIdentity.findUnique({
    where: { googleSub: verified.googleSub },
  });
  if (existing && existing.userId !== userId) {
    throw new ApiError(409, "google_identity_already_linked", "That Google account is already linked to another user");
  }

  const identity = existing
    ? await deps.prisma.googleIdentity.update({
        where: { googleSub: verified.googleSub },
        data: { lastVerifiedAt: BigInt(input.nowMs), email: verified.email },
      })
    : await deps.prisma.googleIdentity.create({
        data: {
          id: randomUUID(),
          userId,
          googleSub: verified.googleSub,
          email: verified.email,
          emailVerified: true,
          linkedAt: BigInt(input.nowMs),
          lastVerifiedAt: BigInt(input.nowMs),
        },
      });

  await recordAttestation(deps, userId, verified, input);

  return { googleSub: identity.googleSub, email: identity.email, linkedAt: Number(identity.linkedAt) };
}
```

If `signAccessToken`'s parameter order from core Task 6 differs from `(userId, secret, nowMs)`, use the core plan's order and adjust the call. Do not change `jwt.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/services/google_auth_service.test.ts`
Expected: PASS, 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/google_auth_service.ts test/services/google_auth_service.test.ts
git commit -m "feat(api): sign in and link accounts through google play"
```

---

### Task 6: The routes, the config, and the wiring

**Files:**
- Create: `server/apps/api/src/routes/google_auth_routes.ts`
- Modify: `server/apps/api/src/config.ts`
- Modify: `server/apps/api/src/app.ts`
- Modify: `server/apps/api/.env.example`
- Test: `server/apps/api/test/routes/google_auth_routes.test.ts`
- Modify: `server/apps/api/test/config.test.ts`

**Interfaces:**
- Consumes: `verifyWithGoogle`, `linkGoogleToUser`, `createGoogleJwksFetcher`, `createPlayIntegrityDecoder`, `buildApp`, `app.authenticate`.
- Produces: routes `POST /v1/auth/google/verify` and `POST /v1/auth/google/link`; `AppConfig` gains `googleOauthClientId`, `playPackageName`, `playIntegrityServiceAccountJson`, `betaWindowStartAt`, `betaWindowEndAt`, `googleJwksUrl`, `integrityMaxSkewMs`, `googleAuthRateLimitMax`; `buildApp` accepts `{ fetchJwks?: JwksFetcher; decodeIntegrity?: PlayIntegrityDecoder }` as test seams.

- [ ] **Step 1: Extend the config test**

Append to `test/config.test.ts`, and add the new required variables to that file's `VALID_ENV`:

```ts
const GOOGLE_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "123.apps.googleusercontent.com",
  PLAY_PACKAGE_NAME: "com.filldev.peraplano",
  PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: '{"client_email":"a@b","private_key":"pem"}',
  BETA_WINDOW_START_AT: "1750000000000",
  BETA_WINDOW_END_AT: "1760000000000",
} as NodeJS.ProcessEnv;

describe("loadConfig google and play settings", () => {
  it("applies defaults for the optional variables", () => {
    const config = loadConfig({ ...VALID_ENV, ...GOOGLE_ENV });
    expect(config.googleJwksUrl).toBe("https://www.googleapis.com/oauth2/v3/certs");
    expect(config.integrityMaxSkewMs).toBe(300000);
    expect(config.googleAuthRateLimitMax).toBe(20);
    expect(config.betaWindowStartAt).toBe(1750000000000);
  });

  it.each([
    "GOOGLE_OAUTH_CLIENT_ID",
    "PLAY_PACKAGE_NAME",
    "PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON",
    "BETA_WINDOW_START_AT",
    "BETA_WINDOW_END_AT",
  ])("throws when %s is missing", (key) => {
    const env = { ...VALID_ENV, ...GOOGLE_ENV };
    delete env[key];
    expect(() => loadConfig(env)).toThrow(key);
  });

  it("throws when the beta window ends before it starts", () => {
    expect(() =>
      loadConfig({ ...VALID_ENV, ...GOOGLE_ENV, BETA_WINDOW_END_AT: "1740000000000" }),
    ).toThrow("BETA_WINDOW_END_AT");
  });
});
```

- [ ] **Step 2: Run to verify it fails, then extend `loadConfig`**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL, the defaults test reports `undefined` for `googleJwksUrl`.

Add to `AppConfig` and `loadConfig` in `src/config.ts`, following the existing throw-on-missing style:

```ts
  googleOauthClientId: string;
  playPackageName: string;
  playIntegrityServiceAccountJson: string;
  betaWindowStartAt: number;
  betaWindowEndAt: number;
  googleJwksUrl: string;
  integrityMaxSkewMs: number;
  googleAuthRateLimitMax: number;
```

```ts
  const requireVar = (key: string): string => {
    const value = env[key];
    if (!value) throw new Error(`Missing required environment variable: ${key}`);
    return value;
  };

  const requireEpochMs = (key: string): number => {
    const value = Number(requireVar(key));
    if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${key}: ${env[key]}`);
    return value;
  };

  const googleOauthClientId = requireVar("GOOGLE_OAUTH_CLIENT_ID");
  const playPackageName = requireVar("PLAY_PACKAGE_NAME");
  const playIntegrityServiceAccountJson = requireVar("PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON");
  const betaWindowStartAt = requireEpochMs("BETA_WINDOW_START_AT");
  const betaWindowEndAt = requireEpochMs("BETA_WINDOW_END_AT");
  if (betaWindowEndAt <= betaWindowStartAt) {
    throw new Error(`Invalid BETA_WINDOW_END_AT: ${env.BETA_WINDOW_END_AT} is not after BETA_WINDOW_START_AT`);
  }
  const googleJwksUrl = env.GOOGLE_JWKS_URL ?? "https://www.googleapis.com/oauth2/v3/certs";
  const integrityMaxSkewMs =
    env.INTEGRITY_MAX_SKEW_MS === undefined ? 300_000 : Number(env.INTEGRITY_MAX_SKEW_MS);
  if (!Number.isInteger(integrityMaxSkewMs) || integrityMaxSkewMs < 1) {
    throw new Error(`Invalid INTEGRITY_MAX_SKEW_MS: ${env.INTEGRITY_MAX_SKEW_MS}`);
  }
  const googleAuthRateLimitMax =
    env.GOOGLE_AUTH_RATE_LIMIT_MAX === undefined ? 20 : Number(env.GOOGLE_AUTH_RATE_LIMIT_MAX);
  if (!Number.isInteger(googleAuthRateLimitMax) || googleAuthRateLimitMax < 1) {
    throw new Error(`Invalid GOOGLE_AUTH_RATE_LIMIT_MAX: ${env.GOOGLE_AUTH_RATE_LIMIT_MAX}`);
  }
```

Return all eight from `loadConfig`. Append the same keys to `.env.example`, and add the five required ones to `test/setup.ts` so the existing suite keeps booting:

```ts
process.env.GOOGLE_OAUTH_CLIENT_ID ??= "123.apps.googleusercontent.com";
process.env.PLAY_PACKAGE_NAME ??= "com.filldev.peraplano";
process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON ??= '{"client_email":"a@b","private_key":"pem"}';
process.env.BETA_WINDOW_START_AT ??= "1750000000000";
process.env.BETA_WINDOW_END_AT ??= "1760000000000";
```

- [ ] **Step 3: Run the config tests to verify they pass**

Run: `npx vitest run test/config.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing route tests**

`server/apps/api/test/routes/google_auth_routes.test.ts`. Reuse the token and payload builders from Task 5's test file by copying them into this file; the two suites are read independently and a shared fixture module would couple them.

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { resetDb } from "../helpers/db.js";
import { computeRequestHash, type InstallClaim } from "../../src/lib/play_integrity.js";

const PACKAGE = "com.filldev.peraplano";
const AUDIENCE = "123.apps.googleusercontent.com";
const NOW = 1_761_000_000_000;
const KID = "test-key-1";

let app: FastifyInstance;
let privateKeyPem: string;
let jwks: { keys: unknown[] };
let licensingVerdict = "LICENSED";
let requestHashOverride: string | null = null;

const CLAIM: InstallClaim = {
  packageName: PACKAGE,
  claimSource: "package_manager",
  installBeginAt: null,
  firstInstallAt: 1_755_000_000_000,
  appVersionAtInstall: "0.1.0",
};

function makeIdToken(sub = "sub_1", email = "user@example.com", overrides: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      sub,
      email,
      email_verified: true,
      iat: Math.floor(NOW / 1000) - 60,
      exp: Math.floor(NOW / 1000) + 3600,
      ...overrides,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(createPrivateKey(privateKeyPem)).toString("base64url")}`;
}

function body(idToken: string, claim: InstallClaim = CLAIM) {
  return { idToken, integrityToken: "integrity", installClaim: claim };
}

beforeAll(async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] };

  app = buildApp(
    {
      googleOauthClientId: AUDIENCE,
      playPackageName: PACKAGE,
      betaWindowStartAt: 1_750_000_000_000,
      betaWindowEndAt: 1_760_000_000_000,
    },
    {
      fetchJwks: async () => jwks as never,
      decodeIntegrity: async () => ({
        requestDetails: {
          requestPackageName: PACKAGE,
          requestHash: requestHashOverride ?? computeRequestHash(currentIdToken, currentClaim),
          timestampMillis: String(Date.now()),
        },
        appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
        accountDetails: { appLicensingVerdict: licensingVerdict },
      }),
    },
  );
  await app.ready();
});

let currentIdToken = "";
let currentClaim: InstallClaim = CLAIM;

async function post(url: string, idToken: string, claim: InstallClaim = CLAIM, headers: Record<string, string> = {}) {
  currentIdToken = idToken;
  currentClaim = claim;
  return app.inject({ method: "POST", url, payload: body(idToken, claim), headers });
}

beforeEach(async () => {
  await resetDb(app.prisma);
  licensingVerdict = "LICENSED";
  requestHashOverride = null;
});

afterAll(async () => {
  await app.close();
});

describe("POST /v1/auth/google/verify", () => {
  it("returns exactly the four OTP-verify keys and nothing about tier", async () => {
    const response = await post("/v1/auth/google/verify", makeIdToken());
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(Object.keys(payload).sort()).toEqual(["accessToken", "refreshToken", "user"]);
    expect(Object.keys(payload.user).sort()).toEqual(["destination", "id"]);
  });

  it("issues a token pair that the entitlements route accepts", async () => {
    const verify = await post("/v1/auth/google/verify", makeIdToken());
    const entitlements = await app.inject({
      method: "GET",
      url: "/v1/entitlements",
      headers: { authorization: `Bearer ${verify.json().accessToken}` },
    });
    expect(entitlements.json()).toEqual({ tier: "plus", source: "beta_cohort" });
  });

  it("rejects a body missing installClaim with validation_error", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/google/verify",
      payload: { idToken: "a", integrityToken: "b" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("validation_error");
  });

  it("rejects an unknown extra field", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/google/verify",
      payload: { ...body(makeIdToken()), sneaky: "value" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 401 invalid_google_token for a foreign audience", async () => {
    const response = await post("/v1/auth/google/verify", makeIdToken("s", "e@example.com", { aud: "999" }));
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("invalid_google_token");
  });

  it("returns 401 google_email_unverified", async () => {
    const response = await post(
      "/v1/auth/google/verify",
      makeIdToken("s", "e@example.com", { email_verified: false }),
    );
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("google_email_unverified");
  });

  it("returns 401 integrity_request_mismatch when the hash is bound elsewhere", async () => {
    requestHashOverride = "not-the-right-hash";
    const response = await post("/v1/auth/google/verify", makeIdToken());
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("integrity_request_mismatch");
  });

  it("returns 403 app_not_play_licensed for a sideloaded install", async () => {
    licensingVerdict = "UNLICENSED";
    const response = await post("/v1/auth/google/verify", makeIdToken());
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("app_not_play_licensed");
  });

  it("returns 400 install_claim_invalid when both timestamps are null", async () => {
    const response = await post("/v1/auth/google/verify", makeIdToken(), {
      ...CLAIM,
      installBeginAt: null,
      firstInstallAt: null,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("install_claim_invalid");
  });
});

describe("POST /v1/auth/google/link", () => {
  it("requires a bearer token", async () => {
    const response = await post("/v1/auth/google/link", makeIdToken());
    expect(response.statusCode).toBe(401);
  });

  it("links a google account to the authenticated user", async () => {
    const first = await post("/v1/auth/google/verify", makeIdToken("sub_a", "a@example.com"));
    const accessToken = first.json().accessToken;
    const response = await post("/v1/auth/google/link", makeIdToken("sub_a", "a@example.com"), CLAIM, {
      authorization: `Bearer ${accessToken}`,
    });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json())).toEqual(["identity"]);
    expect(response.json().identity.googleSub).toBe("sub_a");
  });

  it("returns 409 google_identity_already_linked", async () => {
    const owner = await post("/v1/auth/google/verify", makeIdToken("sub_b", "b@example.com"));
    const other = await post("/v1/auth/google/verify", makeIdToken("sub_c", "c@example.com"));
    expect(owner.statusCode).toBe(200);

    const response = await post("/v1/auth/google/link", makeIdToken("sub_b", "b@example.com"), CLAIM, {
      authorization: `Bearer ${other.json().accessToken}`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("google_identity_already_linked");
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run test/routes/google_auth_routes.test.ts`
Expected: FAIL, every route returns 404 because `google_auth_routes.ts` is not registered.

- [ ] **Step 6: Implement the routes**

`server/apps/api/src/routes/google_auth_routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { ApiError } from "../lib/errors.js";
import type { InstallClaim } from "../lib/play_integrity.js";
import { linkGoogleToUser, verifyWithGoogle, type GoogleAuthDeps } from "../services/google_auth_service.js";

const INSTALL_CLAIM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["packageName", "claimSource", "installBeginAt", "firstInstallAt", "appVersionAtInstall"],
  properties: {
    packageName: { type: "string", minLength: 1 },
    claimSource: { type: "string", enum: ["install_referrer", "package_manager"] },
    installBeginAt: { type: ["integer", "null"] },
    firstInstallAt: { type: ["integer", "null"] },
    appVersionAtInstall: { type: ["string", "null"] },
  },
} as const;

const BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["idToken", "integrityToken", "installClaim"],
  properties: {
    idToken: { type: "string", minLength: 1 },
    integrityToken: { type: "string", minLength: 1 },
    installClaim: INSTALL_CLAIM_SCHEMA,
  },
} as const;

type GoogleAuthBody = { idToken: string; integrityToken: string; installClaim: InstallClaim };

/** Both timestamps null means the client sent no evidence at all, which the cohort rule cannot evaluate. */
function assertClaimUsable(claim: InstallClaim): void {
  if (claim.installBeginAt === null && claim.firstInstallAt === null) {
    throw new ApiError(400, "install_claim_invalid", "The install claim carries no timestamp");
  }
}

export async function googleAuthRoutes(app: FastifyInstance, deps: GoogleAuthDeps): Promise<void> {
  const rateLimit = {
    max: app.config.googleAuthRateLimitMax,
    timeWindow: "1 minute",
  };

  app.post<{ Body: GoogleAuthBody }>(
    "/v1/auth/google/verify",
    { schema: { body: BODY_SCHEMA }, config: { rateLimit } },
    async (request) => {
      assertClaimUsable(request.body.installClaim);
      return verifyWithGoogle(deps, {
        idToken: request.body.idToken,
        integrityToken: request.body.integrityToken,
        claim: request.body.installClaim,
        nowMs: Date.now(),
      });
    },
  );

  app.post<{ Body: GoogleAuthBody }>(
    "/v1/auth/google/link",
    { schema: { body: BODY_SCHEMA }, preHandler: app.authenticate, config: { rateLimit } },
    async (request) => {
      assertClaimUsable(request.body.installClaim);
      const identity = await linkGoogleToUser(deps, request.userId, {
        idToken: request.body.idToken,
        integrityToken: request.body.integrityToken,
        claim: request.body.installClaim,
        nowMs: Date.now(),
      });
      return { identity };
    },
  );
}
```

`Date.now()` appears here and only here, at the process boundary. Every function below the route takes `nowMs` as an argument, which is what makes the window rules testable.

- [ ] **Step 7: Wire it into `buildApp`**

In `src/app.ts`, add the optional second parameter and register the routes:

```ts
import { createGoogleJwksFetcher, type JwksFetcher } from "./lib/google_id_token.js";
import { createPlayIntegrityDecoder, type PlayIntegrityDecoder } from "./lib/play_integrity.js";
import { googleAuthRoutes } from "./routes/google_auth_routes.js";

export type BuildAppSeams = {
  fetchJwks?: JwksFetcher;
  decodeIntegrity?: PlayIntegrityDecoder;
};

export function buildApp(overrides?: Partial<AppConfig>, seams?: BuildAppSeams): FastifyInstance {
  // ... existing plugin and route registration ...

  const fetchJwks =
    seams?.fetchJwks ?? createGoogleJwksFetcher({ url: app.config.googleJwksUrl });
  const decodeIntegrity =
    seams?.decodeIntegrity ??
    createPlayIntegrityDecoder({
      packageName: app.config.playPackageName,
      serviceAccountJson: app.config.playIntegrityServiceAccountJson,
    });

  app.register(async (instance) => {
    await googleAuthRoutes(instance, {
      prisma: app.prisma,
      fetchJwks,
      decodeIntegrity,
      expectedAudience: app.config.googleOauthClientId,
      expectedPackageName: app.config.playPackageName,
      jwtSecret: app.config.jwtSecret,
      betaWindowStartAt: app.config.betaWindowStartAt,
      betaWindowEndAt: app.config.betaWindowEndAt,
      maxSkewMs: app.config.integrityMaxSkewMs,
    });
  });

  return app;
}
```

The real adapters are constructed lazily as defaults, so a test that passes seams never parses the service-account key and never opens a socket.

- [ ] **Step 8: Run the route tests to verify they pass**

Run: `npx vitest run test/routes/google_auth_routes.test.ts`
Expected: PASS, 12 tests green.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS. If `buildApp` callers in earlier core tests break, the second parameter was made required instead of optional.

- [ ] **Step 10: Commit**

```bash
git add src/routes/google_auth_routes.ts src/app.ts src/config.ts .env.example test/setup.ts test/config.test.ts test/routes/google_auth_routes.test.ts
git commit -m "feat(api): expose the google verify and link routes"
```

---

### Task 7: Capture install evidence on the device

**Ship this in the next mobile release even if the server is not ready.** The device is the only source of an install date, and an uninstall destroys it.

**Files:**
- Modify: `mobile/package.json` (add `expo-application`)
- Create: `mobile/lib/onboarding/install_evidence.ts`
- Test: `mobile/lib/onboarding/__tests__/install_evidence.test.ts`
- Modify: `mobile/lib/bootstrap.ts`

**Interfaces:**
- Produces:
  - `type InstallEvidence = { firstInstallAt: number | null; installReferrer: string | null; capturedAt: number; appVersionAtInstall: string | null }`
  - `captureInstallEvidence(nowMs: number): Promise<InstallEvidence>`
  - `getStoredInstallEvidence(): Promise<InstallEvidence | null>`

`expo-application` exposes `getInstallationTimeAsync(): Promise<Date>`, backed by Android's `PackageInfo.firstInstallTime`, and `getInstallReferrerAsync(): Promise<string>`, which returns the referrer **string only**. The Play-supplied install-begin timestamp is not available through it, so this task produces `claimSource: "package_manager"` claims. Task 9's note covers the native module that would upgrade them.

- [ ] **Step 1: Install the dependency**

Run: `npx expo install expo-application`
Expected: `expo-application` appears in `mobile/package.json` dependencies at the SDK-matched version.

- [ ] **Step 2: Write the failing test**

`mobile/lib/onboarding/__tests__/install_evidence.test.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { captureInstallEvidence, getStoredInstallEvidence } from "../install_evidence";

jest.mock("expo-application", () => ({
  getInstallationTimeAsync: jest.fn(),
  getInstallReferrerAsync: jest.fn(),
  nativeApplicationVersion: "0.1.0",
}));

const NOW = 1_756_000_000_000;
const INSTALLED_AT = 1_755_000_000_000;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  (Application.getInstallationTimeAsync as jest.Mock).mockResolvedValue(new Date(INSTALLED_AT));
  (Application.getInstallReferrerAsync as jest.Mock).mockResolvedValue("utm_source=google-play");
});

describe("captureInstallEvidence", () => {
  it("records the first install time and the referrer", async () => {
    const evidence = await captureInstallEvidence(NOW);
    expect(evidence).toEqual({
      firstInstallAt: INSTALLED_AT,
      installReferrer: "utm_source=google-play",
      capturedAt: NOW,
      appVersionAtInstall: "0.1.0",
    });
  });

  it("never overwrites evidence captured earlier", async () => {
    await captureInstallEvidence(NOW);
    (Application.getInstallationTimeAsync as jest.Mock).mockResolvedValue(new Date(NOW));
    const second = await captureInstallEvidence(NOW + 1_000_000);
    expect(second.firstInstallAt).toBe(INSTALLED_AT);
    expect(second.capturedAt).toBe(NOW);
  });

  it("stores nulls rather than throwing when the native calls fail", async () => {
    (Application.getInstallationTimeAsync as jest.Mock).mockRejectedValue(new Error("unavailable"));
    (Application.getInstallReferrerAsync as jest.Mock).mockRejectedValue(new Error("unavailable"));
    const evidence = await captureInstallEvidence(NOW);
    expect(evidence.firstInstallAt).toBeNull();
    expect(evidence.installReferrer).toBeNull();
  });
});

describe("getStoredInstallEvidence", () => {
  it("returns null before anything is captured", async () => {
    expect(await getStoredInstallEvidence()).toBeNull();
  });

  it("returns what capture stored", async () => {
    await captureInstallEvidence(NOW);
    expect((await getStoredInstallEvidence())?.firstInstallAt).toBe(INSTALLED_AT);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest lib/onboarding/__tests__/install_evidence.test.ts --ci`
Expected: FAIL, cannot resolve `../install_evidence`.

- [ ] **Step 4: Implement the capture**

`mobile/lib/onboarding/install_evidence.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";

const STORAGE_KEY = "install_evidence_v1";

export type InstallEvidence = {
  firstInstallAt: number | null;
  installReferrer: string | null;
  capturedAt: number;
  appVersionAtInstall: string | null;
};

async function readNumberOrNull(read: () => Promise<Date>): Promise<number | null> {
  try {
    return (await read()).getTime();
  } catch {
    return null;
  }
}

async function readStringOrNull(read: () => Promise<string>): Promise<string | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export async function getStoredInstallEvidence(): Promise<InstallEvidence | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as InstallEvidence);
}

/**
 * Write-once. The install date is the one fact this app cannot reconstruct later
 * (see the linking design section 3), so a second capture must never replace a
 * first one with a value read after a reinstall.
 */
export async function captureInstallEvidence(nowMs: number): Promise<InstallEvidence> {
  const existing = await getStoredInstallEvidence();
  if (existing !== null) return existing;

  const evidence: InstallEvidence = {
    firstInstallAt: await readNumberOrNull(Application.getInstallationTimeAsync),
    installReferrer: await readStringOrNull(Application.getInstallReferrerAsync),
    capturedAt: nowMs,
    appVersionAtInstall: Application.nativeApplicationVersion,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(evidence));
  return evidence;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest lib/onboarding/__tests__/install_evidence.test.ts --ci`
Expected: PASS, 5 tests green.

- [ ] **Step 6: Call it during bootstrap**

In `mobile/lib/bootstrap.ts`, call `captureInstallEvidence(Date.now())` alongside the other startup work, awaited but wrapped so a failure never blocks launch:

```ts
import { captureInstallEvidence } from "./onboarding/install_evidence";

  // inside the existing bootstrap sequence:
  await captureInstallEvidence(Date.now()).catch(() => undefined);
```

- [ ] **Step 7: Run the mobile suite**

Run: `npx jest --ci`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/lib/onboarding/install_evidence.ts mobile/lib/onboarding/__tests__/install_evidence.test.ts mobile/lib/bootstrap.ts
git commit -m "feat(mobile): capture install evidence once, on first launch"
```

---

### Task 8: The mobile Google sign-in client

**Files:**
- Create: `mobile/lib/onboarding/google_link_client.ts`
- Test: `mobile/lib/onboarding/__tests__/google_link_client.test.ts`

**Interfaces:**
- Consumes: `getStoredInstallEvidence` (Task 7); the routes from Task 6.
- Produces:
  - `buildInstallClaim(evidence: InstallEvidence | null, packageName: string): InstallClaim`
  - `computeRequestHash(idToken: string, claim: InstallClaim): Promise<string>`
  - `signInWithGoogle(deps: GoogleLinkDeps): Promise<{ accessToken: string; refreshToken: string; user: { id: string; destination: string } }>`

**The request hash must byte-match the server.** Task 3 pins the canonical form: a JSON object with exactly `appVersionAtInstall`, `claimSource`, `firstInstallAt`, `installBeginAt`, `packageName`, in that order, no whitespace, then `sha256(idToken + "." + canonical)` encoded base64url. The test below asserts a fixed vector so a change on either side fails loudly instead of silently rejecting every user.

- [ ] **Step 1: Write the failing test**

`mobile/lib/onboarding/__tests__/google_link_client.test.ts`:

```ts
import { buildInstallClaim, computeRequestHash } from "../google_link_client";

const PACKAGE = "com.filldev.peraplano";

describe("buildInstallClaim", () => {
  it("maps stored evidence onto a package_manager claim", () => {
    expect(
      buildInstallClaim(
        {
          firstInstallAt: 1_750_000_000_000,
          installReferrer: "utm_source=google-play",
          capturedAt: 1_756_000_000_000,
          appVersionAtInstall: "0.1.0",
        },
        PACKAGE,
      ),
    ).toEqual({
      packageName: PACKAGE,
      claimSource: "package_manager",
      installBeginAt: null,
      firstInstallAt: 1_750_000_000_000,
      appVersionAtInstall: "0.1.0",
    });
  });

  it("produces an all-null claim when nothing was captured", () => {
    const claim = buildInstallClaim(null, PACKAGE);
    expect(claim.firstInstallAt).toBeNull();
    expect(claim.installBeginAt).toBeNull();
  });
});

describe("computeRequestHash", () => {
  it("matches the server's canonical serialization for a fixed vector", async () => {
    const claim = buildInstallClaim(
      {
        firstInstallAt: 1_750_000_000_000,
        installReferrer: null,
        capturedAt: 1_756_000_000_000,
        appVersionAtInstall: "0.1.0",
      },
      PACKAGE,
    );
    // Fixed vector, computed independently of both implementations from the
    // canonical string in Task 3:
    //   sha256("header.payload.signature." + canonicalClaimJson(claim)) as base64url
    // A mismatch here means the two canonical forms have diverged.
    expect(await computeRequestHash("header.payload.signature", claim)).toBe(
      "93FKR_3bMXQjd9Z33gZoVd0Ltoy9pOhiqvHBHakkPNo",
    );
  });
});
```

The expected value is a literal, not something recomputed by the code under test. A self-referential
assertion passes happily while both sides are wrong together, which is exactly the failure this
cross-boundary test exists to catch. Add the identical vector as a case in
`server/apps/api/test/lib/play_integrity.test.ts` so both ends assert against the same constant:

```ts
  it("matches the fixed cross-boundary vector the mobile client asserts", () => {
    expect(
      computeRequestHash("header.payload.signature", {
        packageName: "com.filldev.peraplano",
        claimSource: "package_manager",
        installBeginAt: null,
        firstInstallAt: 1_750_000_000_000,
        appVersionAtInstall: "0.1.0",
      }),
    ).toBe("93FKR_3bMXQjd9Z33gZoVd0Ltoy9pOhiqvHBHakkPNo");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest lib/onboarding/__tests__/google_link_client.test.ts --ci`
Expected: FAIL, cannot resolve `../google_link_client`.

- [ ] **Step 3: Implement the client**

`mobile/lib/onboarding/google_link_client.ts`:

```ts
import * as Crypto from "expo-crypto";
import type { InstallEvidence } from "./install_evidence";

export type InstallClaimSource = "install_referrer" | "package_manager";

export type InstallClaim = {
  packageName: string;
  claimSource: InstallClaimSource;
  installBeginAt: number | null;
  firstInstallAt: number | null;
  appVersionAtInstall: string | null;
};

export type GoogleLinkDeps = {
  baseUrl: string;
  packageName: string;
  getIdToken: () => Promise<string>;
  getIntegrityToken: (requestHash: string) => Promise<string>;
  getEvidence: () => Promise<InstallEvidence | null>;
  fetchImpl?: typeof fetch;
};

export function buildInstallClaim(evidence: InstallEvidence | null, packageName: string): InstallClaim {
  return {
    packageName,
    claimSource: "package_manager",
    installBeginAt: null,
    firstInstallAt: evidence?.firstInstallAt ?? null,
    appVersionAtInstall: evidence?.appVersionAtInstall ?? null,
  };
}

/**
 * MUST match server/apps/api/src/lib/play_integrity.ts canonicalClaimJson exactly:
 * five keys, alphabetical, no whitespace. Changing one side without the other
 * rejects every request with integrity_request_mismatch.
 */
function canonicalClaimJson(claim: InstallClaim): string {
  return JSON.stringify({
    appVersionAtInstall: claim.appVersionAtInstall,
    claimSource: claim.claimSource,
    firstInstallAt: claim.firstInstallAt,
    installBeginAt: claim.installBeginAt,
    packageName: claim.packageName,
  });
}

export async function computeRequestHash(idToken: string, claim: InstallClaim): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${idToken}.${canonicalClaimJson(claim)}`,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signInWithGoogle(
  deps: GoogleLinkDeps,
): Promise<{ accessToken: string; refreshToken: string; user: { id: string; destination: string } }> {
  const doFetch = deps.fetchImpl ?? fetch;
  const idToken = await deps.getIdToken();
  const claim = buildInstallClaim(await deps.getEvidence(), deps.packageName);
  const integrityToken = await deps.getIntegrityToken(await computeRequestHash(idToken, claim));

  const response = await doFetch(`${deps.baseUrl}/v1/auth/google/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken, integrityToken, installClaim: claim }),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: { code?: string } };
    throw new Error(body.error?.code ?? "google_sign_in_failed");
  }
  return response.json() as Promise<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; destination: string };
  }>;
}
```

`expo-crypto` is already a dependency and returns base64, so the three replacements convert it to the base64url the server computes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest lib/onboarding/__tests__/google_link_client.test.ts --ci`
Expected: PASS, 3 tests green, with the pasted vector matching.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/onboarding/google_link_client.ts mobile/lib/onboarding/__tests__/google_link_client.test.ts
git commit -m "feat(mobile): build and sign google link requests"
```

**Deferred here on purpose, and each needs its own task when the server is deployable:** obtaining the Google ID token through Credential Manager, obtaining the Play Integrity token, storing the returned token pair, and wiring `getTier()` to the server value. They need a reachable API and real Google client credentials, neither of which exists while Task 6 is unmerged. The native module that would supply a Play-sourced `installBeginAt`, upgrading claims from `package_manager` to `install_referrer`, is also its own task and improves claim quality without changing any contract.

---

### Task 9: Revise the privacy documents

Identity linking makes `07-privacy-and-compliance.md` §1 literally untrue as written. Play submission and the privacy notice both depend on this, so it ships in the same release as Task 6, not after it.

**Files:**
- Modify: `docs/07-privacy-and-compliance.md`
- Modify: `docs/09-v2-backlog.md`
- Modify: `docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md`

- [ ] **Step 1: Correct the posture paragraph**

`07-privacy-and-compliance.md` §1 says "A Free-tier user's financial data therefore never touches a server at all." Keep that sentence, since it stays true, and add the identity carve-out immediately after it: a linked Google account sends a verified email address and a Google subject id to the server for identity and entitlement, no financial data accompanies it, and linking is optional.

- [ ] **Step 2: Add the lawful-basis row**

In §2.3's table, add: **Google account linking (identity and entitlement)**, lawful basis **consent**, note that the account is linked only on explicit user action, that the data is a verified email address, a Google subject id, and a device-attested install timestamp, and that unlinking is available.

- [ ] **Step 3: Add the lifecycle rows**

In §4's table, add `google_identities` and `install_attestations`, with what each stores, where it lives, and its retention. §2.4's rule binds here: this table and the notice must be revised in the same release.

- [ ] **Step 4: Correct the falsified premise in the backlog**

`09-v2-backlog.md` §2.12 states that Play Console install records are the only surviving evidence of the beta cohort. Replace that with §3 fact 3 of the linking design: Play Console does not expose per-account install dates at all, the device is the only source, and it is lost on uninstall. Mark prerequisite 3 obsolete and point at this plan's Task 7.

- [ ] **Step 5: Note the reversal in the revamp spec**

`2026-08-22-mobile-ui-revamp-design.md` §6.3 chose not to persist `first_install_at`. Add a dated note that Task 7 reverses it, with the reason, so the next reader does not treat the original decision as still standing.

- [ ] **Step 6: Update the Play Data safety form checklist**

Record in §3 that the Data safety declaration gains "personal identifiers, email address" collected for account management, optional, not shared, and that the declaration must be updated before the release ships.

- [ ] **Step 7: Commit**

```bash
git add docs/07-privacy-and-compliance.md docs/09-v2-backlog.md docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md
git commit -m "docs: record what google account linking changes for privacy"
```

---

## Open questions this plan cannot close

| # | Question | Blocks |
|---|---|---|
| O1 | How long Install Referrer data stays retrievable after install. Unconfirmed. | Nothing here. Task 7 captures `firstInstallAt` regardless, and the referrer string opportunistically. |
| O2 | The exact beta window as two epoch-ms values. | Task 6's `.env` for any real deployment. Tests use fixed literals, so implementation is unblocked. |
| O3 | Whether a Google identity changes the NPC registration position, given a Free user's device now contacts a server for identity. | Release, not implementation. Task 9 documents the change; counsel decides whether registration must precede launch. |
