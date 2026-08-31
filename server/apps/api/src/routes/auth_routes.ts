import type { FastifyInstance } from "fastify";
import { requestOtp } from "../services/auth_service.js";

const EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

// Deliberately not `async`: the plugin body itself awaits nothing, and the repo lints
// @typescript-eslint/require-await as an error. The handler below does await, so it stays async.
export function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/auth/otp/request",
    {
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
      // Dev-only delivery channel: the OTP goes to the log, never the response.
      // Replace with a real mail provider before production traffic.
      request.log.info(
        { requestId, destination, otpCode: code },
        "otp issued (dev delivery)",
      );
      return { requestId };
    },
  );
  return Promise.resolve();
}
