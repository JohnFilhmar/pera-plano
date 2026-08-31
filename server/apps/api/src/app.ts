import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type AppConfig } from "./config.js";
import { errorHandler } from "./lib/errors.js";
import { healthRoutes } from "./routes/health_routes.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export function buildApp(overrides: Partial<AppConfig> = {}): FastifyInstance {
  const config: AppConfig = { ...loadConfig(), ...overrides };
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
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
  void app.register(healthRoutes);
  return app;
}
