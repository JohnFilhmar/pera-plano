import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

type ParseStatsBody = {
  appVersion: string;
  rulesetVersion: number;
  providerKey: string;
  parsed: number;
  failed: number;
  periodStart: number;
  periodEnd: number;
};

export function telemetryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/telemetry/parse_stats",
    {
      config: {
        // The plugin's 429 flows through `errorHandler`, which emits the
        // `rate_limited` envelope; no custom errorResponseBuilder needed.
        rateLimit: {
          max: app.config.telemetryRateLimitMax,
          timeWindow: 60_000,
        },
      },
      schema: {
        body: {
          type: "object",
          required: [
            "appVersion",
            "rulesetVersion",
            "providerKey",
            "parsed",
            "failed",
            "periodStart",
            "periodEnd",
          ],
          additionalProperties: false, // privacy gate: counts only, never content
          properties: {
            appVersion: { type: "string", minLength: 1, maxLength: 32 },
            rulesetVersion: { type: "integer", minimum: 0 },
            providerKey: { type: "string", minLength: 1, maxLength: 64 },
            parsed: { type: "integer", minimum: 0 },
            failed: { type: "integer", minimum: 0 },
            periodStart: { type: "integer", minimum: 0 },
            periodEnd: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as ParseStatsBody;
      await app.prisma.telemetryParseStat.create({
        data: {
          id: randomUUID(),
          appVersion: body.appVersion,
          rulesetVersion: body.rulesetVersion,
          providerKey: body.providerKey,
          parsed: body.parsed,
          failed: body.failed,
          periodStart: BigInt(body.periodStart),
          periodEnd: BigInt(body.periodEnd),
          receivedAt: BigInt(Date.now()),
        },
      });
      return reply.status(202).send();
    },
  );
  return Promise.resolve();
}
