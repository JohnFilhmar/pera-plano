import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../lib/errors.js";
import { qualifiesForBetaCohort } from "../lib/beta_cohort.js";
import { signAccessToken } from "../lib/jwt.js";
import {
  assertPlayLicensed,
  assertRequestBinding,
  type InstallClaim,
  type PlayIntegrityDecoder,
} from "../lib/play_integrity.js";
import {
  jwksHasKid,
  readIdTokenKid,
  verifyGoogleIdToken,
  type GoogleIdentityClaims,
  type JwksFetcher,
} from "../lib/google_id_token.js";
import { issueRefreshToken } from "./auth_service.js";
import { claimPregrantIfAny, grantBetaCohort } from "./entitlement_service.js";

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
 * Google publishes new signing keys ahead of using them, so a stale cache is
 * usually harmless. "Usually" is not a guarantee, and the failure mode is a
 * total sign-in outage for the rest of the TTL. On a key id the cached set does
 * not carry, refetch exactly once and verify against the fresh set.
 *
 * Exactly once, never in a loop: the `kid` is attacker-controlled, so a retry
 * per attempt is a request amplifier pointed at Google.
 */
async function verifyIdTokenWithRefresh(
  deps: GoogleAuthDeps,
  input: GoogleAuthInput,
): Promise<GoogleIdentityClaims> {
  let jwks = await deps.fetchJwks();
  const kid = readIdTokenKid(input.idToken);
  if (kid !== null && !jwksHasKid(jwks, kid)) {
    jwks = await deps.fetchJwks(true);
  }
  return verifyGoogleIdToken({
    idToken: input.idToken,
    jwks,
    expectedAudience: deps.expectedAudience,
    nowMs: input.nowMs,
    maxSkewMs: deps.maxSkewMs,
  });
}

/**
 * Both entry points share this. Every Google and Play check happens here, before
 * any write, so a rejected request leaves no rows behind.
 */
async function verifyRequest(
  deps: GoogleAuthDeps,
  input: GoogleAuthInput,
): Promise<VerifiedRequest> {
  const claims = await verifyIdTokenWithRefresh(deps, input);

  const payload = await deps.decodeIntegrity(input.integrityToken);

  // Binding is enforced for everyone. A pregrant excuses a missing Play licence,
  // never an unbound or replayed integrity token. Reversing that order would
  // turn the pregrant list into a replay bypass for anyone who learns an email
  // on it.
  assertRequestBinding({
    payload,
    idToken: input.idToken,
    claim: input.claim,
    expectedPackageName: deps.expectedPackageName,
    nowMs: input.nowMs,
    maxSkewMs: deps.maxSkewMs,
  });

  const pregrant = await deps.prisma.betaPregrant.findUnique({ where: { email: claims.email } });
  const hasUnclaimedPregrant = pregrant !== null && pregrant.claimedAt === null;
  if (!hasUnclaimedPregrant) {
    assertPlayLicensed(payload);
  }

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

/**
 * Written on EVERY verified call, granted or not. A permanent Plus grant has to
 * still be explainable a year from now, and the row that explains it is this one.
 */
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
      installBeginAt:
        input.claim.installBeginAt === null ? null : BigInt(input.claim.installBeginAt),
      firstInstallAt:
        input.claim.firstInstallAt === null ? null : BigInt(input.claim.firstInstallAt),
      appVersionAtInstall: input.claim.appVersionAtInstall,
      licensingVerdict: verified.licensingVerdict,
      recognitionVerdict: verified.recognitionVerdict,
      cohortGranted: verified.qualifies,
      createdAt: BigInt(input.nowMs),
    },
  });
  if (verified.qualifies) {
    await grantBetaCohort(deps.prisma, userId, input.nowMs);
    return;
  }
  // Pre-Play testers cannot produce a LICENSED verdict, so the pregrant list is
  // their only route (design section 7.1). Checked only when the automatic rule
  // did not already grant, so a Play install never consumes a pregrant.
  await claimPregrantIfAny(deps.prisma, userId, verified.email, input.nowMs);
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
    const user = await deps.prisma.user.findUniqueOrThrow({
      where: { id: existingIdentity.userId },
    });
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
    throw new ApiError(
      409,
      "google_identity_already_linked",
      "That Google account is already linked to another user",
    );
  }

  // `google_identities.user_id` is UNIQUE (Task 1 had to add it: Prisma cannot
  // express this plan's own one-to-one back-relation without it). So a bare
  // create below raises a unique violation whenever the caller already has a
  // DIFFERENT Google account linked, surfacing as a 500. Refuse explicitly.
  //
  // Refusing rather than replacing is deliberate. Silently repointing an account
  // at a new Google login is an account-takeover primitive: momentary access to a
  // session would become permanent ownership. Changing the linked account has to
  // be an explicit unlink-then-link flow, which is out of scope here.
  //
  // This code is NOT the same as google_identity_already_linked and the two must
  // never be collapsed. That one means "this Google account belongs to somebody
  // else"; this one means "your account is already linked to a different Google
  // account". The remedies are opposite, so the client has to tell them apart.
  const currentForUser = await deps.prisma.googleIdentity.findUnique({ where: { userId } });
  if (currentForUser && currentForUser.googleSub !== verified.googleSub) {
    throw new ApiError(
      409,
      "user_already_linked",
      "This account is already linked to a different Google account",
    );
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
