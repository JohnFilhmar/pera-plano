import type { FastifyInstance } from "fastify";

// Stub seam. The real entitlement resolver arrives with store billing; until then the
// route deliberately reads nothing and always answers free/stub.
export function entitlementsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/entitlements", { preHandler: app.authenticate }, () => ({
    tier: "free",
    source: "stub",
  }));
  return Promise.resolve();
}
