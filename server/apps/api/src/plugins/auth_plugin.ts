import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "../lib/jwt.js";
import { ApiError } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}

// One message for every rejection. A missing header, a wrong scheme, a garbage
// token, a bad signature and an expired token are indistinguishable in the
// response, so the endpoint cannot be used to probe which part of a presented
// credential was wrong. The token itself is never logged.
const UNAUTHORIZED_MESSAGE = "Missing or invalid access token";
const BEARER_PREFIX = "Bearer ";

export const authPlugin = fp((app: FastifyInstance) => {
  app.decorateRequest("userId", "");
  app.decorate(
    "authenticate",
    (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      const header = request.headers.authorization;
      if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
        return Promise.reject(
          new ApiError(401, "unauthorized", UNAUTHORIZED_MESSAGE),
        );
      }
      const claims = verifyAccessToken(
        header.slice(BEARER_PREFIX.length),
        app.config.jwtSecret,
      );
      if (claims === null) {
        return Promise.reject(
          new ApiError(401, "unauthorized", UNAUTHORIZED_MESSAGE),
        );
      }
      request.userId = claims.sub;
      return Promise.resolve();
    },
  );
  return Promise.resolve();
});
