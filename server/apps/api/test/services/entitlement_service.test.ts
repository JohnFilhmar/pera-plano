import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { resetDb } from "../helpers/db.js";
import {
  claimPregrantIfAny,
  grantBetaCohort,
  resolveEntitlement,
} from "../../src/services/entitlement_service.js";

const prisma = new PrismaClient();
const NOW = 1_756_000_000_000;

async function makeUser(): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: { id, destination: `${id}@example.com`, createdAt: BigInt(NOW) },
  });
  return id;
}

beforeEach(async () => {
  await resetDb(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveEntitlement", () => {
  it("returns free/stub when the user has no entitlement row", async () => {
    const userId = await makeUser();
    expect(await resolveEntitlement(prisma, userId)).toEqual({
      tier: "free",
      source: "stub",
    });
  });

  it("returns plus/beta_cohort after a grant", async () => {
    const userId = await makeUser();
    await grantBetaCohort(prisma, userId, NOW);
    expect(await resolveEntitlement(prisma, userId)).toEqual({
      tier: "plus",
      source: "beta_cohort",
    });
  });

  it("returns plus/manual_grant for a claimed pregrant", async () => {
    const userId = await makeUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await prisma.betaPregrant.create({
      data: {
        id: randomUUID(),
        email: user.destination,
        note: "pre-play tester",
        createdAt: BigInt(NOW),
      },
    });
    expect(
      await claimPregrantIfAny(prisma, userId, user.destination, NOW),
    ).toBe(true);
    expect(await resolveEntitlement(prisma, userId)).toEqual({
      tier: "plus",
      source: "manual_grant",
    });
  });

  it("does not resolve a play_billing row in this pass", async () => {
    const userId = await makeUser();
    await prisma.entitlement.create({
      data: {
        id: randomUUID(),
        userId,
        tier: "plus",
        source: "play_billing",
        updatedAt: BigInt(NOW),
      },
    });
    expect(await resolveEntitlement(prisma, userId)).toEqual({
      tier: "free",
      source: "stub",
    });
  });
});

describe("grantBetaCohort", () => {
  it("is idempotent and keeps the original grant timestamp", async () => {
    const userId = await makeUser();
    await grantBetaCohort(prisma, userId, NOW);
    await grantBetaCohort(prisma, userId, NOW + 999_999);
    const rows = await prisma.entitlement.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.updatedAt).toBe(BigInt(NOW));
  });

  it("writes no row for a user who never qualified", async () => {
    await makeUser();
    expect(await prisma.entitlement.count()).toBe(0);
  });
});

describe("claimPregrantIfAny", () => {
  it("returns false when no pregrant exists and writes nothing", async () => {
    const userId = await makeUser();
    expect(
      await claimPregrantIfAny(prisma, userId, "nobody@example.com", NOW),
    ).toBe(false);
    expect(await prisma.entitlement.count()).toBe(0);
  });

  it("cannot be claimed twice", async () => {
    const firstId = await makeUser();
    const first = await prisma.user.findUniqueOrThrow({
      where: { id: firstId },
    });
    await prisma.betaPregrant.create({
      data: {
        id: randomUUID(),
        email: first.destination,
        note: "tester",
        createdAt: BigInt(NOW),
      },
    });
    expect(
      await claimPregrantIfAny(prisma, firstId, first.destination, NOW),
    ).toBe(true);

    const secondId = await makeUser();
    expect(
      await claimPregrantIfAny(prisma, secondId, first.destination, NOW + 1000),
    ).toBe(false);
    expect(await prisma.entitlement.count()).toBe(1);

    const pregrant = await prisma.betaPregrant.findUniqueOrThrow({
      where: { email: first.destination },
    });
    expect(pregrant.claimedByUserId).toBe(firstId);
    expect(pregrant.claimedAt).toBe(BigInt(NOW));
  });

  it("leaves an existing beta_cohort grant in place", async () => {
    const userId = await makeUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await grantBetaCohort(prisma, userId, NOW);
    await prisma.betaPregrant.create({
      data: {
        id: randomUUID(),
        email: user.destination,
        note: "tester",
        createdAt: BigInt(NOW),
      },
    });
    await claimPregrantIfAny(prisma, userId, user.destination, NOW + 1000);
    expect(await resolveEntitlement(prisma, userId)).toEqual({
      tier: "plus",
      source: "beta_cohort",
    });
  });
});
