import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID, createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../helpers/db.js";
import {
  computeRequestHash,
  type InstallClaim,
  type IntegrityPayload,
} from "../../src/lib/play_integrity.js";
import type { GoogleJwks, JwksFetcher } from "../../src/lib/google_id_token.js";
import {
  linkGoogleToUser,
  verifyWithGoogle,
  type GoogleAuthDeps,
} from "../../src/services/google_auth_service.js";

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
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID })).toString(
    "base64url",
  );
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
    fetchJwks: () => Promise.resolve(jwks),
    decodeIntegrity: () => Promise.resolve({} as IntegrityPayload),
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
    decodeIntegrity: () =>
      Promise.resolve({
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

    const attestation = await prisma.installAttestation.findFirst({
      where: { userId: result.user.id },
    });
    expect(attestation?.cohortGranted).toBe(true);
    expect(attestation?.claimSource).toBe("package_manager");

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: result.user.id } });
    expect(entitlement?.source).toBe("beta_cohort");
  });

  it("returns the same user on a second sign-in and does not duplicate the identity", async () => {
    const idToken = makeIdToken("sub_1", "first@example.com");
    const deps = depsFor(idToken, IN_WINDOW);
    const first = await verifyWithGoogle(deps, {
      idToken,
      integrityToken: "it",
      claim: IN_WINDOW,
      nowMs: NOW,
    });
    const second = await verifyWithGoogle(deps, {
      idToken,
      integrityToken: "it",
      claim: IN_WINDOW,
      nowMs: NOW + 1000,
    });

    expect(second.user.id).toBe(first.user.id);
    expect(await prisma.googleIdentity.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
    // One attestation per verified call, granted or not: a permanent Plus grant
    // has to stay explainable a year later.
    expect(await prisma.installAttestation.count()).toBe(2);
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

    const attestation = await prisma.installAttestation.findFirst({
      where: { userId: result.user.id },
    });
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
    ).rejects.toMatchObject({ code: "app_not_play_licensed" });
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.googleIdentity.count()).toBe(0);
    expect(await prisma.installAttestation.count()).toBe(0);
    expect(await prisma.entitlement.count()).toBe(0);
  });

  it("writes nothing when the id token itself does not verify", async () => {
    const idToken = makeIdToken("sub_bad", "forged@example.com");
    const deps = makeDeps({ expectedAudience: "999.apps.googleusercontent.com" });
    await expect(
      verifyWithGoogle(deps, { idToken, integrityToken: "it", claim: IN_WINDOW, nowMs: NOW }),
    ).rejects.toMatchObject({ code: "invalid_google_token" });
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.googleIdentity.count()).toBe(0);
    expect(await prisma.installAttestation.count()).toBe(0);
  });

  it("lets an unlicensed pre-Play tester in when a pregrant covers their email", async () => {
    await prisma.betaPregrant.create({
      data: {
        id: randomUUID(),
        email: "tester@example.com",
        note: "adb tester, predates Play",
        createdAt: BigInt(NOW - 100_000),
      },
    });
    const idToken = makeIdToken("sub_8", "tester@example.com");
    const result = await verifyWithGoogle(depsFor(idToken, OUT_OF_WINDOW, "UNLICENSED"), {
      idToken,
      integrityToken: "it",
      claim: OUT_OF_WINDOW,
      nowMs: NOW,
    });

    const entitlement = await prisma.entitlement.findUnique({ where: { userId: result.user.id } });
    expect(entitlement?.source).toBe("manual_grant");
    const pregrant = await prisma.betaPregrant.findUniqueOrThrow({
      where: { email: "tester@example.com" },
    });
    expect(pregrant.claimedByUserId).toBe(result.user.id);
    const attestation = await prisma.installAttestation.findFirst({
      where: { userId: result.user.id },
    });
    expect(attestation?.licensingVerdict).toBe("UNLICENSED");
  });

  it("still rejects an unlicensed account whose pregrant was already claimed", async () => {
    await prisma.betaPregrant.create({
      data: {
        id: randomUUID(),
        email: "spent@example.com",
        note: "already used",
        createdAt: BigInt(NOW - 100_000),
        claimedAt: BigInt(NOW - 50_000),
        claimedByUserId: randomUUID(),
      },
    });
    const idToken = makeIdToken("sub_9", "spent@example.com");
    await expect(
      verifyWithGoogle(depsFor(idToken, IN_WINDOW, "UNLICENSED"), {
        idToken,
        integrityToken: "it",
        claim: IN_WINDOW,
        nowMs: NOW,
      }),
    ).rejects.toMatchObject({ code: "app_not_play_licensed" });
  });

  it("still enforces request binding for a pregranted email", async () => {
    await prisma.betaPregrant.create({
      data: {
        id: randomUUID(),
        email: "bound@example.com",
        note: "tester",
        createdAt: BigInt(NOW - 100_000),
      },
    });
    const idToken = makeIdToken("sub_10", "bound@example.com");
    const deps = makeDeps({
      decodeIntegrity: () =>
        Promise.resolve({
          requestDetails: {
            requestPackageName: PACKAGE,
            requestHash: "wrong-hash",
            timestampMillis: String(NOW),
          },
          appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
          accountDetails: { appLicensingVerdict: "UNLICENSED" },
        }),
    });
    await expect(
      verifyWithGoogle(deps, { idToken, integrityToken: "it", claim: IN_WINDOW, nowMs: NOW }),
    ).rejects.toMatchObject({ code: "integrity_request_mismatch" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("refetches the key set once when no published key matches the token kid", async () => {
    const idToken = makeIdToken("sub_12", "rotated@example.com");
    const stale: GoogleJwks = { keys: jwks.keys.map((key) => ({ ...key, kid: "stale-key" })) };
    let calls = 0;
    const fetchJwks: JwksFetcher = (forceRefresh) => {
      calls += 1;
      return Promise.resolve(forceRefresh === true ? jwks : stale);
    };
    const result = await verifyWithGoogle(
      { ...depsFor(idToken, IN_WINDOW), fetchJwks },
      { idToken, integrityToken: "it", claim: IN_WINDOW, nowMs: NOW },
    );

    expect(calls).toBe(2);
    expect(result.user.destination).toBe("rotated@example.com");
  });

  it("refetches at most once, so an arbitrary kid cannot drive unbounded upstream calls", async () => {
    const idToken = makeIdToken("sub_13", "unknown@example.com");
    const stale: GoogleJwks = { keys: jwks.keys.map((key) => ({ ...key, kid: "stale-key" })) };
    let calls = 0;
    const fetchJwks: JwksFetcher = () => {
      calls += 1;
      return Promise.resolve(stale);
    };
    await expect(
      verifyWithGoogle(
        { ...depsFor(idToken, IN_WINDOW), fetchJwks },
        { idToken, integrityToken: "it", claim: IN_WINDOW, nowMs: NOW },
      ),
    ).rejects.toMatchObject({ code: "invalid_google_token" });
    expect(calls).toBe(2);
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
    expect(await prisma.installAttestation.count()).toBe(1);
  });

  it("is idempotent when the caller re-links the same google account", async () => {
    const userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, destination: "again@example.com", createdAt: BigInt(NOW - 10_000) },
    });
    const idToken = makeIdToken("sub_14", "again-google@example.com");
    const input = { idToken, integrityToken: "it", claim: IN_WINDOW, nowMs: NOW };
    await linkGoogleToUser(depsFor(idToken, IN_WINDOW), userId, input);
    const second = await linkGoogleToUser(depsFor(idToken, IN_WINDOW), userId, {
      ...input,
      nowMs: NOW + 1000,
    });

    expect(second.linkedAt).toBe(NOW);
    expect(await prisma.googleIdentity.count()).toBe(1);
    expect(await prisma.installAttestation.count()).toBe(2);
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
    ).rejects.toMatchObject({ code: "google_identity_already_linked" });
  });

  it("refuses a caller who is already linked to a different google account", async () => {
    const userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, destination: "one@example.com", createdAt: BigInt(NOW - 10_000) },
    });
    const firstToken = makeIdToken("sub_15", "one-google@example.com");
    await linkGoogleToUser(depsFor(firstToken, IN_WINDOW), userId, {
      idToken: firstToken,
      integrityToken: "it",
      claim: IN_WINDOW,
      nowMs: NOW,
    });

    const secondToken = makeIdToken("sub_16", "two-google@example.com");
    await expect(
      linkGoogleToUser(depsFor(secondToken, IN_WINDOW), userId, {
        idToken: secondToken,
        integrityToken: "it",
        claim: IN_WINDOW,
        nowMs: NOW + 1000,
      }),
    ).rejects.toMatchObject({ code: "user_already_linked" });
    const identity = await prisma.googleIdentity.findUniqueOrThrow({ where: { userId } });
    expect(identity.googleSub).toBe("sub_15");
    expect(await prisma.googleIdentity.count()).toBe(1);
  });
});
