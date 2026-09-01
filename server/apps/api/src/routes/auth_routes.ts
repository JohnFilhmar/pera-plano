import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ApiError } from "../lib/errors.js";
import { signAccessToken } from "../lib/jwt.js";
import { OTP_TTL_MS } from "../lib/otp.js";
import {
  requestOtp,
  verifyOtp,
  issueRefreshToken,
  rotateRefreshToken,
} from "../services/auth_service.js";

const EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

// Deliberately not `async`: the plugin body itself awaits nothing, and the repo lints
// @typescript-eslint/require-await as an error. The handler below does await, so it stays async.
export function authRoutes(app: FastifyInstance): Promise<void> {
  // Strict per-IP tier for the unauthenticated auth surface: without it anyone can create
  // otp_requests rows without limit, and mail to arbitrary addresses once a real provider
  // replaces the dev log. OTP_MAX_ATTEMPTS only bounds guesses against an existing request.
  // The plugin's 429 flows through `errorHandler`, which emits the `rate_limited` envelope.
  const rateLimit = { max: app.config.authRateLimitMax, timeWindow: 60_000 };

  app.post(
    "/auth/otp/request",
    {
      config: { rateLimit },
      schema: {
        body: {
          type: "object",
          required: ["channel", "destination"],
          additionalProperties: false,
          properties: {
            channel: { type: "string", enum: ["email"] },
            destination: { type: "string", pattern: EMAIL_PATTERN },
          },
        },
      },
    },
    async (request) => {
      const { destination } = request.body as {
        channel: "email";
        destination: string;
      };
      const { requestId, code } = await requestOtp(
        app.prisma,
        destination,
        app.config.jwtSecret,
      );
      // The code leaves the process here and nowhere else. Delivery failure is
      // reported rather than swallowed: a caller told "ok" would sit waiting for
      // a mail that was never sent. The OTP row is left to expire on its own.
      try {
        await app.mailer.sendOtp({
          to: destination,
          code,
          expiresInMinutes: Math.round(OTP_TTL_MS / 60_000),
        });
      } catch (error) {
        request.log.error({ err: error, requestId }, "otp mail delivery failed");
        throw new ApiError(
          502,
          "mail_delivery_failed",
          "Could not send the sign-in code. Try again shortly.",
        );
      }
      return { requestId };
    },
  );

  app.post(
    "/auth/otp/verify",
    {
      config: { rateLimit },
      schema: {
        body: {
          type: "object",
          required: ["requestId", "code"],
          additionalProperties: false,
          properties: {
            requestId: { type: "string", minLength: 1 },
            code: { type: "string", pattern: "^\\d{6}$" },
          },
        },
      },
    },
    async (request) => {
      const { requestId, code } = request.body as {
        requestId: string;
        code: string;
      };
      const result = await verifyOtp(
        app.prisma,
        requestId,
        code,
        app.config.jwtSecret,
      );
      if (result.kind === "not_found") {
        throw new ApiError(
          404,
          "otp_not_found",
          "OTP request not found or already used",
        );
      }
      if (result.kind === "expired") {
        throw new ApiError(401, "otp_expired", "OTP code has expired");
      }
      if (result.kind === "too_many_attempts") {
        throw new ApiError(
          429,
          "too_many_attempts",
          "Too many incorrect attempts",
        );
      }
      if (result.kind === "invalid_code") {
        throw new ApiError(401, "invalid_code", "Incorrect OTP code");
      }
      const accessToken = signAccessToken(result.userId, app.config.jwtSecret);
      const refreshToken = await issueRefreshToken(
        app.prisma,
        result.userId,
        randomUUID(), // new token family per login
      );
      return {
        accessToken,
        refreshToken,
        user: { id: result.userId, destination: result.destination },
      };
    },
  );

  app.post(
    "/auth/token/refresh",
    {
      config: { rateLimit },
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          additionalProperties: false,
          properties: {
            refreshToken: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const { refreshToken } = request.body as { refreshToken: string };
      const result = await rotateRefreshToken(app.prisma, refreshToken);
      if (result.kind === "reuse_detected") {
        throw new ApiError(
          401,
          "token_reuse_detected",
          "Refresh token reuse detected; token family revoked",
        );
      }
      if (result.kind === "invalid") {
        throw new ApiError(
          401,
          "invalid_token",
          "Refresh token is invalid or expired",
        );
      }
      const accessToken = signAccessToken(result.userId, app.config.jwtSecret);
      return { accessToken, refreshToken: result.refreshToken };
    },
  );
  return Promise.resolve();
}
