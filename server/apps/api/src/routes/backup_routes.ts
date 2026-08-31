import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ApiError } from "../lib/errors.js";

const BASE64_PATTERN = "^[A-Za-z0-9+/=_-]+$"; // accepts base64 and base64url

// The blob is client-side-encrypted. The server stores and returns the bytes it was
// given: it never parses, inspects or logs them, and every query is keyed by the
// authenticated `request.userId`, never by anything the client sends.
// Not `async`: the plugin body awaits nothing and the repo lints require-await as an error.
export function backupRoutes(app: FastifyInstance): Promise<void> {
  app.put(
    "/backup/vault",
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          type: "object",
          required: ["schemaVersion", "deviceId", "blob"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "integer", minimum: 1 },
            deviceId: { type: "string", minLength: 1, maxLength: 128 },
            blob: { type: "string", minLength: 1, pattern: BASE64_PATTERN },
          },
        },
      },
    },
    async (request) => {
      const { schemaVersion, deviceId, blob } = request.body as {
        schemaVersion: number;
        deviceId: string;
        blob: string;
      };
      const storedAt = Date.now();
      await app.prisma.backupVault.upsert({
        where: { userId: request.userId },
        update: { schemaVersion, deviceId, blob, storedAt: BigInt(storedAt) },
        create: {
          id: randomUUID(),
          userId: request.userId,
          schemaVersion,
          deviceId,
          blob,
          storedAt: BigInt(storedAt),
        },
      });
      return { storedAt };
    },
  );

  app.get("/backup/vault", { preHandler: app.authenticate }, async (request) => {
    const vault = await app.prisma.backupVault.findUnique({
      where: { userId: request.userId },
    });
    if (!vault) {
      throw new ApiError(
        404,
        "not_found",
        "No backup vault stored for this user",
      );
    }
    return {
      schemaVersion: vault.schemaVersion,
      deviceId: vault.deviceId,
      blob: vault.blob,
      storedAt: Number(vault.storedAt),
    };
  });
  return Promise.resolve();
}
