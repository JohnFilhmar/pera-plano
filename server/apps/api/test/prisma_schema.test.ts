import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("prisma schema", () => {
  it("creates all 7 snake_case tables", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "backup_vaults",
      "entitlements",
      "otp_requests",
      "parser_rulesets",
      "refresh_tokens",
      "telemetry_parse_stats",
      "users",
    ]);
  });

  it("maps camelCase model fields onto snake_case columns", async () => {
    const id = randomUUID();
    const destination = `${id}@example.com`;
    const createdAt = BigInt(Date.now());
    await prisma.user.create({ data: { id, destination, createdAt } });
    const found = await prisma.user.findUnique({ where: { destination } });
    expect(found?.id).toBe(id);
    expect(found?.createdAt).toBe(createdAt);
    // prove the physical column names are snake_case
    const raw = await prisma.$queryRawUnsafe<Array<{ created_at: bigint }>>(
      `SELECT created_at FROM users WHERE id = '${id}'`,
    );
    expect(raw[0]?.created_at).toBe(createdAt);
    await prisma.user.delete({ where: { id } });
  });
});
