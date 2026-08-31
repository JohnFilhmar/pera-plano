import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { loadConfig, type AppConfig } from "./config.js";
import { errorHandler } from "./lib/errors.js";
import { prismaPlugin } from "./plugins/prisma_plugin.js";
import { authPlugin } from "./plugins/auth_plugin.js";
import { healthRoutes } from "./routes/health_routes.js";
import { authRoutes } from "./routes/auth_routes.js";
import { parserRulesRoutes } from "./routes/parser_rules_routes.js";
import { telemetryRoutes } from "./routes/telemetry_routes.js";
import { backupRoutes } from "./routes/backup_routes.js";
import { entitlementsRoutes } from "./routes/entitlements_routes.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export function buildApp(overrides: Partial<AppConfig> = {}): FastifyInstance {
  const config: AppConfig = { ...loadConfig(), ...overrides };
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // Fastify's Ajv defaults to removeAdditional: true, which silently strips unknown body
    // fields. Telemetry's privacy stance needs `additionalProperties: false` to REJECT a
    // content-bearing field, not quietly accept the request without it.
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.decorate("config", config);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: {
        code: "not_found",
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });
  void app.register(prismaPlugin);
  void app.register(authPlugin);
  // Opt-in only: every limited route declares its own budget through `config.rateLimit`,
  // keyed by `request.ip`.
  void app.register(rateLimit, { global: false });
  void app.register(healthRoutes);
  void app.register(authRoutes, { prefix: "/v1" });
  void app.register(parserRulesRoutes, { prefix: "/v1" });
  void app.register(telemetryRoutes, { prefix: "/v1" });
  void app.register(backupRoutes, { prefix: "/v1" });
  void app.register(entitlementsRoutes, { prefix: "/v1" });
  return app;
}
