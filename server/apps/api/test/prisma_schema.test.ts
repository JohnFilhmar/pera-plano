import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("prisma schema", () => {
  it("creates all 10 snake_case tables", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "backup_vaults",
      "beta_pregrants",
      "entitlements",
      "google_identities",
      "install_attestations",
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
  it("rejects a second identity for the same google_sub", async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const googleSub = `sub_${randomUUID()}`;
    const now = BigInt(Date.now());
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, destination: `${id}@example.com`, createdAt: now },
      });
    }
    await prisma.googleIdentity.create({
      data: {
        id: randomUUID(),
        userId,
        googleSub,
        email: `${userId}@example.com`,
        emailVerified: true,
        linkedAt: now,
        lastVerifiedAt: now,
      },
    });
    await expect(
      prisma.googleIdentity.create({
        data: {
          id: randomUUID(),
          userId: otherUserId,
          googleSub,
          email: `${otherUserId}@example.com`,
          emailVerified: true,
          linkedAt: now,
          lastVerifiedAt: now,
        },
      }),
    ).rejects.toThrow();
    await prisma.googleIdentity.deleteMany({ where: { googleSub } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("stores an attestation with both install timestamps nullable", async () => {
    const userId = randomUUID();
    const now = BigInt(Date.now());
    await prisma.user.create({
      data: { id: userId, destination: `${userId}@example.com`, createdAt: now },
    });
    const created = await prisma.installAttestation.create({
      data: {
        id: randomUUID(),
        userId,
        googleSub: `sub_${userId}`,
        packageName: "com.filldev.peraplano",
        claimSource: "package_manager",
        installBeginAt: null,
        firstInstallAt: now,
        appVersionAtInstall: null,
        licensingVerdict: "LICENSED",
        recognitionVerdict: "PLAY_RECOGNIZED",
        cohortGranted: true,
        createdAt: now,
      },
    });
    expect(created.installBeginAt).toBeNull();
    expect(created.firstInstallAt).toBe(now);
    await prisma.installAttestation.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("rejects a second pregrant for the same email and keeps it user-free", async () => {
    const email = `pregrant_${randomUUID()}@example.com`;
    const now = BigInt(Date.now());
    const created = await prisma.betaPregrant.create({
      data: { id: randomUUID(), email, note: "adb tester, predates Play", createdAt: now },
    });
    expect(created.claimedAt).toBeNull();
    expect(created.claimedByUserId).toBeNull();
    await expect(
      prisma.betaPregrant.create({
        data: { id: randomUUID(), email, note: "duplicate", createdAt: now },
      }),
    ).rejects.toThrow();
    // no foreign key to users: a pregrant is written before the account exists
    const claimed = await prisma.betaPregrant.update({
      where: { email },
      data: { claimedAt: now, claimedByUserId: randomUUID() },
    });
    expect(claimed.claimedAt).toBe(now);
    await prisma.betaPregrant.delete({ where: { email } });
  });
});
