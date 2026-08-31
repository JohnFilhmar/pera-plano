import type { FastifyInstance } from "fastify";
import { ApiError } from "../lib/errors.js";
import type { InstallClaim } from "../lib/play_integrity.js";
import {
  linkGoogleToUser,
  verifyWithGoogle,
  type GoogleAuthDeps,
} from "../services/google_auth_service.js";

const INSTALL_CLAIM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "packageName",
    "claimSource",
    "installBeginAt",
    "firstInstallAt",
    "appVersionAtInstall",
  ],
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

type GoogleAuthBody = {
  idToken: string;
  integrityToken: string;
  installClaim: InstallClaim;
};

/** Both timestamps null means the client sent no evidence at all, which the cohort rule cannot evaluate. */
function assertClaimUsable(claim: InstallClaim): void {
  if (claim.installBeginAt === null && claim.firstInstallAt === null) {
    throw new ApiError(400, "install_claim_invalid", "The install claim carries no timestamp");
  }
}

// Deliberately not `async`: the plugin body itself awaits nothing, and the repo lints
// @typescript-eslint/require-await as an error. Both handlers below do await, so they stay async.
export function googleAuthRoutes(app: FastifyInstance, deps: GoogleAuthDeps): Promise<void> {
  // Strictest per-IP tier in the app. Both endpoints are reachable without a session and each
  // accepted call costs outbound requests to Google, so the budget bounds what one address can
  // spend on our behalf. The plugin's 429 flows through `errorHandler` as `rate_limited`.
  const rateLimit = { max: app.config.googleAuthRateLimitMax, timeWindow: 60_000 };

  app.post<{ Body: GoogleAuthBody }>(
    "/v1/auth/google/verify",
    { schema: { body: BODY_SCHEMA }, config: { rateLimit } },
    (request) => {
      assertClaimUsable(request.body.installClaim);
      // The ONLY Date.now() on this path. Everything below takes nowMs as an argument,
      // which is what makes the beta-window rules testable without a global clock mock.
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

  return Promise.resolve();
}
