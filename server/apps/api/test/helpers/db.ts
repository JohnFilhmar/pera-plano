import type { PrismaClient } from "@prisma/client";

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "users", "otp_requests", "refresh_tokens", "parser_rulesets", "telemetry_parse_stats", "backup_vaults", "entitlements" CASCADE',
  );
}
