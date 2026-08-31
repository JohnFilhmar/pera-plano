import type { FastifyInstance } from "fastify";
import { resolveEntitlement } from "../services/entitlement_service.js";

export function entitlementsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/entitlements", { preHandler: app.authenticate }, (request) =>
    resolveEntitlement(app.prisma, request.userId),
  );
  return Promise.resolve();
}
