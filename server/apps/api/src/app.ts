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
import { googleAuthRoutes } from "./routes/google_auth_routes.js";
import { createGoogleJwksFetcher, type JwksFetcher } from "./lib/google_id_token.js";
import { createMailer, type Mailer, type SendMail } from "./lib/mailer.js";
import {
  createPlayIntegrityDecoder,
  type PlayIntegrityDecoder,
} from "./lib/play_integrity.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    mailer: Mailer;
  }
}

/**
 * The two collaborators that talk to Google. A test supplies both and the real
 * adapters are never constructed, so no suite parses a service-account key or
 * opens a socket.
 */
export type BuildAppSeams = {
  fetchJwks?: JwksFetcher;
  decodeIntegrity?: PlayIntegrityDecoder;
  /** Supplied by tests so no suite opens an SMTP connection or reads a password. */
  sendMail?: SendMail;
};

export function buildApp(
  overrides: Partial<AppConfig> = {},
  seams: BuildAppSeams = {},
): FastifyInstance {
  const config: AppConfig = { ...loadConfig(), ...overrides };
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // Fastify's Ajv defaults to removeAdditional: true, which silently strips unknown body
    // fields. Telemetry's privacy stance needs `additionalProperties: false` to REJECT a
    // content-bearing field, not quietly accept the request without it.
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.decorate("config", config);
  // Built before ready() so a route can rely on `app.mailer` existing. The log
  // transport is refused in production by loadConfig, not here.
  app.decorate("mailer", createMailer(config.mail, app.log, seams.sendMail));
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

  // `??` short-circuits, so a seamed app never runs these factories: the JSON key is not
  // parsed and no HTTP client is created.
  const fetchJwks = seams.fetchJwks ?? createGoogleJwksFetcher({ url: config.googleJwksUrl });
  const decodeIntegrity =
    seams.decodeIntegrity ??
    createPlayIntegrityDecoder({
      packageName: config.playPackageName,
      serviceAccountJson: config.playIntegrityServiceAccountJson,
    });
  // Registered in its own scope, and not until ready(), because `app.prisma` is decorated
  // by prismaPlugin above and only exists once that plugin has run.
  void app.register((instance) =>
    googleAuthRoutes(instance, {
      prisma: app.prisma,
      fetchJwks,
      decodeIntegrity,
      expectedAudience: config.googleOauthClientId,
      expectedPackageName: config.playPackageName,
      jwtSecret: config.jwtSecret,
      betaWindowStartAt: config.betaWindowStartAt,
      betaWindowEndAt: config.betaWindowEndAt,
      maxSkewMs: config.integrityMaxSkewMs,
    }),
  );
  return app;
}
