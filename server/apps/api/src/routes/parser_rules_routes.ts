import type { FastifyInstance } from "fastify";
import { ApiError } from "../lib/errors.js";

// Declared here rather than imported from prisma/seed_data.ts: the build sets
// rootDir: "src", and even a type-only import pulls the file into the program and
// fails with TS6059. prisma/ is seed input, src/ is the shipped server; the wire
// shape this route serves belongs on the route.
type StoredRuleset = {
  version: number;
  providers: unknown[];
};

// Deliberately not `async`: the plugin body itself awaits nothing, and the repo lints
// @typescript-eslint/require-await as an error. The handler below does await, so it stays async.
export function parserRulesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/parser_rules",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            since_version: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request) => {
      const { since_version: sinceVersion } = request.query as {
        since_version?: number;
      };
      const latest = await app.prisma.parserRuleset.findFirst({
        orderBy: { version: "desc" },
      });
      if (!latest) {
        throw new ApiError(404, "not_found", "No parser ruleset available");
      }
      if (sinceVersion !== undefined && sinceVersion >= latest.version) {
        return { version: latest.version, providers: [] };
      }
      const rules = latest.rulesJson as unknown as StoredRuleset;
      return { version: latest.version, providers: rules.providers };
    },
  );
  return Promise.resolve();
}
