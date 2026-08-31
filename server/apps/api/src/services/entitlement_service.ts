import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { EntitlementSource, Tier } from "../lib/beta_cohort.js";

/**
 * The only place tier is decided. Resolution order per the linking design §8:
 * a beta_cohort grant wins; play_billing is reserved and deliberately has no
 * branch; everything else is free. Do not add a play_billing check here without
 * a spec that defines what it verifies.
 */
export async function resolveEntitlement(
  prisma: PrismaClient,
  userId: string,
): Promise<{ tier: Tier; source: EntitlementSource }> {
  const row = await prisma.entitlement.findUnique({ where: { userId } });
  if (row?.source === "beta_cohort") {
    return { tier: "plus", source: "beta_cohort" };
  }
  if (row?.source === "manual_grant") {
    return { tier: "plus", source: "manual_grant" };
  }
  return { tier: "free", source: "stub" };
}

/**
 * Covers the testers who predate Google Play (design section 7.1). The Play
 * verdict is deliberately not consulted: a pregrant is a closed list the
 * operator typed in by hand, which is what makes skipping the verdict safe.
 * Single-use, by the unique email plus the claimedAt stamp.
 */
export async function claimPregrantIfAny(
  prisma: PrismaClient,
  userId: string,
  email: string,
  nowMs: number,
): Promise<boolean> {
  const pregrant = await prisma.betaPregrant.findUnique({ where: { email } });
  if (!pregrant || pregrant.claimedAt !== null) return false;

  await prisma.betaPregrant.update({
    where: { email },
    data: { claimedAt: BigInt(nowMs), claimedByUserId: userId },
  });

  const existing = await prisma.entitlement.findUnique({ where: { userId } });
  if (existing?.source === "beta_cohort" || existing?.source === "manual_grant") {
    return true;
  }
  await prisma.entitlement.upsert({
    where: { userId },
    create: {
      id: randomUUID(),
      userId,
      tier: "plus",
      source: "manual_grant",
      updatedAt: BigInt(nowMs),
    },
    update: { tier: "plus", source: "manual_grant", updatedAt: BigInt(nowMs) },
  });
  return true;
}

/**
 * Permanent. Nothing in this codebase downgrades a beta_cohort grant, and the
 * idempotent write preserves the original timestamp so the grant stays audit-
 * traceable against its install_attestations row.
 */
export async function grantBetaCohort(
  prisma: PrismaClient,
  userId: string,
  nowMs: number,
): Promise<void> {
  const existing = await prisma.entitlement.findUnique({ where: { userId } });
  if (existing?.source === "beta_cohort") return;
  await prisma.entitlement.upsert({
    where: { userId },
    create: {
      id: randomUUID(),
      userId,
      tier: "plus",
      source: "beta_cohort",
      updatedAt: BigInt(nowMs),
    },
    update: { tier: "plus", source: "beta_cohort", updatedAt: BigInt(nowMs) },
  });
}
