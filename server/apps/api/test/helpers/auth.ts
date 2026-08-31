import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { signAccessToken } from "../../src/lib/jwt.js";

export async function createUserWithToken(
  app: FastifyInstance,
): Promise<{ userId: string; accessToken: string }> {
  const userId = randomUUID();
  await app.prisma.user.create({
    data: {
      id: userId,
      destination: `${userId}@example.com`,
      createdAt: BigInt(Date.now()),
    },
  });
  return {
    userId,
    accessToken: signAccessToken(userId, app.config.jwtSecret),
  };
}
